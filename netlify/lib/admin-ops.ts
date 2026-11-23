// netlify/lib/admin-ops.ts — destructive admin operations, made safe:
//   • question deletion (single and bulk): unused bank questions are removed,
//     referenced ones are retired (kept for review, hidden from selection);
//   • removing student / mentor / admin accounts (deactivate, remove the
//     mentor role, or permanently delete personal data);
//   • deleting classes (transfer or remove students, archive class content).
// Every route re-checks the admin role on the server, every step is
// idempotent so a retried request never does double work, and every outcome
// is written to the audit log.
import { and, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { admin as identityAdmin } from "@netlify/identity";
import { db } from "../../db/index.js";
import {
  questions, assignments, savedQuestions, users, sessions, classes, classEnrollments, classInvites,
  mentorActivationCodes, notifications, messages, testAssignments, testHighlights, usageLimits, lessons,
  lessonComments, learningUnits, learningPlacements, vocabTasks, auditLog,
} from "../../db/schema.js";
import { BANK, type FullTestDeps } from "./fulltests.js";
import { notify } from "./platform.js";

export const RETIRED = "RETIRED";
// Largest batch one request may carry; the browser splits bigger selections.
export const QUESTION_BATCH_MAX = 250;
const PREVIEW_MAX = 20000;

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const int = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const str = (v: unknown, max = 400) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
const idList = (raw: unknown, max: number) =>
  Array.from(new Set((Array.isArray(raw) ? raw : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))).slice(0, max);
const inList = (ids: number[]) => sql.join(ids.map((i) => sql`${i}`), sql`, `);

async function writeAudit(actorId: number, action: string, targetType: string, targetId: unknown, details: Record<string, unknown>) {
  await db.insert(auditLog).values({ actorId, action, targetType, targetId: String(targetId ?? ""), details });
}

// ═══════════════════════ QUESTIONS ═══════════════════════
type Usage = "publishedMocks" | "draftTests" | "tasks" | "attempts" | "lessons" | "reports";
export type QuestionPlan = {
  requested: number;
  remove: number[];
  retire: number[];
  skipped: { id: number; reason: string }[];
  usage: Record<Usage, number[]>;
};

// Decide, for each requested id, whether it can be removed outright, has to be
// retired because existing work points at it, or is skipped. Re-run at
// execution time so a retry reflects whatever an earlier attempt already did.
export async function planQuestionDeletion(ids: number[]): Promise<QuestionPlan> {
  const usage: Record<Usage, number[]> = { publishedMocks: [], draftTests: [], tasks: [], attempts: [], lessons: [], reports: [] };
  const plan: QuestionPlan = { requested: ids.length, remove: [], retire: [], skipped: [], usage };
  if (!ids.length) return plan;
  const rows = await db.select({ id: questions.id, scope: questions.scope }).from(questions).where(inArray(questions.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  const bank: number[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) plan.skipped.push({ id, reason: "already deleted" });
    else if (row.scope === RETIRED) plan.skipped.push({ id, reason: "already retired" });
    else if (row.scope !== BANK) plan.skipped.push({ id, reason: "not a question-bank item" });
    else bank.push(id);
  }
  if (!bank.length) return plan;
  const list = inList(bank);
  const [direct, snap, tasks, att, les, rep] = await Promise.all([
    // Legacy modules hold the bank row itself.
    db.execute(sql`select distinct tmq.question_id as id, t.status from test_module_questions tmq
      join test_modules m on m.id = tmq.module_id join tests t on t.id = m.test_id where tmq.question_id in (${list})`),
    // Newer modules hold a snapshot pointing back at the bank row.
    db.execute(sql`select distinct q.source_question_id as id from questions q
      join test_module_questions tmq on tmq.question_id = q.id join test_modules m on m.id = tmq.module_id
      join tests t on t.id = m.test_id where t.status = 'published' and q.source_question_id in (${list})`),
    db.execute(sql`select distinct (e.value)::int as id from assignments a, jsonb_array_elements_text(a.question_ids) e
      where (e.value)::int in (${list})`),
    db.execute(sql`select distinct question_id as id from attempts where question_id in (${list})`),
    db.execute(sql`select distinct (e.value)::int as id from lessons l, jsonb_array_elements_text(l.practice_question_ids) e
      where (e.value)::int in (${list})`),
    db.execute(sql`select distinct question_id as id from question_reports where question_id in (${list})`),
  ]);
  const add = (key: Usage, r: any[]) => { usage[key] = Array.from(new Set(r.map((x) => Number(x.id)))); };
  add("publishedMocks", [...rowsOf(direct).filter((r) => r.status === "published"), ...rowsOf(snap)]);
  add("draftTests", rowsOf(direct).filter((r) => r.status !== "published"));
  add("tasks", rowsOf(tasks));
  add("attempts", rowsOf(att));
  add("lessons", rowsOf(les));
  add("reports", rowsOf(rep));
  const referenced = new Set(Object.values(usage).flat());
  for (const id of bank) (referenced.has(id) ? plan.retire : plan.remove).push(id);
  return plan;
}

export async function executeQuestionDeletion(plan: QuestionPlan, actorId: number) {
  const now = new Date();
  let removed: number[] = [];
  let retired: number[] = [];
  await db.transaction(async (tx) => {
    if (plan.remove.length) {
      await tx.delete(savedQuestions).where(inArray(savedQuestions.questionId, plan.remove));
      // Guard on scope so a question that became referenced in the meantime is never removed.
      removed = (await tx.delete(questions).where(and(inArray(questions.id, plan.remove), eq(questions.scope, BANK)))
        .returning({ id: questions.id })).map((r) => r.id);
    }
    if (plan.retire.length) {
      retired = (await tx.update(questions).set({ scope: RETIRED, retiredAt: now, retiredBy: actorId })
        .where(and(inArray(questions.id, plan.retire), eq(questions.scope, BANK)))
        .returning({ id: questions.id })).map((r) => r.id);
    }
  });
  const skipped = [
    ...plan.skipped,
    ...plan.remove.filter((id) => !removed.includes(id)).map((id) => ({ id, reason: "changed during deletion" })),
    ...plan.retire.filter((id) => !retired.includes(id)).map((id) => ({ id, reason: "changed during deletion" })),
  ];
  return { deleted: removed, retired, skipped };
}

const usageCounts = (plan: QuestionPlan) =>
  Object.fromEntries(Object.entries(plan.usage).map(([k, v]) => [k, v.length])) as Record<Usage, number>;

// ═══════════════════════ USERS ═══════════════════════
const loginOf = (u: typeof users.$inferSelect) => u.email || u.username || u.phone || "";

async function activeAdminsExcept(userId: number) {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(users)
    .where(and(eq(users.role, "admin"), eq(users.status, "active"), ne(users.id, userId)));
  return row?.n ?? 0;
}

async function userImpact(target: typeof users.$inferSelect, actorId: number) {
  const key = `u${target.id}`;
  const [owned, memberships, counts] = await Promise.all([
    db.select().from(classes).where(and(eq(classes.mentorId, target.id), isNull(classes.deletedAt))),
    db.select({ id: classes.id, name: classes.name, mentorId: classes.mentorId }).from(classEnrollments)
      .innerJoin(classes, eq(classEnrollments.classId, classes.id))
      .where(and(eq(classEnrollments.studentId, target.id), eq(classEnrollments.status, "active"), isNull(classes.deletedAt))),
    db.execute(sql`select
      (select count(*)::int from attempts where student = ${key}) as attempts,
      (select count(*)::int from test_attempts where student_id = ${target.id}) as test_sittings,
      (select count(*)::int from test_attempts where student_id = ${target.id} and submitted_at is not null) as tests_submitted,
      (select count(*)::int from lesson_progress where student_id = ${target.id}) as lesson_progress,
      (select count(*)::int from skill_evidence where student_id = ${target.id}) as skill_evidence,
      (select count(*)::int from saved_questions where student_id = ${target.id}) as saved,
      (select count(*)::int from messages where sender_id = ${target.id} or recipient_id = ${target.id}) as messages,
      (select count(*)::int from notifications where user_id = ${target.id}) as notifications,
      (select count(*)::int from badge_awards where student_id = ${target.id}) as badges,
      (select count(*)::int from question_reports where reporter_id = ${target.id}) as reports,
      (select count(*)::int from lesson_comments where author_id = ${target.id}) as comments,
      (select count(*)::int from sessions where user_id = ${target.id}) as sessions,
      (select count(*)::int from assignments where mentor_id = ${target.id}) as tasks_authored,
      (select count(*)::int from lessons where created_by = ${target.id}) as lessons_authored`),
  ]);
  const c = rowsOf(counts)[0] || {};
  const mentorIds: number[] = Array.from(new Set(memberships.map((m: { mentorId: number }) => m.mentorId)));
  const mentorRows = mentorIds.length ? await db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, mentorIds)) : [];
  const ownedDetail = [];
  for (const cls of owned) {
    const studs = await db.select({ id: users.id, displayName: users.displayName }).from(classEnrollments)
      .innerJoin(users, eq(classEnrollments.studentId, users.id))
      .where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.status, "active")));
    ownedDetail.push({ id: cls.id, name: cls.name, students: studs });
  }
  const otherMentors = await db.select({ id: users.id, displayName: users.displayName, status: users.status }).from(users)
    .where(and(eq(users.role, "mentor"), eq(users.status, "active"), ne(users.id, target.id)));
  const isAdmin = target.role === "admin";
  return {
    user: { id: target.id, displayName: target.displayName, role: target.role, status: target.status, login: loginOf(target), provider: target.provider },
    isSelf: target.id === actorId,
    isLastActiveAdmin: isAdmin && target.status === "active" && (await activeAdminsExcept(target.id)) === 0,
    classesAsStudent: memberships.map((m: { id: number; name: string; mentorId: number }) => ({ id: m.id, name: m.name, mentorName: mentorRows.find((r) => r.id === m.mentorId)?.displayName || "Mentor" })),
    classesAsMentor: ownedDetail,
    // A mentor with their own practice history or memberships also has a student side.
    hasStudentHistory: target.role === "mentor" && (memberships.length > 0 || (c.attempts ?? 0) > 0 || (c.test_sittings ?? 0) > 0),
    otherMentors,
    counts: {
      attempts: c.attempts ?? 0, testSittings: c.test_sittings ?? 0, testsSubmitted: c.tests_submitted ?? 0,
      lessonProgress: c.lesson_progress ?? 0, skillEvidence: c.skill_evidence ?? 0, saved: c.saved ?? 0,
      messages: c.messages ?? 0, notifications: c.notifications ?? 0, badges: c.badges ?? 0, reports: c.reports ?? 0,
      comments: c.comments ?? 0, sessions: c.sessions ?? 0, tasksAuthored: c.tasks_authored ?? 0, lessonsAuthored: c.lessons_authored ?? 0,
    },
    retention: {
      deactivate: [
        "Sign-in is blocked and every active session ends immediately.",
        "Any active class memberships end, so the account disappears from class rosters.",
        "Scores, test sittings, lesson progress, mastery evidence and messages are kept unchanged, so the account can be restored by an admin later.",
      ],
      delete: [
        "Name, login (email / username / phone), password, avatar, linked sign-in identity and preferences are erased permanently.",
        "Messages, notifications, saved questions, personal highlights, lesson comments and pending activation codes are deleted.",
        "Practice answers, test sittings and score reports, lesson progress, mastery evidence and badges are kept but anonymised (shown as “Deleted user”), so class and question statistics stay correct.",
        "Question reports they filed are kept for the content team, without their identity.",
        "This cannot be undone.",
      ],
    },
  };
}

