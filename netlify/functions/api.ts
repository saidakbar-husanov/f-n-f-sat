// netlify/functions/api.ts — single entry point for all Fast&Free SAT data.
// Routes everything under /api/* against the Netlify Database.
import type { Config } from "@netlify/functions";
import { eq, and, or, desc, sql, inArray } from "drizzle-orm";
import { getUser as getIdentityUser } from "@netlify/identity";
import { randomBytes, timingSafeEqual, createPublicKey, createHash, verify as cryptoVerify } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  questions, attempts, pages, users, sessions, settings, classes,
  classInvites, classEnrollments, mentorActivationCodes, savedQuestions, assignments,
  tests, testModules, testModuleQuestions, testAttempts, testAssignments, lessons, lessonComments, testHighlights,
} from "../../db/schema.js";
import { SEED_QUESTIONS, SEED_PAGES } from "./seed-data.js";
import { handleVocab } from "../lib/vocab.js";
import { handleCollections } from "../lib/collections.js";
import {
  BANK, TEST_EXCLUSIVE, type QuestionSource, sanitizeRichHtml, loadTestModules, loadModuleQuestions,
  isAnswerCorrect, isPerModuleTimed, initialPlan, planModules, moduleTransition, buildScoreReport,
  ensureScoreReport, loadAssignment, assignmentReaches, ensureSeedFullTest, handleFullTests, publishProblems,
} from "../lib/fulltests.js";
import { questionMediaStore, saveQuestionMedia, MAX_IMAGE_BYTES } from "../lib/test-import.js";
import { hashPassword, verifyPassword } from "../lib/passwords.js";
import {
  handlePlatform, consumeUsage, recordModuleCompletion, evaluateBadges, examSettings, notify,
} from "../lib/platform.js";
import {
  auditLog, notifications, messages, badgeAwards, studentDailyActivity, usageLimits, questionReports,
} from "../../db/schema.js";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });

// ─────────────── AUTH HELPERS ───────────────
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";
// Optional override; by default the callback is <site origin>/api/auth/google/callback.
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || "";
const APPLE_CLIENT_ID = process.env.APPLE_CLIENT_ID || "";
// No built-in fallback: admin sign-in stays disabled until ADMIN_PASSCODE is set.
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || "";
// Admin sign-in lockout: this many failures inside the window locks the
// passcode form for ADMIN_LOCKOUT_MS. The counter lives in the settings table.
const ADMIN_LOGIN_FAILURES_KEY = "admin-login-failures";
const ADMIN_MAX_FAILURES = 10;
const ADMIN_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const ADMIN_LOCKOUT_MS = 15 * 60 * 1000;

// Password storage (scrypt, per-user salt) lives in lib/passwords.
const newToken = () => randomBytes(32).toString("hex");
const codeHash = (code: string) => createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
const newCode = (prefix: string) => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  return `${prefix}-${Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("")}`;
};

type DbUser = typeof users.$inferSelect;
// Shape sent to the browser — never expose the password hash.
const publicUser = (u: DbUser) => ({
  id: u.id, displayName: u.displayName, username: u.username,
  email: u.email, phone: u.phone, role: u.role, provider: u.provider,
  avatarUrl: u.avatarUrl, status: u.status, approvedAt: u.approvedAt, bannedAt: u.bannedAt,
  mustChangePassword: u.mustChangePassword, preferences: u.preferences ?? {},
});

// One lookup per request, however many handlers ask who is calling.
const requestUsers = new WeakMap<Request, Promise<DbUser | null>>();
function userFromReq(req: Request): Promise<DbUser | null> {
  let p = requestUsers.get(req);
  if (!p) { p = lookupUser(req); requestUsers.set(req, p); }
  return p;
}
async function lookupUser(req: Request): Promise<DbUser | null> {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token) {
    const [s] = await db.select().from(sessions).where(eq(sessions.token, token));
    if (s) {
      const [u] = await db.select().from(users).where(eq(users.id, s.userId));
      if (u) return u;
    }
  }
  try {
    const identityUser = await getIdentityUser();
    if (!identityUser) return null;
    const identity = identityUser as any;
    const email = identity.email ? String(identity.email).toLowerCase() : null;
    let [u] = await db.select().from(users).where(and(eq(users.provider, "netlify"), eq(users.providerId, identity.id)));
    if (!u && email) [u] = await db.select().from(users).where(eq(users.email, email));
    return u ?? null;
  } catch {
    return null;
  }
}

async function requireUser(req: Request, roles?: string[]) {
  const user = await userFromReq(req);
  if (!user) return { error: json({ error: "Sign in to continue." }, 401), user: null };
  if (user.status === "banned") return { error: json({ error: "This account has been banned." }, 403), user: null };
  // After an admin password reset only the auth routes (me, logout, change
  // password) work until the user chooses a new password.
  if (user.mustChangePassword && !new URL(req.url).pathname.startsWith("/api/auth/"))
    return { error: json({ error: "Change your temporary password to continue.", mustChangePassword: true }, 403), user: null };
  if (roles && !roles.includes(user.role)) return { error: json({ error: "You do not have access to this action." }, 403), user: null };
  return { error: null, user };
}

async function startSession(userId: number) {
  const token = newToken();
  await db.insert(sessions).values({ token, userId });
  return token;
}

// Find or create a user arriving through a Google / Apple identity. Existing
// password accounts with a matching email are linked rather than duplicated.
async function oauthUpsert(provider: string, providerId: string, email: string | null, displayName: string, requestedRole = "student", avatarUrl: string | null = null) {
  const mail = email ? email.toLowerCase() : null;
  let [u] = await db.select().from(users)
    .where(and(eq(users.provider, provider), eq(users.providerId, providerId)));
  if (!u && mail) [u] = await db.select().from(users).where(eq(users.email, mail));
  if (!u) {
    const role = requestedRole === "mentor" ? "mentor" : "student";
    [u] = await db.insert(users).values({
      provider, providerId, email: mail,
      displayName: displayName || (mail ? mail.split("@")[0] : role === "mentor" ? "Mentor" : "Student"),
      role, status: role === "mentor" ? "pending" : "active", avatarUrl,
    }).returning();
  } else if (avatarUrl && u.avatarUrl !== avatarUrl) {
    [u] = await db.update(users).set({ avatarUrl }).where(eq(users.id, u.id)).returning();
  }
  return u;
}

// Verify an OpenID Connect id_token (RS256) against a provider's JWKS endpoint.
async function verifyOidcToken(idToken: string, jwksUrl: string, audience: string) {
  const [h, p, sig] = idToken.split(".");
  if (!h || !p || !sig) throw new Error("Malformed token");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  const jwks = await (await fetch(jwksUrl)).json();
  const jwk = (jwks.keys || []).find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error("Unknown signing key");
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const ok = cryptoVerify("RSA-SHA256", Buffer.from(`${h}.${p}`), key, Buffer.from(sig, "base64url"));
  if (!ok) throw new Error("Invalid signature");
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("Token expired");
  if (audience && payload.aud !== audience) throw new Error("Audience mismatch");
  return payload as { sub: string; iss?: string; email?: string; email_verified?: boolean; name?: string; picture?: string };
}

// ─────────────── GOOGLE OAUTH 2.0 (authorization code + PKCE) ───────────────
// /api/auth/google/start redirects to Google; Google redirects back to
// /api/auth/google/callback, which exchanges the code using the client secret,
// creates a session, and hands it to the browser through a short-lived
// HttpOnly cookie that /api/auth/google/session swaps for the bearer token.
const GOOGLE_FLOW_COOKIE = "fnf_google_oauth";
const GOOGLE_SESSION_COOKIE = "fnf_google_session";

const googleRedirectUri = (url: URL) => GOOGLE_REDIRECT_URI || `${url.origin}/api/auth/google/callback`;

