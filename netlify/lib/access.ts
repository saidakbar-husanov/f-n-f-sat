// netlify/lib/access.ts — effective subject access for a student, computed on
// every request (so a change applies to the very next request, including in an
// open or resumed practice session), and the admin routes that edit it.
import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../../db/index.js";
import { accessRules, classEnrollments, classes, users } from "../../db/schema.js";
import {
  AREAS, SUBJECTS, FULL_ACCESS, normalizeRules, presetRules, isPreset, resolveAccess, sameRules, describePreset,
  allows, allowedSubjects, libraryAllowed, rulesKey, type Rules, type Resolution, type Area, type Preset, type ClassRule,
} from "./access-core.js";
import type { FullTestDeps } from "./fulltests.js";

type DbUser = typeof users.$inferSelect;
export { allows, allowedSubjects, libraryAllowed, FULL_ACCESS, type Rules, type Area };

// The platform's original administrator signs in with the studio passcode
// (provider "admin"); that verified account is the super admin. Any other
// account holding the admin role is an ordinary admin.
export function isSuperAdmin(u: Pick<DbUser, "role" | "provider" | "status"> | null | undefined) {
  return !!u && u.role === "admin" && u.provider === "admin" && u.status === "active";
}

export type Access = Resolution & { library: boolean; staff: boolean };
const STAFF_ACCESS = (): Access => ({ rules: normalizeRules({}), source: "default", classIds: [], conflict: null, library: true, staff: true });

async function loadInputs(studentId: number) {
  const enrolled = await db.select({ classId: classEnrollments.classId, name: classes.name }).from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active"), isNull(classes.deletedAt)));
  const classIds = [...new Set(enrolled.map((e) => e.classId))];
  const rows = await db.select().from(accessRules).where(or(
    and(inArray(accessRules.scope, ["user", "snapshot"]), eq(accessRules.targetId, studentId)),
    classIds.length ? and(eq(accessRules.scope, "class"), inArray(accessRules.targetId, classIds)) : undefined,
  ));
  const user = rows.find((r) => r.scope === "user");
  const snapshot = rows.find((r) => r.scope === "snapshot");
  const classRules: ClassRule[] = rows.filter((r) => r.scope === "class").map((r) => ({
    classId: r.targetId, name: enrolled.find((e) => e.classId === r.targetId)?.name,
    preset: isPreset(r.preset) ? r.preset : "custom", rules: normalizeRules(r.rules),
  }));
  return { user: user ? normalizeRules(user.rules) : null, classRules, snapshot: snapshot ? normalizeRules(snapshot.rules) : null };
}

// Keep the last conflict-free result, so a later conflict preserves it.
async function rememberSnapshot(studentId: number, res: Resolution, snapshot: Rules | null) {
  if (res.source === "conflict" || (snapshot && sameRules(snapshot, res.rules))) return;
  await db.insert(accessRules).values({ scope: "snapshot", targetId: studentId, preset: describePreset(res.rules), rules: res.rules })
    .onConflictDoUpdate({ target: [accessRules.scope, accessRules.targetId], set: { rules: res.rules, preset: describePreset(res.rules), updatedAt: new Date() } })
    .catch((e) => console.error("access snapshot failed", e));
}

export async function studentAccess(studentId: number): Promise<Access> {
  const { user, classRules, snapshot } = await loadInputs(studentId);
  const res = resolveAccess({ user, classes: classRules, snapshot });
  await rememberSnapshot(studentId, res, snapshot);
  return { ...res, library: libraryAllowed(res.rules), staff: false };
}

// One computation per request, however many handlers ask.
const perRequest = new WeakMap<Request, Promise<Access>>();
export function accessFor(req: Request, user: DbUser): Promise<Access> {
  if (user.role !== "student") return Promise.resolve(STAFF_ACCESS());
  let p = perRequest.get(req);
  if (!p) { p = studentAccess(user.id); perRequest.set(req, p); }
  return p;
}
export async function accessForUser(user: DbUser) {
  return user.role === "student" ? studentAccess(user.id) : STAFF_ACCESS();
}

// Snapshot the current access of these students before a class change, so a
// change that produces a conflict keeps what they had a moment ago.
export async function snapshotStudents(studentIds: number[]) {
  for (const id of [...new Set(studentIds)].slice(0, 2000)) await studentAccess(id).catch(() => null);
}

const publicRules = (r: Rules) => normalizeRules(r);
function readRules(raw: unknown): Rules | null {
  if (!raw || typeof raw !== "object") return null;
  return normalizeRules(raw);
}