// Move every class a mentor owns to the chosen replacement mentors.
async function applyTransfers(tx: any, mentorId: number, transfers: Record<string, unknown>) {
  const owned = await tx.select().from(classes).where(and(eq(classes.mentorId, mentorId), isNull(classes.deletedAt)));
  const moved: { classId: number; name: string; toMentorId: number }[] = [];
  for (const cls of owned) {
    const to = int(transfers[String(cls.id)]);
    if (!to) throw new UserFacing(`Choose a new mentor for “${cls.name}” before removing this account.`, 400);
    if (to === mentorId) throw new UserFacing(`“${cls.name}” must move to a different mentor.`, 400);
    const [next] = await tx.select().from(users).where(and(eq(users.id, to), eq(users.role, "mentor"), eq(users.status, "active"))).limit(1);
    if (!next) throw new UserFacing(`The mentor chosen for “${cls.name}” is not an active mentor account.`, 400);
    await tx.update(classes).set({ mentorId: to }).where(eq(classes.id, cls.id));
    await tx.update(assignments).set({ mentorId: to }).where(and(eq(assignments.classId, cls.id), eq(assignments.mentorId, mentorId)));
    moved.push({ classId: cls.id, name: cls.name, toMentorId: to });
  }
  return moved;
}

class DryRun extends Error {}
class UserFacing extends Error { constructor(message: string, public status = 400) { super(message); } }