function readCookie(req: Request, name: string) {
  for (const part of (req.headers.get("cookie") || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return "";
}
const authCookie = (name: string, value: string, maxAge: number) =>
  `${name}=${encodeURIComponent(value)}; Path=/api/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

function redirect(location: string, cookies: string[] = []) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  for (const c of cookies) headers.append("set-cookie", c);
  return new Response(null, { status: 302, headers });
}
const googleError = (message: string) =>
  redirect(`/sign-in?google_error=${encodeURIComponent(message)}`, [authCookie(GOOGLE_FLOW_COOKIE, "", 0)]);

function googleStart(url: URL) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return googleError("Google sign-in is not configured.");
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const role = url.searchParams.get("role") === "mentor" ? "mentor" : "student";
  const auth = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  auth.search = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(url),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();
  const flow = Buffer.from(JSON.stringify({ state, verifier, role })).toString("base64url");
  return redirect(auth.toString(), [authCookie(GOOGLE_FLOW_COOKIE, flow, 600)]);
}

async function googleCallback(req: Request, url: URL) {
  if (url.searchParams.get("error")) return googleError("Google sign-in was cancelled.");
  let flow: { state?: string; verifier?: string; role?: string } = {};
  try { flow = JSON.parse(Buffer.from(readCookie(req, GOOGLE_FLOW_COOKIE), "base64url").toString()); } catch {}
  const state = url.searchParams.get("state") || "";
  const code = url.searchParams.get("code") || "";
  const expected = Buffer.from(flow.state || "");
  if (!code || !flow.verifier || expected.length === 0 || expected.length !== Buffer.byteLength(state) ||
      !timingSafeEqual(expected, Buffer.from(state)))
    return googleError("Your Google sign-in session expired. Please try again.");

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(url),
      grant_type: "authorization_code",
      code_verifier: flow.verifier,
    }),
  });
  const tokens = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !tokens.id_token) return googleError("Google did not accept the sign-in. Please try again.");

  const p = await verifyOidcToken(tokens.id_token, "https://www.googleapis.com/oauth2/v3/certs", GOOGLE_CLIENT_ID);
  if (p.iss !== "https://accounts.google.com" && p.iss !== "accounts.google.com")
    return googleError("Google sign-in could not be verified.");
  if (!p.email || p.email_verified === false) return googleError("Your Google account needs a verified email address.");

  const u = await oauthUpsert("google", p.sub, p.email, p.name || "", flow.role, p.picture || null);
  if (u.status === "banned") return googleError("This account has been banned.");
  const token = await startSession(u.id);
  return redirect("/sign-in?google=done", [
    authCookie(GOOGLE_FLOW_COOKIE, "", 0),
    authCookie(GOOGLE_SESSION_COOKIE, token, 120),
  ]);
}

// One-time handoff: return the session token minted by the callback, then clear it.
async function googleSession(req: Request) {
  const token = readCookie(req, GOOGLE_SESSION_COOKIE);
  const clear = authCookie(GOOGLE_SESSION_COOKIE, "", 0);
  const fail = () => new Response(JSON.stringify({ error: "Google sign-in expired. Please try again." }), {
    status: 401, headers: { "content-type": "application/json", "set-cookie": clear },
  });
  if (!token) return fail();
  const [s] = await db.select().from(sessions).where(eq(sessions.token, token));
  if (!s) return fail();
  const [u] = await db.select().from(users).where(eq(users.id, s.userId));
  if (!u) return fail();
  return new Response(JSON.stringify({ token, user: publicUser(u) }), {
    headers: { "content-type": "application/json", "cache-control": "no-store", "set-cookie": clear },
  });
}

// ─────────────── SITE SETTINGS & BRANDING ───────────────
// Sensible defaults so the site looks finished before an admin customises it.
const DEFAULT_SITE = {
  name: "Fast&Free SAT",
  tagline: "Adaptive Digital SAT practice",
  description:
    "Fast&Free SAT is a focused practice studio for the Digital SAT — a hand-curated question bank across Math and EBRW, with full explanations and progress tracking. Free for every student.",
};
const DEFAULT_BRANDING = { logo: false, ogImage: false };
const BRANDING_KINDS = ["logo", "og"] as const;
type BrandingKind = (typeof BRANDING_KINDS)[number];
const brandingStore = () => getStore({ name: "branding", consistency: "strong" });

async function studentActivity(studentId: number) {
  const key = `u${studentId}`;
  const [summaryRows, periodRows, recent, mistakes, saved] = await Promise.all([
    db.select({
      attempts: sql<number>`count(*)::int`,
      correct: sql<number>`sum(case when ${attempts.correct} then 1 else 0 end)::int`,
      lastActiveAt: sql<Date | null>`max(${attempts.createdAt})`,
    }).from(attempts).where(eq(attempts.student, key)),
    db.select({
      dailyAttempts: sql<number>`count(*) filter (where ${attempts.createdAt} >= date_trunc('day', now()))::int`,
      dailyCorrect: sql<number>`count(*) filter (where ${attempts.correct} and ${attempts.createdAt} >= date_trunc('day', now()))::int`,
      weeklyAttempts: sql<number>`count(*) filter (where ${attempts.createdAt} >= date_trunc('week', now()))::int`,
      weeklyCorrect: sql<number>`count(*) filter (where ${attempts.correct} and ${attempts.createdAt} >= date_trunc('week', now()))::int`,
    }).from(attempts).where(eq(attempts.student, key)),
    db.select().from(attempts).where(eq(attempts.student, key)).orderBy(desc(attempts.createdAt)).limit(10),
    db.select({ attempt: attempts, question: questions }).from(attempts)
      .innerJoin(questions, eq(attempts.questionId, questions.id))
      .where(and(eq(attempts.student, key), eq(attempts.correct, false)))
      .orderBy(desc(attempts.createdAt)),
    db.select({ saved: savedQuestions, question: questions }).from(savedQuestions)
      .innerJoin(questions, eq(savedQuestions.questionId, questions.id))
      .where(eq(savedQuestions.studentId, studentId))
      .orderBy(desc(savedQuestions.createdAt)),
  ]);
  const summary = summaryRows[0];
  const periods = periodRows[0];
  const total = summary?.attempts ?? 0;
  const correct = summary?.correct ?? 0;
  const dailyAttempts = periods?.dailyAttempts ?? 0;
  const weeklyAttempts = periods?.weeklyAttempts ?? 0;
  return {
    attempts: total,
    correct,
    accuracy: total ? Math.round((correct / total) * 100) : 0,
    lastActiveAt: summary?.lastActiveAt ?? null,
    periods: {
      daily: { attempts: dailyAttempts, correct: periods?.dailyCorrect ?? 0, accuracy: dailyAttempts ? Math.round(((periods?.dailyCorrect ?? 0) / dailyAttempts) * 100) : 0 },
      weekly: { attempts: weeklyAttempts, correct: periods?.weeklyCorrect ?? 0, accuracy: weeklyAttempts ? Math.round(((periods?.weeklyCorrect ?? 0) / weeklyAttempts) * 100) : 0 },
      total: { attempts: total, correct, accuracy: total ? Math.round((correct / total) * 100) : 0 },
    },
    recentActivity: recent,
    mistakes,
    savedQuestions: saved,
  };
}

async function mentorCanAccessStudent(mentorId: number, studentId: number) {
  const [row] = await db.select({ enrollmentId: classEnrollments.id }).from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classes.mentorId, mentorId), eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")))
    .limit(1);
  return !!row;
}

// Read a single settings group, merged over its defaults.
async function readSetting<T extends object>(key: string, defaults: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return { ...defaults, ...((row?.value as object) ?? {}) } as T;
}
async function writeSetting(key: string, value: unknown) {
  await db
    .insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

// A clean placeholder image used until an admin uploads real artwork. Logos are
// square; the "og" thumbnail is the 1200×630 card search engines and chat apps
// show in link previews.
// ─────────────── FULL-LENGTH TEST HELPERS ───────────────
// A test is modules in order, each module questions in order. Two timing shapes
// are supported and the shape is derived, never stored: if every module carries
// its own minute limit the student gets a separate clock per module; otherwise
// the whole test runs on one continuous clock of `timeLimitMinutes`.
type TestRow = typeof tests.$inferSelect;
type TestModuleRow = typeof testModules.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
type TestAttemptRow = typeof testAttempts.$inferSelect;


function testTotalMinutes(test: TestRow, mods: TestModuleRow[]) {
  if (isPerModuleTimed(mods)) return mods.reduce((sum, m) => sum + (m.timeLimitMinutes ?? 0), 0);
  return test.timeLimitMinutes;
}

// Minutes the student gets for the module at `index`. In continuous mode the
// deadline is set once when the attempt starts, so this is only read on start.
function minutesForModule(test: TestRow, mods: TestModuleRow[], index: number) {
  if (isPerModuleTimed(mods)) return mods[index]?.timeLimitMinutes ?? test.timeLimitMinutes;
  return test.timeLimitMinutes;
}

// Validate the practice set-up a student picks before a self-started sitting.
// Defaults to the original behaviour: the full test, timed.
function parsePracticeOptions(b: any, mods: TestModuleRow[]):
  { scope: "full" | "modules"; moduleIds: number[]; timed: boolean } | { error: string } {
  const timed = b?.timed === false || b?.timing === "untimed" ? false : true;
  const scope = b?.scope === "modules" ? "modules" : "full";
  if (scope === "full") return { scope, moduleIds: [], timed };
  const wanted = new Set((Array.isArray(b?.moduleIds) ? b.moduleIds : []).map(Number).filter(Number.isInteger));
  const moduleIds = mods.filter((m) => wanted.has(m.id)).map((m) => m.id);
  if (!moduleIds.length) return { error: "Select at least one module of this test to practice." };
  if (moduleIds.length !== wanted.size) return { error: "One of the selected modules is not part of this test." };
  return { scope, moduleIds, timed };
}

// Drop the answer key before a test in progress reaches a student's browser.
const withoutKey = (q: QuestionRow) => {
  const { answer, explanation, acceptableAnswers, ...rest } = q;
  return rest;
};

// Full test tree. `keepKey` false strips answers/explanations from every
// question so a live attempt can be rendered without leaking the key. With an
// attempt, only the modules on that sitting's plan are included, in plan order.
async function loadTestDetail(testId: number, keepKey: boolean, attempt?: TestAttemptRow) {
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return null;
  const mods = attempt ? await planModules(attempt) : await loadTestModules(testId);
  const modules = [];
  let questionCount = 0;
  for (const m of mods) {
    const qs = await loadModuleQuestions(m.id);
    questionCount += qs.length;
    modules.push({ ...m, questions: keepKey ? qs : qs.map(withoutKey) });
  }
  return {
    ...test,
    modules,
    questionCount,
    perModuleTiming: isPerModuleTimed(mods),
    totalMinutes: testTotalMinutes(test, mods),
  };
}

// Grade the sitting's planned modules, close it out with a score report, and
// fold every answered question into the regular attempts log under mode
// "test:<id>" so profile stats pick it up.
async function submitTestAttempt(attempt: TestAttemptRow) {
  const studentId = attempt.studentId;
  const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId)).limit(1);
  const mods = await planModules(attempt);
  const answers = attempt.answers || {};
  // Reachable only for an attempt that is still open, so a sitting is never
  // logged twice — and a retake logs its own fresh row per question.
  for (const m of mods) {
    for (const q of await loadModuleQuestions(m.id)) {
      const given = String(answers[String(q.id)] ?? "");
      if (!given) continue;
      await db.insert(attempts).values({
        student: `u${studentId}`,
        questionId: q.id,
        section: q.section,
        category: q.category,
        difficulty: q.difficulty,
        mode: `test:${attempt.testId}`,
        selected: given,
        correct: isAnswerCorrect(q, given),
      });
    }
  }
  const report = test ? await buildScoreReport(test, mods, answers, attempt) : null;
  const [row] = await db.update(testAttempts)
    .set({
      correctCount: report?.correctCount ?? 0, totalCount: report?.totalCount ?? 0, scoreReport: report,
      submittedAt: new Date(), expiresAt: null, breakEndsAt: null, status: "submitted", remainingSeconds: null,
    })
    .where(eq(testAttempts.id, attempt.id))
    .returning();
  await recordModuleCompletion(attempt.id, studentId, attempt.moduleIndex).catch((e) => console.error("module completion", e));
  await evaluateBadges(studentId, true);
  return row;
}

// Roll an in-progress attempt forward past its deadline: per-module timing moves
// to the next module (routing adaptive modules, submitting after the last one),
// continuous timing submits.
async function settleExpiredAttempt(attempt: TestAttemptRow) {
  if (attempt.submittedAt || !attempt.expiresAt || attempt.timed === false) return attempt;
  if (new Date(attempt.expiresAt).getTime() > Date.now()) return attempt;
  const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId)).limit(1);
  let mods = test ? await planModules(attempt) : [];
  if (!test || !isPerModuleTimed(mods)) return submitTestAttempt(attempt);
  let current = attempt;
  // A student who closed the tab may have slept through several modules.
  while (current.expiresAt && new Date(current.expiresAt).getTime() <= Date.now()) {
    const next = current.moduleIndex + 1;
    if (next >= mods.length) return submitTestAttempt(current);
    await recordModuleCompletion(current.id, current.studentId, current.moduleIndex).catch(() => {});
    const [row] = await db.update(testAttempts)
      .set(await moduleTransition(test, current, mods, next))
      .where(eq(testAttempts.id, current.id))
      .returning();
    current = row;
    mods = await planModules(current);
  }
  return current;
}

// ── Pause & resume ──
// The shape the browser works with for a sitting in progress. `status` is
// derived for rows written before pausing existed, which never set it.
function sessionSnapshot(attempt: TestAttemptRow) {
  const status = attempt.submittedAt ? "submitted" : attempt.status === "paused" ? "paused" : "active";
  const remainingTimeSeconds = attempt.timed === false ? null : status === "paused"
    ? Math.max(0, attempt.remainingSeconds ?? 0)
    : attempt.expiresAt ? Math.max(0, Math.ceil((new Date(attempt.expiresAt).getTime() - Date.now()) / 1000)) : null;
  return {
    testSessionId: attempt.id,
    testId: attempt.testId,
    moduleIndex: attempt.moduleIndex,
    currentQuestionIndex: attempt.currentQuestionIndex ?? 0,
    userAnswers: attempt.answers || {},
    flaggedQuestions: Array.isArray(attempt.flagged) ? attempt.flagged : [],
    remainingTimeSeconds,
    status,
    pausedAt: attempt.pausedAt,
    lastSavedAt: attempt.lastSavedAt,
    expiresAt: attempt.expiresAt,
    breakEndsAt: attempt.breakEndsAt && new Date(attempt.breakEndsAt).getTime() > Date.now() ? attempt.breakEndsAt : null,
    allowPause: attempt.allowPause !== false,
    assignmentId: attempt.assignmentId,
    timed: attempt.timed !== false,
    practiceScope: attempt.practiceScope === "modules" ? "modules" : "full",
  };
}

// A pause that was taken offline reaches us late, after the server clock kept
// running. The student is credited back at most this much of that gap — enough
// to cover a dropped connection, too little to be worth gaming.
const OFFLINE_PAUSE_GRACE_SECONDS = 120;

// Turn a client snapshot into the columns it is allowed to change. The server
// stays authoritative on module and clock: answers and position are only taken
// for the module the attempt is actually on, and only while it is not paused.
async function snapshotUpdates(attempt: TestAttemptRow, mods: TestModuleRow[], b: Record<string, unknown>) {
  const out: Partial<typeof testAttempts.$inferInsert> = {};
  if (Array.isArray(b.flaggedQuestions)) {
    out.flagged = [...new Set(b.flaggedQuestions.map(Number).filter((n) => Number.isInteger(n) && n > 0))].slice(0, 500);
  }
  if (Number(b.moduleIndex) !== attempt.moduleIndex) return out;
  const current = mods[attempt.moduleIndex];
  const qs = current ? await loadModuleQuestions(current.id) : [];
  const idx = Math.round(Number(b.currentQuestionIndex));
  if (Number.isFinite(idx)) out.currentQuestionIndex = Math.max(0, Math.min(Math.max(0, qs.length - 1), idx));
  if (attempt.status !== "paused" && b.userAnswers && typeof b.userAnswers === "object") {
    const given = b.userAnswers as Record<string, unknown>;
    const answers = { ...(attempt.answers || {}) };
    for (const q of qs) {
      const value = String(given[String(q.id)] ?? "").trim().slice(0, 200);
      if (value) answers[String(q.id)] = value;
      else delete answers[String(q.id)];
    }
    out.answers = answers;
  }
  return out;
}

// ─────────────── ONLINE LESSONS ───────────────
// Lessons are YouTube videos, but only the 11-character video id is stored and
// the player is always embedded in our own page — nothing sends a student off
// to youtube.com to watch.
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
function youtubeVideoId(raw: unknown) {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (YT_ID.test(value)) return value;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const candidate = url.pathname.split("/").filter(Boolean)[0] || "";
      return YT_ID.test(candidate) ? candidate : "";
    }
    if (host !== "youtube.com" && host !== "m.youtube.com" && host !== "youtube-nocookie.com") return "";
    const v = url.searchParams.get("v") || "";
    if (YT_ID.test(v)) return v;
    const match = url.pathname.match(/\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{11})/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}


// Answer choices are rich text too — same treatment, per letter.
function sanitizeChoices(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const out: Record<string, string> = {};
  for (const [letter, value] of Object.entries(raw as Record<string, unknown>))
    out[letter] = sanitizeRichHtml(value, 4000);
  return out;
}

// ── Question scope: bank vs test-exclusive ──
// BANK questions make up the shared practice bank. TEST_EXCLUSIVE questions
// belong to a full-length test only and never reach practice or the bank
// pickers. Every question a module holds is TEST_EXCLUSIVE once it is added:
// an imported bank item is snapshotted on attach, so the test copy and the bank
// original can be edited (or deleted) independently.
const bankOnly = eq(questions.scope, BANK);

const CHOICE_LETTERS = ["A", "B", "C", "D"] as const;
const optionalText = z.string().nullish().transform((v) => (v ?? "").trim());

// The fields of one question as the editor sends them.
const QuestionFieldsSchema = z.object({
  section: z.enum(["math", "ebrw"]),
  category: z.string().trim().min(1, "Choose a domain."),
  subcategory: z.string().trim().min(1, "Choose a skill."),
  difficulty: z.coerce.number().int().min(1).max(5).default(3),
  type: z.enum(["mcq", "spr"]).default("mcq"),
  passage: optionalText,
  prompt: optionalText,
  questionImage: optionalText,
  choices: z.record(z.string()).nullish(),
  choiceImages: z.record(z.string()).nullish(),
  answer: z.string().trim().min(1, "Add the correct answer."),
  explanation: optionalText,
}).superRefine((q, ctx) => {
  if (!q.prompt && !q.questionImage)
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["prompt"], message: "Add a question prompt or a question image." });
  if (q.type === "mcq") {
    if (!(CHOICE_LETTERS as readonly string[]).includes(q.answer))
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["answer"], message: "Mark which choice (A–D) is correct." });
    const blank = CHOICE_LETTERS.filter((l) => !q.choices?.[l]?.trim() && !q.choiceImages?.[l]?.trim());
    if (blank.length && !q.questionImage)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["choices"], message: `Add text or an image for choice ${blank.join(", ")}.` });
  }
});
type QuestionFields = z.infer<typeof QuestionFieldsSchema>;

const questionIdSchema = z.coerce.number().int().positive();

// POST /api/admin/tests/:testId/modules/:moduleId/questions takes one of:
//   { question: {...}, copyToBank? }   write a new test-only question
//   { questionBankId }                 import one bank question
//   { questionBankIds: [...] }         import several, in order
const ManualQuestionSchema = z.object({ question: QuestionFieldsSchema, copyToBank: z.boolean().default(false) });
const ImportQuestionsSchema = z.union([
  z.object({ questionBankId: questionIdSchema }),
  z.object({ questionBankIds: z.array(questionIdSchema).min(1, "Choose at least one question.") }),
], { errorMap: () => ({ message: "Choose at least one bank question, or send a new question." }) });
type AddModuleQuestion = z.infer<typeof ManualQuestionSchema> | z.infer<typeof ImportQuestionsSchema>;

// Pick the schema by shape first, so a manual question that fails validation
// reports its own field message rather than a generic union error.
function parseAddModuleQuestion(raw: unknown) {
  const manual = !!raw && typeof raw === "object" && "question" in raw;
  const parsed = manual ? ManualQuestionSchema.safeParse(raw) : ImportQuestionsSchema.safeParse(raw);
  return parsed.success
    ? { data: parsed.data as AddModuleQuestion }
    : { error: zodMessage(parsed.error) };
}

const zodMessage = (error: z.ZodError) => error.issues[0]?.message || "Invalid question.";

// Sanitised column values for a question written in the editor.
function questionColumns(q: QuestionFields) {
  const mcq = q.type === "mcq";
  return {
    section: q.section,
    category: q.category,
    subcategory: q.subcategory,
    difficulty: q.difficulty,
    type: q.type,
    passage: q.passage ? sanitizeRichHtml(q.passage) : null,
    prompt: sanitizeRichHtml(q.prompt || "Refer to the question image."),
    questionImage: q.questionImage || null,
    choices: mcq ? sanitizeChoices(q.choices) : null,
    choiceImages: mcq ? (q.choiceImages ?? null) : null,
    answer: q.answer,
    explanation: sanitizeRichHtml(q.explanation),
  };
}

// Copy a bank question into a test-only snapshot that points back at it.
async function snapshotBankQuestion(bank: QuestionRow) {
  const { id, createdAt, scope, sourceQuestionId, ...content } = bank;
  const [row] = await db.insert(questions)
    .values({ ...content, scope: TEST_EXCLUSIVE, sourceQuestionId: bank.id }).returning();
  return row;
}

// Import bank questions into a module as snapshots, in the order given,
// skipping any bank item the module already holds a copy of.
async function importBankQuestions(moduleId: number, wanted: number[]) {
  const ids = Array.from(new Set(wanted));
  const bankRows = await db.select().from(questions).where(and(inArray(questions.id, ids), bankOnly));
  if (bankRows.length !== ids.length) return { error: "One or more selected questions are no longer in the bank." };
  const byId = new Map(bankRows.map((r) => [r.id, r]));
  const current = await loadModuleQuestions(moduleId);
  // Legacy links point straight at a bank row; newer ones at a snapshot of it.
  const have = new Set(current.flatMap((q) => [q.id, q.sourceQuestionId]).filter((v) => v != null));
  let position = current.length;
  const added: QuestionRow[] = [];
  for (const bankId of ids) {
    if (have.has(bankId)) continue;
    const snapshot = await snapshotBankQuestion(byId.get(bankId)!);
    await db.insert(testModuleQuestions).values({ moduleId, questionId: snapshot.id, position: position++, source: BANK });
    added.push(snapshot);
  }
  return { added };
}

// Write a brand-new question straight into a module. It stays out of the bank
// unless `copyToBank` is set, in which case a separate bank row is created too
// and the test copy remembers it as its source.
async function createManualQuestion(moduleId: number, fields: QuestionFields, copyToBank: boolean) {
  const values = questionColumns(fields);
  let bankCopy: QuestionRow | null = null;
  if (copyToBank) [bankCopy] = await db.insert(questions).values({ ...values, scope: BANK }).returning();
  const [row] = await db.insert(questions)
    .values({ ...values, scope: TEST_EXCLUSIVE, sourceQuestionId: bankCopy?.id ?? null }).returning();
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(testModuleQuestions).where(eq(testModuleQuestions.moduleId, moduleId));
  await db.insert(testModuleQuestions).values({ moduleId, questionId: row.id, position: count, source: TEST_EXCLUSIVE });
  return { question: row, bankCopy };
}

// Test-only questions that no module holds any more are unreachable, so they
// are removed — unless a mentor has already handed them out in an assignment.
async function pruneTestQuestions(candidateIds: number[]) {
  if (!candidateIds.length) return;
  const exclusive = await db.select({ id: questions.id }).from(questions)
    .where(and(inArray(questions.id, candidateIds), eq(questions.scope, TEST_EXCLUSIVE)));
  if (!exclusive.length) return;
  const ids = exclusive.map((r) => r.id);
  const linked = await db.select({ id: testModuleQuestions.questionId }).from(testModuleQuestions)
    .where(inArray(testModuleQuestions.questionId, ids));
  const assigned = (await db.select({ ids: assignments.questionIds }).from(assignments)).flatMap((a) => a.ids);
  const keep = new Set([...linked.map((l) => l.id), ...assigned]);
  const orphans = ids.filter((qid) => !keep.has(qid));
  if (!orphans.length) return;
  await db.delete(savedQuestions).where(inArray(savedQuestions.questionId, orphans));
  await db.delete(questions).where(inArray(questions.id, orphans));
}

type LessonRow = typeof lessons.$inferSelect;
const lessonSection = (value: unknown) => (String(value ?? "") === "ebrw" ? "ebrw" : "math");

async function lessonCommentTree(lessonId: number) {
  const rows = await db.select({ comment: lessonComments, author: users })
    .from(lessonComments)
    .leftJoin(users, eq(lessonComments.authorId, users.id))
    .where(eq(lessonComments.lessonId, lessonId))
    .orderBy(lessonComments.createdAt, lessonComments.id);
  return rows.map(({ comment, author }) => ({
    ...comment,
    author: author
      ? { id: author.id, displayName: author.displayName, role: author.role }
      : { id: comment.authorId, displayName: "Removed account", role: "student" },
  }));
}

async function lessonWithMeta(lesson: LessonRow, withComments: boolean) {
  const [author] = lesson.createdBy
    ? await db.select().from(users).where(eq(users.id, lesson.createdBy)).limit(1)
    : [];
  const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
    .from(lessonComments).where(eq(lessonComments.lessonId, lesson.id));
  return {
    ...lesson,
    author: author ? { id: author.id, displayName: author.displayName, role: author.role } : null,
    commentCount: count,
    ...(withComments ? { comments: await lessonCommentTree(lesson.id) } : {}),
  };
}

function defaultBrandingSvg(kind: BrandingKind, name: string) {
  const safe = name.replace(/[<>&]/g, "").slice(0, 40) || "Fast&Free SAT";
  if (kind === "logo") {
    const mark = (safe.match(/[A-Za-z0-9]/g) || ["S"]).slice(0, 1).join("").toUpperCase();
    return `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256"><rect width="256" height="256" rx="56" fill="#141319"/><rect x="20" y="20" width="216" height="216" rx="44" fill="#FF6A3D"/><text x="128" y="128" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="120" font-weight="800" fill="#1A0E07" text-anchor="middle" dominant-baseline="central">${mark}</text></svg>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><rect width="1200" height="630" fill="#141319"/><circle cx="980" cy="120" r="320" fill="#FF6A3D" opacity="0.14"/><rect x="80" y="250" width="84" height="84" rx="22" fill="#FF6A3D"/><text x="190" y="306" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="58" font-weight="800" fill="#EFEDE6">${safe}</text><text x="84" y="400" font-family="Segoe UI,Helvetica,Arial,sans-serif" font-size="34" font-weight="600" fill="#A7A4B2">Adaptive Digital SAT practice</text></svg>`;
}

export default async (req: Request) => {
  const url = new URL(req.url);
  // strip the /api prefix → ["questions"], ["questions","12"], ["pages","about"] …
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [resource, id] = parts;
  const method = req.method;

  try {
    // Administration, limits, notifications, reports, messages, integrity,
    // leaderboards, achievements and performance reports.
    const platform = await handlePlatform(req, parts, { json, requireUser });
    if (platform) return platform;

    // ─────────────── SAT VOCABULARY ───────────────
    if (resource === "vocab") return await handleVocab(req, parts, { json, requireUser });
    // Question Bank domain / Challenging Questions set imports and the student set browser.
    if (resource === "collections" || resource === "challenge-sets") {
      const handled = await handleCollections(req, parts, { json, requireUser });
      if (handled) return handled;
    }

    // ─────────────── AUTH ───────────────
    if (resource === "auth") {
      // Public client config — which social logins are available to the browser.
      if (id === "config" && method === "GET") {
        return json({
          google: GOOGLE_CLIENT_ID || null,
          googleRedirect: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET),
          apple: APPLE_CLIENT_ID || null,
        });
      }

      if (id === "google" && parts[2] === "start" && method === "GET") return googleStart(url);
      if (id === "google" && parts[2] === "callback" && method === "GET") {
        try { return await googleCallback(req, url); }
        catch { return googleError("Google sign-in could not be completed."); }
      }
      if (id === "google" && parts[2] === "session" && method === "POST") return googleSession(req);

      if (id === "register" && method === "POST") {
        const b = await req.json();
        const displayName = String(b.displayName || "").trim();
        const username = b.username ? String(b.username).trim().toLowerCase() : null;
        const email = b.email ? String(b.email).trim().toLowerCase() : null;
        const phone = b.phone ? String(b.phone).trim() : null;
        const password = String(b.password || "");
        const role = b.role === "mentor" ? "mentor" : "student";
        if (!displayName) return json({ error: "Enter your name." }, 400);
        if (!username && !email && !phone)
          return json({ error: "Provide a username, email, or phone number." }, 400);
        if (password.length < 6)
          return json({ error: "Password must be at least 6 characters." }, 400);
        if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
          return json({ error: "Enter a valid email address." }, 400);

        // Friendly duplicate check before relying on the DB unique constraints.
        const clashes = [
          username ? eq(users.username, username) : null,
          email ? eq(users.email, email) : null,
          phone ? eq(users.phone, phone) : null,
        ].filter(Boolean) as any[];
        const [exists] = await db.select().from(users).where(or(...clashes)).limit(1);
        if (exists) return json({ error: "An account with those details already exists." }, 409);

        const [u] = await db.insert(users).values({
          displayName, username, email, phone,
          passwordHash: hashPassword(password), provider: "password", role,
          status: role === "mentor" ? "pending" : "active",
        }).returning();
        const token = await startSession(u.id);
        return json({ token, user: publicUser(u) }, 201);
      }

      if (id === "login" && method === "POST") {
        const b = await req.json();
        const idf = String(b.identifier || "").trim();
        const password = String(b.password || "");
        if (!idf || !password) return json({ error: "Enter your login and password." }, 400);
        const low = idf.toLowerCase();
        const [u] = await db.select().from(users)
          .where(or(eq(users.username, low), eq(users.email, low), eq(users.phone, idf)))
          .limit(1);
        if (!u || !verifyPassword(password, u.passwordHash))
          return json({ error: "Incorrect login or password." }, 401);
        if (u.status === "banned") return json({ error: "This account has been banned." }, 403);
        const token = await startSession(u.id);
        return json({ token, user: publicUser(u) });
      }

      if (id === "google" && !parts[2] && method === "POST") {
        if (!GOOGLE_CLIENT_ID) return json({ error: "Google sign-in is not configured." }, 503);
        const b = await req.json();
        const credential = String(b.credential || "");
        if (!credential) return json({ error: "Missing Google credential." }, 400);
        const p = await verifyOidcToken(
          credential, "https://www.googleapis.com/oauth2/v3/certs", GOOGLE_CLIENT_ID);
        const u = await oauthUpsert("google", p.sub, p.email ?? null, p.name || "", b.role, p.picture || null);
        if (u.status === "banned") return json({ error: "This account has been banned." }, 403);
        const token = await startSession(u.id);
        return json({ token, user: publicUser(u) });
      }

      if (id === "apple" && method === "POST") {
        const b = await req.json();
        const credential = String(b.credential || "");
        if (!credential) return json({ error: "Missing Apple credential." }, 400);
        const p = await verifyOidcToken(
          credential, "https://appleid.apple.com/auth/keys", APPLE_CLIENT_ID);
        const name = typeof b.name === "string" ? b.name : "";
        const u = await oauthUpsert("apple", p.sub, p.email ?? null, name, b.role);
        if (u.status === "banned") return json({ error: "This account has been banned." }, 403);
        const token = await startSession(u.id);
        return json({ token, user: publicUser(u) });
      }

      if (id === "identity-session" && method === "POST") {
        const identityUser = await getIdentityUser();
        if (!identityUser) return json({ error: "Google sign-in could not be verified." }, 401);
        const identity = identityUser as any;
        const b = await req.json().catch(() => ({}));
        const email = identity.email ? String(identity.email).toLowerCase() : null;
        const displayName = String(identity.userMetadata?.full_name || identity.userMetadata?.name || "");
        const u = await oauthUpsert("netlify", identity.id, email, displayName, b.role);
        if (u.status === "banned") return json({ error: "This account has been banned." }, 403);
        const token = await startSession(u.id);
        return json({ token, user: publicUser(u) });
      }

      if (id === "admin-login" && method === "POST") {
        // Never compare against an empty passcode: two empty buffers are equal.
        if (!ADMIN_PASSCODE) return json({ error: "Admin sign-in is not configured." }, 503);
        const now = Date.now();
        const failures = await readSetting(ADMIN_LOGIN_FAILURES_KEY, { count: 0, firstAt: 0, lockedUntil: 0 });
        if (failures.lockedUntil > now) {
          const minutes = Math.ceil((failures.lockedUntil - now) / 60000);
          return json({ error: `Too many failed attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, 429);
        }
        const b = await req.json().catch(() => ({}));
        const passcode = String(b.passcode || "");
        const supplied = Buffer.from(passcode);
        const expected = Buffer.from(ADMIN_PASSCODE);
        if (!passcode || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
          const fresh = !failures.firstAt || now - failures.firstAt > ADMIN_FAILURE_WINDOW_MS;
          const count = (fresh ? 0 : failures.count) + 1;
          const lockedUntil = count >= ADMIN_MAX_FAILURES ? now + ADMIN_LOCKOUT_MS : 0;
          await writeSetting(ADMIN_LOGIN_FAILURES_KEY, {
            count: lockedUntil ? 0 : count, firstAt: lockedUntil ? 0 : fresh ? now : failures.firstAt, lockedUntil,
          });
          if (lockedUntil) return json({ error: "Too many failed attempts. Try again in 15 minutes." }, 429);
          return json({ error: "Incorrect studio passcode." }, 401);
        }
        if (failures.count || failures.lockedUntil) await writeSetting(ADMIN_LOGIN_FAILURES_KEY, { count: 0, firstAt: 0, lockedUntil: 0 });
        let [u] = await db.select().from(users).where(eq(users.username, "studio-admin"));
        if (!u) {
          [u] = await db.insert(users).values({
            username: "studio-admin", displayName: "Studio Admin", provider: "admin",
            role: "admin", status: "active", approvedAt: new Date(),
          }).returning();
        } else if (u.role !== "admin" || u.status !== "active") {
          [u] = await db.update(users).set({ role: "admin", status: "active", bannedAt: null }).where(eq(users.id, u.id)).returning();
        }
        const token = await startSession(u.id);
        return json({ token, user: publicUser(u) });
      }

      if (id === "me" && method === "GET") {
        const u = await userFromReq(req);
        return u ? json({ user: publicUser(u) }) : json({ user: null }, 401);
      }

      if (id === "logout" && method === "POST") {
        const auth = req.headers.get("authorization") || "";
        const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
        if (token) await db.delete(sessions).where(eq(sessions.token, token));
        return json({ ok: true });
      }
    }

    // ─────────────── MENTOR APPROVAL ───────────────
    if (resource === "mentor" && id === "activate" && method === "POST") {
      const auth = await requireUser(req, ["mentor"]);
      if (auth.error) return auth.error;
      if (auth.user!.status === "active") return json({ user: publicUser(auth.user!) });
      const b = await req.json();
      const hash = codeHash(String(b.code || ""));
      const [activation] = await db.select().from(mentorActivationCodes)
        .where(and(
          eq(mentorActivationCodes.codeHash, hash),
          eq(mentorActivationCodes.mentorId, auth.user!.id),
          sql`${mentorActivationCodes.usedAt} is null`,
          sql`${mentorActivationCodes.expiresAt} > now()`,
        )).limit(1);
      if (!activation) return json({ error: "That activation code is invalid or expired." }, 400);
      const now = new Date();
      await db.update(mentorActivationCodes).set({ usedAt: now }).where(eq(mentorActivationCodes.id, activation.id));
      const [user] = await db.update(users).set({ status: "active", approvedAt: now, bannedAt: null })
        .where(eq(users.id, auth.user!.id)).returning();
      return json({ user: publicUser(user) });
    }

    if (resource === "mentor-codes" && method === "POST") {
      const auth = await requireUser(req, ["admin"]);
      if (auth.error) return auth.error;
      const b = await req.json();
      const mentorId = Number(b.mentorId);
      const [mentor] = await db.select().from(users).where(and(eq(users.id, mentorId), eq(users.role, "mentor"))).limit(1);
      if (!mentor) return json({ error: "Mentor account not found." }, 404);
      if (mentor.status === "banned") return json({ error: "Unban this mentor before approving the account." }, 400);
      await db.delete(mentorActivationCodes).where(and(
        eq(mentorActivationCodes.mentorId, mentorId),
        sql`${mentorActivationCodes.usedAt} is null`,
      ));
      const code = newCode("MENTOR");
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
      await db.insert(mentorActivationCodes).values({
        codeHash: codeHash(code), mentorId, createdBy: auth.user!.id, expiresAt,
      });
      return json({ code, expiresAt }, 201);
    }

    // ─────────────── CLASSES ───────────────
    if (resource === "classes") {
      if (!id && method === "GET") {
        const auth = await requireUser(req, ["mentor", "student", "admin"]);
        if (auth.error) return auth.error;
        if (auth.user!.role === "mentor" || auth.user!.role === "admin") {
          if (auth.user!.status !== "active") return json({ error: "Activate your mentor account first." }, 403);
          const owned = auth.user!.role === "admin"
            ? await db.select().from(classes).orderBy(desc(classes.createdAt))
            : await db.select().from(classes).where(eq(classes.mentorId, auth.user!.id)).orderBy(desc(classes.createdAt));
          const result = [];
          for (const classroom of owned) {
            const [mentor] = await db.select().from(users).where(eq(users.id, classroom.mentorId));
            const enrollments = await db.select().from(classEnrollments)
              .where(and(eq(classEnrollments.classId, classroom.id), eq(classEnrollments.status, "active")));
            const students = [];
            for (const enrollment of enrollments) {
              const [student] = await db.select().from(users).where(eq(users.id, enrollment.studentId));
              if (!student) continue;
              students.push({
                ...publicUser(student), joinedAt: enrollment.joinedAt, ...(await studentActivity(student.id)),
              });
            }
            result.push({ ...classroom, mentor: mentor ? publicUser(mentor) : null, students, studentCount: students.length });
          }
          return json(result);
        }
        const enrollments = await db.select().from(classEnrollments)
          .where(and(eq(classEnrollments.studentId, auth.user!.id), eq(classEnrollments.status, "active")));
        const result = [];
        for (const enrollment of enrollments) {
          const [classroom] = await db.select().from(classes).where(eq(classes.id, enrollment.classId));
          if (!classroom) continue;
          const [mentor] = await db.select().from(users).where(eq(users.id, classroom.mentorId));
          result.push({ ...classroom, mentor: mentor ? publicUser(mentor) : null, joinedAt: enrollment.joinedAt });
        }
        return json(result);
      }

      if (!id && method === "POST") {
        const auth = await requireUser(req, ["mentor"]);
        if (auth.error) return auth.error;
        if (auth.user!.status !== "active") return json({ error: "Activate your mentor account first." }, 403);
        const b = await req.json();
        const name = String(b.name || "").trim();
        const description = String(b.description || "").trim();
        if (!name) return json({ error: "Enter a class name." }, 400);
        const [classroom] = await db.insert(classes).values({ mentorId: auth.user!.id, name, description }).returning();
        return json(classroom, 201);
      }

      if (id === "join" && method === "POST") {
        const auth = await requireUser(req, ["student"]);
        if (auth.error) return auth.error;
        const b = await req.json();
        const hash = codeHash(String(b.code || ""));
        const [invite] = await db.select().from(classInvites).where(and(
          eq(classInvites.codeHash, hash), sql`${classInvites.usedAt} is null`, sql`${classInvites.expiresAt} > now()`,
        )).limit(1);
        if (!invite) return json({ error: "That class code is invalid or has already been used." }, 400);
        const [existing] = await db.select().from(classEnrollments).where(and(
          eq(classEnrollments.classId, invite.classId), eq(classEnrollments.studentId, auth.user!.id),
        )).limit(1);
        if (existing?.status === "active") return json({ error: "You already belong to this class." }, 409);
        if (existing?.status === "banned") return json({ error: "This mentor has blocked you from rejoining the class." }, 403);
        const now = new Date();
        if (existing) await db.update(classEnrollments).set({ status: "active", joinedAt: now }).where(eq(classEnrollments.id, existing.id));
        else await db.insert(classEnrollments).values({ classId: invite.classId, studentId: auth.user!.id });
        await db.update(classInvites).set({ usedBy: auth.user!.id, usedAt: now }).where(eq(classInvites.id, invite.id));
        const [joined] = await db.select({ name: classes.name, mentorId: classes.mentorId }).from(classes).where(eq(classes.id, invite.classId));
        if (joined) await notify([joined.mentorId], { kind: "class", title: `${auth.user!.displayName} joined “${joined.name}”`, link: { view: "students" } });
        return json({ ok: true }, 201);
      }

      if (id && parts[2] === "invites" && method === "POST") {
        const auth = await requireUser(req, ["mentor"]);
        if (auth.error) return auth.error;
        if (auth.user!.status !== "active") return json({ error: "Activate your mentor account first." }, 403);
        const classId = Number(id);
        const [classroom] = await db.select().from(classes).where(and(eq(classes.id, classId), eq(classes.mentorId, auth.user!.id))).limit(1);
        if (!classroom) return json({ error: "Class not found." }, 404);
        const code = newCode("CLASS");
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await db.insert(classInvites).values({ classId, codeHash: codeHash(code), expiresAt });
        return json({ code, expiresAt }, 201);
      }

      if (id && parts[2] === "students" && parts[3] && method === "PATCH") {
        const auth = await requireUser(req, ["mentor"]);
        if (auth.error) return auth.error;
        const classId = Number(id);
        const studentId = Number(parts[3]);
        const [classroom] = await db.select().from(classes).where(and(
          eq(classes.id, classId), eq(classes.mentorId, auth.user!.id),
        )).limit(1);
        if (!classroom) return json({ error: "Class not found." }, 404);
        const [enrollment] = await db.select().from(classEnrollments).where(and(
          eq(classEnrollments.classId, classId), eq(classEnrollments.studentId, studentId),
        )).limit(1);
        if (!enrollment) return json({ error: "Student is not enrolled in this class." }, 404);
        const b = await req.json();
        const action = String(b.action || "");
        if (action === "remove" || action === "ban")
          await notify([studentId], { kind: "class", title: `You were removed from “${classroom.name}”` });
        if (action === "remove") {
          await db.update(classEnrollments).set({ status: "removed" }).where(eq(classEnrollments.id, enrollment.id));
          return json({ ok: true, status: "removed" });
        }
        if (action === "ban") {
          await db.update(classEnrollments).set({ status: "banned" }).where(eq(classEnrollments.id, enrollment.id));
          return json({ ok: true, status: "banned" });
        }
        if (action === "restore") {
          await db.update(classEnrollments).set({ status: "active" }).where(eq(classEnrollments.id, enrollment.id));
          return json({ ok: true, status: "active" });
        }
        return json({ error: "Unsupported class action." }, 400);
      }
    }

    // ─────────────── CLASS ASSIGNMENTS ───────────────
    if (resource === "assignments") {
      if (method === "POST" || (method === "PUT" && id)) {
        const auth = await requireUser(req, ["mentor", "admin"]);
        if (auth.error) return auth.error;
        const isAdmin = auth.user!.role === "admin";
        const b = await req.json();
        // Editing an existing task keeps its class unless a new one is passed.
        let current: typeof assignments.$inferSelect | undefined;
        if (method === "PUT") {
          [current] = await db.select().from(assignments).where(eq(assignments.id, Number(id))).limit(1);
          if (!current) return json({ error: "Task not found." }, 404);
          if (!isAdmin && current.mentorId !== auth.user!.id)
            return json({ error: "This task belongs to another mentor." }, 403);
        }
        const classId = Number(b.classId ?? current?.classId);
        const title = String(b.title || "").trim();
        const description = String(b.description || "").trim();
        const questionIds: number[] = Array.from(new Set<number>(
          (Array.isArray(b.questionIds) ? b.questionIds : []).map((value: unknown) => Number(value)).filter(Number.isInteger),
        ));
        const dueAt = new Date(String(b.dueAt || ""));
        const [classroom] = await db.select().from(classes).where(
          isAdmin ? eq(classes.id, classId) : and(eq(classes.id, classId), eq(classes.mentorId, auth.user!.id)),
        ).limit(1);
        if (!classroom) return json({ error: "Class not found." }, 404);
        if (!title) return json({ error: "Enter an assignment title." }, 400);
        if (!questionIds.length) return json({ error: "Choose at least one question." }, 400);
        if (Number.isNaN(dueAt.getTime())) return json({ error: "Choose a deadline." }, 400);
        // A new task must be due in the future; an edit may keep a past deadline.
        if (method === "POST" && dueAt <= new Date()) return json({ error: "Choose a future deadline." }, 400);
        const found = await db.select({ id: questions.id }).from(questions).where(inArray(questions.id, questionIds));
        if (found.length !== questionIds.length) return json({ error: "One or more selected questions no longer exist." }, 400);
        if (method === "PUT") {
          const [row] = await db.update(assignments)
            .set({ classId: classroom.id, title, description, questionIds, dueAt })
            .where(eq(assignments.id, current!.id)).returning();
          return json(row);
        }
        const [row] = await db.insert(assignments).values({
          classId: classroom.id,
          mentorId: isAdmin ? classroom.mentorId : auth.user!.id,
          title, description, questionIds, dueAt,
        }).returning();
        return json(row, 201);
      }

      if (method === "DELETE" && id) {
        const auth = await requireUser(req, ["mentor", "admin"]);
        if (auth.error) return auth.error;
        const [current] = await db.select().from(assignments).where(eq(assignments.id, Number(id))).limit(1);
        if (!current) return json({ error: "Task not found." }, 404);
        if (auth.user!.role !== "admin" && current.mentorId !== auth.user!.id)
          return json({ error: "This task belongs to another mentor." }, 403);
        await db.delete(assignments).where(eq(assignments.id, current.id));
        return json({ deleted: current.id });
      }

      if (method === "GET") {
        const auth = await requireUser(req, ["student", "mentor", "admin"]);
        if (auth.error) return auth.error;
        let rows = [] as (typeof assignments.$inferSelect)[];
        if (auth.user!.role === "student") {
          const enrollments = await db.select().from(classEnrollments).where(and(
            eq(classEnrollments.studentId, auth.user!.id), eq(classEnrollments.status, "active"),
          ));
          const classIds = enrollments.map((row) => row.classId);
          rows = classIds.length
            ? await db.select().from(assignments).where(inArray(assignments.classId, classIds)).orderBy(assignments.dueAt)
            : [];
        } else if (auth.user!.role === "mentor") {
          rows = await db.select().from(assignments).where(eq(assignments.mentorId, auth.user!.id)).orderBy(assignments.dueAt);
        } else {
          rows = await db.select().from(assignments).orderBy(assignments.dueAt);
        }

        const result = [];
        for (const assignment of rows) {
          const [classroom] = await db.select().from(classes).where(eq(classes.id, assignment.classId));
          const taskQuestions = assignment.questionIds.length
            ? await db.select().from(questions).where(inArray(questions.id, assignment.questionIds))
            : [];
          if (auth.user!.role === "student") {
            const taskAttempts = await db.select().from(attempts).where(and(
              eq(attempts.student, `u${auth.user!.id}`), eq(attempts.mode, `task:${assignment.id}`),
            ));
            const completedIds = Array.from(new Set(taskAttempts.map((row) => row.questionId)));
            result.push({ ...assignment, classroom, questions: taskQuestions.map(withoutKey), completedIds, completed: completedIds.length, total: assignment.questionIds.length });
          } else {
            const enrollments = await db.select().from(classEnrollments).where(and(
              eq(classEnrollments.classId, assignment.classId), eq(classEnrollments.status, "active"),
            ));
            const progress = [];
            for (const enrollment of enrollments) {
              const [student] = await db.select().from(users).where(eq(users.id, enrollment.studentId));
              if (!student) continue;
              const taskAttempts = await db.select().from(attempts).where(and(
                eq(attempts.student, `u${student.id}`), eq(attempts.mode, `task:${assignment.id}`),
              ));
              progress.push({ student: publicUser(student), completed: new Set(taskAttempts.map((row) => row.questionId)).size });
            }
            result.push({ ...assignment, classroom, questions: taskQuestions, progress, total: assignment.questionIds.length });
          }
        }
        return json(result);
      }
    }

    // ─────────────── FULL-LENGTH TESTS ───────────────
    // Importer, export, exam tasks and analytics live in lib/fulltests.
    if ((resource === "tests" && (id === "import" || ["export", "publish", "integrity"].includes(parts[2])))
      || resource === "test-assignments" || resource === "test-analytics") {
      const handled = await handleFullTests(req, parts, { json, requireUser });
      if (handled) return handled;
    }

    if (resource === "tests") {
      const auth = await requireUser(req, ["student", "mentor", "admin"]);
      if (auth.error) return auth.error;
      const role = auth.user!.role;
      const testId = Number(id);

      // Admins and mentors both build and publish tests; students only sit them.
      if (method !== "GET" && role === "student")
        return json({ error: "Only admins and mentors can edit full-length tests." }, 403);

      // Nested: modules of one test.
      if (parts[2] === "modules" && method === "POST") {
        const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
        if (!test) return json({ error: "Test not found." }, 404);
        const b = await req.json();
        const title = String(b.title || "").trim();
        if (!title) return json({ error: "Enter a module title." }, 400);
        const limit = b.timeLimitMinutes === null || b.timeLimitMinutes === "" || b.timeLimitMinutes === undefined
          ? null : Math.max(1, Math.min(600, Math.round(Number(b.timeLimitMinutes) || 0)));
        const existing = await loadTestModules(testId);
        const [row] = await db.insert(testModules).values({
          testId,
          title,
          section: b.section === "ebrw" ? "ebrw" : "math",
          timeLimitMinutes: limit,
          position: existing.length,
        }).returning();
        return json(row, 201);
      }

      // Nested: every sitting of one test, for mentor and admin review.
      if (parts[2] === "attempts" && method === "GET") {
        if (role === "student") return json({ error: "You do not have access to this action." }, 403);
        const rows = await db.select().from(testAttempts)
          .where(eq(testAttempts.testId, testId)).orderBy(desc(testAttempts.startedAt));
        const visible = [];
        for (const row of rows) {
          if (role === "mentor" && !(await mentorCanAccessStudent(auth.user!.id, row.studentId))) continue;
          const [student] = await db.select().from(users).where(eq(users.id, row.studentId)).limit(1);
          if (!student) continue;
          visible.push({ ...row, student: publicUser(student) });
        }
        return json(visible);
      }

      if (method === "GET" && id) {
        // Students may only open a published test, and never with the key attached.
        const detail = await loadTestDetail(testId, role !== "student");
        if (!detail) return json({ error: "Test not found." }, 404);
        if (role === "student" && detail.status !== "published")
          return json({ error: "This test is not available yet." }, 404);
        return json(detail);
      }

      if (method === "GET") {
        await ensureSeedFullTest().catch((err) => console.error("Seeding the sample test failed", err));
        const rows = await db.select().from(tests)
          .where(role === "student" ? eq(tests.status, "published") : undefined)
          .orderBy(desc(tests.createdAt));
        const result = [];
        for (const test of rows) {
          const mods = await loadTestModules(test.id);
          let questionCount = 0;
          // Per-module outline (no question content) — feeds the student's
          // "Select modules" picker, which is built from the test's real data.
          const moduleOutline = [];
          for (const m of mods) {
            const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
              .from(testModuleQuestions).where(eq(testModuleQuestions.moduleId, m.id));
            questionCount += count;
            moduleOutline.push({
              id: m.id, title: m.title, section: m.section, moduleNumber: m.moduleNumber,
              difficultyTrack: m.difficultyTrack, timeLimitMinutes: m.timeLimitMinutes, position: m.position,
              questionCount: count,
            });
          }
          const summary = {
            ...test,
            moduleCount: mods.length,
            moduleOutline,
            questionCount,
            perModuleTiming: isPerModuleTimed(mods),
            totalMinutes: testTotalMinutes(test, mods),
          };
          if (role === "student") {
            // Practice sittings only — exam-task sittings show on the task card.
            const [latest] = await db.select().from(testAttempts).where(and(
              eq(testAttempts.testId, test.id), eq(testAttempts.studentId, auth.user!.id),
              sql`${testAttempts.assignmentId} is null`,
            )).orderBy(desc(testAttempts.startedAt)).limit(1);
            result.push({ ...summary, attempt: latest ? await settleExpiredAttempt(latest) : null });
          } else {
            const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
              .from(testAttempts).where(eq(testAttempts.testId, test.id));
            result.push({ ...summary, attemptCount: count });
          }
        }
        return json(result);
      }

      if (method === "POST") {
        const b = await req.json();
        const title = String(b.title || "").trim();
        if (!title) return json({ error: "Enter a test title." }, 400);
        const [row] = await db.insert(tests).values({
          title,
          description: String(b.description || "").trim(),
          timeLimitMinutes: Math.max(1, Math.min(600, Math.round(Number(b.timeLimitMinutes) || 134))),
          status: b.status === "published" ? "published" : "draft",
          createdBy: auth.user!.id,
        }).returning();
        return json(row, 201);
      }

      if (method === "PUT" && id) {
        const b = await req.json();
        const title = String(b.title || "").trim();
        if (!title) return json({ error: "Enter a test title." }, 400);
        const mods = await loadTestModules(testId);
        if (b.status === "published" && !mods.length)
          return json({ error: "Add at least one module before publishing." }, 400);
        if (b.status === "published") {
          const [current] = await db.select({ status: tests.status }).from(tests).where(eq(tests.id, testId)).limit(1);
          if (current && current.status !== "published") {
            const problems = await publishProblems(testId);
            if (problems.length) return json({ error: `The test cannot be published yet: ${problems[0]}`, problems }, 400);
          }
        }
        const [row] = await db.update(tests).set({
          title,
          description: String(b.description || "").trim(),
          timeLimitMinutes: Math.max(1, Math.min(600, Math.round(Number(b.timeLimitMinutes) || 134))),
          status: b.status === "published" ? "published" : "draft",
        }).where(eq(tests.id, testId)).returning();
        if (!row) return json({ error: "Test not found." }, 404);
        return json(row);
      }

      if (method === "DELETE" && id) {
        const [existing] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
        if (!existing) return json({ error: "Test not found." }, 404);
        if (role === "mentor" && existing.createdBy !== auth.user!.id)
          return json({ error: "Only the author of this test, or an admin, can delete it." }, 403);
        const mods = await loadTestModules(testId);
        const heldIds: number[] = [];
        for (const m of mods) {
          const links = await db.select().from(testModuleQuestions).where(eq(testModuleQuestions.moduleId, m.id));
          heldIds.push(...links.map((l) => l.questionId));
          await db.delete(testModuleQuestions).where(eq(testModuleQuestions.moduleId, m.id));
        }
        await db.delete(testModules).where(eq(testModules.testId, testId));
        await db.delete(testAttempts).where(eq(testAttempts.testId, testId));
        await db.delete(testAssignments).where(eq(testAssignments.testId, testId));
        await db.delete(tests).where(eq(tests.id, testId));
        await pruneTestQuestions(heldIds);
        return json({ deleted: testId });
      }
    }

    // ─────────────── TEST MODULES (admin) ───────────────
    if (resource === "test-modules" && id) {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const moduleId = Number(id);
      const [mod] = await db.select().from(testModules).where(eq(testModules.id, moduleId)).limit(1);
      if (!mod) return json({ error: "Module not found." }, 404);

      // Append bank questions to a module (as snapshots), skipping anything
      // already in it. Kept for older clients; the builder now uses
      // POST /api/admin/tests/:testId/modules/:moduleId/questions.
      if (parts[2] === "questions" && method === "POST") {
        const parsed = z.object({ questionIds: z.array(questionIdSchema).min(1, "Choose at least one question.") })
          .safeParse(await req.json());
        if (!parsed.success) return json({ error: zodMessage(parsed.error) }, 400);
        const result = await importBankQuestions(moduleId, parsed.data.questionIds);
        if ("error" in result) return json({ error: result.error }, 400);
        return json({ added: result.added.length, questionIds: result.added.map((q) => q.id) }, 201);
      }

      // Replace the module's question list — this is how removal and reordering
      // both happen, so the stored positions always match what the admin sees.
      // Only questions the module already holds may be listed: new ones come in
      // through import (snapshotted) or manual creation, never a raw bank id.
      if (parts[2] === "questions" && method === "PUT") {
        const b = await req.json();
        const ordered: number[] = Array.from(new Set<number>(
          (Array.isArray(b.questionIds) ? b.questionIds : []).map((v: unknown) => Number(v)).filter(Number.isInteger),
        ));
        const links = await db.select().from(testModuleQuestions).where(eq(testModuleQuestions.moduleId, moduleId));
        const sourceOf = new Map(links.map((l) => [l.questionId, l.source]));
        if (ordered.some((qid) => !sourceOf.has(qid)))
          return json({ error: "One or more questions are not part of this module. Reload and try again." }, 400);
        await db.delete(testModuleQuestions).where(eq(testModuleQuestions.moduleId, moduleId));
        for (let i = 0; i < ordered.length; i += 1)
          await db.insert(testModuleQuestions).values({ moduleId, questionId: ordered[i], position: i, source: sourceOf.get(ordered[i]) });
        await pruneTestQuestions(links.map((l) => l.questionId).filter((qid) => !ordered.includes(qid)));
        return json({ questionIds: ordered });
      }

      if (method === "PUT") {
        const b = await req.json();
        const title = String(b.title || "").trim();
        if (!title) return json({ error: "Enter a module title." }, 400);
        const limit = b.timeLimitMinutes === null || b.timeLimitMinutes === "" || b.timeLimitMinutes === undefined
          ? null : Math.max(1, Math.min(600, Math.round(Number(b.timeLimitMinutes) || 0)));
        const [row] = await db.update(testModules).set({
          title,
          section: b.section === "ebrw" ? "ebrw" : "math",
          timeLimitMinutes: limit,
          position: Number.isInteger(Number(b.position)) ? Number(b.position) : mod.position,
        }).where(eq(testModules.id, moduleId)).returning();
        return json(row);
      }

      if (method === "DELETE") {
        const links = await db.select().from(testModuleQuestions).where(eq(testModuleQuestions.moduleId, moduleId));
        await db.delete(testModuleQuestions).where(eq(testModuleQuestions.moduleId, moduleId));
        await db.delete(testModules).where(eq(testModules.id, moduleId));
        await pruneTestQuestions(links.map((l) => l.questionId));
        // Close the gap so the remaining modules keep a contiguous order.
        const rest = await loadTestModules(mod.testId);
        for (let i = 0; i < rest.length; i += 1)
          if (rest[i].position !== i) await db.update(testModules).set({ position: i }).where(eq(testModules.id, rest[i].id));
        return json({ deleted: moduleId });
      }
    }

    // ─────────────── ADMIN · TEST MODULE QUESTIONS ───────────────
    // /api/admin/tests/:testId/modules/:moduleId/questions[/:questionId]
    if (resource === "admin" && id === "tests" && parts[3] === "modules" && parts[5] === "questions") {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const testId = Number(parts[2]);
      const moduleId = Number(parts[4]);
      if (!Number.isInteger(testId) || !Number.isInteger(moduleId)) return json({ error: "Module not found in this test." }, 404);
      const [mod] = await db.select().from(testModules)
        .where(and(eq(testModules.id, moduleId), eq(testModules.testId, testId))).limit(1);
      if (!mod) return json({ error: "Module not found in this test." }, 404);

      // Import from the bank, or write a new test-only question.
      if (method === "POST" && !parts[6]) {
        const parsed = parseAddModuleQuestion(await req.json());
        if ("error" in parsed) return json({ error: parsed.error }, 400);
        const body = parsed.data;
        if ("question" in body) {
          const { question, bankCopy } = await createManualQuestion(moduleId, body.question, body.copyToBank);
          return json({ added: 1, questions: [{ ...question, source: TEST_EXCLUSIVE }], bankCopyId: bankCopy?.id ?? null }, 201);
        }
        const result = await importBankQuestions(moduleId, "questionBankId" in body ? [body.questionBankId] : body.questionBankIds);
        if ("error" in result) return json({ error: result.error }, 400);
        return json({ added: result.added.length, questions: result.added.map((q) => ({ ...q, source: BANK })) }, 201);
      }

      // Edit the test's copy of a question. A legacy link that still points at
      // a bank row is forked into a snapshot first, so the bank is never touched.
      if (method === "PUT" && parts[6]) {
        const questionId = Number(parts[6]);
        if (!Number.isInteger(questionId)) return json({ error: "That question is not part of this module." }, 404);
        const [link] = await db.select().from(testModuleQuestions).where(and(
          eq(testModuleQuestions.moduleId, moduleId), eq(testModuleQuestions.questionId, questionId),
        )).limit(1);
        if (!link) return json({ error: "That question is not part of this module." }, 404);
        const parsed = QuestionFieldsSchema.safeParse(await req.json());
        if (!parsed.success) return json({ error: zodMessage(parsed.error) }, 400);
        const values = questionColumns(parsed.data);
        const [current] = await db.select().from(questions).where(eq(questions.id, questionId)).limit(1);
        if (!current) return json({ error: "Question not found." }, 404);
        let row: QuestionRow;
        if (current.scope === TEST_EXCLUSIVE) {
          [row] = await db.update(questions).set(values).where(eq(questions.id, questionId)).returning();
        } else {
          [row] = await db.insert(questions)
            .values({ ...values, scope: TEST_EXCLUSIVE, sourceQuestionId: current.id }).returning();
          await db.update(testModuleQuestions).set({ questionId: row.id }).where(eq(testModuleQuestions.id, link.id));
        }
        return json({ ...row, source: link.source === TEST_EXCLUSIVE ? TEST_EXCLUSIVE : BANK });
      }
      return json({ error: "Method not allowed." }, 405);
    }

    // ─────────────── TEST ATTEMPTS (student sittings) ───────────────
    if (resource === "test-attempts") {
      const auth = await requireUser(req, ["student", "mentor", "admin"]);
      if (auth.error) return auth.error;
      const role = auth.user!.role;

      // Start a fresh sitting, or hand back the one already in progress.
      if (method === "POST" && !id) {
        if (role !== "student") return json({ error: "Only students can sit a test." }, 403);
        const b = await req.json();
        // An exam task names the test (and maybe a slice of its modules) itself.
        const assignment = b.assignmentId ? await loadAssignment(Number(b.assignmentId)) : null;
        if (b.assignmentId && (!assignment || !(await assignmentReaches(assignment, auth.user!.id))))
          return json({ error: "This exam task is not assigned to you." }, 404);
        const wantedTest = assignment ? assignment.testId : Number(b.testId);
        const [test] = await db.select().from(tests).where(eq(tests.id, wantedTest)).limit(1);
        if (!test || (!assignment && test.status !== "published")) return json({ error: "This test is not available yet." }, 404);
        const mods = await loadTestModules(test.id);
        // Self-started practice may pick its scope and timing. Exam tasks keep
        // the task's own slice and are always timed.
        const opts = assignment ? { scope: "full" as const, moduleIds: [] as number[], timed: true } : parsePracticeOptions(b, mods);
        if ("error" in opts) return json({ error: opts.error }, 400);
        const plan = opts.scope === "modules"
          ? mods.filter((m) => opts.moduleIds.includes(m.id)).map((m) => m.id)
          : initialPlan(test, mods, assignment?.moduleIds);
        if (!plan.length) return json({ error: "This test has no modules yet." }, 400);
        const [open] = await db.select().from(testAttempts).where(and(
          eq(testAttempts.testId, test.id), eq(testAttempts.studentId, auth.user!.id),
          sql`${testAttempts.submittedAt} is null`,
          assignment ? eq(testAttempts.assignmentId, assignment.id) : sql`${testAttempts.assignmentId} is null`,
        )).orderBy(desc(testAttempts.startedAt)).limit(1);
        // An open sitting keeps the scope and timing it was started with.
        if (open) return json({ ...(await settleExpiredAttempt(open)), resumed: true });
        // Exam Mode (full screen + integrity monitoring) for full-length timed
        // sittings; students may opt into Practice Mode when admins allow it.
        const exam = await examSettings();
        const fullTimed = opts.scope === "full" && opts.timed;
        const examMode = exam.examModeFullLength && fullTimed && (!!assignment || !(b.examMode === false && exam.allowPracticeMode));
        // Self-started sittings count against the mock-test limits; exam tasks never do.
        if (!assignment) {
          const usage = await consumeUsage(auth.user!.id, "mock");
          if (!usage.ok) return json(usage, 429);
        }
        const byId = new Map(mods.map((m) => [m.id, m]));
        const planMods = plan.map((mid) => byId.get(mid)!).filter(Boolean);
        const [row] = await db.insert(testAttempts).values({
          testId: test.id,
          studentId: auth.user!.id,
          moduleIndex: 0,
          answers: {},
          modulePlan: plan,
          assignmentId: assignment?.id ?? null,
          allowPause: assignment ? assignment.allowPause : true,
          timed: opts.timed,
          practiceScope: opts.scope,
          examMode,
          // Untimed practice has no deadline at all, so nothing ever expires it.
          expiresAt: opts.timed ? new Date(Date.now() + minutesForModule(test, planMods, 0) * 60_000) : null,
        }).returning();
        return json(row, 201);
      }

      if (method === "GET" && !id) {
        if (role === "student") {
          const rows = await db.select().from(testAttempts)
            .where(eq(testAttempts.studentId, auth.user!.id)).orderBy(desc(testAttempts.startedAt));
          return json(rows);
        }
        const requested = Number(url.searchParams.get("studentId"));
        if (!Number.isInteger(requested)) return json({ error: "Pass a studentId." }, 400);
        if (role === "mentor" && !(await mentorCanAccessStudent(auth.user!.id, requested)))
          return json({ error: "Student is not in one of your classes." }, 403);
        const rows = await db.select().from(testAttempts)
          .where(eq(testAttempts.studentId, requested)).orderBy(desc(testAttempts.startedAt));
        return json(rows);
      }

      const attemptId = Number(id);
      const [found] = await db.select().from(testAttempts).where(eq(testAttempts.id, attemptId)).limit(1);
      if (!found) return json({ error: "Attempt not found." }, 404);
      if (role === "student" && found.studentId !== auth.user!.id)
        return json({ error: "You do not have access to this action." }, 403);
      if (role === "mentor" && !(await mentorCanAccessStudent(auth.user!.id, found.studentId)))
        return json({ error: "Student is not in one of your classes." }, 403);

      // Every read settles the clock first, so a student who walked away comes
      // back to the state the deadline dictates rather than to extra time.
      let attempt = await settleExpiredAttempt(found);

      if (method === "GET") {
        // The key comes back only once the sitting is closed, for review.
        const detail = await loadTestDetail(attempt.testId, !!attempt.submittedAt || role !== "student", attempt);
        if (!detail) return json({ error: "Test not found." }, 404);
        return json({ attempt, test: detail, report: await ensureScoreReport(attempt), serverNow: Date.now() });
      }

      if (method !== "POST" || role !== "student")
        return json({ error: "You do not have access to this action." }, 403);
      if (attempt.submittedAt) return json({ error: "This test has already been submitted.", attempt }, 409);

      const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId)).limit(1);
      const mods = test ? await planModules(attempt) : [];
      if (!test || !mods.length) return json({ error: "Test not found." }, 404);
      // A paused sitting is frozen: nothing moves until the student resumes.
      if (attempt.status === "paused" && parts[2] !== "submit")
        return json({ error: "This test is paused. Resume it to continue.", attempt }, 409);

      if (parts[2] === "answer") {
        const b = await req.json();
        const questionId = Number(b.questionId);
        const current = mods[attempt.moduleIndex];
        const allowed = current ? await loadModuleQuestions(current.id) : [];
        if (!allowed.some((q) => q.id === questionId))
          return json({ error: "That question is not in the module you are on." }, 400);
        const answers = { ...(attempt.answers || {}) };
        const selected = String(b.selected ?? "").slice(0, 200);
        if (selected) answers[String(questionId)] = selected;
        else delete answers[String(questionId)];
        const [row] = await db.update(testAttempts).set({ answers, lastSavedAt: new Date() })
          .where(eq(testAttempts.id, attempt.id)).returning();
        return json(row);
      }

      if (parts[2] === "advance") {
        // The client names the module it is leaving. If the server already
        // rolled past it (its clock ran out first), don't skip a second one.
        const b = await req.json().catch(() => ({}));
        if (b.moduleIndex !== undefined && Number(b.moduleIndex) !== attempt.moduleIndex) return json(attempt);
        const next = attempt.moduleIndex + 1;
        if (next >= mods.length) return json(await submitTestAttempt(attempt));
        await recordModuleCompletion(attempt.id, attempt.studentId, attempt.moduleIndex).catch(() => {});
        // Routes an adaptive Module 2, starts its clock (continuous timing keeps
        // the original deadline), and opens the section break when one is due.
        const [row] = await db.update(testAttempts).set(await moduleTransition(test, attempt, mods, next))
          .where(eq(testAttempts.id, attempt.id)).returning();
        return json(row);
      }

      // End the break between sections early: the module's full time starts now.
      if (parts[2] === "skip-break") {
        const breakEnd = attempt.breakEndsAt ? new Date(attempt.breakEndsAt).getTime() : 0;
        if (!breakEnd || breakEnd <= Date.now() || !attempt.expiresAt) return json(attempt);
        const moduleMs = Math.max(0, new Date(attempt.expiresAt).getTime() - breakEnd);
        const [row] = await db.update(testAttempts).set({
          breakEndsAt: null, expiresAt: new Date(Date.now() + moduleMs), lastSavedAt: new Date(),
        }).where(eq(testAttempts.id, attempt.id)).returning();
        return json(row);
      }

      if (parts[2] === "submit") return json(await submitTestAttempt(attempt));

      return json({ error: "Unknown test attempt action." }, 404);
    }

    // ─────────────── ONLINE LESSONS ───────────────
    if (resource === "lessons") {
      const auth = await requireUser(req, ["student", "mentor", "admin"]);
      if (auth.error) return auth.error;
      const role = auth.user!.role;
      const canEdit = role === "admin" || role === "mentor";
      const lessonId = Number(id);

      // Comments hang off one lesson. Students post questions here; admins and
      // mentors answer them, optionally as a reply to a specific comment.
      if (id && parts[2] === "comments") {
        const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
        if (!lesson) return json({ error: "Lesson not found." }, 404);
        if (role === "student" && lesson.status !== "published")
          return json({ error: "This lesson is not available yet." }, 404);
        if (method === "GET") return json(await lessonCommentTree(lessonId));
        if (method === "POST") {
          const b = await req.json();
          const body = String(b.body ?? "").trim().slice(0, 4000);
          if (!body) return json({ error: "Write a comment first." }, 400);
          let parentId: number | null = Number.isInteger(Number(b.parentId)) ? Number(b.parentId) : null;
          if (parentId !== null) {
            const [parent] = await db.select().from(lessonComments).where(and(
              eq(lessonComments.id, parentId), eq(lessonComments.lessonId, lessonId),
            )).limit(1);
            if (!parent) parentId = null;
          }
          const [row] = await db.insert(lessonComments)
            .values({ lessonId, authorId: auth.user!.id, body, parentId })
            .returning();
          return json(row, 201);
        }
      }

      if (method === "GET" && id) {
        const [lesson] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
        if (!lesson) return json({ error: "Lesson not found." }, 404);
        if (role === "student" && lesson.status !== "published")
          return json({ error: "This lesson is not available yet." }, 404);
        return json(await lessonWithMeta(lesson, true));
      }

      if (method === "GET") {
        const section = url.searchParams.get("section");
        const category = url.searchParams.get("category");
        const subcategory = url.searchParams.get("subcategory");
        const conds = [];
        if (role === "student") conds.push(eq(lessons.status, "published"));
        if (section) conds.push(eq(lessons.section, section));
        if (category) conds.push(eq(lessons.category, category));
        if (subcategory) conds.push(eq(lessons.subcategory, subcategory));
        const rows = await db.select().from(lessons)
          .where(conds.length ? and(...conds) : undefined)
          .orderBy(desc(lessons.createdAt));
        const result = [];
        for (const lesson of rows) result.push(await lessonWithMeta(lesson, false));
        return json(result);
      }

      if (!canEdit) return json({ error: "Only admins and mentors can publish lessons." }, 403);

      if (method === "POST") {
        const b = await req.json();
        const title = String(b.title ?? "").trim();
        const videoId = youtubeVideoId(b.youtubeUrl ?? b.videoId);
        if (!title) return json({ error: "Enter a lesson title." }, 400);
        if (!videoId) return json({ error: "Paste a YouTube link — e.g. https://www.youtube.com/watch?v=…" }, 400);
        const [row] = await db.insert(lessons).values({
          title,
          topic: String(b.topic ?? "").trim().slice(0, 200),
          section: lessonSection(b.section),
          category: String(b.category ?? "").trim(),
          subcategory: String(b.subcategory ?? "").trim(),
          youtubeUrl: String(b.youtubeUrl ?? "").trim().slice(0, 500),
          videoId,
          description: sanitizeRichHtml(b.description),
          difficulty: Math.max(1, Math.min(5, Math.round(Number(b.difficulty) || 3))),
          status: b.status === "draft" ? "draft" : "published",
          createdBy: auth.user!.id,
        }).returning();
        return json(await lessonWithMeta(row, false), 201);
      }

      if (method === "PUT" && id) {
        const [existing] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
        if (!existing) return json({ error: "Lesson not found." }, 404);
        const b = await req.json();
        const title = String(b.title ?? "").trim();
        const videoId = youtubeVideoId(b.youtubeUrl ?? b.videoId);
        if (!title) return json({ error: "Enter a lesson title." }, 400);
        if (!videoId) return json({ error: "Paste a YouTube link — e.g. https://www.youtube.com/watch?v=…" }, 400);
        const [row] = await db.update(lessons).set({
          title,
          topic: String(b.topic ?? "").trim().slice(0, 200),
          section: lessonSection(b.section),
          category: String(b.category ?? "").trim(),
          subcategory: String(b.subcategory ?? "").trim(),
          youtubeUrl: String(b.youtubeUrl ?? "").trim().slice(0, 500),
          videoId,
          description: sanitizeRichHtml(b.description),
          difficulty: Math.max(1, Math.min(5, Math.round(Number(b.difficulty) || 3))),
          status: b.status === "draft" ? "draft" : "published",
          updatedAt: new Date(),
        }).where(eq(lessons.id, lessonId)).returning();
        return json(await lessonWithMeta(row, false));
      }

      if (method === "DELETE" && id) {
        const [existing] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
        if (!existing) return json({ error: "Lesson not found." }, 404);
        // A mentor may retire a lesson they published; admins may remove any.
        if (role === "mentor" && existing.createdBy !== auth.user!.id)
          return json({ error: "Only the mentor who published this lesson, or an admin, can delete it." }, 403);
        await db.delete(lessonComments).where(eq(lessonComments.lessonId, lessonId));
        await db.delete(lessons).where(eq(lessons.id, lessonId));
        return json({ deleted: lessonId });
      }
    }

    if (resource === "lesson-comments" && id && method === "DELETE") {
      const auth = await requireUser(req, ["student", "mentor", "admin"]);
      if (auth.error) return auth.error;
      const commentId = Number(id);
      const [comment] = await db.select().from(lessonComments).where(eq(lessonComments.id, commentId)).limit(1);
      if (!comment) return json({ error: "Comment not found." }, 404);
      const role = auth.user!.role;
      if (role === "student" && comment.authorId !== auth.user!.id)
        return json({ error: "You can only delete your own comment." }, 403);
      await db.delete(lessonComments).where(eq(lessonComments.parentId, commentId));
      await db.delete(lessonComments).where(eq(lessonComments.id, commentId));
      return json({ deleted: commentId });
    }

    // ─────────────── STUDENT MONITORING (admin & mentor) ───────────────
    // One payload with everything the Users & Stats panel needs: who each
    // student's mentor and class are, how they are doing per section of the
    // question bank, and how every full-length test sitting went.
    if (resource === "students" && method === "GET") {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const role = auth.user!.role;

      const [studentRows, mentorRows, enrollRows, bankRows, activityRows, testRows] = await Promise.all([
        db.select().from(users).where(eq(users.role, "student")).orderBy(desc(users.createdAt)),
        db.select().from(users).where(eq(users.role, "mentor")),
        db.select({
          studentId: classEnrollments.studentId,
          status: classEnrollments.status,
          joinedAt: classEnrollments.joinedAt,
          classId: classes.id,
          className: classes.name,
          mentorId: classes.mentorId,
        }).from(classEnrollments).innerJoin(classes, eq(classEnrollments.classId, classes.id)),
        db.select({
          student: attempts.student,
          section: attempts.section,
          category: attempts.category,
          total: sql<number>`count(*)::int`,
          correct: sql<number>`sum(case when ${attempts.correct} then 1 else 0 end)::int`,
        }).from(attempts)
          .where(sql`${attempts.mode} not like 'test:%'`)
          .groupBy(attempts.student, attempts.section, attempts.category),
        db.select({
          student: attempts.student,
          lastActiveAt: sql<Date | null>`max(${attempts.createdAt})`,
        }).from(attempts).groupBy(attempts.student),
        db.select({
          id: testAttempts.id,
          studentId: testAttempts.studentId,
          testId: testAttempts.testId,
          title: tests.title,
          correctCount: testAttempts.correctCount,
          totalCount: testAttempts.totalCount,
          startedAt: testAttempts.startedAt,
          submittedAt: testAttempts.submittedAt,
          moduleIndex: testAttempts.moduleIndex,
        }).from(testAttempts).innerJoin(tests, eq(testAttempts.testId, tests.id))
          .orderBy(desc(testAttempts.startedAt)),
      ]);

      const mentorName = new Map(mentorRows.map((m) => [m.id, m.displayName]));
      const classList = Array.from(
        new Map(enrollRows.map((row) => [row.classId, {
          id: row.classId, name: row.className, mentorId: row.mentorId,
          mentorName: mentorName.get(row.mentorId) ?? "Mentor",
        }])).values(),
      );
      // A mentor only ever sees the students enrolled in their own classes.
      const visibleClassIds = new Set(
        classList.filter((c) => role === "admin" || c.mentorId === auth.user!.id).map((c) => c.id),
      );

      const percent = (correct: number, total: number) => (total ? Math.round((correct / total) * 100) : 0);
      const result = [];
      for (const student of studentRows) {
        const memberships = enrollRows.filter((row) => row.studentId === student.id && row.status === "active" && visibleClassIds.has(row.classId));
        if (role === "mentor" && !memberships.length) continue;
        const bank = bankRows.filter((row) => row.student === `u${student.id}`);
        const bankTotal = bank.reduce((sum, row) => sum + row.total, 0);
        const bankCorrect = bank.reduce((sum, row) => sum + (row.correct ?? 0), 0);
        const bySection = ["math", "ebrw"].map((section) => {
          const slice = bank.filter((row) => row.section === section);
          const total = slice.reduce((sum, row) => sum + row.total, 0);
          const correct = slice.reduce((sum, row) => sum + (row.correct ?? 0), 0);
          return { section, total, correct, accuracy: percent(correct, total) };
        });
        const byCategory = bank.map((row) => ({
          section: row.section, category: row.category, total: row.total,
          correct: row.correct ?? 0, accuracy: percent(row.correct ?? 0, row.total),
        })).sort((a, b) => b.total - a.total);
        const sittings = testRows.filter((row) => row.studentId === student.id);
        const submitted = sittings.filter((row) => row.submittedAt);
        const testCorrect = submitted.reduce((sum, row) => sum + row.correctCount, 0);
        const testTotal = submitted.reduce((sum, row) => sum + row.totalCount, 0);
        result.push({
          ...publicUser(student),
          createdAt: student.createdAt,
          lastActiveAt: activityRows.find((row) => row.student === `u${student.id}`)?.lastActiveAt ?? null,
          classes: memberships.map((row) => ({
            id: row.classId, name: row.className, mentorId: row.mentorId,
            mentorName: mentorName.get(row.mentorId) ?? "Mentor", joinedAt: row.joinedAt,
          })),
          bank: { total: bankTotal, correct: bankCorrect, accuracy: percent(bankCorrect, bankTotal), bySection, byCategory },
          tests: {
            sittings: sittings.length,
            submitted: submitted.length,
            correct: testCorrect,
            total: testTotal,
            accuracy: percent(testCorrect, testTotal),
            rows: sittings.map((row) => ({
              id: row.id, testId: row.testId, title: row.title,
              correctCount: row.correctCount, totalCount: row.totalCount,
              accuracy: percent(row.correctCount, row.totalCount),
              startedAt: row.startedAt, submittedAt: row.submittedAt, moduleIndex: row.moduleIndex,
            })),
          },
        });
      }

      return json({
        students: result,
        classes: classList.filter((c) => visibleClassIds.has(c.id)),
        mentors: mentorRows
          .filter((m) => role === "admin" || m.id === auth.user!.id)
          .map((m) => ({ id: m.id, displayName: m.displayName, status: m.status })),
      });
    }

    // ─────────────── QUESTIONS ───────────────
    if (resource === "questions") {
      if (id === "stats" && method === "GET") {
        const rows = await db
          .select({
            section: questions.section,
            category: questions.category,
            subcategory: questions.subcategory,
            count: sql<number>`count(*)::int`,
          })
          .from(questions)
          .where(bankOnly)
          .groupBy(questions.section, questions.category, questions.subcategory);
        return json(rows);
      }

      if (id === "seed" && method === "POST") {
        const auth = await requireUser(req, ["admin"]);
        if (auth.error) return auth.error;
        const existing = await db.select({ id: questions.id }).from(questions).where(bankOnly).limit(1);
        if (existing.length) return json({ seeded: 0, message: "Bank already has questions." });
        await db.insert(questions).values(SEED_QUESTIONS);
        for (const p of SEED_PAGES) {
          await db
            .insert(pages)
            .values(p)
            .onConflictDoNothing({ target: pages.slug });
        }
        return json({ seeded: SEED_QUESTIONS.length });
      }

      // GET /api/questions (alias /api/questions/bank) is the general bank:
      // test-exclusive questions never appear in practice or the pickers.
      if (method === "GET" && (!id || id === "bank")) {
        // Signed-in users only; students never receive the answer key here —
        // POST /api/attempts grades on the server and returns it after answering.
        const auth = await requireUser(req);
        if (auth.error) return auth.error;
        const section = url.searchParams.get("section");
        const category = url.searchParams.get("category");
        const subcategory = url.searchParams.get("subcategory");
        const conds = [bankOnly];
        if (section) conds.push(eq(questions.section, section));
        if (category) conds.push(eq(questions.category, category));
        if (subcategory) conds.push(eq(questions.subcategory, subcategory));
        const rows = await db
          .select()
          .from(questions)
          .where(and(...conds))
          .orderBy(desc(questions.createdAt));
        return json(auth.user!.role === "student" ? rows.map(withoutKey) : rows);
      }

      if (method === "POST") {
        const auth = await requireUser(req, ["admin", "mentor"]);
        if (auth.error) return auth.error;
        const b = await req.json();
        const [row] = await db
          .insert(questions)
          .values({
            section: b.section,
            category: b.category,
            subcategory: b.subcategory ?? "",
            difficulty: b.difficulty ?? 3,
            type: b.type ?? "mcq",
            passage: b.passage ? sanitizeRichHtml(b.passage) : null,
            prompt: sanitizeRichHtml(b.prompt),
            questionImage: b.questionImage || null,
            choices: sanitizeChoices(b.choices),
            choiceImages: b.choiceImages ?? null,
            answer: b.answer,
            explanation: sanitizeRichHtml(b.explanation ?? ""),
          })
          .returning();
        return json(row, 201);
      }

      if (method === "PUT" && id) {
        const auth = await requireUser(req, ["admin", "mentor"]);
        if (auth.error) return auth.error;
        const b = await req.json();
        const [row] = await db
          .update(questions)
          .set({
            section: b.section,
            category: b.category,
            subcategory: b.subcategory ?? "",
            difficulty: b.difficulty ?? 3,
            type: b.type ?? "mcq",
            passage: b.passage ? sanitizeRichHtml(b.passage) : null,
            prompt: sanitizeRichHtml(b.prompt),
            questionImage: b.questionImage || null,
            choices: sanitizeChoices(b.choices),
            choiceImages: b.choiceImages ?? null,
            answer: b.answer,
            explanation: sanitizeRichHtml(b.explanation ?? ""),
          })
          .where(eq(questions.id, Number(id)))
          .returning();
        return json(row);
      }

      if (method === "DELETE" && id) {
        const auth = await requireUser(req, ["admin"]);
        if (auth.error) return auth.error;
        const questionId = Number(id);
        const taskRows = await db.select().from(assignments);
        for (const task of taskRows) {
          if (!task.questionIds.includes(questionId)) continue;
          const remaining = task.questionIds.filter((item) => item !== questionId);
          if (remaining.length) await db.update(assignments).set({ questionIds: remaining }).where(eq(assignments.id, task.id));
          else await db.delete(assignments).where(eq(assignments.id, task.id));
        }
        await db.delete(savedQuestions).where(eq(savedQuestions.questionId, questionId));
        await db.delete(questions).where(eq(questions.id, questionId));
        return json({ deleted: questionId });
      }
    }

    // ─────────────── ATTEMPTS ───────────────
    if (resource === "attempts") {
      if (method === "POST") {
        const auth = await requireUser(req, ["student"]);
        if (auth.error) return auth.error;
        const b = await req.json();
        const mode = String(b.mode || "bank").slice(0, 40);
        if (!["bank", "rush", "challenge", "review"].includes(mode) && !/^task:\d+$/.test(mode))
          return json({ error: "Unknown practice mode." }, 400);
        // Grade on the server from the stored question, so leaderboards and
        // badges never trust a correctness flag sent by the browser.
        const [question] = await db.select().from(questions).where(eq(questions.id, Number(b.questionId))).limit(1);
        if (!question) return json({ error: "That question no longer exists." }, 404);
        // Review replays saved / missed questions, which may come from a test.
        if (question.scope === TEST_EXCLUSIVE && !mode.startsWith("task:") && mode !== "review")
          return json({ error: "That question is not part of practice." }, 403);
        if (mode.startsWith("task:")) {
          const assignmentId = Number(mode.slice(5));
          const [assignment] = await db.select().from(assignments).where(eq(assignments.id, assignmentId)).limit(1);
          const [taskEnrollment] = assignment ? await db.select().from(classEnrollments).where(and(
            eq(classEnrollments.classId, assignment.classId), eq(classEnrollments.studentId, auth.user!.id), eq(classEnrollments.status, "active"),
          )).limit(1) : [];
          if (!assignment || !taskEnrollment || !assignment.questionIds.includes(question.id))
            return json({ error: "This question is not part of an active assignment." }, 403);
        }
        const selected = String(b.selected ?? "").trim().slice(0, 200);
        // Daily limits: bank & rush share the Question Bank allowance, sets use
        // the Challenging Questions allowance; class tasks and review are never limited.
        const usage = await consumeUsage(auth.user!.id, mode === "challenge" ? "challenge" : mode.startsWith("task:") || mode === "review" ? "task" : "bank");
        if (!usage.ok) return json(usage, 429);
        const [row] = await db
          .insert(attempts)
          .values({
            student: `u${auth.user!.id}`,
            questionId: question.id,
            section: question.section,
            category: question.category,
            difficulty: question.difficulty,
            mode,
            selected,
            correct: selected ? isAnswerCorrect(question, selected) : false,
          })
          .returning();
        await evaluateBadges(auth.user!.id);
        // The key is revealed only once the question has been answered.
        return json({
          ...row,
          answer: question.answer,
          acceptableAnswers: Array.isArray(question.acceptableAnswers) ? question.acceptableAnswers : [],
          explanation: question.explanation ?? "",
        }, 201);
      }
      if (method === "GET") {
        const auth = await requireUser(req, ["student", "mentor", "admin"]);
        if (auth.error) return auth.error;
        const requested = url.searchParams.get("student") || `u${auth.user!.id}`;
        const student = auth.user!.role === "student" ? `u${auth.user!.id}` : requested;
        const studentId = Number(student.replace(/^u/, ""));
        if (auth.user!.role === "mentor" && (!Number.isInteger(studentId) || !(await mentorCanAccessStudent(auth.user!.id, studentId))))
          return json({ error: "Student is not in one of your classes." }, 403);
        const rows = await db
          .select()
          .from(attempts)
          .where(eq(attempts.student, student))
          .orderBy(desc(attempts.createdAt));
        return json(rows);
      }
    }

    // ─────────────── STUDENT REVIEW & LIMIT STATUS ───────────────
    if (resource === "reviews" && method === "GET") {
      const auth = await requireUser(req, ["student", "mentor", "admin"]);
      if (auth.error) return auth.error;
      const requestedId = Number(url.searchParams.get("studentId") || auth.user!.id);
      const studentId = auth.user!.role === "student" ? auth.user!.id : requestedId;
      if (!Number.isInteger(studentId)) return json({ error: "Invalid student." }, 400);
      if (auth.user!.role === "mentor" && !(await mentorCanAccessStudent(auth.user!.id, studentId)))
        return json({ error: "Student is not in one of your classes." }, 403);
      return json(await studentActivity(studentId));
    }

    // ─────────────── SAVED QUESTIONS ───────────────
    if (resource === "saved-questions") {
      const auth = await requireUser(req, ["student"]);
      if (auth.error) return auth.error;
      if (method === "GET") {
        const rows = await db.select({ saved: savedQuestions, question: questions })
          .from(savedQuestions).innerJoin(questions, eq(savedQuestions.questionId, questions.id))
          .where(eq(savedQuestions.studentId, auth.user!.id)).orderBy(desc(savedQuestions.createdAt));
        return json(rows);
      }
      if (method === "POST") {
        const b = await req.json();
        const questionId = Number(b.questionId);
        if (!Number.isInteger(questionId)) return json({ error: "Invalid question." }, 400);
        const [existing] = await db.select().from(savedQuestions).where(and(
          eq(savedQuestions.studentId, auth.user!.id), eq(savedQuestions.questionId, questionId),
        )).limit(1);
        if (existing) return json(existing);
        const [row] = await db.insert(savedQuestions).values({ studentId: auth.user!.id, questionId }).returning();
        return json(row, 201);
      }
      if (method === "DELETE" && id) {
        await db.delete(savedQuestions).where(and(
          eq(savedQuestions.studentId, auth.user!.id), eq(savedQuestions.questionId, Number(id)),
        ));
        return json({ ok: true });
      }
    }

    // ─────────────── PAGES ───────────────
    if (resource === "pages") {
      if (method === "GET" && id) {
        const [row] = await db.select().from(pages).where(eq(pages.slug, id));
        return json(row ?? null);
      }
      if (method === "GET") {
        const rows = await db.select().from(pages);
        return json(rows);
      }
      if (method === "PUT" && id) {
        const auth = await requireUser(req, ["admin"]);
        if (auth.error) return auth.error;
        const b = await req.json();
        // Page bodies are written in the rich-text editor, so they arrive as HTML.
        const body = sanitizeRichHtml(b.body ?? "", 60000);
        const title = String(b.title ?? id);
        const [row] = await db
          .insert(pages)
          .values({ slug: id, title, body })
          .onConflictDoUpdate({
            target: pages.slug,
            set: { title, body, updatedAt: new Date() },
          })
          .returning();
        return json(row);
      }
      if (method === "DELETE" && id) {
        const auth = await requireUser(req, ["admin"]);
        if (auth.error) return auth.error;
        await db.delete(pages).where(eq(pages.slug, id));
        return json({ deleted: id });
      }
    }

    // ─────────────── SITE SETTINGS ───────────────
    // Public read (the storefront needs the name/description for SEO); writes
    // are admin-only.
    if (resource === "settings") {
      if (method === "GET") {
        const [site, branding] = await Promise.all([
          readSetting("site", DEFAULT_SITE),
          readSetting("branding", DEFAULT_BRANDING),
        ]);
        return json({ site, branding });
      }
      if (method === "PUT") {
        const auth = await requireUser(req, ["admin"]);
        if (auth.error) return auth.error;
        const b = await req.json();
        if (b.site && typeof b.site === "object") {
          const cur = await readSetting("site", DEFAULT_SITE);
          await writeSetting("site", {
            name: String(b.site.name ?? cur.name).slice(0, 80),
            tagline: String(b.site.tagline ?? cur.tagline).slice(0, 160),
            description: String(b.site.description ?? cur.description).slice(0, 600),
          });
        }
        const [site, branding] = await Promise.all([
          readSetting("site", DEFAULT_SITE),
          readSetting("branding", DEFAULT_BRANDING),
        ]);
        return json({ site, branding });
      }
    }

    // ─────────────── BRANDING IMAGES (Netlify Blobs) ───────────────
    // GET serves the stored image (or a generated default) so it can be used
    // directly as a favicon / <img src> / og:image URL. PUT accepts the raw
    // image bytes; DELETE reverts to the default.
    if (resource === "branding" && id) {
      const kind = (id === "og" || id === "logo" ? id : null) as BrandingKind | null;
      if (!kind) return json({ error: "Unknown branding image." }, 404);
      const store = brandingStore();

      if (method === "GET") {
        // This URL backs the favicon and og:image, so it must always return an
        // image — fall back to a generated default if the store or DB hiccups.
        try {
          const found = await store.getWithMetadata(kind, { type: "arrayBuffer" });
          if (found?.data) {
            return new Response(found.data as ArrayBuffer, {
              headers: {
                "content-type": String(found.metadata?.contentType || "application/octet-stream"),
                "cache-control": "public, max-age=60",
              },
            });
          }
        } catch (e) {
          console.error("branding read failed", e);
        }
        let name = DEFAULT_SITE.name;
        try {
          name = (await readSetting("site", DEFAULT_SITE)).name;
        } catch {
          /* fall back to the default name */
        }
        return new Response(defaultBrandingSvg(kind, name), {
          headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=60" },
        });
      }

      if (method === "PUT") {
        const auth = await requireUser(req, ["admin"]);
        if (auth.error) return auth.error;
        const contentType = req.headers.get("content-type") || "";
        if (!contentType.startsWith("image/"))
          return json({ error: "Upload an image file (PNG, JPG, SVG, or WebP)." }, 400);
        const bytes = await req.arrayBuffer();
        if (!bytes.byteLength) return json({ error: "The uploaded image was empty." }, 400);
        if (bytes.byteLength > 2_000_000)
          return json({ error: "Image is too large — keep it under 2 MB." }, 400);
        await store.set(kind, bytes, { metadata: { contentType } });
        const branding = await readSetting("branding", DEFAULT_BRANDING);
        await writeSetting("branding", { ...branding, [kind === "og" ? "ogImage" : "logo"]: true });
        return json({ ok: true, kind });
      }

      if (method === "DELETE") {
        const auth = await requireUser(req, ["admin"]);
        if (auth.error) return auth.error;
        await store.delete(kind);
        const branding = await readSetting("branding", DEFAULT_BRANDING);
        await writeSetting("branding", { ...branding, [kind === "og" ? "ogImage" : "logo"]: false });
        return json({ ok: true, kind });
      }
    }

    if (resource === "question-media") {
      const store = questionMediaStore();
      if (method === "POST") {
        const auth = await requireUser(req, ["admin", "mentor"]);
        if (auth.error) return auth.error;
        const contentType = req.headers.get("content-type") || "";
        if (!contentType.startsWith("image/")) return json({ error: "Upload an image file." }, 400);
        const bytes = await req.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES)
          return json({ error: "Question images must be between 1 byte and 3 MB." }, 400);
        // Same store and URL scheme the test importer writes embedded images to.
        const saved = await saveQuestionMedia(bytes, contentType);
        return json({ url: saved.url }, 201);
      }
      if (method === "GET" && id) {
        const found = await store.getWithMetadata(id, { type: "arrayBuffer" });
        if (!found?.data) return json({ error: "Image not found." }, 404);
        return new Response(found.data as ArrayBuffer, {
          headers: {
            "content-type": String(found.metadata?.contentType || "application/octet-stream"),
            "cache-control": "public, max-age=31536000, immutable",
            // Images only: an SVG opened directly can never run script on this origin.
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:",
            "x-content-type-options": "nosniff",
          },
        });
      }
    }

    // ─────────────── USERS (admin) ───────────────
    // Registered students plus a lightweight activity summary per user. Attempts
    // are keyed by the student token "u<id>" the client sends on each submission.
    if (resource === "users" && !id && method === "GET") {
      const auth = await requireUser(req, ["admin"]);
      if (auth.error) return auth.error;
      const rows = await db.select().from(users).orderBy(desc(users.createdAt));
      const agg = await db
        .select({
          student: attempts.student,
          total: sql<number>`count(*)::int`,
          correct: sql<number>`sum(case when ${attempts.correct} then 1 else 0 end)::int`,
        })
        .from(attempts)
        .groupBy(attempts.student);
      const byKey = new Map(agg.map((a) => [a.student, a]));
      return json(
        rows.map((u) => {
          const a = byKey.get("u" + u.id);
          const total = a?.total ?? 0;
          const correct = a?.correct ?? 0;
          return {
            ...publicUser(u),
            createdAt: u.createdAt,
            attempts: total,
            correct,
            accuracy: total ? Math.round((correct / total) * 100) : 0,
          };
        }),
      );
    }

    if (resource === "users" && id && method === "PATCH") {
      const auth = await requireUser(req, ["admin"]);
      if (auth.error) return auth.error;
      const userId = Number(id);
      if (!Number.isInteger(userId)) return json({ error: "Invalid user id." }, 400);
      if (userId === auth.user!.id) return json({ error: "You cannot change your own admin account here." }, 400);
      const b = await req.json();
      const action = String(b.action || "");
      const [target] = await db.select().from(users).where(eq(users.id, userId));
      if (!target) return json({ error: "User not found." }, 404);
      if (action === "ban") {
        const [updated] = await db.update(users).set({ status: "banned", bannedAt: new Date() }).where(eq(users.id, userId)).returning();
        await db.delete(sessions).where(eq(sessions.userId, userId));
        return json({ user: publicUser(updated) });
      }
      if (action === "unban") {
        const status = target.role === "mentor" && !target.approvedAt ? "pending" : "active";
        const [updated] = await db.update(users).set({ status, bannedAt: null }).where(eq(users.id, userId)).returning();
        return json({ user: publicUser(updated) });
      }
      return json({ error: "Unsupported user action." }, 400);
    }

    if (resource === "users" && id && method === "DELETE") {
      const auth = await requireUser(req, ["admin"]);
      if (auth.error) return auth.error;
      const userId = Number(id);
      if (!Number.isInteger(userId)) return json({ error: "Invalid user id." }, 400);
      if (userId === auth.user!.id) return json({ error: "You cannot delete your own admin account." }, 400);
      const ownedClasses = await db.select().from(classes).where(eq(classes.mentorId, userId));
      for (const classroom of ownedClasses) {
        await db.delete(classInvites).where(eq(classInvites.classId, classroom.id));
        await db.delete(classEnrollments).where(eq(classEnrollments.classId, classroom.id));
        await db.delete(assignments).where(eq(assignments.classId, classroom.id));
      }
      await db.delete(classes).where(eq(classes.mentorId, userId));
      await db.delete(classEnrollments).where(eq(classEnrollments.studentId, userId));
      await db.delete(mentorActivationCodes).where(eq(mentorActivationCodes.mentorId, userId));
      await db.delete(savedQuestions).where(eq(savedQuestions.studentId, userId));
      await db.delete(sessions).where(eq(sessions.userId, userId));
      await db.delete(attempts).where(eq(attempts.student, `u${userId}`));
      await db.delete(notifications).where(eq(notifications.userId, userId));
      await db.delete(messages).where(or(eq(messages.senderId, userId), eq(messages.recipientId, userId)));
      await db.delete(badgeAwards).where(eq(badgeAwards.studentId, userId));
      await db.delete(studentDailyActivity).where(eq(studentDailyActivity.studentId, userId));
      await db.delete(usageLimits).where(and(eq(usageLimits.scope, "user"), eq(usageLimits.targetId, userId)));
      await db.delete(questionReports).where(eq(questionReports.reporterId, userId));
      await db.delete(users).where(eq(users.id, userId));
      await db.insert(auditLog).values({ actorId: auth.user!.id, action: "user.delete", targetType: "user", targetId: String(userId) });
      return json({ ok: true });
    }

    // ─────────────── PLATFORM STATS (admin) ───────────────
    if (resource === "stats" && (id === "overview" || !id) && method === "GET") {
      const auth = await requireUser(req, ["admin"]);
      if (auth.error) return auth.error;
      const [[userCount], [attemptAgg], sectionRows] = await Promise.all([
        db.select({ n: sql<number>`count(*)::int` }).from(users),
        db
          .select({
            total: sql<number>`count(*)::int`,
            correct: sql<number>`sum(case when ${attempts.correct} then 1 else 0 end)::int`,
            students: sql<number>`count(distinct ${attempts.student})::int`,
          })
          .from(attempts),
        db
          .select({
            section: attempts.section,
            total: sql<number>`count(*)::int`,
            correct: sql<number>`sum(case when ${attempts.correct} then 1 else 0 end)::int`,
          })
          .from(attempts)
          .groupBy(attempts.section),
      ]);
      const total = attemptAgg?.total ?? 0;
      const correct = attemptAgg?.correct ?? 0;
      return json({
        users: userCount?.n ?? 0,
        attempts: total,
        correct,
        accuracy: total ? Math.round((correct / total) * 100) : 0,
        activeStudents: attemptAgg?.students ?? 0,
        bySection: sectionRows.map((r) => ({
          section: r.section,
          total: r.total,
          correct: r.correct,
          accuracy: r.total ? Math.round((r.correct / r.total) * 100) : 0,
        })),
      });
    }

    // ─────────────── PERSONAL HIGHLIGHTS ───────────────
    // A student's own annotations on the questions of one sitting. They never
    // touch the question (or any vocabulary entry) and only their owner can
    // read or change them — a new sitting starts with none.
    //   GET    /api/test-highlights?attemptId=        → this sitting's highlights
    //   POST   /api/test-highlights                   → { attemptId, questionId, field, start, end, quote }
    //   DELETE /api/test-highlights/:id               → remove one
    //   DELETE /api/test-highlights?attemptId=&questionId=  → clear one question
    if (resource === "test-highlights") {
      const auth = await requireUser(req, ["student"]);
      if (auth.error) return auth.error;
      const me = auth.user!.id;
      const b = method === "POST" ? await req.json().catch(() => ({})) : {};
      const attemptId = Number(method === "POST" ? b.attemptId : url.searchParams.get("attemptId"));
      const ownAttempt = async (aid: number) => {
        if (!Number.isInteger(aid)) return null;
        const [a] = await db.select().from(testAttempts).where(eq(testAttempts.id, aid)).limit(1);
        return a && a.studentId === me ? a : null;
      };
      if (method === "DELETE" && id) {
        const hid = Number(id);
        const [h] = await db.select().from(testHighlights).where(eq(testHighlights.id, hid)).limit(1);
        if (!h || h.studentId !== me) return json({ error: "Highlight not found." }, 404);
        await db.delete(testHighlights).where(eq(testHighlights.id, hid));
        return json({ deleted: hid });
      }
      const attempt = await ownAttempt(attemptId);
      if (!attempt) return json({ error: "Test session not found." }, 404);
      if (method === "GET") {
        const rows = await db.select().from(testHighlights)
          .where(and(eq(testHighlights.attemptId, attempt.id), eq(testHighlights.studentId, me)))
          .orderBy(testHighlights.questionId, testHighlights.field, testHighlights.startOffset);
        return json(rows);
      }
      if (method === "DELETE") {
        const questionId = Number(url.searchParams.get("questionId"));
        if (!Number.isInteger(questionId)) return json({ error: "Pass a questionId." }, 400);
        await db.delete(testHighlights).where(and(
          eq(testHighlights.attemptId, attempt.id), eq(testHighlights.studentId, me), eq(testHighlights.questionId, questionId)));
        return json({ cleared: questionId });
      }
      if (method !== "POST") return json({ error: "Method not allowed." }, 405);
      if (attempt.submittedAt) return json({ error: "This test has already been submitted." }, 409);
      const questionId = Number(b.questionId);
      const field = String(b.field || "");
      if (!/^(passage|prompt|choice:[A-D])$/.test(field)) return json({ error: "Highlights can go on the passage, the question or a text answer choice." }, 400);
      let start = Math.round(Number(b.start)), end = Math.round(Number(b.end));
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start || end > 200_000)
        return json({ error: "Select some text to highlight." }, 400);
      let inPlan = false;
      for (const m of await planModules(attempt)) {
        if ((await loadModuleQuestions(m.id)).some((q) => q.id === questionId)) { inPlan = true; break; }
      }
      if (!inPlan) return json({ error: "That question is not part of this sitting." }, 400);
      // Overlapping or touching highlights on the same field merge into one.
      const same = await db.select().from(testHighlights).where(and(
        eq(testHighlights.attemptId, attempt.id), eq(testHighlights.studentId, me),
        eq(testHighlights.questionId, questionId), eq(testHighlights.field, field)));
      const merged = same.filter((h) => h.startOffset <= end && h.endOffset >= start);
      let quote = String(b.quote ?? "").slice(0, 4000);
      if (merged.length) {
        start = Math.min(start, ...merged.map((h) => h.startOffset));
        end = Math.max(end, ...merged.map((h) => h.endOffset));
        quote = String(b.mergedQuote ?? quote).slice(0, 4000);
        await db.delete(testHighlights).where(inArray(testHighlights.id, merged.map((h) => h.id)));
      }
      const [row] = await db.insert(testHighlights).values({
        studentId: me, attemptId: attempt.id, questionId, field, startOffset: start, endOffset: end, quote,
      }).returning();
      return json({ highlight: row, replaced: merged.map((h) => h.id) }, 201);
    }

    // ─────────────── TEST SESSIONS (pause / resume / autosave) ───────────────
    // A test session is a test attempt seen as a resumable snapshot. The id is
    // the attempt id, so /api/test-session/:id and /api/test-attempts/:id agree.
    if (resource === "test-session") {
      const auth = await requireUser(req, ["student", "mentor", "admin"]);
      if (auth.error) return auth.error;
      const role = auth.user!.role;

      // Open sittings for the signed-in student — feeds the dashboard's resume card.
      if (method === "GET" && !id) {
        if (role !== "student") return json([]);
        const rows = await db.select({ attempt: testAttempts, title: tests.title })
          .from(testAttempts).innerJoin(tests, eq(testAttempts.testId, tests.id))
          .where(and(eq(testAttempts.studentId, auth.user!.id), sql`${testAttempts.submittedAt} is null`))
          .orderBy(desc(testAttempts.startedAt));
        const open = [];
        for (const r of rows) {
          const settled = await settleExpiredAttempt(r.attempt);
          if (!settled.submittedAt) open.push({ ...sessionSnapshot(settled), testTitle: r.title });
        }
        return json(open);
      }

      const writeAction = method === "POST" && ["pause", "save", "resume"].includes(id || "");
      if (method === "POST" && !writeAction) return json({ error: "Unknown test session action." }, 404);
      if (writeAction && role !== "student") return json({ error: "Only students can sit a test." }, 403);
      const b = writeAction ? await req.json().catch(() => ({})) : {};
      const sessionId = Number(writeAction ? b.testSessionId : id);
      if (!Number.isInteger(sessionId)) return json({ error: "Pass a testSessionId." }, 400);

      const [found] = await db.select().from(testAttempts).where(eq(testAttempts.id, sessionId)).limit(1);
      if (!found) return json({ error: "Test session not found." }, 404);
      if (role === "student" && found.studentId !== auth.user!.id)
        return json({ error: "You do not have access to this test session." }, 403);
      if (role === "mentor" && !(await mentorCanAccessStudent(auth.user!.id, found.studentId)))
        return json({ error: "Student is not in one of your classes." }, 403);
      const attempt = await settleExpiredAttempt(found);

      if (method === "GET") {
        const detail = await loadTestDetail(attempt.testId, !!attempt.submittedAt || role !== "student", attempt);
        if (!detail) return json({ error: "Test not found." }, 404);
        return json({ session: sessionSnapshot(attempt), attempt, test: detail, report: await ensureScoreReport(attempt), serverNow: Date.now() });
      }

      if (attempt.submittedAt)
        return json({ error: "This test has already been submitted.", session: sessionSnapshot(attempt), attempt }, 409);
      const mods = await planModules(attempt);
      const now = new Date();
      const respond = (row: TestAttemptRow) => json({ session: sessionSnapshot(row), attempt: row, serverNow: Date.now() });

      if (id === "save") {
        const updates = await snapshotUpdates(attempt, mods, b);
        const [row] = await db.update(testAttempts).set({ ...updates, lastSavedAt: now })
          .where(eq(testAttempts.id, attempt.id)).returning();
        return respond(row);
      }

      if (id === "pause") {
        if (attempt.allowPause === false)
          return json({ error: "Pausing is turned off for this exam task.", session: sessionSnapshot(attempt), attempt }, 403);
        if (attempt.breakEndsAt && new Date(attempt.breakEndsAt).getTime() > now.getTime())
          return json({ error: "You're on the section break — there is nothing to pause yet.", session: sessionSnapshot(attempt), attempt }, 409);
        const updates = await snapshotUpdates(attempt, mods, b);
        if (attempt.status === "paused") {
          const [row] = await db.update(testAttempts).set({ ...updates, lastSavedAt: now })
            .where(eq(testAttempts.id, attempt.id)).returning();
          return respond(row);
        }
        // Untimed practice has no clock to hold: pausing only covers the screen.
        if (attempt.timed === false) {
          const [row] = await db.update(testAttempts).set({
            ...updates, status: "paused", remainingSeconds: null, pausedAt: now, expiresAt: null, lastSavedAt: now,
          }).where(eq(testAttempts.id, attempt.id)).returning();
          return respond(row);
        }
        const serverLeft = attempt.expiresAt
          ? Math.max(0, Math.ceil((new Date(attempt.expiresAt).getTime() - now.getTime()) / 1000)) : 0;
        const lastSeen = new Date(attempt.lastSavedAt || attempt.startedAt || now).getTime();
        const grace = Math.max(0, Math.min(OFFLINE_PAUSE_GRACE_SECONDS, Math.floor((now.getTime() - lastSeen) / 1000)));
        const clientLeft = Number(b.remainingTimeSeconds);
        const credited = Number.isFinite(clientLeft) && clientLeft >= 0
          ? Math.min(Math.round(clientLeft), serverLeft + grace) : serverLeft;
        if (credited <= 0) return json({ error: "Time is up on this module.", session: sessionSnapshot(attempt), attempt }, 409);
        const [row] = await db.update(testAttempts).set({
          ...updates,
          status: "paused",
          remainingSeconds: credited,
          pausedAt: now,
          expiresAt: null,
          lastSavedAt: now,
        }).where(eq(testAttempts.id, attempt.id)).returning();
        return respond(row);
      }

      // Resume: the held time becomes a fresh deadline from now. Idempotent, so
      // a double click or a retried request never costs the student time.
      if (attempt.status !== "paused") return respond(attempt);
      const [row] = await db.update(testAttempts).set({
        status: "active",
        expiresAt: attempt.timed === false ? null : new Date(now.getTime() + Math.max(0, attempt.remainingSeconds ?? 0) * 1000),
        remainingSeconds: null,
        pausedAt: null,
        lastSavedAt: now,
      }).where(eq(testAttempts.id, attempt.id)).returning();
      return respond(row);
    }


    return json({ error: "Not found" }, 404);
  } catch (err) {
    console.error("API error", err);
    return json({ error: (err as Error).message }, 500);
  }
};

export const config: Config = {
  path: "/api/*",
};
