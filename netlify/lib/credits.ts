// netlify/lib/credits.ts — optional per-student practice credits.
//
// Credit mode is OFF for every student until the verified super admin turns
// it on for that individual. While it is off a student-facing response never
// carries a credit field, and practice follows the normal access rules with
// no credit checks or debits. Turning it off again releases any credits held
// for open sittings and keeps the stored account history.
//
// Rules while ON:
//   • 1 credit per accepted, non-blank submitted question attempt (correct or
//     not). An intentional retry is a new attempt and costs 1 more.
//   • Opening, typing, autosaving, skipping, navigating, reading, reviewing
//     and resuming cost nothing.
//   • The charge and the attempt row are written by ONE SQL statement keyed by
//     a unique attempt id (credit_apply locks the account row), so double
//     clicks, refreshes, retries or two tabs can never charge twice or go below
//     zero.
//   • Timed / batch-submitted modules (full mocks) hold the module's question
//     count when the module starts; at the module's submission boundary the
//     answered questions are charged once and the rest is released.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { attempts, classes, creditAccounts, creditHolds, creditLedger, testAttempts, users } from "../../db/schema.js";
import { isSuperAdmin } from "./access.js";
import type { FullTestDeps } from "./fulltests.js";

type DbUser = typeof users.$inferSelect;
type AttemptRow = typeof attempts.$inferSelect;
type AttemptValues = typeof attempts.$inferInsert;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const int = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const str = (v: unknown, max: number) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
export const COST_PER_QUESTION = 1;
const MAX_GRANT = 100_000;

export type CreditState = { enabled: boolean; balance: number; held: number; available: number };

export async function creditState(studentId: number): Promise<CreditState> {
  const [r] = rowsOf(await db.execute(sql`select a.enabled, a.balance,
      coalesce((select sum(h.amount) from credit_holds h where h.student_id = a.student_id and h.status = 'held'), 0)::int as held
    from credit_accounts a where a.student_id = ${studentId}`));
  if (!r) return { enabled: false, balance: 0, held: 0, available: 0 };
  const balance = Number(r.balance), held = Number(r.held);
  return { enabled: !!r.enabled, balance, held, available: Math.max(0, balance - held) };
}
export const creditOn = async (studentId: number) => (await creditState(studentId)).enabled;

// What a student may see: nothing at all while the mode is off.
export function studentCreditView(s: CreditState) {
  if (!s.enabled) return {};
  return { enabled: true, balance: s.balance, reserved: s.held, available: s.available, costPerQuestion: COST_PER_QUESTION };
}
// Receipt attached to a student response — undefined (so the key is omitted from JSON) while off.
export function receipt(s: CreditState | null, charged: number, duplicate = false) {
  if (!s?.enabled) return undefined;
  return { charged, duplicate, balance: s.balance, reserved: s.held, available: s.available };
}
export function outOfCredits(s: CreditState) {
  return {
    error: s.available <= 0
      ? "You have no credits left. Each submitted answer uses 1 credit — ask your administrator for more. Your past results and reviews stay available."
      : `This needs more credits than you have available (${s.available}). Ask your administrator for more.`,
    credits: studentCreditView(s), outOfCredits: true,
  };
}

// ── Charging one submitted attempt ──
// `key` is unique per submission (browser attempt id, or practice session +
// question). Returns the stored attempt for a repeated key without charging.
export type ChargeResult =
  | { status: "recorded" | "duplicate"; attempt: AttemptRow; charged: number; credit: CreditState | null }
  | { status: "insufficient"; credit: CreditState };