// Remove a linked Netlify Identity login. "Not found" counts as done so a
// retried request after a partial failure goes straight through.
async function deleteIdentityLogin(u: typeof users.$inferSelect) {
  if (u.provider !== "netlify" || !u.providerId) return "not linked";
  try { await identityAdmin.deleteUser(u.providerId); return "deleted"; }
  catch (e) {
    const msg = String((e as Error)?.message || e);
    if (/not\s*found|404/i.test(msg)) return "already removed";
    throw new UserFacing("The linked sign-in identity could not be removed right now. Nothing else was changed for this step — retry in a moment.", 502);
  }
}

async function removeUser(actor: typeof users.$inferSelect, target: typeof users.$inferSelect, b: any) {
  const mode = str(b.mode, 30) as "deactivate" | "delete" | "remove_mentor_role";
  if (!["deactivate", "delete", "remove_mentor_role"].includes(mode)) throw new UserFacing("Choose what to do with this account.");
  if (target.id === actor.id) throw new UserFacing("You cannot remove your own account.", 400);
  if (target.status === "deleted") return { ok: true, alreadyDone: true, mode, message: "This account was already permanently deleted." };
  if (target.role === "admin" && mode !== "remove_mentor_role" && target.status === "active" && (await activeAdminsExcept(target.id)) === 0)
    throw new UserFacing("This is the last active admin. Promote another admin before removing it.", 409);
  if (mode === "remove_mentor_role" && target.role !== "mentor") throw new UserFacing("Only mentor accounts have a mentor role to remove.");
  if (mode === "delete" && str(b.confirm, 200) !== target.displayName)
    throw new UserFacing("Type the account's exact name to confirm permanent deletion.");
  if (mode === "deactivate" && target.status === "deactivated" && target.role !== "mentor")
    return { ok: true, alreadyDone: true, mode, message: "This account is already deactivated." };
  const transfers = (b.transfers && typeof b.transfers === "object") ? b.transfers : {};
  const now = new Date();

  // Validate everything that can be refused before changing anything, so a
  // refused request leaves the account exactly as it was.
  if (target.role === "mentor") await db.transaction(async (tx) => {
    await applyTransfers(tx, target.id, transfers);
    throw new DryRun();
  }).catch((e) => { if (!(e instanceof DryRun)) throw e; });

  // Step 1 — access goes first, so the account is locked out even if a later step fails.
  if (mode !== "remove_mentor_role") {
    await db.delete(sessions).where(eq(sessions.userId, target.id));
  }

  // Step 2 — the external identity (permanent delete only), before any data is erased.
  let identity = "unchanged";
  if (mode === "delete") identity = await deleteIdentityLogin(target);

  // Step 3 — the database changes, all or nothing.
  const result = await db.transaction(async (tx) => {
    const moved = target.role === "mentor" ? await applyTransfers(tx, target.id, transfers) : [];
    if (mode === "remove_mentor_role") {
      await tx.update(users).set({ role: "student", status: "active", approvedAt: target.approvedAt, bannedAt: null }).where(eq(users.id, target.id));
      await tx.delete(mentorActivationCodes).where(and(eq(mentorActivationCodes.mentorId, target.id), isNull(mentorActivationCodes.usedAt)));
      await tx.delete(sessions).where(eq(sessions.userId, target.id)); // pick up the new role on next sign-in
      return { moved, endedMemberships: 0 };
    }
    const ended = await tx.update(classEnrollments).set({ status: "removed" })
      .where(and(eq(classEnrollments.studentId, target.id), eq(classEnrollments.status, "active")))
      .returning({ classId: classEnrollments.classId });
    if (mode === "deactivate") {
      await tx.update(users).set({ status: "deactivated", deactivatedAt: now }).where(eq(users.id, target.id));
      return { moved, endedMemberships: ended.length };
    }
    // Permanent deletion: erase personal data, keep an anonymous tombstone.
    await tx.delete(savedQuestions).where(eq(savedQuestions.studentId, target.id));
    await tx.delete(notifications).where(eq(notifications.userId, target.id));
    await tx.delete(messages).where(or(eq(messages.senderId, target.id), eq(messages.recipientId, target.id)));
    await tx.delete(testHighlights).where(eq(testHighlights.studentId, target.id));
    await tx.delete(mentorActivationCodes).where(eq(mentorActivationCodes.mentorId, target.id));
    await tx.delete(usageLimits).where(and(eq(usageLimits.scope, "user"), eq(usageLimits.targetId, target.id)));
    const theirComments = (await tx.select({ id: lessonComments.id }).from(lessonComments).where(eq(lessonComments.authorId, target.id))).map((r) => r.id);
    if (theirComments.length) {
      await tx.delete(lessonComments).where(inArray(lessonComments.parentId, theirComments));
      await tx.delete(lessonComments).where(inArray(lessonComments.id, theirComments));
    }
    await tx.update(users).set({
      username: null, email: null, phone: null, passwordHash: null, providerId: null, avatarUrl: null,
      displayName: `Deleted user #${target.id}`, preferences: {}, role: "deleted", status: "deleted",
      deletedAt: now, deactivatedAt: target.deactivatedAt ?? now, mustChangePassword: false,
    }).where(eq(users.id, target.id));
    await tx.delete(sessions).where(eq(sessions.userId, target.id));
    return { moved, endedMemberships: ended.length };
  });

  const action = mode === "delete" ? "user.delete_permanent" : mode === "deactivate" ? "user.deactivate" : "user.remove_mentor_role";
  await writeAudit(actor.id, action, "user", target.id, {
    role: target.role, name: mode === "delete" ? undefined : target.displayName,
    transferredClasses: result.moved, endedMemberships: result.endedMemberships, identity, outcome: "completed",
  });
  for (const m of result.moved) {
    await notify([m.toMentorId], { kind: "class", title: `You are now the mentor of “${m.name}”`, link: { view: "classes" } });
  }
  return { ok: true, mode, ...result, identity };
}