// What a proposed change would mean for each affected student.
async function previewFor(studentIds: number[], change: { scope: "user" | "class"; targetId: number; rules: Rules | null }) {
  const people = studentIds.length ? await db.select({ id: users.id, displayName: users.displayName, username: users.username })
    .from(users).where(inArray(users.id, studentIds)) : [];
  const out = [];
  for (const p of people) {
    const inp = await loadInputs(p.id);
    const before = resolveAccess({ user: inp.user, classes: inp.classRules, snapshot: inp.snapshot });
    let user = inp.user, classRules = inp.classRules;
    if (change.scope === "user") user = change.rules;
    else {
      classRules = classRules.filter((c) => c.classId !== change.targetId);
      if (change.rules) classRules.push({ classId: change.targetId, preset: describePreset(change.rules), rules: change.rules });
    }
    // A change that produces a conflict keeps the access the student has right now.
    const after = resolveAccess({ user, classes: classRules, snapshot: before.source === "conflict" ? inp.snapshot : before.rules });
    out.push({ id: p.id, displayName: p.displayName, username: p.username, before, after, changed: !sameRules(before.rules, after.rules) || before.source !== after.source });
  }
  return out;
}

export async function handleAccess(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  const { json, requireUser } = deps;
  const [resource, id, sub, sub2] = parts;
  const method = req.method;

  // A student's own effective access (drives which sections the interface shows).
  if (resource === "access" && !id && method === "GET") {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const a = await accessFor(req, auth.user!);
    return json({ rules: publicRules(a.rules), source: a.source, library: a.library, conflict: a.conflict, subjects: { bank: allowedSubjects(a.rules, "bank"), challenge: allowedSubjects(a.rules, "challenge"), lessons: allowedSubjects(a.rules, "lessons"), rush: allowedSubjects(a.rules, "rush") } });
  }

  if (resource !== "admin" || id !== "access") return null;
  const auth = await requireUser(req, ["admin"]);
  if (auth.error) return auth.error;
  const admin = auth.user!;
  const { audit, notify } = await import("./platform.js");
  const int = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };

  // Overview: every class preset, every individual override, open conflicts.
  if (method === "GET" && !sub) {
    const [rows, cls] = await Promise.all([
      db.select().from(accessRules).where(inArray(accessRules.scope, ["user", "class"])),
      db.select({ id: classes.id, name: classes.name }).from(classes).where(isNull(classes.deletedAt)),
    ]);
    const userIds = rows.filter((r) => r.scope === "user").map((r) => r.targetId);
    const people = userIds.length ? await db.select({ id: users.id, displayName: users.displayName, username: users.username }).from(users).where(inArray(users.id, userIds)) : [];
    // Students with more than one class setting that disagree, and no override.
    const classRows = rows.filter((r) => r.scope === "class");
    const enroll = classRows.length ? await db.select({ classId: classEnrollments.classId, studentId: classEnrollments.studentId }).from(classEnrollments)
      .where(and(eq(classEnrollments.status, "active"), inArray(classEnrollments.classId, classRows.map((r) => r.targetId)))) : [];
    const byStudent = new Map<number, number[]>();
    for (const e of enroll) byStudent.set(e.studentId, [...(byStudent.get(e.studentId) || []), e.classId]);
    const conflictIds = [...byStudent.entries()].filter(([sid, cids]) => !userIds.includes(sid) && cids.length > 1
      && new Set(cids.map((c) => rulesKey(normalizeRules(classRows.find((r) => r.targetId === c)!.rules)))).size > 1).map(([sid]) => sid);
    const conflicts = [];
    for (const sid of conflictIds.slice(0, 200)) {
      const a = await studentAccess(sid);
      if (a.source !== "conflict") continue;
      const [u] = await db.select({ id: users.id, displayName: users.displayName, username: users.username }).from(users).where(eq(users.id, sid));
      conflicts.push({ ...u, kept: publicRules(a.rules), classes: a.conflict?.classes ?? [] });
    }
    return json({
      subjects: SUBJECTS, areas: AREAS,
      classes: cls.map((c) => { const r = classRows.find((x) => x.targetId === c.id); return { ...c, preset: r ? r.preset : null, rules: r ? publicRules(normalizeRules(r.rules)) : null }; }),
      users: rows.filter((r) => r.scope === "user").map((r) => ({ id: r.targetId, displayName: people.find((p) => p.id === r.targetId)?.displayName ?? `User #${r.targetId}`, username: people.find((p) => p.id === r.targetId)?.username ?? null, rules: publicRules(normalizeRules(r.rules)) })),
      conflicts,
    });
  }

  // Every student's effective access and where it comes from, computed in one
  // pass (read-only: no snapshots are written here).
  if (method === "GET" && sub === "students") {
    const people = await db.select({ id: users.id, displayName: users.displayName, username: users.username, status: users.status })
      .from(users).where(and(eq(users.role, "student"), inArray(users.status, ["active", "banned", "deactivated"])));
    const [rules, enrolled] = await Promise.all([
      db.select().from(accessRules),
      db.select({ classId: classEnrollments.classId, studentId: classEnrollments.studentId, name: classes.name }).from(classEnrollments)
        .innerJoin(classes, eq(classEnrollments.classId, classes.id))
        .where(and(eq(classEnrollments.status, "active"), isNull(classes.deletedAt))),
    ]);
    const byKey = new Map(rules.map((r) => [`${r.scope}:${r.targetId}`, r]));
    const classesOf = new Map<number, { classId: number; name: string }[]>();
    for (const e of enrolled) classesOf.set(e.studentId, [...(classesOf.get(e.studentId) || []), { classId: e.classId, name: e.name }]);
    const out = people.map((p) => {
      const mine = classesOf.get(p.id) || [];
      const user = byKey.get(`user:${p.id}`), snap = byKey.get(`snapshot:${p.id}`);
      const classRules: ClassRule[] = mine.map((c) => ({ c, r: byKey.get(`class:${c.classId}`) })).filter((x) => x.r)
        .map(({ c, r }) => ({ classId: c.classId, name: c.name, preset: isPreset(r!.preset) ? r!.preset : "custom", rules: normalizeRules(r!.rules) }));
      const res = resolveAccess({ user: user ? normalizeRules(user.rules) : null, classes: classRules, snapshot: snap ? normalizeRules(snap.rules) : null });
      return { id: p.id, displayName: p.displayName, username: p.username, status: p.status, classes: mine.map((c) => c.name),
        rules: publicRules(res.rules), source: res.source, conflict: res.conflict, hasOverride: !!user };
    });
    out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    return json({ students: out });
  }

  // One student: override, class settings and the effective result with its source.
  if (method === "GET" && sub === "user" && int(sub2)) {
    const target = int(sub2)!;
    const [u] = await db.select().from(users).where(eq(users.id, target)).limit(1);
    if (!u) return json({ error: "User not found." }, 404);
    const inp = await loadInputs(target);
    const eff = await studentAccess(target);
    return json({ user: { id: u.id, displayName: u.displayName, username: u.username, role: u.role }, override: inp.user, classes: inp.classRules, effective: { ...eff, rules: publicRules(eff.rules) } });
  }

  // Dry run: what saving would change, per student, with the source of each result.
  if (method === "POST" && sub === "preview") {
    const b = await req.json().catch(() => ({}));
    const scope = b.scope === "class" ? "class" : "user";
    const target = int(b.targetId);
    if (!target) return json({ error: "Choose a student or class." }, 400);
    const rules = b.clear ? null : scope === "class" && isPreset(b.preset) && b.preset !== "custom" ? presetRules(b.preset) : readRules(b.rules);
    if (!b.clear && !rules) return json({ error: "Choose the access settings to preview." }, 400);
    const ids = scope === "user" ? [target] : (await db.select({ id: classEnrollments.studentId }).from(classEnrollments)
      .where(and(eq(classEnrollments.classId, target), eq(classEnrollments.status, "active")))).map((r) => r.id);
    return json({ students: await previewFor(ids, { scope, targetId: target, rules }) });
  }

  if ((method === "PUT" || method === "DELETE") && (sub === "user" || sub === "class") && int(sub2)) {
    const target = int(sub2)!;
    const b = method === "PUT" ? await req.json().catch(() => ({})) : {};
    let members: number[] = [];
    if (sub === "user") {
      const [u] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, target)).limit(1);
      if (!u) return json({ error: "User not found." }, 404);
      if (u.role !== "student") return json({ error: "Subject access applies to student accounts." }, 400);
      members = [target];
    } else {
      const [c] = await db.select({ id: classes.id }).from(classes).where(and(eq(classes.id, target), isNull(classes.deletedAt))).limit(1);
      if (!c) return json({ error: "Class not found." }, 404);
      members = (await db.select({ id: classEnrollments.studentId }).from(classEnrollments).where(and(eq(classEnrollments.classId, target), eq(classEnrollments.status, "active")))).map((r) => r.id);
    }
    // Before the write: remember every affected student's current access.
    await snapshotStudents(members);
    if (method === "DELETE") {
      await db.delete(accessRules).where(and(eq(accessRules.scope, sub), eq(accessRules.targetId, target)));
      await audit(admin.id, `access.${sub}.remove`, sub, target);
      await snapshotStudents(members);
      return json({ ok: true, removed: true });
    }
    const preset: Preset = isPreset((b as any).preset) ? (b as any).preset : "custom";
    const rules = sub === "class" && preset !== "custom" ? presetRules(preset) : readRules((b as any).rules);
    if (!rules) return json({ error: "Send the access settings to save." }, 400);
    const stored = sub === "class" ? preset : describePreset(rules);
    await db.insert(accessRules).values({ scope: sub, targetId: target, preset: stored, rules, updatedBy: admin.id })
      .onConflictDoUpdate({ target: [accessRules.scope, accessRules.targetId], set: { rules, preset: stored, updatedBy: admin.id, updatedAt: new Date() } });
    await audit(admin.id, `access.${sub}.set`, sub, target, { preset: stored, rules });
    await snapshotStudents(members);
    if (sub === "user") await notify([target], { kind: "account", title: "Your subject access was updated", link: { view: "home" } });
    return json({ ok: true, preset: stored, rules });
  }
  return json({ error: "Method not allowed." }, 405);
}
