// netlify/lib/platform.ts — administration, usage limits, notifications, question
// reports, mentor ↔ student messages, exam integrity, leaderboards, badges and
// performance reports. Mounted by the main /api function; every route checks
// the caller's role (and, for mentors, class membership) on the server.
import { and, desc, eq, inArray, or, sql, isNull, gte } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  users, sessions, settings, classes, classEnrollments, questions, attempts, tests, testAttempts,
  auditLog, notifications, questionReports, messages, examIntegrityEvents, badgeAwards,
  studentDailyActivity, usageLimits, moduleCompletions, studentWordMastery,
} from "../../db/schema.js";
import { hashPassword, verifyPassword, temporaryPassword, passwordProblem } from "./passwords.js";
import { ensureScoreReport, planModules, loadModuleQuestions, isAnswerCorrect, type FullTestDeps } from "./fulltests.js";
import { buildBoard, boardCsv, rankRows, type ScoreRow } from "./leaderboard-core.js";
import { isSuperAdmin, snapshotStudents } from "./access.js";

type DbUser = typeof users.$inferSelect;
type Json = FullTestDeps["json"];
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const int = (v: unknown) => { if (v === null || v === undefined || v === "") return null; const n = Number(v); return Number.isInteger(n) ? n : null; };
const str = (v: unknown, max = 400) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
const nameOf = (u: Pick<DbUser, "displayName"> | undefined | null) => u?.displayName || "Student";