// ═══════════════════════ CLASSES ═══════════════════════
async function classImpact(cls: typeof classes.$inferSelect) {
  const [mentor] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, cls.mentorId));
  const members = await db.select({ id: users.id, displayName: users.displayName }).from(classEnrollments)
    .innerJoin(users, eq(classEnrollments.studentId, users.id))
    .where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.status, "active")));
  const memberIds = members.map((m) => m.id);
  const otherEnroll = memberIds.length ? await db.select({ studentId: classEnrollments.studentId, classId: classes.id, name: classes.name })
    .from(classEnrollments).innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(inArray(classEnrollments.studentId, memberIds), eq(classEnrollments.status, "active"), ne(classes.id, cls.id), isNull(classes.deletedAt))) : [];
  const tasks = await db.select({ id: assignments.id, title: assignments.title }).from(assignments).where(eq(assignments.classId, cls.id));
  const [examRows, vocabRows] = await Promise.all([
    db.select({ id: testAssignments.id, title: testAssignments.title }).from(testAssignments).where(sql`${testAssignments.classIds} @> ${JSON.stringify([cls.id])}::jsonb`),
    db.select({ id: vocabTasks.id, title: vocabTasks.title }).from(vocabTasks).where(sql`${vocabTasks.classIds} @> ${JSON.stringify([cls.id])}::jsonb`),
  ]);
  const units = await db.select().from(learningUnits).where(eq(learningUnits.classId, cls.id));
  const placements = await db.select().from(learningPlacements).where(eq(learningPlacements.classId, cls.id));
  const lessonIds = Array.from(new Set(placements.map((p) => p.lessonId)));
  const owned = await db.select({ id: lessons.id }).from(lessons).where(eq(lessons.ownerClassId, cls.id));
  const allIds = Array.from(new Set([...lessonIds, ...owned.map((o) => o.id)]));
  const lessonRows = allIds.length ? await db.select().from(lessons).where(inArray(lessons.id, allIds)) : [];
  const elsewhere = allIds.length ? await db.select({ lessonId: learningPlacements.lessonId, classId: learningPlacements.classId, name: classes.name })
    .from(learningPlacements).innerJoin(classes, eq(learningPlacements.classId, classes.id))
    .where(and(inArray(learningPlacements.lessonId, allIds), ne(learningPlacements.classId, cls.id), ne(learningPlacements.status, "archived"), isNull(classes.deletedAt))) : [];
  const archive: { id: number; title: string }[] = [];
  const preserve: { id: number; title: string; usedBy: string[] }[] = [];
  for (const l of lessonRows) {
    const usedBy = Array.from(new Set(elsewhere.filter((e) => e.lessonId === l.id).map((e) => e.name)));
    // Shared lessons (other classes or the public library) stay; class-only content is archived.
    if (usedBy.length || (l.visibility === "public" && l.ownerClassId !== cls.id)) preserve.push({ id: l.id, title: l.title, usedBy: usedBy.length ? usedBy : ["Online Lessons library"] });
    else archive.push({ id: l.id, title: l.title });
  }
  const otherClasses = await db.select({ id: classes.id, name: classes.name }).from(classes).where(and(ne(classes.id, cls.id), isNull(classes.deletedAt)));
  return {
    class: { id: cls.id, name: cls.name, description: cls.description, deletedAt: cls.deletedAt },
    mentor: mentor ?? null,
    students: members.map((m) => ({ ...m, otherClasses: otherEnroll.filter((o) => o.studentId === m.id).map((o) => ({ id: o.classId, name: o.name })) })),
    practiceTasks: tasks, examTasks: examRows, vocabTasks: vocabRows,
    curriculum: { units: units.length, placements: placements.length },
    lessonsToArchive: archive, lessonsPreserved: preserve, otherClasses,
  };
}