export async function recordChargedAttempt(studentId: number, values: AttemptValues & { clientKey: string }): Promise<ChargeResult> {
  const student = `u${studentId}`;
  const existing = async () => (await db.select().from(attempts).where(and(eq(attempts.student, student), eq(attempts.clientKey, values.clientKey))).limit(1))[0];
  const prev = await existing();
  const state = await creditState(studentId);
  if (prev) return { status: "duplicate", attempt: prev, charged: 0, credit: state.enabled ? state : null };
  const blank = !String(values.selected ?? "").trim();
  if (!state.enabled || blank) {
    // Mode off (or a blank / skipped answer, which never costs anything).
    const [row] = await db.insert(attempts).values({ ...values, student }).onConflictDoNothing().returning();
    if (!row) return { status: "duplicate", attempt: (await existing())!, charged: 0, credit: state.enabled ? state : null };
    return { status: "recorded", attempt: row, charged: 0, credit: state.enabled ? state : null };
  }
  if (state.available < COST_PER_QUESTION) return { status: "insufficient", credit: state };
  const ckey = `att:${studentId}:${values.clientKey}`;
  // One statement: the debit (account row locked inside credit_apply) and the
  // attempt row commit or roll back together.
  const res = rowsOf(await db.execute(sql`with c as (
      select * from credit_apply(${studentId}, ${ckey}, ${-COST_PER_QUESTION}, 'debit', ${"Answer · " + String(values.mode ?? "")}, null, null, null, ${values.clientKey})
    ), ins as (
      insert into attempts (student, question_id, section, category, difficulty, mode, selected, correct, client_key)
      select ${student}, ${values.questionId}, ${values.section}, ${values.category}, ${values.difficulty ?? 3}, ${values.mode ?? "bank"}, ${values.selected ?? ""}, ${!!values.correct}, ${values.clientKey}
      from c where c.ok and not c.duplicate
      on conflict (student, client_key) do nothing
      returning id
    )
    select c.ok, c.duplicate, c.balance, c.available, c.error, (select id from ins) as attempt_id from c`));
  const r = res[0];
  const after = await creditState(studentId);
  if (!r?.ok) {
    if (r?.error === "disabled") {
      // Switched off between the two reads: record without charging.
      const [row] = await db.insert(attempts).values({ ...values, student }).onConflictDoNothing().returning();
      return { status: row ? "recorded" : "duplicate", attempt: row ?? (await existing())!, charged: 0, credit: null };
    }
    return { status: "insufficient", credit: after };
  }
  if (r.duplicate || !r.attempt_id) return { status: "duplicate", attempt: (await existing())!, charged: 0, credit: after };
  await db.update(creditLedger).set({ attemptId: Number(r.attempt_id) }).where(eq(creditLedger.key, ckey)).catch(() => {});
  const [row] = await db.select().from(attempts).where(eq(attempts.id, Number(r.attempt_id))).limit(1);
  return { status: "recorded", attempt: row, charged: COST_PER_QUESTION, credit: after };
}

// A charge with no attempt row (scored Library comprehension answers).
export async function chargeOnce(studentId: number, key: string, reason: string, ref: string) {
  const state = await creditState(studentId);
  if (!state.enabled) return { ok: true, charged: 0, duplicate: false, credit: null as CreditState | null };
  const [r] = rowsOf(await db.execute(sql`select * from credit_apply(${studentId}, ${key}, ${-COST_PER_QUESTION}, 'debit', ${reason}, null, null, null, ${ref})`));
  const after = await creditState(studentId);
  if (!r?.ok) return { ok: r?.error === "disabled", charged: 0, duplicate: false, credit: r?.error === "disabled" ? null : after };
  return { ok: true, charged: r.duplicate ? 0 : COST_PER_QUESTION, duplicate: !!r.duplicate, credit: after };
}

// ── Full mocks: one hold per module of a sitting ──
const holdKey = (attemptId: number, moduleIndex: number) => `ta:${attemptId}:m${moduleIndex}`;
type TestAttemptRow = typeof testAttempts.$inferSelect;
type ModuleLike = { id: number };

// Before a sitting starts: is there room for its first module?
export async function canStartModule(studentId: number, questionCount: number) {
  const s = await creditState(studentId);
  if (!s.enabled || questionCount <= 0) return { ok: true as const, state: s };
  return s.available >= questionCount ? { ok: true as const, state: s } : { ok: false as const, state: s };
}