// ─────────────── SETTINGS ───────────────
async function readSetting<T extends object>(key: string, defaults: T): Promise<T> {
  const [row] = await db.select().from(settings).where(eq(settings.key, key));
  return { ...defaults, ...((row?.value as object) ?? {}) } as T;
}
async function writeSetting(key: string, value: unknown) {
  await db.insert(settings).values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

// Platform timezone: every "day" (limits, streaks, leaderboards) is a calendar
// day here. Defaults to UTC — the clock the platform has always used.
const DEFAULT_PLATFORM = { timezone: "UTC" };
let tzCache: { at: number; tz: string } | null = null;
export async function platformTz() {
  if (tzCache && Date.now() - tzCache.at < 60_000) return tzCache.tz;
  const s = await readSetting("platform", DEFAULT_PLATFORM);
  const tz = validTz(s.timezone) ? s.timezone : "UTC";
  tzCache = { at: Date.now(), tz };
  return tz;
}
function validTz(tz: unknown) {
  if (typeof tz !== "string" || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}
// Calendar boundaries in the platform timezone. `*At` values are UTC instants;
// `*Ts` values are UTC wall-clock strings comparable with the stored timestamps.
async function bounds() {
  const tz = await platformTz();
  const [r] = rowsOf(await db.execute(sql`select
    (now() at time zone ${tz})::date::text as today,
    ((now() at time zone ${tz})::date - 1)::text as yesterday,
    date_trunc('week', now() at time zone ${tz})::date::text as week_start,
    date_trunc('month', now() at time zone ${tz})::date::text as month_start,
    (date_trunc('day', now() at time zone ${tz}) at time zone ${tz}) as day_at,
    (date_trunc('week', now() at time zone ${tz}) at time zone ${tz}) as week_at,
    (date_trunc('month', now() at time zone ${tz}) at time zone ${tz}) as month_at,
    ((date_trunc('day', now() at time zone ${tz}) + interval '1 day') at time zone ${tz}) as next_day_at,
    ((date_trunc('week', now() at time zone ${tz}) + interval '1 week') at time zone ${tz}) as next_week_at`));
  const iso = (v: any) => new Date(v).toISOString();
  return {
    tz, today: r.today as string, yesterday: r.yesterday as string, weekStart: r.week_start as string, monthStart: r.month_start as string,
    dayAt: iso(r.day_at), weekAt: iso(r.week_at), monthAt: iso(r.month_at), nextDayAt: iso(r.next_day_at), nextWeekAt: iso(r.next_week_at),
  };
}
// A UTC instant → the naive UTC timestamp the tables store.
const tsLit = (isoString: string) => isoString.replace("T", " ").replace("Z", "");

// ─────────────── AUDIT & NOTIFICATIONS ───────────────
export async function audit(actorId: number | null, action: string, targetType: string, targetId: unknown, details: Record<string, unknown> = {}) {
  try {
    await db.insert(auditLog).values({ actorId, action, targetType, targetId: String(targetId ?? ""), details });
  } catch (e) { console.error("audit write failed", e); }
}
export async function notify(userIds: number[], n: { kind: string; title: string; body?: string; link?: Record<string, unknown> | null }) {
  const ids = [...new Set(userIds.filter((v) => Number.isInteger(v)))];
  if (!ids.length) return;
  try {
    await db.insert(notifications).values(ids.map((userId) => ({
      userId, kind: n.kind, title: n.title.slice(0, 200), body: (n.body || "").slice(0, 600), link: n.link ?? null,
    })));
  } catch (e) { console.error("notification write failed", e); }
}
async function adminIds() {
  return (await db.select({ id: users.id }).from(users).where(and(eq(users.role, "admin"), eq(users.status, "active")))).map((r) => r.id);
}
async function mentorsOf(studentId: number) {
  const rows = await db.select({ mentorId: classes.mentorId }).from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  return [...new Set(rows.map((r) => r.mentorId))];
}
export async function mentorCanAccess(mentorId: number, studentId: number) {
  const [row] = await db.select({ id: classEnrollments.id }).from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classes.mentorId, mentorId), eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")))
    .limit(1);
  return !!row;
}
async function mentorStudentIds(mentorId: number) {
  const rows = await db.select({ studentId: classEnrollments.studentId }).from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classes.mentorId, mentorId), eq(classEnrollments.status, "active")));
  return [...new Set(rows.map((r) => r.studentId))];
}
async function activeClassIds(studentId: number) {
  return (await db.select({ classId: classEnrollments.classId }).from(classEnrollments)
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")))).map((r) => r.classId);
}

// ─────────────── DAILY ACTIVITY & USAGE LIMITS ───────────────
type Counter = "practiceAnswered" | "bankUsed" | "challengeUsed" | "mockStarts" | "modulesCompleted" | "vocabQuizzes";
const COLUMN: Record<Counter, string> = {
  practiceAnswered: "practice_answered", bankUsed: "bank_used", challengeUsed: "challenge_used",
  mockStarts: "mock_starts", modulesCompleted: "modules_completed", vocabQuizzes: "vocab_quizzes",
};
async function bump(exec: typeof db, studentId: number, day: string, add: Partial<Record<Counter, number>>) {
  const entries = Object.entries(add).filter(([, v]) => v) as [Counter, number][];
  if (!entries.length) return;
  const cols = sql.raw(entries.map(([k]) => `"${COLUMN[k]}"`).join(", "));
  const vals = sql.join(entries.map(([, v]) => sql`${v}`), sql`, `);
  const sets = sql.raw(entries.map(([k]) => `"${COLUMN[k]}" = "student_daily_activity"."${COLUMN[k]}" + excluded."${COLUMN[k]}"`).join(", "));
  await exec.execute(sql`insert into "student_daily_activity" ("student_id", "day", ${cols}) values (${studentId}, ${day}::date, ${vals})
    on conflict ("student_id", "day") do update set ${sets}, "updated_at" = now()`);
}

export const LIMIT_KINDS = ["bankDaily", "challengeDaily", "mockDaily", "mockWeekly", "vocabDaily"] as const;
type LimitKind = (typeof LIMIT_KINDS)[number];
type LimitMap = Partial<Record<LimitKind, number>>; // n ≥ 0 cap, -1 unlimited
// Independent students keep the original 20-a-day practice allowance; class
// members keep unlimited practice. Admins change both tiers from Limits.
const DEFAULT_LIMITS: { independent: Record<LimitKind, number>; member: Record<LimitKind, number> } = {
  independent: { bankDaily: 20, challengeDaily: 20, mockDaily: -1, mockWeekly: -1, vocabDaily: -1 },
  member: { bankDaily: -1, challengeDaily: -1, mockDaily: -1, mockWeekly: -1, vocabDaily: -1 },
};
function cleanLimits(raw: unknown): LimitMap {
  const out: LimitMap = {};
  if (!raw || typeof raw !== "object") return out;
  for (const k of LIMIT_KINDS) {
    const v = (raw as any)[k];
    if (v === null || v === undefined || v === "") continue;
    if (v === "unlimited" || Number(v) === -1) { out[k] = -1; continue; }
    const n = Math.round(Number(v));
    if (Number.isFinite(n) && n >= 0 && n <= 100000) out[k] = n;
  }
  return out;
}
async function platformLimits() {
  const s = await readSetting("limits", DEFAULT_LIMITS);
  return {
    independent: { ...DEFAULT_LIMITS.independent, ...cleanLimits(s.independent) } as Record<LimitKind, number>,
    member: { ...DEFAULT_LIMITS.member, ...cleanLimits(s.member) } as Record<LimitKind, number>,
  };
}
// User override > class limit > platform default. With several classes the
// most generous class limit applies.
export async function effectiveLimits(studentId: number) {
  const classIds = await activeClassIds(studentId);
  const [platform, overrides] = await Promise.all([
    platformLimits(),
    db.select().from(usageLimits).where(or(
      and(eq(usageLimits.scope, "user"), eq(usageLimits.targetId, studentId)),
      classIds.length ? and(eq(usageLimits.scope, "class"), inArray(usageLimits.targetId, classIds)) : sql`false`,
    )),
  ]);
  const user = overrides.find((o) => o.scope === "user");
  const classRows = overrides.filter((o) => o.scope === "class");
  const base = classIds.length ? platform.member : platform.independent;
  const out = {} as Record<LimitKind, { limit: number | null; source: "user" | "class" | "platform" }>;
  for (const k of LIMIT_KINDS) {
    const u = cleanLimits(user?.limits)[k];
    const cls = classRows.map((r) => cleanLimits(r.limits)[k]).filter((v): v is number => v !== undefined);
    const clsVal = cls.length ? (cls.includes(-1) ? -1 : Math.max(...cls)) : undefined;
    const v = u ?? clsVal ?? base[k];
    out[k] = { limit: v === -1 ? null : v, source: u !== undefined ? "user" : clsVal !== undefined ? "class" : "platform" };
  }
  return { limits: out, enrolled: classIds.length > 0 };
}
async function usedCounts(exec: typeof db, studentId: number, b: Awaited<ReturnType<typeof bounds>>) {
  const [r] = rowsOf(await exec.execute(sql`select
    coalesce(sum(bank_used) filter (where day = ${b.today}::date), 0)::int as bank,
    coalesce(sum(challenge_used) filter (where day = ${b.today}::date), 0)::int as challenge,
    coalesce(sum(mock_starts) filter (where day = ${b.today}::date), 0)::int as mock_day,
    coalesce(sum(mock_starts), 0)::int as mock_week,
    coalesce(sum(vocab_quizzes) filter (where day = ${b.today}::date), 0)::int as vocab,
    coalesce(sum(practice_answered) filter (where day = ${b.today}::date), 0)::int as practice
    from student_daily_activity where student_id = ${studentId} and day >= ${b.weekStart}::date`));
  return { bankDaily: r?.bank ?? 0, challengeDaily: r?.challenge ?? 0, mockDaily: r?.mock_day ?? 0, mockWeekly: r?.mock_week ?? 0, vocabDaily: r?.vocab ?? 0, practiceToday: r?.practice ?? 0 };
}
export async function usageSummary(studentId: number) {
  const b = await bounds();
  const [{ limits, enrolled }, used] = await Promise.all([effectiveLimits(studentId), usedCounts(db, studentId, b)]);
  const kinds = Object.fromEntries(LIMIT_KINDS.map((k) => {
    const l = limits[k].limit;
    return [k, { used: used[k], limit: l, remaining: l === null ? null : Math.max(0, l - used[k]), source: limits[k].source, resetsAt: k === "mockWeekly" ? b.nextWeekAt : b.nextDayAt }];
  }));
  const bank = (kinds as any).bankDaily;
  // `enrolled` / `used` / `limit` / `remaining` keep the original response shape (bank practice).
  return { enrolled: bank.limit === null, inClass: enrolled, used: bank.used, limit: bank.limit, remaining: bank.remaining, limits: kinds, timezone: b.tz, resetsAt: b.nextDayAt, weekResetsAt: b.nextWeekAt, practiceToday: used.practiceToday };
}

const USAGE_MESSAGES: Record<LimitKind, string> = {
  bankDaily: "Daily Question Bank limit reached.", challengeDaily: "Daily Challenging Questions limit reached.",
  mockDaily: "Daily mock-test limit reached.", mockWeekly: "Weekly mock-test limit reached.", vocabDaily: "Daily vocabulary quiz limit reached.",
};
// Check and count one unit of usage atomically. Daily caps use one conditional
// upsert (the row only increments while under the cap), so two tabs can never
// both spend the last unit; mock starts also check the weekly cap under a
// per-student advisory lock.
export async function consumeUsage(studentId: number, kind: "bank" | "challenge" | "task" | "mock" | "vocab" | "module") {
  const b = await bounds();
  const add: Partial<Record<Counter, number>> =
    kind === "bank" ? { bankUsed: 1, practiceAnswered: 1 } : kind === "challenge" ? { challengeUsed: 1, practiceAnswered: 1 }
    : kind === "task" ? { practiceAnswered: 1 } : kind === "mock" ? { mockStarts: 1 } : kind === "vocab" ? { vocabQuizzes: 1 } : { modulesCompleted: 1 };
  if (kind === "task" || kind === "module") { await bump(db, studentId, b.today, add); return { ok: true as const }; }
  const { limits } = await effectiveLimits(studentId);
  const refuse = (k: LimitKind, l: number, used: number) => ({
    ok: false as const, kind: k, error: `${USAGE_MESSAGES[k]} It resets ${k === "mockWeekly" ? "next week" : "tomorrow"}.`,
    limit: l, used, resetsAt: k === "mockWeekly" ? b.nextWeekAt : b.nextDayAt,
  });
  if (kind === "mock") {
    return db.transaction(async (tx) => {
      const exec = tx as unknown as typeof db;
      await exec.execute(sql`select pg_advisory_xact_lock(hashtext(${"usage:" + studentId}))`);
      const used = await usedCounts(exec, studentId, b);
      for (const k of ["mockDaily", "mockWeekly"] as const) {
        const l = limits[k].limit;
        if (l !== null && used[k] >= l) return refuse(k, l, used[k]);
      }
      await bump(exec, studentId, b.today, add);
      return { ok: true as const };
    });
  }
  const k: LimitKind = kind === "bank" ? "bankDaily" : kind === "challenge" ? "challengeDaily" : "vocabDaily";
  const l = limits[k].limit;
  if (l === null) { await bump(db, studentId, b.today, add); return { ok: true as const }; }
  if (l <= 0) return refuse(k, l, 0);
  const col = COLUMN[k === "bankDaily" ? "bankUsed" : k === "challengeDaily" ? "challengeUsed" : "vocabQuizzes"];
  const entries = Object.entries(add) as [Counter, number][];
  const cols = sql.raw(entries.map(([c]) => `"${COLUMN[c]}"`).join(", "));
  const vals = sql.join(entries.map(([, v]) => sql`${v}`), sql`, `);
  const sets = sql.raw(entries.map(([c]) => `"${COLUMN[c]}" = "student_daily_activity"."${COLUMN[c]}" + excluded."${COLUMN[c]}"`).join(", "));
  const r = rowsOf(await db.execute(sql`insert into "student_daily_activity" ("student_id", "day", ${cols}) values (${studentId}, ${b.today}::date, ${vals})
    on conflict ("student_id", "day") do update set ${sets}, "updated_at" = now()
    where "student_daily_activity".${sql.raw(`"${col}"`)} < ${l} returning "id"`));
  if (!r.length) return refuse(k, l, l);
  return { ok: true as const };
}
// Vocabulary answers are only accepted on a day the student has a counted quiz
// (or an unlimited allowance), so the daily quiz limit cannot be bypassed.
export async function vocabAllowed(studentId: number) {
  const s = await usageSummary(studentId);
  const v = (s.limits as any).vocabDaily;
  return v.limit === null || v.used > 0;
}
export async function recordModuleCompletion(attemptId: number, studentId: number, moduleIndex: number) {
  const inserted = await db.insert(moduleCompletions).values({ attemptId, studentId, moduleIndex })
    .onConflictDoNothing().returning({ id: moduleCompletions.id });
  if (inserted.length) await consumeUsage(studentId, "module");
}

// ─────────────── PASSWORDS ───────────────
async function resetPassword(admin: DbUser, targetId: number, json: Json) {
  const [target] = await db.select().from(users).where(eq(users.id, targetId)).limit(1);
  if (!target) return json({ error: "User not found." }, 404);
  if (target.id === admin.id) return json({ error: "Change your own password from Settings instead." }, 400);
  if (target.role === "admin") return json({ error: "Administrator accounts cannot be reset here." }, 403);
  const loginHint = target.username || target.email || target.phone;
  if (!loginHint) return json({ error: "This account has no username, email or phone to sign in with, so a password cannot be used." }, 400);
  const temp = temporaryPassword();
  await db.update(users).set({ passwordHash: hashPassword(temp), mustChangePassword: true, passwordChangedAt: new Date() }).where(eq(users.id, target.id));
  // Every existing sign-in of this user ends now.
  await db.delete(sessions).where(eq(sessions.userId, target.id));
  await audit(admin.id, "password.reset", "user", target.id, { targetName: target.displayName, sessionsRevoked: true });
  return json({ temporaryPassword: temp, loginHint, displayName: target.displayName, mustChangePassword: true });
}
async function changeOwnPassword(req: Request, user: DbUser, json: Json) {
  const b = await req.json().catch(() => ({}));
  const current = String(b.currentPassword ?? "");
  const next = String(b.newPassword ?? "");
  if (user.passwordHash && !verifyPassword(current, user.passwordHash)) return json({ error: "Your current password is incorrect." }, 400);
  const problem = passwordProblem(next);
  if (problem) return json({ error: problem }, 400);
  if (user.passwordHash && verifyPassword(next, user.passwordHash)) return json({ error: "Choose a password different from the current one." }, 400);
  if (!user.username && !user.email && !user.phone) return json({ error: "This account signs in without a password." }, 400);
  await db.update(users).set({ passwordHash: hashPassword(next), mustChangePassword: false, passwordChangedAt: new Date() }).where(eq(users.id, user.id));
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  // Other devices are signed out; this one stays signed in.
  await db.delete(sessions).where(token ? and(eq(sessions.userId, user.id), sql`${sessions.token} <> ${token}`) : eq(sessions.userId, user.id));
  await audit(user.id, user.mustChangePassword ? "password.changed_after_reset" : "password.changed", "user", user.id);
  const [fresh] = await db.select().from(users).where(eq(users.id, user.id));
  return json({ ok: true, mustChangePassword: false, user: { id: fresh.id, mustChangePassword: false } });
}

// ─────────────── EXAM SETTINGS & INTEGRITY ───────────────
export const DEFAULT_EXAM = {
  examModeFullLength: true,     // full-length timed sittings run in Exam Mode
  allowPracticeMode: true,      // students may choose Practice Mode for self-started full tests
  requireFullscreen: true,
  allowWithoutFullscreen: true, // if the browser refuses full screen: continue (and log) vs. block
  monitoring: true,
  warnAt: 1, strongWarnAt: 2, reviewAt: 3,
  dedupeSeconds: 5,
};
export async function examSettings() {
  const s = await readSetting("exam", DEFAULT_EXAM);
  const n = (v: unknown, d: number, lo = 1, hi = 50) => Math.max(lo, Math.min(hi, Math.round(Number(v)) || d));
  const warnAt = n(s.warnAt, 1), strongWarnAt = Math.max(warnAt, n(s.strongWarnAt, 2)), reviewAt = Math.max(strongWarnAt, n(s.reviewAt, 3));
  return {
    examModeFullLength: s.examModeFullLength !== false, allowPracticeMode: s.allowPracticeMode !== false,
    requireFullscreen: s.requireFullscreen !== false, allowWithoutFullscreen: s.allowWithoutFullscreen !== false,
    monitoring: s.monitoring !== false, warnAt, strongWarnAt, reviewAt, dedupeSeconds: n(s.dedupeSeconds, 5, 1, 60),
  };
}
const COUNTED = new Set(["fullscreen_exit", "tab_hidden", "window_blur"]);
const EVENT_TYPES = new Set([...COUNTED, "navigation", "copy", "paste", "fullscreen_unavailable", "fullscreen_enter"]);
type AttemptRow = typeof testAttempts.$inferSelect;
function integrityLevel(count: number, s: Awaited<ReturnType<typeof examSettings>>) {
  return count >= s.reviewAt ? "review" : count >= s.strongWarnAt ? "strong" : count >= s.warnAt ? "warning" : "none";
}
async function recordIntegrityEvents(attempt: AttemptRow, raw: unknown[]) {
  const s = await examSettings();
  const now = Date.now();
  const started = new Date(attempt.startedAt ?? now).getTime();
  const existing = await db.select().from(examIntegrityEvents).where(eq(examIntegrityEvents.attemptId, attempt.id)).orderBy(examIntegrityEvents.occurredAt);
  const perType = new Map<string, number>();
  for (const e of existing) perType.set(e.type, Math.max(perType.get(e.type) ?? 0, e.occurrence));
  let lastCounted = existing.filter((e) => e.counted).reduce((m, e) => Math.max(m, new Date(e.occurredAt).getTime()), 0);
  let violations = attempt.violationCount;
  const rows: (typeof examIntegrityEvents.$inferInsert)[] = [];
  const list = raw.slice(0, 20).map((e: any) => ({
    type: str(e?.type, 40),
    at: Math.max(started, Math.min(now, Number(e?.at) || now)),
    durationMs: Number.isFinite(Number(e?.durationMs)) ? Math.max(0, Math.min(6 * 3600_000, Math.round(Number(e.durationMs)))) : null,
  })).filter((e) => EVENT_TYPES.has(e.type)).sort((a, b) => a.at - b.at);
  for (const e of list) {
    // One action (e.g. alt-tab) fires blur + visibility + full-screen exit
    // together; within the de-duplication window it counts once.
    const counted = COUNTED.has(e.type) && e.at - lastCounted > s.dedupeSeconds * 1000;
    if (counted) { violations += 1; lastCounted = e.at; }
    const occurrence = (perType.get(e.type) ?? 0) + 1;
    perType.set(e.type, occurrence);
    rows.push({ attemptId: attempt.id, studentId: attempt.studentId, type: e.type, occurredAt: new Date(e.at), durationMs: e.durationMs, occurrence, counted, moduleIndex: attempt.moduleIndex });
  }
  if (rows.length) await db.insert(examIntegrityEvents).values(rows);
  const level = integrityLevel(violations, s);
  const before = attempt.integrityStatus;
  let status = before;
  if (violations > attempt.violationCount) {
    status = level === "review" ? "review_required" : level === "none" ? before : before === "review_required" ? before : "warning";
  }
  const warningCount = Math.min(violations, Math.max(0, s.reviewAt - 1));
  await db.update(testAttempts).set({ violationCount: violations, warningCount, integrityStatus: status }).where(eq(testAttempts.id, attempt.id));
  if (status === "review_required" && before !== "review_required") {
    const [student] = await db.select().from(users).where(eq(users.id, attempt.studentId));
    const [test] = await db.select({ title: tests.title }).from(tests).where(eq(tests.id, attempt.testId));
    await notify([...(await adminIds()), ...(await mentorsOf(attempt.studentId))], {
      kind: "integrity", title: "Exam integrity review required",
      body: `${nameOf(student)} · ${test?.title ?? "Mock test"} · ${violations} recorded violations`,
      link: { view: "integrity", attemptId: attempt.id },
    });
  }
  return { violationCount: violations, level, status, newViolation: violations > attempt.violationCount, thresholds: { warnAt: s.warnAt, strongWarnAt: s.strongWarnAt, reviewAt: s.reviewAt } };
}
async function canSeeStudent(user: DbUser, studentId: number) {
  if (user.role === "admin") return true;
  if (user.role === "mentor") return mentorCanAccess(user.id, studentId);
  return user.id === studentId;
}

// ─────────────── LEADERBOARDS ───────────────
// Eligible practice: Question Bank, Question Rush, Challenging Questions, saved /
// missed review and class tasks. Mock-test answers earn the mock bonus instead.
const ELIGIBLE = sql`(a.mode in ('bank','rush','challenge','review') or a.mode like 'task:%')`;
type Board = { studentId: number; value: number; extra: Record<string, number> }[];
const boardCache = new Map<string, { at: number; data: any }>();
async function cached<T>(key: string, ttl: number, fn: () => Promise<T>): Promise<T> {
  const hit = boardCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.data as T;
  const data = await fn();
  boardCache.set(key, { at: Date.now(), data });
  if (boardCache.size > 200) boardCache.delete(boardCache.keys().next().value!);
  return data;
}
// First eligible graded response per student per question inside [from, to):
// retries never inflate accuracy or points.
async function firstResponses(fromTs: string | null, toTs: string | null) {
  const rows = rowsOf(await db.execute(sql`with firsts as (
      select distinct on (a.student, a.question_id) a.student, a.correct, a.difficulty
      from attempts a where ${ELIGIBLE} and a.student ~ '^u[0-9]{1,9}$'
      ${fromTs ? sql`and a.created_at >= ${fromTs}::timestamp` : sql``} ${toTs ? sql`and a.created_at < ${toTs}::timestamp` : sql``}
      order by a.student, a.question_id, a.created_at, a.id)
    select substring(student from 2)::int as student_id, count(*)::int as answered,
      count(*) filter (where correct)::int as correct,
      coalesce(sum(case when not correct then 0 when difficulty <= 2 then 1 when difficulty = 3 then 2 else 3 end), 0)::int as points
    from firsts group by student`));
  return new Map(rows.map((r) => [Number(r.student_id), { answered: r.answered, correct: r.correct, points: r.points }]));
}
async function pointsBoard(fromTs: string | null, toTs: string | null, fromDay: string | null, toDay: string | null): Promise<Board> {
  const [firsts, days, mocks] = await Promise.all([
    firstResponses(fromTs, toTs),
    db.execute(sql`select student_id, count(*)::int as n from student_daily_activity
      where (practice_answered >= 10 or modules_completed >= 1)
      ${fromDay ? sql`and day >= ${fromDay}::date` : sql``} ${toDay ? sql`and day < ${toDay}::date` : sql``} group by student_id`),
    db.execute(sql`select student_id, count(distinct test_id)::int as n from test_attempts
      where submitted_at is not null and practice_scope = 'full' and not competition_excluded
      ${fromTs ? sql`and submitted_at >= ${fromTs}::timestamp` : sql``} ${toTs ? sql`and submitted_at < ${toTs}::timestamp` : sql``} group by student_id`),
  ]);
  const map = new Map<number, { q: number; d: number; m: number }>();
  for (const [id, f] of firsts) map.set(id, { q: f.points, d: 0, m: 0 });
  for (const r of rowsOf(days)) { const e = map.get(Number(r.student_id)) ?? { q: 0, d: 0, m: 0 }; e.d = r.n; map.set(Number(r.student_id), e); }
  for (const r of rowsOf(mocks)) { const e = map.get(Number(r.student_id)) ?? { q: 0, d: 0, m: 0 }; e.m = r.n; map.set(Number(r.student_id), e); }
  return [...map.entries()].map(([studentId, e]) => ({
    studentId, value: e.q + e.d * 5 + e.m * 20, extra: { questionPoints: e.q, qualifyingDays: e.d, mocks: e.m },
  })).filter((r) => r.value > 0);
}
async function streaks(studentIds?: number[]) {
  const b = await bounds();
  const rows = rowsOf(await db.execute(sql`with q as (
      select student_id, day from student_daily_activity where (practice_answered >= 10 or modules_completed >= 1)
      ${studentIds ? sql`and student_id in (${sql.join(studentIds.map((i) => sql`${i}`), sql`, `)})` : sql``}),
    g as (select student_id, day, day - (row_number() over (partition by student_id order by day))::int as grp from q),
    isl as (select student_id, max(day) as e, count(*)::int as len from g group by student_id, grp)
    select student_id, max(len)::int as longest, coalesce(max(len) filter (where e >= ${b.yesterday}::date), 0)::int as current,
      (select count(*)::int from q q2 where q2.student_id = isl.student_id) as days
    from isl group by student_id`));
  return new Map(rows.map((r) => [Number(r.student_id), { current: r.current, longest: r.longest, days: r.days }]));
}
async function periodRange(period: string) {
  const b = await bounds();
  if (period === "daily") return { fromTs: tsLit(b.dayAt), fromDay: b.today, b };
  if (period === "weekly") return { fromTs: tsLit(b.weekAt), fromDay: b.weekStart, b };
  if (period === "monthly") return { fromTs: tsLit(b.monthAt), fromDay: b.monthStart, b };
  return { fromTs: null, fromDay: null, b };
}
// Scores only (cached briefly); names and visibility are read fresh on every
// request so hiding an entry takes effect immediately.
async function leaderboardScores(category: string, period: string): Promise<ScoreRow[]> {
  return cached(`lb:${category}:${period}`, 60_000, async () => {
    const { fromTs, fromDay } = await periodRange(period);
    const rows: ScoreRow[] = [];
    if (category === "points") {
      for (const r of await pointsBoard(fromTs, null, fromDay, null)) rows.push({ ...r, sort: [r.value] });
    } else if (category === "accuracy") {
      for (const [id, f] of await firstResponses(fromTs, null)) {
        if (f.answered < 50) continue;
        const acc = Math.round((f.correct / f.answered) * 1000) / 10;
        rows.push({ studentId: id, value: acc, extra: { correct: f.correct, answered: f.answered }, sort: [f.correct / f.answered, f.correct, f.answered] });
      }
    } else {
      for (const [id, s] of await streaks()) {
        if (s.current <= 0) continue;
        rows.push({ studentId: id, value: s.current, extra: { longest: s.longest }, sort: [s.current, s.longest] });
      }
    }
    return rows;
  });
}
async function leaderboard(category: string, period: string, classId: number | null, opts: { superAdmin: boolean; search?: string; page?: number; pageSize?: number }) {
  let pool = await db.select({ id: users.id, username: users.username, visible: users.leaderboardVisible }).from(users)
    .where(and(eq(users.role, "student"), eq(users.status, "active")));
  if (classId) {
    const members = new Set((await db.select({ id: classEnrollments.studentId }).from(classEnrollments)
      .where(and(eq(classEnrollments.classId, classId), eq(classEnrollments.status, "active")))).map((r) => r.id));
    pool = pool.filter((p) => members.has(p.id));
  }
  const board = buildBoard(await leaderboardScores(category, period), pool, opts);
  const ids = board.rows.map((r) => r.studentId);
  const badges = ids.length ? await db.select({ studentId: badgeAwards.studentId, badgeKey: badgeAwards.badgeKey }).from(badgeAwards).where(inArray(badgeAwards.studentId, ids)) : [];
  return { ...board, rows: board.rows.map((r) => ({ ...r, badges: badges.filter((x) => x.studentId === r.studentId).map((x) => x.badgeKey) })) };
}

// Championship badges for the last completed week and month, awarded once
// the period is over. A marker row makes the work idempotent and race-safe.
export async function finalizeLeagues() {
  const b = await bounds();
  const tz = b.tz;
  const [r] = rowsOf(await db.execute(sql`select
    (date_trunc('week', now() at time zone ${tz}) - interval '1 week')::date::text as pw,
    ((date_trunc('week', now() at time zone ${tz}) - interval '1 week') at time zone ${tz}) as pw_at,
    (date_trunc('month', now() at time zone ${tz}) - interval '1 month')::date::text as pm,
    ((date_trunc('month', now() at time zone ${tz}) - interval '1 month') at time zone ${tz}) as pm_at`));
  const periods = [
    { key: `league:week:${r.pw}`, fromTs: tsLit(new Date(r.pw_at).toISOString()), toTs: tsLit(b.weekAt), fromDay: r.pw, toDay: b.weekStart, kind: "week" },
    { key: `league:month:${r.pm}`, fromTs: tsLit(new Date(r.pm_at).toISOString()), toTs: tsLit(b.monthAt), fromDay: r.pm, toDay: b.monthStart, kind: "month" },
  ];
  for (const p of periods) {
    const claimed = await db.insert(settings).values({ key: p.key, value: { status: "finalizing", at: new Date().toISOString() } })
      .onConflictDoNothing().returning({ key: settings.key });
    if (!claimed.length) continue;
    try {
    const excluded = new Set((await db.select({ id: users.id }).from(users).where(or(sql`${users.role} <> 'student'`, inArray(users.status, ["banned", "deactivated", "deleted"])))).map((u) => u.id));
    const ranked = rankRows((await pointsBoard(p.fromTs, p.toTs, p.fromDay, p.toDay)).filter((x) => !excluded.has(x.studentId)).map((x) => ({ ...x, sort: [x.value] })));
    const winners = ranked.filter((x) => x.rank === 1).map((x) => x.studentId);
    const awards: { id: number; key: string }[] = winners.map((id) => ({ id, key: p.kind === "week" ? "weekly_champion" : "monthly_champion" }));
    if (p.kind === "month" && ranked.length >= 10) for (const x of ranked.filter((x) => x.rank <= 10)) awards.push({ id: x.studentId, key: "top_performer" });
    for (const a of awards) await awardBadge(a.id, a.key, { period: p.key.split(":").slice(1).join(":") });
    await writeSetting(p.key, { status: "final", at: new Date().toISOString(), participants: ranked.length, top: ranked.slice(0, 10).map((x) => ({ studentId: x.studentId, rank: x.rank, points: x.value })) });
    } catch (e) {
      // Release the claim so the next run retries; awards already made stay (no duplicates).
      await db.delete(settings).where(eq(settings.key, p.key));
      throw e;
    }
  }
}

// ─────────────── BADGES ───────────────
export const BADGES: { key: string; group: string; title: string; requirement: string; metric?: string; target?: number }[] = [
  { key: "first_steps", group: "Streak", title: "First Steps", requirement: "1 qualifying day", metric: "qualifyingDays", target: 1 },
  { key: "consistency_starter", group: "Streak", title: "Consistency Starter", requirement: "3-day streak", metric: "longestStreak", target: 3 },
  { key: "weekly_warrior", group: "Streak", title: "Weekly Warrior", requirement: "7-day streak", metric: "longestStreak", target: 7 },
  { key: "dedicated_learner", group: "Streak", title: "Dedicated Learner", requirement: "14-day streak", metric: "longestStreak", target: 14 },
  { key: "monthly_master", group: "Streak", title: "Monthly Master", requirement: "30-day streak", metric: "longestStreak", target: 30 },
  { key: "century_club", group: "Streak", title: "Century Club", requirement: "100-day streak", metric: "longestStreak", target: 100 },
  { key: "sharp_thinker", group: "Accuracy", title: "Sharp Thinker", requirement: "90% accuracy across at least 50 eligible questions" },
  { key: "precision_expert", group: "Accuracy", title: "Precision Expert", requirement: "95% accuracy across at least 100 eligible questions" },
  { key: "perfect_round", group: "Accuracy", title: "Perfect Round", requirement: "100% on a mock test or class task of at least 20 questions" },
  { key: "curious_mind", group: "Questions", title: "Curious Mind", requirement: "100 answered questions", metric: "answered", target: 100 },
  { key: "knowledge_builder", group: "Questions", title: "Knowledge Builder", requirement: "500 answered questions", metric: "answered", target: 500 },
  { key: "question_master", group: "Questions", title: "Question Master", requirement: "1,000 answered questions", metric: "answered", target: 1000 },
  { key: "sat_legend", group: "Questions", title: "SAT Legend", requirement: "5,000 answered questions", metric: "answered", target: 5000 },
  { key: "first_mock", group: "Mock tests", title: "First Mock", requirement: "1 completed full-length mock", metric: "mocks", target: 1 },
  { key: "mock_veteran", group: "Mock tests", title: "Mock Veteran", requirement: "5 completed full-length mocks", metric: "mocks", target: 5 },
  { key: "mock_champion", group: "Mock tests", title: "Mock Champion", requirement: "20 completed full-length mocks", metric: "mocks", target: 20 },
  { key: "word_explorer", group: "Vocabulary", title: "Word Explorer", requirement: "50 mastered words", metric: "mastered", target: 50 },
  { key: "vocabulary_expert", group: "Vocabulary", title: "Vocabulary Expert", requirement: "250 mastered words", metric: "mastered", target: 250 },
  { key: "vocabulary_legend", group: "Vocabulary", title: "Vocabulary Legend", requirement: "1,000 mastered words", metric: "mastered", target: 1000 },
  { key: "weekly_champion", group: "Leagues", title: "Weekly Champion", requirement: "First place in a completed weekly points leaderboard" },
  { key: "monthly_champion", group: "Leagues", title: "Monthly Champion", requirement: "First place in a completed monthly points leaderboard" },
  { key: "top_performer", group: "Leagues", title: "Top Performer", requirement: "Top 10 in a completed monthly points leaderboard (10+ participants)" },
];
async function awardBadge(studentId: number, key: string, meta: Record<string, unknown> = {}) {
  const def = BADGES.find((b) => b.key === key);
  if (!def) return false;
  const inserted = await db.insert(badgeAwards).values({ studentId, badgeKey: key, meta }).onConflictDoNothing().returning({ id: badgeAwards.id });
  if (inserted.length) await notify([studentId], { kind: "badge", title: `Badge earned: ${def.title}`, body: def.requirement, link: { view: "achievements" } });
  return inserted.length > 0;
}
async function studentMetrics(studentId: number) {
  const key = `u${studentId}`;
  const [streak, firsts, answered, mocks, mastered, perfectTest, perfectTask] = await Promise.all([
    streaks([studentId]),
    db.execute(sql`select count(*)::int as answered, count(*) filter (where correct)::int as correct from (
      select distinct on (a.question_id) a.correct from attempts a where a.student = ${key} and ${ELIGIBLE}
      order by a.question_id, a.created_at, a.id) f`),
    db.select({ n: sql<number>`count(*)::int` }).from(attempts).where(eq(attempts.student, key)),
    db.select({ n: sql<number>`count(*)::int` }).from(testAttempts).where(and(eq(testAttempts.studentId, studentId), sql`${testAttempts.submittedAt} is not null`, eq(testAttempts.practiceScope, "full"), eq(testAttempts.competitionExcluded, false))),
    db.select({ n: sql<number>`count(*)::int` }).from(studentWordMastery).where(and(eq(studentWordMastery.studentId, studentId), eq(studentWordMastery.masteryLevel, "Mastered"))),
    db.select({ id: testAttempts.id }).from(testAttempts).where(and(eq(testAttempts.studentId, studentId), sql`${testAttempts.submittedAt} is not null`,
      sql`${testAttempts.totalCount} >= 20`, sql`${testAttempts.correctCount} = ${testAttempts.totalCount}`, eq(testAttempts.competitionExcluded, false))).limit(1),
    db.execute(sql`select 1 from (select a.mode, a.question_id, bool_and(a.correct) as ok from (
        select distinct on (mode, question_id) mode, question_id, correct from attempts where student = ${key} and mode like 'task:%' order by mode, question_id, created_at, id) a
      group by a.mode, a.question_id) t join assignments s on t.mode = 'task:' || s.id
      group by t.mode, s.question_ids having count(*) >= 20 and bool_and(t.ok) and count(*) = jsonb_array_length(s.question_ids) limit 1`),
  ]);
  const s = streak.get(studentId) ?? { current: 0, longest: 0, days: 0 };
  const f = rowsOf(firsts)[0] ?? { answered: 0, correct: 0 };
  return {
    qualifyingDays: s.days, currentStreak: s.current, longestStreak: s.longest,
    eligibleAnswered: f.answered, eligibleCorrect: f.correct, accuracy: f.answered ? Math.round((f.correct / f.answered) * 1000) / 10 : 0,
    answered: answered[0]?.n ?? 0, mocks: mocks[0]?.n ?? 0, mastered: mastered[0]?.n ?? 0,
    perfectRound: perfectTest.length > 0 || rowsOf(perfectTask).length > 0,
  };
}
const badgeCheckedAt = new Map<number, number>();
export async function evaluateBadges(studentId: number, force = false) {
  const last = badgeCheckedAt.get(studentId) ?? 0;
  if (!force && Date.now() - last < 30_000) return null;
  badgeCheckedAt.set(studentId, Date.now());
  try {
    const m = await studentMetrics(studentId);
    const have = new Set((await db.select({ k: badgeAwards.badgeKey }).from(badgeAwards).where(eq(badgeAwards.studentId, studentId))).map((r) => r.k));
    for (const def of BADGES) {
      if (have.has(def.key) || def.group === "Leagues") continue;
      let earned = false;
      if (def.metric && def.target) earned = (m as any)[def.metric] >= def.target;
      else if (def.key === "sharp_thinker") earned = m.eligibleAnswered >= 50 && m.accuracy >= 90;
      else if (def.key === "precision_expert") earned = m.eligibleAnswered >= 100 && m.accuracy >= 95;
      else if (def.key === "perfect_round") earned = m.perfectRound;
      if (earned) await awardBadge(studentId, def.key);
    }
    return m;
  } catch (e) { console.error("badge evaluation failed", e); return null; }
}

// ─────────────── PERFORMANCE REPORTS ───────────────
async function performanceRows(user: DbUser, url: URL) {
  const q = url.searchParams;
  let scope: number[] | null = null;
  if (user.role === "student") scope = [user.id];
  else if (user.role === "mentor") scope = await mentorStudentIds(user.id);
  const studentId = int(q.get("studentId")), classId = int(q.get("classId")), mentorId = int(q.get("mentorId")), testId = int(q.get("testId"));
  let filterIds: number[] | null = null;
  if (classId || mentorId) {
    const rows = await db.select({ id: classEnrollments.studentId }).from(classEnrollments).innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(and(eq(classEnrollments.status, "active"), classId ? eq(classes.id, classId) : undefined, mentorId ? eq(classes.mentorId, mentorId) : undefined));
    filterIds = [...new Set(rows.map((r) => r.id))];
  }
  if (studentId) filterIds = filterIds ? filterIds.filter((i) => i === studentId) : [studentId];
  let ids = scope;
  if (filterIds) ids = ids ? ids.filter((i) => filterIds!.includes(i)) : filterIds;
  if (ids && !ids.length) return [];
  const conds = [sql`${testAttempts.submittedAt} is not null`];
  if (ids) conds.push(inArray(testAttempts.studentId, ids));
  if (testId) conds.push(eq(testAttempts.testId, testId));
  const from = q.get("from"), to = q.get("to");
  if (from && !Number.isNaN(Date.parse(from))) conds.push(gte(testAttempts.submittedAt, new Date(from)));
  if (to && !Number.isNaN(Date.parse(to))) conds.push(sql`${testAttempts.submittedAt} < ${new Date(Date.parse(to) + 86_400_000)}`);
  const rows = await db.select({ a: testAttempts, title: tests.title, name: users.displayName })
    .from(testAttempts).innerJoin(tests, eq(testAttempts.testId, tests.id)).innerJoin(users, eq(testAttempts.studentId, users.id))
    .where(and(...conds)).orderBy(desc(testAttempts.submittedAt)).limit(500);
  const minScore = int(q.get("minScore")), maxScore = int(q.get("maxScore"));
  const staff = user.role !== "student";
  const memberships = staff && rows.length ? await db.select({ studentId: classEnrollments.studentId, classId: classes.id, className: classes.name, mentorId: classes.mentorId })
    .from(classEnrollments).innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classEnrollments.status, "active"), inArray(classEnrollments.studentId, [...new Set(rows.map((r) => r.a.studentId))]))) : [];
  const out = [];
  for (const r of rows) {
    const report: any = await ensureScoreReport(r.a);
    if (!report) continue;
    const score = report.totalScaled ?? null;
    if (minScore !== null && (score === null || score < minScore)) continue;
    if (maxScore !== null && (score === null || score > maxScore)) continue;
    const answered = Object.values(r.a.answers || {}).filter((v) => String(v ?? "").trim()).length;
    const planned = report.totalCount ?? 0;
    out.push({
      attemptId: r.a.id, testId: r.a.testId, testTitle: r.title, studentId: r.a.studentId, studentName: r.name,
      classes: memberships.filter((m) => m.studentId === r.a.studentId).map((m) => ({ id: m.classId, name: m.className, mentorId: m.mentorId })),
      startedAt: r.a.startedAt, submittedAt: r.a.submittedAt,
      durationSeconds: r.a.startedAt && r.a.submittedAt ? Math.max(0, Math.round((new Date(r.a.submittedAt).getTime() - new Date(r.a.startedAt).getTime()) / 1000)) : null,
      timed: r.a.timed, scope: r.a.practiceScope, examMode: r.a.examMode,
      totalScaled: score, rwScaled: report.rwScaled ?? null, mathScaled: report.mathScaled ?? null,
      correct: report.correctCount, total: planned, unanswered: Math.max(0, planned - Math.min(planned, answered)),
      incorrect: Math.max(0, planned - report.correctCount - Math.max(0, planned - Math.min(planned, answered))),
      accuracy: planned ? Math.round((report.correctCount / planned) * 100) : 0,
      domains: report.domains, skills: report.skills, sections: report.sections,
      ...(staff ? { integrity: { status: r.a.integrityStatus, violations: r.a.violationCount, excluded: r.a.competitionExcluded } } : {}),
    });
  }
  return out;
}
async function performanceDetail(user: DbUser, attemptId: number, json: Json) {
  const [a] = await db.select().from(testAttempts).where(eq(testAttempts.id, attemptId)).limit(1);
  if (!a || !(await canSeeStudent(user, a.studentId))) return json({ error: "Report not found." }, 404);
  if (!a.submittedAt) return json({ error: "This sitting is still in progress." }, 409);
  const [test] = await db.select().from(tests).where(eq(tests.id, a.testId));
  const [student] = await db.select().from(users).where(eq(users.id, a.studentId));
  const report: any = await ensureScoreReport(a);
  const mods = await planModules(a);
  const questionsOut = [];
  const diff = new Map<string, { label: string; correct: number; total: number }>();
  for (const [mi, m] of mods.entries()) {
    for (const [qi, q] of (await loadModuleQuestions(m.id)).entries()) {
      const given = String((a.answers || {})[String(q.id)] ?? "");
      const ok = given ? isAnswerCorrect(q, given) : false;
      const label = q.difficulty <= 2 ? "Easy" : q.difficulty === 3 ? "Medium" : "Hard";
      const d = diff.get(label) ?? { label, correct: 0, total: 0 }; d.total += 1; if (ok) d.correct += 1; diff.set(label, d);
      questionsOut.push({
        id: q.id, module: m.title, moduleIndex: mi, number: qi + 1, section: q.section, domain: q.category, skill: q.subcategory || "General",
        difficulty: label, type: q.type, prompt: q.prompt, passage: q.passage, choices: q.choices, questionImage: q.questionImage, choiceImages: q.choiceImages,
        given, answer: q.answer, correct: ok, unanswered: !given, explanation: q.explanation,
      });
    }
  }
  const staff = user.role !== "student";
  const events = staff ? await db.select().from(examIntegrityEvents).where(eq(examIntegrityEvents.attemptId, a.id)).orderBy(examIntegrityEvents.occurredAt) : [];
  const history = await db.select({ id: testAttempts.id, testId: testAttempts.testId, submittedAt: testAttempts.submittedAt, scoreReport: testAttempts.scoreReport, correctCount: testAttempts.correctCount, totalCount: testAttempts.totalCount })
    .from(testAttempts).where(and(eq(testAttempts.studentId, a.studentId), sql`${testAttempts.submittedAt} is not null`)).orderBy(testAttempts.submittedAt).limit(200);
  return json({
    attempt: { id: a.id, testId: a.testId, startedAt: a.startedAt, submittedAt: a.submittedAt, timed: a.timed, scope: a.practiceScope, examMode: a.examMode },
    test: test ? { id: test.id, title: test.title } : null, student: { id: student?.id, displayName: nameOf(student) },
    report, difficulty: [...diff.values()], questions: questionsOut,
    history: history.map((h: any) => ({ id: h.id, testId: h.testId, submittedAt: h.submittedAt, totalScaled: h.scoreReport?.totalScaled ?? null, rwScaled: h.scoreReport?.rwScaled ?? null, mathScaled: h.scoreReport?.mathScaled ?? null, correct: h.correctCount, total: h.totalCount })),
    ...(staff ? { integrity: { status: a.integrityStatus, violations: a.violationCount, warnings: a.warningCount, note: a.integrityNote, excluded: a.competitionExcluded, reviewedAt: a.integrityReviewedAt, events } } : {}),
  });
}