async function deleteClass(actor: typeof users.$inferSelect, cls: typeof classes.$inferSelect, b: any) {
  if (cls.deletedAt) return { ok: true, alreadyDone: true, message: "This class was already deleted." };
  if (str(b.confirm, 200) !== cls.name) throw new UserFacing("Type the class name exactly to confirm.");
  const impact = await classImpact(cls);
  const choices = (b.students && typeof b.students === "object") ? b.students : {};
  const plan = impact.students.map((s) => {
    const c = choices[String(s.id)] || {};
    const to = int(c.toClassId);
    return c.action === "transfer" && to ? { studentId: s.id, action: "transfer" as const, toClassId: to } : { studentId: s.id, action: "remove" as const };
  });
  const targets = Array.from(new Set(plan.filter((p) => p.action === "transfer").map((p) => (p as any).toClassId as number)));
  if (targets.some((t) => t === cls.id || !impact.otherClasses.some((o) => o.id === t)))
    throw new UserFacing("One of the transfer targets is not an active class.");
  const now = new Date();
  const archiveIds = impact.lessonsToArchive.map((l) => l.id);
  await db.transaction(async (tx) => {
    for (const p of plan) {
      if (p.action !== "transfer") continue;
      const [existing] = await tx.select().from(classEnrollments).where(and(eq(classEnrollments.classId, p.toClassId), eq(classEnrollments.studentId, p.studentId))).limit(1);
      if (!existing) await tx.insert(classEnrollments).values({ classId: p.toClassId, studentId: p.studentId });
      else if (existing.status !== "active" && existing.status !== "banned")
        await tx.update(classEnrollments).set({ status: "active", joinedAt: now }).where(eq(classEnrollments.id, existing.id));
    }
    await tx.update(classEnrollments).set({ status: "removed" }).where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.status, "active")));
    await tx.delete(classInvites).where(and(eq(classInvites.classId, cls.id), isNull(classInvites.usedAt)));
    await tx.update(learningUnits).set({ status: "archived", updatedAt: now }).where(eq(learningUnits.classId, cls.id));
    await tx.update(learningPlacements).set({ status: "archived" }).where(eq(learningPlacements.classId, cls.id));
    if (archiveIds.length) await tx.update(lessons).set({ archivedAt: now, status: "draft" }).where(and(inArray(lessons.id, archiveIds), isNull(lessons.archivedAt)));
    await tx.update(classes).set({ deletedAt: now, deletedBy: actor.id }).where(eq(classes.id, cls.id));
  });
  await writeAudit(actor.id, "class.delete", "class", cls.id, {
    name: cls.name, students: plan, archivedLessonIds: archiveIds, preservedLessonIds: impact.lessonsPreserved.map((l) => l.id), outcome: "completed",
  });
  const removed = plan.filter((p) => p.action === "remove").map((p) => p.studentId);
  const transferred = plan.filter((p) => p.action === "transfer");
  await notify(removed, { kind: "class", title: `The class “${cls.name}” was closed`, body: "Your completed work and scores are kept." });
  for (const t of targets) {
    const [to] = await db.select({ name: classes.name }).from(classes).where(eq(classes.id, t));
    await notify(transferred.filter((p) => (p as any).toClassId === t).map((p) => p.studentId), { kind: "class", title: `You were moved from “${cls.name}” to “${to?.name ?? "a new class"}”`, link: { view: "learn" } });
  }
  return { ok: true, removed: removed.length, transferred: transferred.length, archivedLessons: archiveIds.length, preservedLessons: impact.lessonsPreserved.length };
}