// Idempotent: settle every module the sitting has left (answered questions
// once, the rest released) and hold the module it is on. Safe to call on any
// read; a sitting whose student has the mode off only releases old holds.
export async function syncTestCredits(attempt: TestAttemptRow, mods: ModuleLike[], questionIdsOf: (moduleId: number) => Promise<number[]>) {
  const held = await db.select().from(creditHolds).where(and(eq(creditHolds.studentId, attempt.studentId), sql`${creditHolds.key} like ${`ta:${attempt.id}:m%`}`));
  const state = await creditState(attempt.studentId);
  if (!state.enabled && !held.some((h) => h.status === "held")) return;
  const answers = (attempt.answers || {}) as Record<string, string>;
  const done = !!attempt.submittedAt;
  for (let i = 0; i < mods.length; i++) {
    const key = holdKey(attempt.id, i);
    const h = held.find((x) => x.key === key);
    const leaving = done || i < attempt.moduleIndex;
    if (leaving) {
      if (h && h.status === "held") {
        const ids = await questionIdsOf(mods[i].id);
        const answered = state.enabled ? ids.filter((id) => String(answers[String(id)] ?? "").trim()).length : 0;
        await db.execute(sql`select * from credit_settle(${key}, ${answered * COST_PER_QUESTION}, ${`Full mock module ${i + 1}: ${answered} of ${ids.length} answered`})`);
      }
    } else if (i === attempt.moduleIndex && state.enabled && !h) {
      const ids = await questionIdsOf(mods[i].id);
      if (ids.length) await db.execute(sql`select * from credit_hold(${attempt.studentId}, ${key}, ${ids.length * COST_PER_QUESTION}, ${`ta:${attempt.id}`}, false)`);
    }
  }
}
// Credits held for one sitting (shown before / during the module).
export async function testHoldView(attemptId: number, studentId: number) {
  const s = await creditState(studentId);
  if (!s.enabled) return undefined;
  const rows = await db.select().from(creditHolds).where(sql`${creditHolds.key} like ${`ta:${attemptId}:m%`}`);
  return {
    ...studentCreditView(s),
    holds: rows.map((h) => ({ module: Number(h.key.split(":m")[1]) + 1, amount: h.amount, charged: h.charged, status: h.status })),
  };
}
// Release every open hold (mode switched off). Answers are untouched.
export async function releaseAllHolds(studentId: number) {
  const open = await db.select({ key: creditHolds.key }).from(creditHolds).where(and(eq(creditHolds.studentId, studentId), eq(creditHolds.status, "held")));
  for (const h of open) await db.execute(sql`select * from credit_settle(${h.key}, 0, 'Released: credit mode switched off')`);
  return open.length;
}