// ─────────────── ROUTES ───────────────
const REPORT_REASONS = ["incorrect_answer", "incorrect_explanation", "ambiguous", "formatting", "missing_information", "broken_image", "other"];
const REPORT_SOURCES = ["bank", "challenge", "practice", "mock", "review", "task", "rush"];
const REPORT_STATUSES = ["new", "under_review", "resolved", "rejected"];

export async function handlePlatform(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  const { json, requireUser } = deps;
  const url = new URL(req.url);
  const method = req.method;
  const [resource, id, sub, sub2] = parts;

  // ── own password ──
  if (resource === "auth" && id === "change-password" && method === "POST") {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    return changeOwnPassword(req, auth.user!, json);
  }
  if (resource === "auth" && id === "preferences" && method === "PUT") {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const b = await req.json().catch(() => ({}));
    const prefs = { ...(auth.user!.preferences || {}) } as Record<string, unknown>;
    if (["uz", "ru"].includes(b.vocabLang)) prefs.vocabLang = b.vocabLang;
    if (["en2x", "x2en"].includes(b.vocabDir)) prefs.vocabDir = b.vocabDir;
    // Lessons teaching mode: English–Uzbek ("uz") or English–Russian ("ru").
    if (["uz", "ru"].includes(b.teachLang)) prefs.teachLang = b.teachLang;
    await db.update(users).set({ preferences: prefs }).where(eq(users.id, auth.user!.id));
    return json({ preferences: prefs });
  }

  // ── usage (students) ──
  if (resource === "usage" && method === "GET") {
    const auth = await requireUser(req, ["student"]);
    if (auth.error) return auth.error;
    return json(await usageSummary(auth.user!.id));
  }
  if (resource === "usage" && id === "vocab-quiz" && method === "POST") {
    const auth = await requireUser(req, ["student"]);
    if (auth.error) return auth.error;
    const r = await consumeUsage(auth.user!.id, "vocab");
    if (!r.ok) return json(r, 429);
    return json({ ok: true, usage: await usageSummary(auth.user!.id) });
  }

  // ── notifications & inbox counters ──
  if (resource === "notifications") {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const me = auth.user!.id;
    if (method === "GET") {
      const rows = await db.select().from(notifications).where(eq(notifications.userId, me)).orderBy(desc(notifications.createdAt)).limit(50);
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, me), isNull(notifications.readAt)));
      return json({ notifications: rows, unread: n });
    }
    if (method === "POST" && id === "read") {
      const b = await req.json().catch(() => ({}));
      const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isInteger).slice(0, 200);
      await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.userId, me), isNull(notifications.readAt), b.all ? undefined : ids.length ? inArray(notifications.id, ids) : sql`false`));
      return json({ ok: true });
    }
    return json({ error: "Method not allowed." }, 405);
  }
  if (resource === "inbox" && method === "GET") {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const u = auth.user!;
    const [[n], [m], reports, [ann]] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, u.id), isNull(notifications.readAt))),
      db.select({ n: sql<number>`count(*)::int` }).from(messages).where(and(eq(messages.recipientId, u.id), isNull(messages.readAt))),
      u.role === "admin" ? db.select({ n: sql<number>`count(*)::int` }).from(questionReports).where(eq(questionReports.status, "new")) : Promise.resolve([{ n: 0 }]),
      db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(eq(notifications.userId, u.id), isNull(notifications.readAt), eq(notifications.kind, "announcement"))),
    ]);
    return json({ notifications: n.n, messages: m.n, reports: reports[0]?.n ?? 0, announcements: ann?.n ?? 0 });
  }

  // ── question reports ──
  if (resource === "question-reports" && !id && method === "POST") {
    const auth = await requireUser(req);
    if (auth.error) return auth.error;
    const u = auth.user!;
    const b = await req.json().catch(() => ({}));
    const questionId = int(b.questionId);
    const reason = str(b.reason, 40);
    if (!questionId) return json({ error: "Choose the question to report." }, 400);
    if (!REPORT_REASONS.includes(reason)) return json({ error: "Choose a reason for the report." }, 400);
    const [q] = await db.select({ id: questions.id, scope: questions.scope }).from(questions).where(eq(questions.id, questionId)).limit(1);
    if (!q) return json({ error: "That question no longer exists." }, 404);
    let testAttemptId = int(b.testAttemptId);
    if (testAttemptId) {
      const [a] = await db.select({ studentId: testAttempts.studentId }).from(testAttempts).where(eq(testAttempts.id, testAttemptId)).limit(1);
      if (!a || a.studentId !== u.id) testAttemptId = null;
    }
    const [{ recent }] = await db.select({ recent: sql<number>`count(*)::int` }).from(questionReports)
      .where(and(eq(questionReports.reporterId, u.id), sql`${questionReports.createdAt} > now() - interval '1 day'`));
    if (recent >= 20) return json({ error: "You have sent many reports today. Please try again tomorrow." }, 429);
    const [open] = await db.select({ id: questionReports.id }).from(questionReports)
      .where(and(eq(questionReports.reporterId, u.id), eq(questionReports.questionId, questionId), inArray(questionReports.status, ["new", "under_review"]))).limit(1);
    if (open) return json({ error: "You already reported this question. The team is looking into it." }, 409);
    const [row] = await db.insert(questionReports).values({
      questionId, reporterId: u.id, reason, comment: str(b.comment, 1000),
      source: REPORT_SOURCES.includes(str(b.source, 20)) ? str(b.source, 20) : "bank", testAttemptId,
    }).returning({ id: questionReports.id });
    await notify(await adminIds(), { kind: "question_report", title: "New question report", body: `Question #${questionId} · ${reason.replace(/_/g, " ")}`, link: { view: "qreports", reportId: row.id } });
    return json({ ok: true, id: row.id }, 201);
  }
  if (resource === "admin" && id === "question-reports") {
    const auth = await requireUser(req, ["admin"]);
    if (auth.error) return auth.error;
    const reportId = int(sub);
    if (method === "GET" && !reportId) {
      const status = url.searchParams.get("status");
      const rows = await db.select({ r: questionReports, name: users.displayName, q: { id: questions.id, section: questions.section, category: questions.category, subcategory: questions.subcategory, prompt: questions.prompt, scope: questions.scope } })
        .from(questionReports).innerJoin(users, eq(questionReports.reporterId, users.id)).leftJoin(questions, eq(questionReports.questionId, questions.id))
        .where(status && REPORT_STATUSES.includes(status) ? eq(questionReports.status, status) : undefined)
        .orderBy(desc(questionReports.createdAt)).limit(300);
      const counts = await db.select({ qid: questionReports.questionId, n: sql<number>`count(*)::int` }).from(questionReports).groupBy(questionReports.questionId);
      const byQ = new Map(counts.map((c) => [c.qid, c.n]));
      return json(rows.map((x) => ({ ...x.r, reporterName: x.name, question: x.q, duplicateCount: byQ.get(x.r.questionId) ?? 1 })));
    }
    if (!reportId) return json({ error: "Report not found." }, 404);
    const [report] = await db.select().from(questionReports).where(eq(questionReports.id, reportId)).limit(1);
    if (!report) return json({ error: "Report not found." }, 404);
    if (method === "GET") {
      const [q] = await db.select().from(questions).where(eq(questions.id, report.questionId));
      const related = await db.select({ r: questionReports, name: users.displayName }).from(questionReports).innerJoin(users, eq(questionReports.reporterId, users.id))
        .where(eq(questionReports.questionId, report.questionId)).orderBy(desc(questionReports.createdAt));
      return json({ report, question: q ?? null, related: related.map((x) => ({ ...x.r, reporterName: x.name })) });
    }
    if (method === "PATCH") {
      const b = await req.json().catch(() => ({}));
      const status = str(b.status, 20);
      if (!REPORT_STATUSES.includes(status)) return json({ error: "Choose a valid status." }, 400);
      const note = str(b.resolutionNote, 2000);
      const targets = b.applyToDuplicates ? (await db.select({ id: questionReports.id }).from(questionReports)
        .where(and(eq(questionReports.questionId, report.questionId), inArray(questionReports.status, ["new", "under_review"])))).map((r) => r.id) : [];
      const ids = [...new Set([report.id, ...targets])];
      const updated = await db.update(questionReports).set({ status, resolutionNote: note, resolvedBy: auth.user!.id, updatedAt: new Date() })
        .where(inArray(questionReports.id, ids)).returning({ id: questionReports.id, reporterId: questionReports.reporterId });
      if (status === "resolved" || status === "rejected")
        await notify(updated.map((r) => r.reporterId), { kind: "question_report", title: `Your question report was ${status}`, body: note.slice(0, 300) || `Question #${report.questionId}` });
      await audit(auth.user!.id, "question_report.update", "question_report", report.id, { status, ids });
      return json({ ok: true, updated: ids.length });
    }
    return json({ error: "Method not allowed." }, 405);
  }

  // ── mentor ↔ student messages ──
  if (resource === "messages") {
    const auth = await requireUser(req, ["student", "mentor"]);
    if (auth.error) return auth.error;
    const u = auth.user!;
    if (method === "GET" && (!id || id === "contacts")) {
      let contacts: { id: number; displayName: string; role: string; classNames: string[] }[] = [];
      if (u.role === "student") {
        const rows = await db.select({ id: users.id, displayName: users.displayName, className: classes.name }).from(classEnrollments)
          .innerJoin(classes, eq(classEnrollments.classId, classes.id)).innerJoin(users, eq(classes.mentorId, users.id))
          .where(and(eq(classEnrollments.studentId, u.id), eq(classEnrollments.status, "active"), eq(users.status, "active")));
        for (const r of rows) { const c = contacts.find((x) => x.id === r.id); if (c) c.classNames.push(r.className); else contacts.push({ id: r.id, displayName: r.displayName, role: "mentor", classNames: [r.className] }); }
      } else {
        const rows = await db.select({ id: users.id, displayName: users.displayName, className: classes.name }).from(classEnrollments)
          .innerJoin(classes, eq(classEnrollments.classId, classes.id)).innerJoin(users, eq(classEnrollments.studentId, users.id))
          .where(and(eq(classes.mentorId, u.id), eq(classEnrollments.status, "active")));
        for (const r of rows) { const c = contacts.find((x) => x.id === r.id); if (c) c.classNames.push(r.className); else contacts.push({ id: r.id, displayName: r.displayName, role: "student", classNames: [r.className] }); }
      }
      const ids = contacts.map((c) => c.id);
      const stats = ids.length ? rowsOf(await db.execute(sql`select other, max(created_at) as last_at,
          count(*) filter (where recipient_id = ${u.id} and read_at is null)::int as unread
        from (select case when sender_id = ${u.id} then recipient_id else sender_id end as other, created_at, recipient_id, read_at
          from messages where sender_id = ${u.id} or recipient_id = ${u.id}) m group by other`)) : [];
      const byId = new Map(stats.map((s) => [Number(s.other), s]));
      return json(contacts.map((c) => ({ ...c, unread: byId.get(c.id)?.unread ?? 0, lastAt: byId.get(c.id)?.last_at ?? null }))
        .sort((a, b) => (b.lastAt ? new Date(b.lastAt).getTime() : 0) - (a.lastAt ? new Date(a.lastAt).getTime() : 0)));
    }
    const otherId = int(id);
    if (!otherId) return json({ error: "Conversation not found." }, 404);
    const [other] = await db.select().from(users).where(eq(users.id, otherId)).limit(1);
    const allowed = other && other.status !== "banned" && (u.role === "student"
      ? other.role === "mentor" && (await mentorCanAccess(other.id, u.id))
      : other.role === "student" && (await mentorCanAccess(u.id, other.id)));
    if (!allowed) return json({ error: "You can only message your assigned mentors and students." }, 403);
    if (method === "GET") {
      const after = int(url.searchParams.get("after")) ?? 0;
      const rows = await db.select().from(messages).where(and(
        or(and(eq(messages.senderId, u.id), eq(messages.recipientId, otherId)), and(eq(messages.senderId, otherId), eq(messages.recipientId, u.id))),
        after ? sql`${messages.id} > ${after}` : undefined,
      )).orderBy(desc(messages.id)).limit(200);
      await db.update(messages).set({ readAt: new Date() }).where(and(eq(messages.senderId, otherId), eq(messages.recipientId, u.id), isNull(messages.readAt)));
      return json({ other: { id: other!.id, displayName: other!.displayName, role: other!.role }, messages: rows.reverse() });
    }
    if (method === "POST") {
      const b = await req.json().catch(() => ({}));
      const body = String(b.body ?? "").replace(/\r\n/g, "\n").trim();
      if (!body) return json({ error: "Write a message first." }, 400);
      if (body.length > 2000) return json({ error: "Keep messages under 2,000 characters." }, 400);
      const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(messages)
        .where(and(eq(messages.senderId, u.id), sql`${messages.createdAt} > now() - interval '1 minute'`));
      if (n >= 20) return json({ error: "You're sending messages too quickly. Wait a moment and try again." }, 429);
      const [row] = await db.insert(messages).values({ senderId: u.id, recipientId: otherId, body }).returning();
      // One unread "new message" notification per conversation is enough.
      const [pending] = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.userId, otherId), eq(notifications.kind, "message"),
        isNull(notifications.readAt), sql`${notifications.link}->>'with' = ${String(u.id)}`)).limit(1);
      if (!pending) await notify([otherId], { kind: "message", title: `New message from ${nameOf(u)}`, body: body.slice(0, 140), link: { view: "messages", with: String(u.id) } });
      return json(row, 201);
    }
    return json({ error: "Method not allowed." }, 405);
  }
  // Admin investigation of a reported conversation (read-only, audited).
  if (resource === "admin" && id === "conversations" && method === "GET") {
    const auth = await requireUser(req, ["admin"]);
    if (auth.error) return auth.error;
    const a = int(url.searchParams.get("a")), b2 = int(url.searchParams.get("b"));
    if (!a || !b2) return json({ error: "Pass both user ids." }, 400);
    const rows = await db.select().from(messages).where(or(and(eq(messages.senderId, a), eq(messages.recipientId, b2)), and(eq(messages.senderId, b2), eq(messages.recipientId, a))))
      .orderBy(desc(messages.id)).limit(500);
    await audit(auth.user!.id, "conversation.viewed", "conversation", `${a}:${b2}`, { count: rows.length });
    return json(rows.reverse());
  }

  // ── exam settings & integrity ──
  if (resource === "exam-settings") {
    if (method === "GET") {
      const auth = await requireUser(req);
      if (auth.error) return auth.error;
      return json(await examSettings());
    }
    if (method === "PUT") {
      const auth = await requireUser(req, ["admin"]);
      if (auth.error) return auth.error;
      const b = await req.json().catch(() => ({}));
      const cur = await examSettings();
      const next = { ...cur };
      for (const k of ["examModeFullLength", "allowPracticeMode", "requireFullscreen", "allowWithoutFullscreen", "monitoring"] as const) if (typeof b[k] === "boolean") next[k] = b[k];
      for (const k of ["warnAt", "strongWarnAt", "reviewAt", "dedupeSeconds"] as const) if (b[k] !== undefined) next[k] = Number(b[k]) as any;
      await writeSetting("exam", next);
      await audit(auth.user!.id, "exam_settings.update", "settings", "exam", next);
      return json(await examSettings());
    }
  }
  if (resource === "integrity") {
    if (id === "events" && method === "POST") {
      const auth = await requireUser(req, ["student"]);
      if (auth.error) return auth.error;
      const b = await req.json().catch(() => ({}));
      const attemptId = int(b.attemptId);
      const [a] = attemptId ? await db.select().from(testAttempts).where(eq(testAttempts.id, attemptId)).limit(1) : [];
      if (!a || a.studentId !== auth.user!.id) return json({ error: "Test session not found." }, 404);
      if (!a.examMode || a.submittedAt) return json({ ignored: true });
      if (!(await examSettings()).monitoring) return json({ ignored: true });
      return json(await recordIntegrityEvents(a, Array.isArray(b.events) ? b.events : []));
    }
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    const u = auth.user!;
    if (!id && method === "GET") {
      const status = url.searchParams.get("status");
      const scope = u.role === "mentor" ? await mentorStudentIds(u.id) : null;
      if (scope && !scope.length) return json([]);
      const rows = await db.select({ a: testAttempts, title: tests.title, name: users.displayName }).from(testAttempts)
        .innerJoin(tests, eq(testAttempts.testId, tests.id)).innerJoin(users, eq(testAttempts.studentId, users.id))
        .where(and(eq(testAttempts.examMode, true), status ? eq(testAttempts.integrityStatus, status) : sql`${testAttempts.integrityStatus} <> 'none'`,
          scope ? inArray(testAttempts.studentId, scope) : undefined))
        .orderBy(desc(testAttempts.startedAt)).limit(300);
      return json(rows.map((r) => ({
        attemptId: r.a.id, testTitle: r.title, studentId: r.a.studentId, studentName: r.name, startedAt: r.a.startedAt, submittedAt: r.a.submittedAt,
        status: r.a.integrityStatus, violations: r.a.violationCount, warnings: r.a.warningCount, note: r.a.integrityNote, excluded: r.a.competitionExcluded,
      })));
    }
    const attemptId = int(id);
    const [a] = attemptId ? await db.select().from(testAttempts).where(eq(testAttempts.id, attemptId)).limit(1) : [];
    if (!a || !(await canSeeStudent(u, a.studentId))) return json({ error: "Report not found." }, 404);
    if (method === "GET") {
      const events = await db.select().from(examIntegrityEvents).where(eq(examIntegrityEvents.attemptId, a.id)).orderBy(examIntegrityEvents.occurredAt);
      const [student] = await db.select().from(users).where(eq(users.id, a.studentId));
      const [test] = await db.select({ title: tests.title }).from(tests).where(eq(tests.id, a.testId));
      const byType: Record<string, number> = {};
      for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1;
      return json({
        attemptId: a.id, studentName: nameOf(student), testTitle: test?.title ?? "", examMode: a.examMode, status: a.integrityStatus,
        violations: a.violationCount, warnings: a.warningCount, note: a.integrityNote, excluded: a.competitionExcluded,
        reviewedAt: a.integrityReviewedAt, byType, events, canReview: u.role === "admin",
      });
    }
    if (method === "PATCH") {
      if (u.role !== "admin") return json({ error: "Only admins can review integrity flags." }, 403);
      const b = await req.json().catch(() => ({}));
      const action = str(b.action, 20); // "reviewed" | "dismiss" | "reopen" | "note"
      const set: Partial<typeof testAttempts.$inferInsert> = { integrityNote: str(b.note ?? a.integrityNote, 2000) };
      if (action === "reviewed" || action === "dismiss") Object.assign(set, { integrityStatus: "reviewed", integrityReviewedBy: u.id, integrityReviewedAt: new Date() });
      if (action === "reopen") Object.assign(set, { integrityStatus: a.violationCount >= (await examSettings()).reviewAt ? "review_required" : a.violationCount ? "warning" : "none", integrityReviewedAt: null });
      if (action === "dismiss") set.competitionExcluded = false;
      if (typeof b.competitionExcluded === "boolean") set.competitionExcluded = b.competitionExcluded;
      await db.update(testAttempts).set(set).where(eq(testAttempts.id, a.id));
      await audit(u.id, `integrity.${action || "note"}`, "test_attempt", a.id, { excluded: set.competitionExcluded ?? a.competitionExcluded });
      boardCache.clear();
      return json({ ok: true });
    }
  }

  // ── performance reports ──
  if (resource === "performance" && method === "GET") {
    const auth = await requireUser(req, ["student", "mentor", "admin"]);
    if (auth.error) return auth.error;
    const u = auth.user!;
    if (id === "attempt" && int(sub)) return performanceDetail(u, int(sub)!, json);
    const rows = await performanceRows(u, url);
    let options: any = {};
    if (u.role !== "student") {
      const cls = await db.select({ id: classes.id, name: classes.name, mentorId: classes.mentorId }).from(classes).where(u.role === "mentor" ? and(eq(classes.mentorId, u.id), isNull(classes.deletedAt)) : isNull(classes.deletedAt));
      const mentors = u.role === "admin" ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.role, "mentor")) : [];
      const sIds = u.role === "mentor" ? await mentorStudentIds(u.id) : null;
      const studs = await db.select({ id: users.id, displayName: users.displayName }).from(users)
        .where(and(eq(users.role, "student"), sIds ? (sIds.length ? inArray(users.id, sIds) : sql`false`) : undefined)).orderBy(users.displayName);
      const tlist = await db.select({ id: tests.id, title: tests.title }).from(tests).orderBy(desc(tests.createdAt));
      options = { classes: cls, mentors, students: studs, tests: tlist };
    }
    return json({ rows, options });
  }

  // ── leaderboards & achievements ──
  if (resource === "leaderboards" && method === "GET") {
    const auth = await requireUser(req, ["student", "mentor", "admin"]);
    if (auth.error) return auth.error;
    const u = auth.user!;
    const superAdmin = isSuperAdmin(u);
    finalizeLeagues().catch((e) => console.error("league finalize failed", e));
    const category = ["points", "accuracy", "streak"].includes(String(url.searchParams.get("category"))) ? String(url.searchParams.get("category")) : "points";
    const period = ["daily", "weekly", "monthly", "all"].includes(String(url.searchParams.get("period"))) ? String(url.searchParams.get("period")) : "weekly";
    let classId = int(url.searchParams.get("classId"));
    const myClasses = u.role === "student" ? await activeClassIds(u.id)
      : (await db.select({ id: classes.id }).from(classes).where(u.role === "mentor" ? and(eq(classes.mentorId, u.id), isNull(classes.deletedAt)) : isNull(classes.deletedAt))).map((c) => c.id);
    if (classId && !myClasses.includes(classId)) classId = null;
    const classList = myClasses.length ? await db.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, myClasses)) : [];
    const search = str(url.searchParams.get("q"), 60);
    const exporting = url.searchParams.get("format") === "csv";
    const board = await leaderboard(category, period, classId, {
      superAdmin, search, page: exporting ? 0 : Math.max(0, Number(url.searchParams.get("page")) || 0), pageSize: exporting ? 200 : 50,
    });
    const unit = category === "points" ? "points" : category === "accuracy" ? "%" : "days";
    if (exporting) {
      return new Response(boardCsv(board.all.slice(0, 500), unit, superAdmin), {
        headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="leaderboard-${category}-${period}.csv"`, "cache-control": "no-store" },
      });
    }
    const b = await bounds();
    // A student sees their own entry only while it is visible to everyone.
    const me = u.role === "student" ? board.all.find((r) => r.studentId === u.id) ?? null : null;
    const strip = <T extends { hidden: boolean }>(r: T) => (superAdmin ? r : { ...r, hidden: undefined });
    return json({
      category, period, classId, classes: classList, rows: board.rows.map(strip), total: board.total, page: board.page, pageSize: board.pageSize,
      superAdmin, hiddenCount: board.hiddenCount, search,
      me: me ? strip(me) : null, myVisibility: u.role === "student" ? u.leaderboardVisible : null,
      timezone: b.tz, minAccuracyQuestions: 50,
    });
  }
  if (resource === "achievements" && method === "GET") {
    const auth = await requireUser(req, ["student", "mentor", "admin"]);
    if (auth.error) return auth.error;
    const u = auth.user!;
    let studentId = u.id;
    const requested = int(url.searchParams.get("studentId"));
    if (u.role !== "student") {
      if (!requested || !(await canSeeStudent(u, requested))) return json({ error: "Choose one of your students." }, 400);
      studentId = requested;
    }
    const metrics = (await evaluateBadges(studentId, true)) ?? (await studentMetrics(studentId));
    const earned = await db.select().from(badgeAwards).where(eq(badgeAwards.studentId, studentId));
    const byKey = new Map(earned.map((e) => [e.badgeKey, e]));
    return json({
      metrics,
      badges: BADGES.map((d) => ({
        ...d, earned: byKey.has(d.key), awardedAt: byKey.get(d.key)?.awardedAt ?? null,
        progress: d.metric && d.target ? Math.min(d.target, (metrics as any)[d.metric] ?? 0) : null,
      })),
    });
  }

  // ── admin: users, classes, limits, audit ──
  if (resource === "admin" && id === "users" && int(sub) && sub2 === "reset-password" && method === "POST") {
    const auth = await requireUser(req, ["admin"]);
    if (auth.error) return auth.error;
    return resetPassword(auth.user!, int(sub)!, json);
  }
  if (resource === "admin" && id === "audit" && method === "GET") {
    const auth = await requireUser(req, ["admin"]);
    if (auth.error) return auth.error;
    const rows = await db.select({ l: auditLog, name: users.displayName }).from(auditLog).leftJoin(users, eq(auditLog.actorId, users.id)).orderBy(desc(auditLog.createdAt)).limit(200);
    return json(rows.map((r) => ({ ...r.l, actorName: r.name })));
  }
  if (resource === "admin" && id === "classes") {
    const auth = await requireUser(req, ["admin"]);
    if (auth.error) return auth.error;
    const admin = auth.user!;
    const classId = int(sub);
    if (method === "GET" && !classId) {
      const [cls, mentors, students, enroll] = await Promise.all([
        db.select().from(classes).where(isNull(classes.deletedAt)).orderBy(classes.name),
        db.select({ id: users.id, displayName: users.displayName, status: users.status }).from(users).where(eq(users.role, "mentor")).orderBy(users.displayName),
        db.select({ id: users.id, displayName: users.displayName, username: users.username, email: users.email, phone: users.phone, status: users.status }).from(users).where(eq(users.role, "student")).orderBy(users.displayName),
        db.select().from(classEnrollments).where(eq(classEnrollments.status, "active")),
      ]);
      return json({
        classes: cls.map((c) => ({ ...c, studentIds: enroll.filter((e) => e.classId === c.id).map((e) => e.studentId) })),
        mentors, students: students.map((s) => ({ ...s, classIds: enroll.filter((e) => e.studentId === s.id).map((e) => e.classId) })),
      });
    }
    const b = await req.json().catch(() => ({}));
    const mentorOk = async (mid: unknown) => {
      const m = int(mid);
      if (!m) return null;
      const [row] = await db.select().from(users).where(and(eq(users.id, m), eq(users.role, "mentor"))).limit(1);
      return row ?? null;
    };
    if (method === "POST" && !classId) {
      const name = str(b.name, 120);
      if (!name) return json({ error: "Enter a class name." }, 400);
      const mentor = await mentorOk(b.mentorId);
      if (!mentor) return json({ error: "Choose the class mentor." }, 400);
      const [row] = await db.insert(classes).values({ name, description: str(b.description, 1000), mentorId: mentor.id }).returning();
      await audit(admin.id, "class.create", "class", row.id, { name, mentorId: mentor.id });
      await notify([mentor.id], { kind: "class", title: `You were assigned to the class “${name}”`, link: { view: "classes" } });
      return json(row, 201);
    }
    const [cls] = classId ? await db.select().from(classes).where(and(eq(classes.id, classId), isNull(classes.deletedAt))).limit(1) : [];
    if (!cls) return json({ error: "Class not found." }, 404);
    if (method === "PATCH" && !sub2) {
      const set: Partial<typeof classes.$inferInsert> = {};
      if (b.name !== undefined) { const n = str(b.name, 120); if (!n) return json({ error: "Enter a class name." }, 400); set.name = n; }
      if (b.description !== undefined) set.description = str(b.description, 1000);
      if (b.mentorId !== undefined) {
        const mentor = await mentorOk(b.mentorId);
        if (!mentor) return json({ error: "Choose a mentor account." }, 400);
        set.mentorId = mentor.id;
      }
      const [row] = await db.update(classes).set(set).where(eq(classes.id, cls.id)).returning();
      await audit(admin.id, "class.update", "class", cls.id, { ...set, previousMentorId: cls.mentorId });
      if (set.mentorId && set.mentorId !== cls.mentorId) {
        const members = (await db.select({ id: classEnrollments.studentId }).from(classEnrollments).where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.status, "active")))).map((r) => r.id);
        await notify([set.mentorId], { kind: "class", title: `You are now the mentor of “${row.name}”`, link: { view: "classes" } });
        await notify([cls.mentorId], { kind: "class", title: `“${row.name}” was reassigned to another mentor` });
        await notify(members, { kind: "class", title: `Your class “${row.name}” has a new mentor`, link: { view: "messages" } });
      }
      return json(row);
    }
    if (method === "POST" && sub2 === "members") {
      const studentId = int(b.studentId);
      const action = str(b.action, 20); // "add" | "transfer" | "remove"
      const [student] = studentId ? await db.select().from(users).where(and(eq(users.id, studentId), eq(users.role, "student"))).limit(1) : [];
      if (!student) return json({ error: "Student not found." }, 404);
      await snapshotStudents([student.id]);
      const now = new Date();
      if (action === "remove") {
        await db.update(classEnrollments).set({ status: "removed" }).where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.studentId, student.id), eq(classEnrollments.status, "active")));
        await audit(admin.id, "class.member_remove", "class", cls.id, { studentId: student.id });
        await notify([student.id], { kind: "class", title: `You were removed from “${cls.name}”` });
        return json({ ok: true });
      }
      if (action !== "add" && action !== "transfer") return json({ error: "Unsupported member action." }, 400);
      let from: number[] = [];
      if (action === "transfer") {
        const prev = await db.update(classEnrollments).set({ status: "removed" })
          .where(and(eq(classEnrollments.studentId, student.id), eq(classEnrollments.status, "active"), sql`${classEnrollments.classId} <> ${cls.id}`))
          .returning({ classId: classEnrollments.classId });
        from = prev.map((p) => p.classId);
      }
      const [existing] = await db.select().from(classEnrollments).where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.studentId, student.id))).limit(1);
      if (existing) { if (existing.status !== "active") await db.update(classEnrollments).set({ status: "active", joinedAt: now }).where(eq(classEnrollments.id, existing.id)); }
      else await db.insert(classEnrollments).values({ classId: cls.id, studentId: student.id });
      await audit(admin.id, action === "transfer" ? "class.member_transfer" : "class.member_add", "class", cls.id, { studentId: student.id, fromClassIds: from });
      await notify([student.id], { kind: "class", title: `You were added to the class “${cls.name}”`, link: { view: "classes" } });
      await notify([cls.mentorId], { kind: "class", title: `${nameOf(student)} joined “${cls.name}”`, link: { view: "students" } });
      return json({ ok: true, fromClassIds: from });
    }
    return json({ error: "Method not allowed." }, 405);
  }
  if (resource === "admin" && id === "limits") {
    const auth = await requireUser(req, ["admin"]);
    if (auth.error) return auth.error;
    const admin = auth.user!;
    if (method === "GET" && !sub) {
      const [platform, rows, plat] = await Promise.all([platformLimits(), db.select().from(usageLimits), readSetting("platform", DEFAULT_PLATFORM)]);
      const ids = rows.filter((r) => r.scope === "user").map((r) => r.targetId);
      const people = ids.length ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, ids)) : [];
      const cls = await db.select({ id: classes.id, name: classes.name }).from(classes).where(isNull(classes.deletedAt));
      return json({
        platform, timezone: validTz(plat.timezone) ? plat.timezone : "UTC", kinds: LIMIT_KINDS,
        classes: cls.map((c) => ({ ...c, limits: cleanLimits(rows.find((r) => r.scope === "class" && r.targetId === c.id)?.limits) })),
        users: rows.filter((r) => r.scope === "user").map((r) => ({ id: r.targetId, displayName: people.find((p) => p.id === r.targetId)?.displayName ?? `User #${r.targetId}`, limits: cleanLimits(r.limits) })),
      });
    }
    if (method === "GET" && sub === "user" && int(sub2)) {
      const target = int(sub2)!;
      const [row] = await db.select().from(usageLimits).where(and(eq(usageLimits.scope, "user"), eq(usageLimits.targetId, target)));
      return json({ overrides: cleanLimits(row?.limits), usage: await usageSummary(target) });
    }
    if (method === "PUT" && sub === "platform") {
      const b = await req.json().catch(() => ({}));
      const cur = await platformLimits();
      const next = { independent: { ...cur.independent, ...cleanLimits(b.independent) }, member: { ...cur.member, ...cleanLimits(b.member) } };
      await writeSetting("limits", next);
      if (b.timezone !== undefined) {
        if (!validTz(b.timezone)) return json({ error: "Enter a valid IANA timezone such as Asia/Tashkent or UTC." }, 400);
        await writeSetting("platform", { timezone: b.timezone });
        tzCache = null;
      }
      await audit(admin.id, "limits.platform", "settings", "limits", { ...next, timezone: b.timezone });
      return json({ ok: true, platform: next });
    }
    if ((method === "PUT" || method === "DELETE") && (sub === "user" || sub === "class") && int(sub2)) {
      const target = int(sub2)!;
      const exists = sub === "user"
        ? (await db.select({ id: users.id }).from(users).where(eq(users.id, target)).limit(1)).length
        : (await db.select({ id: classes.id }).from(classes).where(eq(classes.id, target)).limit(1)).length;
      if (!exists) return json({ error: sub === "user" ? "User not found." : "Class not found." }, 404);
      const b = method === "PUT" ? await req.json().catch(() => ({})) : {};
      const limits = cleanLimits((b as any).limits);
      if (method === "DELETE" || !Object.keys(limits).length) {
        await db.delete(usageLimits).where(and(eq(usageLimits.scope, sub), eq(usageLimits.targetId, target)));
        await audit(admin.id, `limits.${sub}.remove`, sub, target);
        return json({ ok: true, removed: true });
      }
      await db.insert(usageLimits).values({ scope: sub, targetId: target, limits, updatedBy: admin.id })
        .onConflictDoUpdate({ target: [usageLimits.scope, usageLimits.targetId], set: { limits, updatedBy: admin.id, updatedAt: new Date() } });
      await audit(admin.id, `limits.${sub}.set`, sub, target, limits);
      if (sub === "user") await notify([target], { kind: "account", title: "Your practice limits were updated", link: { view: "home" } });
      return json({ ok: true, limits });
    }
    return json({ error: "Method not allowed." }, 405);
  }
  return null;
}
