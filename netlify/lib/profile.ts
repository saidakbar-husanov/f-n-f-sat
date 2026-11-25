// netlify/lib/profile.ts — self-service profile for students and mentors:
// display name, username, login email and leaderboard visibility. Passwords
// keep using POST /api/auth/change-password (lib/platform). Nothing here ever
// logs or returns a password.
//
// Identity checks use the platform's own sign-in provider: changing the login
// email requires the current password. No email delivery is configured, so the
// new address cannot be confirmed by a link; until it is, the previous login
// email keeps signing in (users.previous_email) and the account owner can
// retire it from Settings.
import { and, eq, ne, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { sessions, users } from "../../db/schema.js";
import { verifyPassword } from "./passwords.js";
import type { FullTestDeps } from "./fulltests.js";

type DbUser = typeof users.$inferSelect;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export function usernameProblem(v: string) {
  if (!v) return "Choose a username.";
  if (!USERNAME_RE.test(v)) return "Usernames are 3–30 characters: letters, numbers, dots, dashes or underscores, starting with a letter or number.";
  return null;
}

// A fresh non-identifying handle for an account without a username.
export async function freshHandle(exec: typeof db = db) {
  for (let i = 0; i < 8; i++) {
    const h = `learner-${Math.random().toString(36).slice(2, 10).padEnd(8, "0")}`;
    const r = rowsOf(await exec.execute(sql`select 1 from users where lower(username) = ${h} limit 1`));
    if (!r.length) return h;
  }
  return `learner-${Date.now().toString(36)}`;
}

// Is this login (email) already used by another account, as its current or
// still-active previous email?
async function emailTaken(email: string, selfId: number) {
  const [row] = await db.select({ id: users.id }).from(users)
    .where(and(ne(users.id, selfId), or(eq(users.email, email), eq(users.previousEmail, email)))).limit(1);
  return !!row;
}

export async function handleProfile(req: Request, parts: string[], deps: FullTestDeps & { publicUser: (u: DbUser) => unknown }): Promise<Response | null> {
  const [resource, id] = parts;
  if (resource !== "auth" || (id !== "profile" && id !== "leaderboard-visibility")) return null;
  const { json, requireUser, publicUser } = deps;
  const auth = await requireUser(req);
  if (auth.error) return auth.error;
  const me = auth.user!;
  const method = req.method;
  if (me.mustChangePassword) return json({ error: "Change your temporary password to continue.", mustChangePassword: true }, 403);

  if (id === "leaderboard-visibility" && method === "PUT") {
    if (me.role !== "student") return json({ error: "Only student entries appear on the leaderboard." }, 400);
    const b = await req.json().catch(() => ({}));
    const [u] = await db.update(users).set({ leaderboardVisible: !!b.visible }).where(eq(users.id, me.id)).returning();
    return json({ user: publicUser(u) });
  }

  if (id === "profile" && parts[2] === "previous-email" && method === "DELETE") {
    return json({ user: publicUser(await dropPreviousEmail(me)) });
  }
  if (id !== "profile" || method !== "PUT") return json({ error: "Method not allowed." }, 405);
  if (me.role !== "student" && me.role !== "mentor" && me.role !== "admin") return json({ error: "Profile editing is not available for this account." }, 403);
  const b = await req.json().catch(() => ({}));
  const set: Partial<typeof users.$inferInsert> = {};

  if (b.displayName !== undefined) {
    const name = String(b.displayName ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
    if (!name) return json({ error: "Enter your name." }, 400);
    set.displayName = name;
  }

  let newUsername: string | null = null;
  if (b.username !== undefined) {
    if (me.provider === "admin") return json({ error: "The studio admin username cannot be changed." }, 400);
    const v = String(b.username ?? "").trim().toLowerCase();
    const problem = usernameProblem(v);
    if (problem) return json({ error: problem, field: "username" }, 400);
    if (v !== (me.username || "").toLowerCase()) newUsername = v;
  }

  let emailChange: { next: string | null } | null = null;
  if (b.email !== undefined) {
    const next = String(b.email ?? "").trim().toLowerCase() || null;
    if (next !== (me.email || null)) {
      if (me.provider === "admin") return json({ error: "The studio admin has no login email." }, 400);
      if (next && !EMAIL_RE.test(next)) return json({ error: "Enter a valid email address.", field: "email" }, 400);
      // Identity check: the current password, verified the same way sign-in does.
      if (!me.passwordHash) return json({ error: "This account signs in through Google, which manages its email address. Set a password first to change your login email here.", field: "email" }, 400);
      if (!verifyPassword(String(b.currentPassword ?? ""), me.passwordHash)) return json({ error: "Your current password is incorrect.", field: "currentPassword" }, 400);
      if (!next && !(newUsername || me.username) && !me.phone) return json({ error: "Keep at least one way to sign in (username, email or phone).", field: "email" }, 400);
      if (next && (await emailTaken(next, me.id))) return json({ error: "That email is already used by another account.", field: "email" }, 409);
      emailChange = { next };
    }
  }

  if (!Object.keys(set).length && !newUsername && !emailChange) {
    const [fresh] = await db.select().from(users).where(eq(users.id, me.id));
    return json({ user: publicUser(fresh), unchanged: true });
  }

  try {
    if (emailChange) {
      set.email = emailChange.next;
      // The old login email keeps working until the new one is verified.
      set.previousEmail = me.email && me.email !== emailChange.next ? me.email : me.previousEmail === emailChange.next ? null : me.previousEmail;
      set.emailVerifiedAt = null;
    }
    if (newUsername) set.username = newUsername;
    // One atomic statement: the name is claimed only if no other account holds
    // it in any letter case. Two simultaneous claims are settled by the unique
    // indexes on username / lower(username) — exactly one succeeds.
    const [updated] = await db.update(users).set(set).where(and(eq(users.id, me.id),
      newUsername ? sql`not exists (select 1 from users u2 where lower(u2.username) = ${newUsername} and u2.id <> ${me.id})` : undefined)).returning();
    if (!updated) return json({ error: "That username is taken.", field: "username" }, 409);
    if (emailChange) {
      // Other devices sign in again with the new details; this one stays signed in.
      const authz = req.headers.get("authorization") || "";
      const token = authz.startsWith("Bearer ") ? authz.slice(7).trim() : "";
      await db.delete(sessions).where(token ? and(eq(sessions.userId, me.id), sql`${sessions.token} <> ${token}`) : eq(sessions.userId, me.id));
    }
    const { audit } = await import("./platform.js");
    await audit(me.id, "profile.update", "user", me.id, { fields: [...Object.keys(set)].filter((k) => k !== "emailVerifiedAt") });
    return json({
      user: publicUser(updated),
      notice: emailChange?.next ? "Your login email was changed. Email delivery is not configured on this platform, so the new address can't be confirmed by link yet — your previous login email keeps working until you remove it." : null,
    });
  } catch (e: any) {
    const code = String(e?.code ?? e?.cause?.code ?? "");
    const text = String(e?.cause?.message ?? e?.message ?? "");
    if (code === "23505" || /duplicate key|unique/i.test(text)) {
      const field = /email/i.test(text) ? "email" : "username";
      return json({ error: field === "email" ? "That email is already used by another account." : "That username is taken.", field }, 409);
    }
    throw e;
  }
}

// Retire the previous login email (it stops signing in).
export async function dropPreviousEmail(user: DbUser) {
  const [u] = await db.update(users).set({ previousEmail: null }).where(eq(users.id, user.id)).returning();
  return u;
}