// ── Routes ──
//   GET  /api/credits                              student: own balance ({} while off)
//   GET  /api/admin/credits                        super admin: every student's mode & balance
//   GET  /api/admin/credits/:studentId             super admin: account + ledger
//   POST /api/admin/credits/:studentId/mode        { enabled }
//   POST /api/admin/credits/:studentId/adjust      { kind: grant|topup|correction, amount | target, reason, key }
//   POST /api/admin/credits/class-grant/preview    { classId, amount }
//   POST /api/admin/credits/class-grant            { classId, amount, reason, batchId, includeOff }
export async function handleCredits(req: Request, parts: string[], deps: FullTestDeps & { onModeOff?: (studentId: number) => Promise<void> }): Promise<Response | null> {
  const { json, requireUser } = deps;
  const method = req.method;
  if (parts[0] === "credits" && !parts[1] && method === "GET") {
    const auth = await requireUser(req, ["student", "mentor", "admin"]);
    if (auth.error) return auth.error;
    if (auth.user!.role !== "student") return json({});
    const s = await creditState(auth.user!.id);
    if (!s.enabled) return json({});
    const recent = await db.select({ delta: creditLedger.delta, kind: creditLedger.kind, reason: creditLedger.reason, balanceAfter: creditLedger.balanceAfter, createdAt: creditLedger.createdAt })
      .from(creditLedger).where(eq(creditLedger.studentId, auth.user!.id)).orderBy(desc(creditLedger.id)).limit(15);
    return json({ ...studentCreditView(s), recent });
  }
  if (parts[0] !== "admin" || parts[1] !== "credits") return null;
  const auth = await requireUser(req, ["admin"]);
  if (auth.error) return auth.error;
  const admin = auth.user!;
  // Server-verified super admin only — the browser's role flag is never trusted.
  if (!isSuperAdmin(admin)) return json({ error: "Only the super admin can manage student credits." }, 403);
  const body = method === "POST" ? await req.json().catch(() => ({})) : {};
  const [, , a, b] = parts;

  if (!a && method === "GET") {
    const rows = rowsOf(await db.execute(sql`select u.id, u.display_name, u.username, u.email, u.status,
        coalesce(c.enabled, false) as enabled, coalesce(c.balance, 0)::int as balance,
        coalesce((select sum(h.amount) from credit_holds h where h.student_id = u.id and h.status = 'held'), 0)::int as held
      from users u left join credit_accounts c on c.student_id = u.id
      where u.role = 'student' and u.status <> 'deleted' order by u.display_name`));
    return json(rows.map((r) => ({ id: r.id, displayName: r.display_name, username: r.username, email: r.email, status: r.status, enabled: !!r.enabled, balance: r.balance, reserved: r.held })));
  }

  if (a === "class-grant") {
    const classId = int(body.classId);
    const amount = Math.floor(Number(body.amount));
    if (!classId) return json({ error: "Choose a class." }, 400);
    if (!Number.isInteger(amount) || amount <= 0 || amount > MAX_GRANT) return json({ error: `Enter a whole number of credits between 1 and ${MAX_GRANT}.` }, 400);
    const [cls] = await db.select({ id: classes.id, name: classes.name }).from(classes).where(eq(classes.id, classId)).limit(1);
    if (!cls) return json({ error: "Class not found." }, 404);
    const members = rowsOf(await db.execute(sql`select u.id, u.display_name, u.username, coalesce(c.enabled, false) as enabled
      from class_enrollments e join users u on u.id = e.student_id left join credit_accounts c on c.student_id = u.id
      where e.class_id = ${classId} and e.status = 'active' and u.role = 'student' and u.status = 'active' order by u.display_name`));
    const off = members.filter((m) => !m.enabled).map((m) => ({ id: m.id, displayName: m.display_name, username: m.username }));
    const includeOff = body.includeOff === true;
    const recipients = includeOff ? members : members.filter((m) => m.enabled);
    if (b === "preview") {
      return json({ classId, className: cls.name, members: members.length, recipients: recipients.length, amountPerStudent: amount, total: recipients.length * amount, modeOff: off, includeOff });
    }
    const batchId = str(body.batchId, 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(batchId)) return json({ error: "Missing grant batch id. Reopen the grant dialog and try again." }, 400);
    const reason = str(body.reason, 300) || `Class grant · ${cls.name}`;
    let granted = 0, repeated = 0;
    for (const m of recipients) {
      // Same batch + recipient = same key: a retried batch grants each student once.
      const [r] = rowsOf(await db.execute(sql`select * from credit_apply(${Number(m.id)}, ${`grant:${batchId}:${m.id}`}, ${amount}, 'grant', ${reason}, ${admin.id}, ${batchId}, null, ${`class:${classId}`})`));
      if (r?.duplicate) repeated++; else if (r?.ok) granted++;
    }
    return json({ batchId, granted, alreadyGranted: repeated, recipients: recipients.length, amountPerStudent: amount, total: granted * amount });
  }

  const studentId = int(a);
  if (!studentId) return json({ error: "Not found." }, 404);
  const [student] = await db.select().from(users).where(and(eq(users.id, studentId), eq(users.role, "student"))).limit(1);
  if (!student) return json({ error: "Student not found." }, 404);

  if (!b && method === "GET") {
    const s = await creditState(studentId);
    const [acc] = await db.select().from(creditAccounts).where(eq(creditAccounts.studentId, studentId)).limit(1);
    const ledger = rowsOf(await db.execute(sql`select l.id, l.delta, l.balance_after, l.kind, l.reason, l.batch_id, l.attempt_id, l.ref, l.created_at, u.display_name as actor
      from credit_ledger l left join users u on u.id = l.actor_id where l.student_id = ${studentId} order by l.id desc limit 200`));
    const holds = await db.select().from(creditHolds).where(eq(creditHolds.studentId, studentId)).orderBy(desc(creditHolds.id)).limit(50);
    return json({
      student: { id: student.id, displayName: student.displayName, username: student.username },
      enabled: s.enabled, balance: s.balance, reserved: s.held, available: s.available,
      enabledAt: acc?.enabledAt ?? null,
      ledger: ledger.map((l) => ({ id: l.id, delta: l.delta, balanceAfter: l.balance_after, kind: l.kind, reason: l.reason, batchId: l.batch_id, attemptId: l.attempt_id, ref: l.ref, createdAt: l.created_at, actor: l.actor })),
      holds,
    });
  }
  if (b === "mode" && method === "POST") {
    const enabled = body.enabled === true;
    await db.insert(creditAccounts).values({ studentId }).onConflictDoNothing();
    await db.update(creditAccounts).set({ enabled, updatedAt: new Date(), ...(enabled ? { enabledBy: admin.id, enabledAt: new Date() } : {}) }).where(eq(creditAccounts.studentId, studentId));
    let released = 0;
    if (!enabled) released = await releaseAllHolds(studentId);
    await db.execute(sql`insert into audit_log (actor_id, action, target_type, target_id, details) values (${admin.id}, ${enabled ? "credits.enable" : "credits.disable"}, 'user', ${String(studentId)}, ${JSON.stringify({ released })}::jsonb)`).catch(() => {});
    const s = await creditState(studentId);
    return json({ enabled: s.enabled, balance: s.balance, reserved: s.held, available: s.available, released });
  }
  if (b === "adjust" && method === "POST") {
    const kind = ["grant", "topup", "correction"].includes(body.kind) ? body.kind : null;
    if (!kind) return json({ error: "Choose grant, top-up or correction." }, 400);
    const reason = str(body.reason, 300);
    if (!reason) return json({ error: "Enter a reason — it is stored with the change." }, 400);
    const key = str(body.key, 80);
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(key)) return json({ error: "Missing request id. Try again." }, 400);
    let delta = 0, target: number | null = null;
    if (kind === "correction") {
      target = Math.floor(Number(body.target));
      if (!Number.isInteger(target) || target < 0 || target > MAX_GRANT * 10) return json({ error: "Enter the corrected balance (0 or more)." }, 400);
    } else {
      delta = Math.floor(Number(body.amount));
      if (!Number.isInteger(delta) || delta <= 0 || delta > MAX_GRANT) return json({ error: `Enter a whole number of credits between 1 and ${MAX_GRANT}.` }, 400);
    }
    // Never changes the mode: a grant to a student with the mode off stays invisible to them.
    const [r] = rowsOf(await db.execute(sql`select * from credit_apply(${studentId}, ${`adm:${key}`}, ${delta}, ${kind}, ${reason}, ${admin.id}, null, null, '', ${target})`));
    const s = await creditState(studentId);
    return json({ ok: !!r?.ok, duplicate: !!r?.duplicate, delta: r?.delta ?? 0, enabled: s.enabled, balance: s.balance, reserved: s.held, available: s.available });
  }
  return json({ error: "Not found." }, 404);
}