// ═══════════════════════ ROUTES ═══════════════════════
export async function handleAdminOps(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  const { json, requireUser } = deps;
  const [resource, id, sub, sub2] = parts;
  const method = req.method;
  if (resource !== "admin" || !["questions", "users", "classes"].includes(id)) return null;
  const isOurs = (id === "questions" && ["delete-preview", "bulk-delete"].includes(sub))
    || (id === "users" && int(sub) && ["impact", "remove"].includes(sub2))
    || (id === "classes" && int(sub) && ["impact", "delete"].includes(sub2));
  if (!isOurs) return null;
  const auth = await requireUser(req, ["admin"]);
  if (auth.error) return auth.error;
  const actor = auth.user!;
  try {
    if (id === "questions" && sub === "delete-preview" && method === "POST") {
      const b = await req.json().catch(() => ({}));
      const ids = idList(b.ids, PREVIEW_MAX);
      if (!ids.length) return json({ error: "Select at least one question." }, 400);
      const plan = await planQuestionDeletion(ids);
      return json({
        requested: ids.length, deletable: plan.remove.length, retire: plan.retire.length, skipped: plan.skipped.length,
        skippedReasons: plan.skipped.reduce((acc, s) => { acc[s.reason] = (acc[s.reason] || 0) + 1; return acc; }, {} as Record<string, number>),
        usage: usageCounts(plan), batchSize: QUESTION_BATCH_MAX,
      });
    }
    if (id === "questions" && sub === "bulk-delete" && method === "POST") {
      const b = await req.json().catch(() => ({}));
      const ids = idList(b.ids, QUESTION_BATCH_MAX + 1);
      const expectedTotal = Number(b.expectedTotal);
      const operationId = str(b.operationId, 80) || `op-${Date.now()}`;
      if (!ids.length) return json({ error: "Select at least one question." }, 400);
      if (ids.length > QUESTION_BATCH_MAX) return json({ error: `Send at most ${QUESTION_BATCH_MAX} questions per batch.` }, 400);
      if (!Number.isInteger(expectedTotal) || Number(b.confirmCount) !== expectedTotal || ids.length > expectedTotal)
        return json({ error: "Confirm the exact number of selected questions before deleting." }, 400);
      const plan = await planQuestionDeletion(ids);
      const res = await executeQuestionDeletion(plan, actor.id);
      await writeAudit(actor.id, "question.bulk_delete", "question_batch", operationId, {
        batch: Number(b.batchIndex) || 0, batches: Number(b.batchCount) || 1, total: expectedTotal,
        deletedIds: res.deleted, retiredIds: res.retired, skipped: res.skipped,
      });
      return json({ operationId, ...res });
    }

    if (id === "users") {
      const userId = int(sub)!;
      const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!target) return json({ error: "User not found." }, 404);
      if (sub2 === "impact" && method === "GET") return json(await userImpact(target, actor.id));
      if (sub2 === "remove" && method === "POST") {
        const b = await req.json().catch(() => ({}));
        try { return json(await removeUser(actor, target, b)); }
        catch (e) {
          await writeAudit(actor.id, "user.remove_failed", "user", target.id, { mode: str(b.mode, 30), error: (e as Error).message, outcome: "failed" }).catch(() => {});
          throw e;
        }
      }
    }

    if (id === "classes") {
      const classId = int(sub)!;
      const [cls] = await db.select().from(classes).where(eq(classes.id, classId)).limit(1);
      if (!cls) return json({ error: "Class not found." }, 404);
      if (sub2 === "impact" && method === "GET") return json(await classImpact(cls));
      if (sub2 === "delete" && method === "POST") {
        const b = await req.json().catch(() => ({}));
        try { return json(await deleteClass(actor, cls, b)); }
        catch (e) {
          await writeAudit(actor.id, "class.delete_failed", "class", cls.id, { error: (e as Error).message, outcome: "failed" }).catch(() => {});
          throw e;
        }
      }
    }
    return json({ error: "Method not allowed." }, 405);
  } catch (e) {
    if (e instanceof UserFacing) return json({ error: e.message }, e.status);
    throw e;
  }
}

// Single-question delete (DELETE /api/questions/:id) follows the same rules.
export async function deleteOneQuestion(questionId: number, actorId: number) {
  const plan = await planQuestionDeletion([questionId]);
  const res = await executeQuestionDeletion(plan, actorId);
  await writeAudit(actorId, "question.delete", "question", questionId, { deletedIds: res.deleted, retiredIds: res.retired, skipped: res.skipped, usage: usageCounts(plan) });
  return { ...res, usage: usageCounts(plan) };
}
