// netlify/lib/learning.ts — class-based SAT Lessons: Class → Unit → Lesson → Practice.
//
// Access: a student reaches a lesson, its practice and its private materials
// only through a published placement in a published unit of a class they
// currently belong to — checked on every request, direct links included.
// Mentors author only inside their own classes; admins everywhere.
//
// Progress vs mastery: lesson progress (video position, completion) lives in
// lesson_progress, one row per student and lesson. Skill mastery is built from
// skill_evidence, one row per student and distinct question, so retries,
// classes and language modes never count a question twice.
import { studentAccess, allows, allowedSubjects } from "./access.js";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { getStore } from "@netlify/blobs";
import { randomBytes } from "node:crypto";
import { db } from "../../db/index.js";
import {
  users, classes, classEnrollments, questions, attempts, lessons, learningUnits, learningPlacements,
  lessonMaterials, lessonProgress, skillEvidence, skillLevelUps, settings,
} from "../../db/schema.js";
import { isAnswerCorrect, sanitizeRichHtml, type FullTestDeps } from "./fulltests.js";
import { notify } from "./platform.js";

type DbUser = typeof users.$inferSelect;
type LessonRow = typeof lessons.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const int = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const str = (v: unknown, max = 400) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
const LANGS = ["en", "uz", "ru"] as const;
const TEACH_LANGS = ["uz", "ru"];
export const MAX_MATERIAL_BYTES = 4_500_000; // function request bodies are capped at ~6 MB
const materialStore = () => getStore({ name: "lesson-materials", consistency: "strong" });

// ─────────────── MASTERY SETTINGS ───────────────
export const DEFAULT_MASTERY = {
  pointsPerQuestion: 10,
  proficientCount: 5,
  masteredCount: 10,
  masteredAccuracy: 80,
  masteredWindow: 10,
};
type MasteryRules = typeof DEFAULT_MASTERY;
async function masteryRules(): Promise<MasteryRules> {
  const [row] = await db.select().from(settings).where(eq(settings.key, "mastery"));
  const v = { ...DEFAULT_MASTERY, ...((row?.value as object) ?? {}) } as MasteryRules;
  return v;
}
const LEVELS = ["not_started", "practising", "proficient", "mastered"] as const;
type Level = (typeof LEVELS)[number];
const rank = (l: Level) => LEVELS.indexOf(l);

type SkillAgg = {
  skill: string; domain: string; section: string; points: number; questions: number;
  independentCorrect: number; firstAttempts: number; recentCount: number; recentCorrect: number;
  assistedQuestions: number; assistedAnswers: number; assistedCorrect: number;
};
function levelOf(a: SkillAgg | undefined, r: MasteryRules): Level {
  if (!a || !a.questions) return "not_started";
  const acc = a.recentCount ? (a.recentCorrect / a.recentCount) * 100 : 0;
  if (a.independentCorrect >= r.masteredCount && a.recentCount >= Math.min(r.masteredWindow, a.firstAttempts) && acc >= r.masteredAccuracy) return "mastered";
  if (a.independentCorrect >= r.proficientCount) return "proficient";
  return "practising";
}
async function skillAggregates(studentIds: number[], r: MasteryRules, skill?: string) {
  if (!studentIds.length) return [] as (SkillAgg & { studentId: number })[];
  const ids = sql.join(studentIds.map((i) => sql`${i}`), sql`, `);
  const skillCond = skill ? sql`and skill = ${skill}` : sql``;
  const skillCondE = skill ? sql`and e.skill = ${skill}` : sql``;
  const res = await db.execute(sql`
    with ranked as (
      select student_id, skill, first_independent_correct,
        row_number() over (partition by student_id, skill order by first_independent_at desc) as rn
      from skill_evidence where student_id in (${ids}) and first_independent_at is not null ${skillCond}
    ), recent as (
      select student_id, skill, count(*)::int as n, count(*) filter (where first_independent_correct)::int as c
      from ranked where rn <= ${r.masteredWindow} group by student_id, skill
    )
    select e.student_id, e.skill, max(e.domain) as domain, max(e.section) as section,
      coalesce(sum(e.points_awarded), 0)::int as points, count(*)::int as questions,
      count(*) filter (where e.independent_correct_at is not null)::int as independent_correct,
      count(*) filter (where e.first_independent_at is not null)::int as first_attempts,
      count(*) filter (where e.assisted_count > 0)::int as assisted_questions,
      coalesce(sum(e.assisted_count), 0)::int as assisted_answers,
      coalesce(sum(e.assisted_correct_count), 0)::int as assisted_correct,
      coalesce(max(rc.n), 0)::int as recent_count, coalesce(max(rc.c), 0)::int as recent_correct
    from skill_evidence e left join recent rc on rc.student_id = e.student_id and rc.skill = e.skill
    where e.student_id in (${ids}) ${skillCondE}
    group by e.student_id, e.skill`);
  return rowsOf(res).map((x) => ({
    studentId: Number(x.student_id), skill: x.skill, domain: x.domain || "", section: x.section || "",
    points: x.points, questions: x.questions, independentCorrect: x.independent_correct, firstAttempts: x.first_attempts,
    recentCount: x.recent_count, recentCorrect: x.recent_correct, assistedQuestions: x.assisted_questions,
    assistedAnswers: x.assisted_answers, assistedCorrect: x.assisted_correct,
  }));
}
const skillView = (a: SkillAgg, r: MasteryRules) => ({
  ...a, level: levelOf(a, r), recentAccuracy: a.recentCount ? Math.round((a.recentCorrect / a.recentCount) * 100) : null,
  toProficient: Math.max(0, r.proficientCount - a.independentCorrect), toMastered: Math.max(0, r.masteredCount - a.independentCorrect),
});

// ─────────────── ACCESS ───────────────
async function studentClassIds(studentId: number) {
  const rows = await db.select({ id: classes.id }).from(classEnrollments)
    .innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active"), isNull(classes.deletedAt)));
  return rows.map((r) => r.id);
}
async function manageableClass(user: DbUser, classId: number | null) {
  if (!classId) return null;
  const [cls] = await db.select().from(classes).where(and(eq(classes.id, classId), isNull(classes.deletedAt))).limit(1);
  if (!cls) return null;
  if (user.role === "admin") return cls;
  if (user.role === "mentor" && user.status === "active" && cls.mentorId === user.id) return cls;
  return null;
}
async function staffClassIds(user: DbUser) {
  const rows = await db.select({ id: classes.id }).from(classes)
    .where(user.role === "admin" ? isNull(classes.deletedAt) : and(isNull(classes.deletedAt), eq(classes.mentorId, user.id)));
  return rows.map((r) => r.id);
}
// Published, visible placements of a lesson in the given classes.
async function publishedPlacements(lessonId: number, classIds: number[]) {
  if (!classIds.length) return [];
  return db.select({ placement: learningPlacements }).from(learningPlacements)
    .innerJoin(learningUnits, eq(learningPlacements.unitId, learningUnits.id))
    .where(and(eq(learningPlacements.lessonId, lessonId), inArray(learningPlacements.classId, classIds),
      eq(learningPlacements.status, "published"), eq(learningUnits.status, "published")))
    .then((r) => r.map((x) => x.placement));
}
// The classes through which `user` may open `lesson` (empty = no access).
// Staff may open any lesson used in a class they manage, their own lessons and
// public library lessons; students only published placements in their classes.
export async function lessonAccess(user: DbUser, lesson: LessonRow) {
  if (user.role === "student") {
    if (lesson.archivedAt) return { ok: false, classIds: [] as number[], staff: false };
    // Subject access first: covers the lesson, its practice and its private files.
    if (!allows((await studentAccess(user.id)).rules, lesson.section, "lessons")) return { ok: false, classIds: [] as number[], staff: false };
    const mine = await studentClassIds(user.id);
    const placed = await publishedPlacements(lesson.id, mine);
    return { ok: placed.length > 0, classIds: Array.from(new Set(placed.map((p) => p.classId))), staff: false };
  }
  if (user.role === "admin") return { ok: true, classIds: [] as number[], staff: true };
  if (user.role !== "mentor" || user.status !== "active") return { ok: false, classIds: [], staff: false };
  const mine = await staffClassIds(user);
  const placed = mine.length ? await db.select({ classId: learningPlacements.classId }).from(learningPlacements)
    .where(and(eq(learningPlacements.lessonId, lesson.id), inArray(learningPlacements.classId, mine))) : [];
  const ok = placed.length > 0 || lesson.createdBy === user.id || (lesson.visibility === "public" && !lesson.archivedAt);
  return { ok, classIds: Array.from(new Set(placed.map((p) => p.classId))), staff: true };
}
// For the Online Lessons library: may this user open a lesson by id?
export async function canOpenLibraryLesson(user: DbUser, lesson: LessonRow) {
  if (lesson.visibility === "public" && !lesson.archivedAt) return user.role !== "student" || lesson.status === "published";
  return (await lessonAccess(user, lesson)).ok;
}

// Who uses a lesson, and may this user edit it in place?
async function lessonScope(user: DbUser, lesson: LessonRow) {
  const uses = await db.select({ classId: classes.id, name: classes.name, mentorId: classes.mentorId, placementId: learningPlacements.id, status: learningPlacements.status })
    .from(learningPlacements).innerJoin(classes, eq(learningPlacements.classId, classes.id))
    .where(and(eq(learningPlacements.lessonId, lesson.id), ne(learningPlacements.status, "archived"), isNull(classes.deletedAt)));
  const classList = Array.from(new Map(uses.map((u) => [u.classId, { id: u.classId, name: u.name, mentorId: u.mentorId }])).values());
  let canEdit = false;
  let reason = "";
  if (user.role === "admin") canEdit = true;
  else if (user.role === "mentor" && user.status === "active") {
    const foreign = classList.filter((c) => c.mentorId !== user.id);
    if (foreign.length) reason = `This lesson is also used by ${foreign.map((c) => `“${c.name}”`).join(", ")}, which belong to another mentor. Make a class-specific copy to edit it.`;
    else if (lesson.visibility === "public" && lesson.createdBy !== user.id) reason = "This is a shared library lesson. Make a class-specific copy to edit it.";
    else if (!classList.length && lesson.createdBy !== user.id) reason = "Only the author or an admin can edit this lesson.";
    else canEdit = true;
  }
  return { classes: classList, shared: classList.length > 1 || lesson.visibility === "public", canEdit, reason };
}

// ─────────────── LESSON FIELDS ───────────────
const i18n = (raw: unknown, rich = false, max = 20000) => {
  const out: Record<string, string> = {};
  const src = raw && typeof raw === "object" ? raw as Record<string, unknown> : { en: raw };
  for (const l of LANGS) {
    const v = src[l];
    if (v === undefined || v === null || String(v).trim() === "") continue;
    out[l] = rich ? sanitizeRichHtml(v, max) : str(v, max);
  }
  return out;
};
const YT_ID = /^[A-Za-z0-9_-]{11}$/;
function youtubeId(raw: unknown) {
  const value = str(raw, 500);
  if (!value) return "";
  if (YT_ID.test(value)) return value;
  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") { const c = url.pathname.split("/").filter(Boolean)[0] || ""; return YT_ID.test(c) ? c : ""; }
    if (!["youtube.com", "m.youtube.com", "youtube-nocookie.com"].includes(host)) return "";
    const v = url.searchParams.get("v") || "";
    if (YT_ID.test(v)) return v;
    const m = url.pathname.match(/\/(?:embed|shorts|v|live)\/([A-Za-z0-9_-]{11})/);
    return m ? m[1] : "";
  } catch { return ""; }
}
const httpsUrl = (raw: unknown) => {
  const v = str(raw, 1000);
  if (!v) return "";
  try { const u = new URL(v); return u.protocol === "https:" ? u.toString() : ""; } catch { return ""; }
};

async function lessonColumns(b: any, existing?: LessonRow) {
  const title = str(b.title ?? existing?.title, 200);
  if (!title) throw new Problem("Enter a lesson title.");
  const provider = ["youtube", "url", "none"].includes(b.videoProvider) ? b.videoProvider : existing?.videoProvider ?? "youtube";
  let videoId = "", videoUrl = "", youtubeUrl = "";
  if (provider === "youtube") {
    youtubeUrl = str(b.youtubeUrl ?? existing?.youtubeUrl, 500);
    videoId = youtubeId(b.youtubeUrl ?? b.videoId ?? existing?.videoId);
    if (!videoId) throw new Problem("Paste a YouTube link (unlisted videos work), or choose another video option.");
  } else if (provider === "url") {
    videoUrl = httpsUrl(b.videoUrl ?? existing?.videoUrl);
    if (!videoUrl) throw new Problem("Paste an https:// link to an .mp4 or .webm video file.");
  }
  const c = b.content && typeof b.content === "object" ? b.content : (existing?.content ?? {}) as any;
  const vocabulary = (Array.isArray(c.vocabulary) ? c.vocabulary : []).slice(0, 80)
    .map((v: any) => ({ term: str(v?.term, 120), en: str(v?.en, 600), uz: str(v?.uz, 600), ru: str(v?.ru, 600) }))
    .filter((v: any) => v.term);
  const workedExamples = (Array.isArray(c.workedExamples) ? c.workedExamples : []).slice(0, 20)
    .map((w: any) => ({ title: str(w?.title, 200), body: i18n(w?.body, true) }))
    .filter((w: any) => w.title || Object.keys(w.body).length);
  const practiceIds = Array.from(new Set((Array.isArray(b.practiceQuestionIds) ? b.practiceQuestionIds : existing?.practiceQuestionIds ?? [])
    .map(Number).filter((n: number) => Number.isInteger(n) && n > 0))).slice(0, 60) as number[];
  if (practiceIds.length) {
    const found = await db.select({ id: questions.id, scope: questions.scope }).from(questions).where(inArray(questions.id, practiceIds));
    const keep = new Set(existing?.practiceQuestionIds ?? []);
    const bad = practiceIds.filter((id) => { const f = found.find((x) => x.id === id); return !f || (f.scope !== "BANK" && !keep.has(id)); });
    if (bad.length) throw new Problem(`Practice must use question-bank items. Not available: #${bad.join(", #")}.`);
  }
  const tags = Array.from(new Set((Array.isArray(b.skillTags) ? b.skillTags : existing?.skillTags ?? []).map((t: unknown) => str(t, 160)).filter(Boolean))).slice(0, 12) as string[];
  return {
    title,
    topic: str(b.topic ?? existing?.topic, 200),
    section: (b.section ?? existing?.section) === "ebrw" ? "ebrw" : "math",
    category: str(b.category ?? existing?.category, 160),
    subcategory: tags[0] || str(b.subcategory ?? existing?.subcategory, 160),
    videoProvider: provider, videoId, youtubeUrl, videoUrl,
    description: sanitizeRichHtml(b.description ?? existing?.description ?? ""),
    difficulty: Math.max(1, Math.min(5, Math.round(Number(b.difficulty ?? existing?.difficulty) || 3))),
    objective: i18n(b.objective ?? existing?.objective, false, 600),
    content: {
      explanation: i18n(c.explanation, true),
      transcript: i18n(c.transcript, false, 60000),
      vocabulary, workedExamples,
      slidesUrl: httpsUrl(c.slidesUrl),
    },
    skillTags: tags,
    practiceQuestionIds: practiceIds,
  };
}
class Problem extends Error { constructor(message: string, public status = 400) { super(message); } }

const withoutKey = (q: QuestionRow) => {
  const { answer, explanation, acceptableAnswers, ...rest } = q;
  return rest;
};

// ─────────────── CURRICULUM ───────────────
async function classPath(classId: number, opts: { staff: boolean; studentId?: number; lessonSubjects?: string[] }) {
  const units = await db.select().from(learningUnits)
    .where(and(eq(learningUnits.classId, classId), opts.staff ? ne(learningUnits.status, "archived") : eq(learningUnits.status, "published")))
    .orderBy(asc(learningUnits.position), asc(learningUnits.id));
  const unitIds = units.map((u) => u.id);
  const placed = unitIds.length ? await db.select({ p: learningPlacements, l: lessons }).from(learningPlacements)
    .innerJoin(lessons, eq(learningPlacements.lessonId, lessons.id))
    .where(and(inArray(learningPlacements.unitId, unitIds),
      opts.staff ? ne(learningPlacements.status, "archived") : eq(learningPlacements.status, "published"),
      opts.staff ? undefined : isNull(lessons.archivedAt)))
    .orderBy(asc(learningPlacements.position), asc(learningPlacements.id)) : [];
  // Students never receive lessons of a subject whose Lessons area is off.
  if (opts.lessonSubjects) for (let i = placed.length - 1; i >= 0; i--) if (!opts.lessonSubjects.includes(placed[i].l.section)) placed.splice(i, 1);
  const lessonIds = placed.map((x) => x.l.id);
  const progress = opts.studentId && lessonIds.length
    ? await db.select().from(lessonProgress).where(and(eq(lessonProgress.studentId, opts.studentId), inArray(lessonProgress.lessonId, lessonIds)))
    : [];
  const usage = opts.staff && lessonIds.length ? await db.select({ lessonId: learningPlacements.lessonId, n: sql<number>`count(distinct ${learningPlacements.classId})::int` })
    .from(learningPlacements).innerJoin(classes, eq(learningPlacements.classId, classes.id))
    .where(and(inArray(learningPlacements.lessonId, lessonIds), ne(learningPlacements.status, "archived"), isNull(classes.deletedAt)))
    .groupBy(learningPlacements.lessonId) : [];
  const out = units.map((u) => ({
    ...u,
    lessons: placed.filter((x) => x.p.unitId === u.id).map(({ p, l }) => {
      const pr = progress.find((g) => g.lessonId === l.id);
      return {
        placementId: p.id, lessonId: l.id, status: p.status, position: p.position, dueAt: p.dueAt, assignedAt: p.assignedAt,
        title: l.title, objective: l.objective, skillTags: l.skillTags, section: l.section, category: l.category,
        hasVideo: l.videoProvider !== "none", practiceCount: (l.practiceQuestionIds || []).length,
        lessonStatus: l.status, archived: !!l.archivedAt, visibility: l.visibility, ownerClassId: l.ownerClassId, sourceLessonId: l.sourceLessonId,
        usedByClasses: usage.find((x) => x.lessonId === l.id)?.n ?? 1,
        progress: pr ? {
          videoPositionSeconds: pr.videoPositionSeconds, videoDurationSeconds: pr.videoDurationSeconds,
          videoCompleted: !!pr.videoCompletedAt, completed: !!pr.completedAt, updatedAt: pr.updatedAt,
          answered: Object.keys(((pr.practiceState as any)?.answers) || {}).length,
        } : null,
      };
    }),
  }));
  return out;
}
const flatLessons = (path: Awaited<ReturnType<typeof classPath>>) => path.flatMap((u) => u.lessons.map((l) => ({ ...l, unitId: u.id, unitTitle: u.title })));

function continueAndNext(path: Awaited<ReturnType<typeof classPath>>) {
  const flat = flatLessons(path);
  const inProgress = flat.filter((l) => l.progress && !l.progress.completed)
    .sort((a, b) => new Date(b.progress!.updatedAt || 0).getTime() - new Date(a.progress!.updatedAt || 0).getTime())[0];
  const firstOpen = flat.find((l) => !l.progress?.completed);
  return {
    continueLesson: inProgress ? { lessonId: inProgress.lessonId, title: inProgress.title } : firstOpen ? { lessonId: firstOpen.lessonId, title: firstOpen.title } : null,
    completed: flat.filter((l) => l.progress?.completed).length,
    total: flat.length,
  };
}

// ─────────────── MATERIALS ───────────────
const materialView = (m: typeof lessonMaterials.$inferSelect) => ({
  id: m.id, kind: m.kind, title: m.title, lang: m.lang, url: m.blobKey ? "" : m.url, hasFile: !!m.blobKey,
  fileName: m.fileName, contentType: m.contentType, size: m.size, position: m.position,
});
async function deleteMaterialRow(m: typeof lessonMaterials.$inferSelect) {
  await db.delete(lessonMaterials).where(eq(lessonMaterials.id, m.id));
  if (m.blobKey) {
    const [other] = await db.select({ id: lessonMaterials.id }).from(lessonMaterials).where(eq(lessonMaterials.blobKey, m.blobKey)).limit(1);
    if (!other) await materialStore().delete(m.blobKey).catch(() => {});
  }
}

// ─────────────── ANSWERS & MASTERY ───────────────
async function recordAnswer(student: DbUser, lesson: LessonRow, q: QuestionRow, selectedRaw: unknown, assistedRaw: boolean, classId: number | null, lang: string) {
  const r = await masteryRules();
  const selected = str(selectedRaw, 200);
  const correct = selected ? isAnswerCorrect(q, selected) : false;
  const skill = q.subcategory || q.category;
  const [before] = await skillAggregates([student.id], r, skill);
  const beforeLevel = levelOf(before, r);
  const [prior] = await db.select().from(skillEvidence).where(and(eq(skillEvidence.studentId, student.id), eq(skillEvidence.questionId, q.id))).limit(1);
  // Once feedback (the key) has been shown, later tries are retries: they get
  // feedback again but are recorded as assisted and never earn points.
  const isRetry = !!prior && prior.attemptCount > 0;
  const assisted = assistedRaw || isRetry;
  await db.insert(skillEvidence).values({
    studentId: student.id, questionId: q.id, skill, domain: q.category, section: q.section, lessonId: lesson.id, classId, lang,
  }).onConflictDoNothing({ target: [skillEvidence.studentId, skillEvidence.questionId] });
  await db.execute(sql`update skill_evidence set
      attempt_count = attempt_count + 1,
      assisted_count = assisted_count + ${assisted ? 1 : 0},
      assisted_correct_count = assisted_correct_count + ${assisted && correct ? 1 : 0},
      first_independent_correct = case when ${!assisted} and first_independent_at is null then ${correct} else first_independent_correct end,
      first_independent_at = case when ${!assisted} and first_independent_at is null then now() else first_independent_at end,
      last_selected = ${selected}, last_correct = ${correct}, last_assisted = ${assisted}, last_attempt_at = now()
    where student_id = ${student.id} and question_id = ${q.id}`);
  let pointsEarned = 0;
  if (correct && !assisted) {
    // Only the update that flips the null wins the points — safe under retries and races.
    const won = await db.update(skillEvidence).set({ independentCorrectAt: new Date(), pointsAwarded: r.pointsPerQuestion, lessonId: lesson.id, classId, lang })
      .where(and(eq(skillEvidence.studentId, student.id), eq(skillEvidence.questionId, q.id), isNull(skillEvidence.independentCorrectAt)))
      .returning({ id: skillEvidence.id });
    if (won.length) pointsEarned = r.pointsPerQuestion;
  }
  const [after] = await skillAggregates([student.id], r, skill);
  const afterLevel = levelOf(after, r);
  const levelUps: string[] = [];
  for (let i = rank(beforeLevel) + 1; i <= rank(afterLevel); i++) {
    const level = LEVELS[i];
    const ins = await db.insert(skillLevelUps).values({ studentId: student.id, skill, level })
      .onConflictDoNothing({ target: [skillLevelUps.studentId, skillLevelUps.skill, skillLevelUps.level] }).returning({ id: skillLevelUps.id });
    if (ins.length) levelUps.push(level);
  }
  // Keep the regular answer log complete (profile stats, reports). Lesson
  // answers are excluded from leaderboards by their mode.
  await db.insert(attempts).values({
    student: `u${student.id}`, questionId: q.id, section: q.section, category: q.category, difficulty: q.difficulty,
    mode: `lesson:${lesson.id}`, selected, correct,
  });
  // Task progress for resuming on another device.
  await db.insert(lessonProgress).values({ studentId: student.id, lessonId: lesson.id, lastClassId: classId, lastLang: lang })
    .onConflictDoNothing({ target: [lessonProgress.studentId, lessonProgress.lessonId] });
  await db.execute(sql`update lesson_progress set
      practice_state = jsonb_set(coalesce(practice_state, '{}'::jsonb), '{answers}',
        coalesce(practice_state->'answers', '{}'::jsonb) || jsonb_build_object(${String(q.id)}::text, ${JSON.stringify({ selected, correct, assisted })}::jsonb)),
      updated_at = now(), last_class_id = coalesce(${classId}, last_class_id), last_lang = ${lang}
    where student_id = ${student.id} and lesson_id = ${lesson.id}`);
  if (levelUps.length && classId) {
    const [cls] = await db.select({ mentorId: classes.mentorId }).from(classes).where(eq(classes.id, classId));
    if (cls && levelUps.includes("mastered"))
      await notify([cls.mentorId], { kind: "class", title: `${student.displayName} mastered “${skill}”`, link: { view: "learn" } });
  }
  return {
    correct, assisted, retry: isRetry, pointsEarned, skill,
    answer: q.answer, acceptableAnswers: Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [], explanation: q.explanation ?? "",
    before: beforeLevel, after: afterLevel, levelUps,
    mastery: after ? skillView(after, r) : null,
  };
}

// ─────────────── ROUTES ───────────────
export async function handleLearning(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  const { json, requireUser } = deps;
  if (parts[0] !== "learn") return null;
  const [, a, b, c, d] = parts;
  const method = req.method;
  const url = new URL(req.url);
  if ((b && !/^\d+$/.test(b) && b !== "skills") || (d && !/^\d+$/.test(d))
    || (c && !["path", "progress", "answer", "file", "dashboard", "students", "units", "placements", "reorder", "copy", "scope", "materials"].includes(c))) return json({ error: "Not found." }, 404);
  const auth = await requireUser(req, ["student", "mentor", "admin"]);
  if (auth.error) return auth.error;
  const user = auth.user!;
  const staff = user.role === "admin" || user.role === "mentor";
  const body = async () => (method === "GET" ? {} : await req.json().catch(() => ({})));
  try {
    // ── settings (rules shown in the UI; admins may change thresholds) ──
    if (a === "settings") {
      if (method === "GET") return json(await masteryRules());
      if (method === "PUT") {
        if (user.role !== "admin") return json({ error: "Only admins can change mastery rules." }, 403);
        const v = await body();
        const n = (k: keyof MasteryRules, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number(v[k] ?? DEFAULT_MASTERY[k]))));
        const next = { pointsPerQuestion: n("pointsPerQuestion", 1, 1000), proficientCount: n("proficientCount", 1, 200), masteredCount: n("masteredCount", 1, 500), masteredAccuracy: n("masteredAccuracy", 1, 100), masteredWindow: n("masteredWindow", 1, 100) };
        if (next.masteredCount < next.proficientCount) return json({ error: "Mastered must need at least as many questions as Proficient." }, 400);
        await db.insert(settings).values({ key: "mastery", value: next }).onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
        return json(next);
      }
    }

    // ── overview: which classes the caller can open ──
    if (a === "overview" && method === "GET") {
      const rules = await masteryRules();
      const lang = TEACH_LANGS.includes(String((user.preferences as any)?.teachLang)) ? (user.preferences as any).teachLang : "uz";
      const ids = staff ? await staffClassIds(user) : await studentClassIds(user.id);
      const rows = ids.length ? await db.select({ c: classes, mentor: users.displayName }).from(classes).leftJoin(users, eq(classes.mentorId, users.id)).where(inArray(classes.id, ids)).orderBy(asc(classes.name)) : [];
      const list = [];
      for (const { c: cls, mentor } of rows) {
        const path = await classPath(cls.id, { staff: false, studentId: staff ? undefined : user.id, lessonSubjects: staff ? undefined : allowedSubjects((await studentAccess(user.id)).rules, "lessons") });
        list.push({ id: cls.id, name: cls.name, mentorName: mentor || "Mentor", ...(staff ? { lessons: flatLessons(path).length } : continueAndNext(path)) });
      }
      return json({ classes: list, lang, rules, role: user.role });
    }

    // ── a class's learning path ──
    if (a === "classes" && int(b) && c === "path" && method === "GET") {
      const classId = int(b)!;
      const preview = url.searchParams.get("preview") === "1";
      if (staff) {
        const cls = await manageableClass(user, classId);
        if (!cls) return json({ error: "You can only open curricula for your own classes." }, 403);
        const path = await classPath(classId, { staff: !preview });
        return json({ class: { id: cls.id, name: cls.name, mentorId: cls.mentorId }, units: path, preview, canManage: true });
      }
      const mine = await studentClassIds(user.id);
      if (!mine.includes(classId)) return json({ error: "You are not a member of this class." }, 403);
      const [cls] = await db.select().from(classes).where(eq(classes.id, classId));
      const path = await classPath(classId, { staff: false, studentId: user.id, lessonSubjects: allowedSubjects((await studentAccess(user.id)).rules, "lessons") });
      return json({ class: { id: cls.id, name: cls.name }, units: path, ...continueAndNext(path) });
    }

    // ── one lesson, for viewing ──
    if (a === "lessons" && int(b) && !c && method === "GET") {
      const [lesson] = await db.select().from(lessons).where(eq(lessons.id, int(b)!)).limit(1);
      if (!lesson) return json({ error: "Lesson not found." }, 404);
      const access = await lessonAccess(user, lesson);
      if (!access.ok) return json({ error: "This lesson is not available to you." }, 403);
      const requested = int(url.searchParams.get("classId"));
      const classId = staff ? requested : (requested && access.classIds.includes(requested) ? requested : access.classIds[0] ?? null);
      if (staff && classId && !(await manageableClass(user, classId))) return json({ error: "You can only preview your own classes." }, 403);
      const materials = await db.select().from(lessonMaterials).where(eq(lessonMaterials.lessonId, lesson.id)).orderBy(asc(lessonMaterials.position), asc(lessonMaterials.id));
      const qIds = lesson.practiceQuestionIds || [];
      const qRows = qIds.length ? await db.select().from(questions).where(inArray(questions.id, qIds)) : [];
      const practice = qIds.map((id) => qRows.find((q) => q.id === id)).filter(Boolean).map((q) => (staff ? q! : withoutKey(q!)));
      let progress = null, evidence: any[] = [];
      if (!staff) {
        [progress] = await db.select().from(lessonProgress).where(and(eq(lessonProgress.studentId, user.id), eq(lessonProgress.lessonId, lesson.id)));
        evidence = qIds.length ? await db.select({ questionId: skillEvidence.questionId, attemptCount: skillEvidence.attemptCount, independentCorrectAt: skillEvidence.independentCorrectAt, firstIndependentCorrect: skillEvidence.firstIndependentCorrect, lastCorrect: skillEvidence.lastCorrect, lastAssisted: skillEvidence.lastAssisted, pointsAwarded: skillEvidence.pointsAwarded })
          .from(skillEvidence).where(and(eq(skillEvidence.studentId, user.id), inArray(skillEvidence.questionId, qIds))) : [];
      }
      // Path neighbours in the chosen class, for the "next step" action.
      let next = null, prev = null, className = "";
      if (classId) {
        const path = await classPath(classId, { staff: false, studentId: staff ? undefined : user.id });
        const flat = flatLessons(path);
        const i = flat.findIndex((l) => l.lessonId === lesson.id);
        if (i >= 0) { next = flat[i + 1] ? { lessonId: flat[i + 1].lessonId, title: flat[i + 1].title } : null; prev = flat[i - 1] ? { lessonId: flat[i - 1].lessonId, title: flat[i - 1].title } : null; }
        const [cls] = await db.select({ name: classes.name }).from(classes).where(eq(classes.id, classId));
        className = cls?.name || "";
      }
      // Answer keys for questions already answered, so feedback survives a reload.
      let answered: Record<string, unknown> = {};
      if (!staff && progress) {
        const state = ((progress.practiceState as any)?.answers || {}) as Record<string, any>;
        for (const q of qRows) if (state[String(q.id)]) answered[String(q.id)] = { ...state[String(q.id)], answer: q.answer, explanation: q.explanation, acceptableAnswers: q.acceptableAnswers || [] };
      }
      const scope = staff ? await lessonScope(user, lesson) : null;
      const rules = await masteryRules();
      const { createdBy, updatedBy, ...publicLesson } = lesson;
      return json({
        lesson: staff ? lesson : publicLesson, materials: materials.map(materialView), practice, progress, evidence, answered,
        classId, className, accessClassIds: access.classIds, next, prev, scope, rules,
        lang: TEACH_LANGS.includes(String((user.preferences as any)?.teachLang)) ? (user.preferences as any).teachLang : "uz",
      });
    }

    // ── student: save video position / completion / position in practice ──
    if (a === "lessons" && int(b) && c === "progress" && method === "PUT") {
      if (user.role !== "student") return json({ error: "Only students record lesson progress." }, 403);
      const [lesson] = await db.select().from(lessons).where(eq(lessons.id, int(b)!)).limit(1);
      if (!lesson) return json({ error: "Lesson not found." }, 404);
      const access = await lessonAccess(user, lesson);
      if (!access.ok) return json({ error: "This lesson is not available to you." }, 403);
      const v = await body();
      const classId = access.classIds.includes(Number(v.classId)) ? Number(v.classId) : access.classIds[0];
      const lang = TEACH_LANGS.includes(v.lang) ? v.lang : "";
      const pos = Math.max(0, Math.min(86400, Math.round(Number(v.videoPositionSeconds) || 0)));
      const dur = Math.max(0, Math.min(86400, Math.round(Number(v.videoDurationSeconds) || 0)));
      const videoDone = v.videoCompleted === true || (dur > 0 && pos >= dur * 0.9);
      // Reading-only lessons (no video) are completed explicitly.
      const done = videoDone || (v.markComplete === true && lesson.videoProvider === "none");
      await db.insert(lessonProgress).values({ studentId: user.id, lessonId: lesson.id, lastClassId: classId, lastLang: lang })
        .onConflictDoNothing({ target: [lessonProgress.studentId, lessonProgress.lessonId] });
      const idx = Number.isInteger(Number(v.practiceIndex)) ? Math.max(0, Math.min(200, Number(v.practiceIndex))) : null;
      const [row] = await db.update(lessonProgress).set({
        ...(v.videoPositionSeconds !== undefined ? { videoPositionSeconds: pos } : {}),
        ...(dur ? { videoDurationSeconds: dur } : {}),
        ...(videoDone ? { videoCompletedAt: sql`coalesce(${lessonProgress.videoCompletedAt}, now())` } : {}),
        ...(done ? { completedAt: sql`coalesce(${lessonProgress.completedAt}, now())` } : {}),
        ...(idx !== null ? { practiceState: sql`jsonb_set(coalesce(${lessonProgress.practiceState}, '{}'::jsonb), '{currentIndex}', to_jsonb(${idx}::int))` } : {}),
        ...(lang ? { lastLang: lang } : {}),
        lastClassId: classId, updatedAt: new Date(),
      } as any).where(and(eq(lessonProgress.studentId, user.id), eq(lessonProgress.lessonId, lesson.id))).returning();
      return json(row);
    }

    // ── student: answer a practice question ──
    if (a === "lessons" && int(b) && c === "answer" && method === "POST") {
      if (user.role !== "student") return json({ error: "Only students submit practice answers. Staff preview shows the key instead." }, 403);
      const [lesson] = await db.select().from(lessons).where(eq(lessons.id, int(b)!)).limit(1);
      if (!lesson) return json({ error: "Lesson not found." }, 404);
      const access = await lessonAccess(user, lesson);
      if (!access.ok) return json({ error: "This lesson is not available to you." }, 403);
      const v = await body();
      const qid = int(v.questionId);
      if (!qid || !(lesson.practiceQuestionIds || []).includes(qid)) return json({ error: "That question is not part of this lesson's practice." }, 403);
      const [q] = await db.select().from(questions).where(eq(questions.id, qid)).limit(1);
      if (!q) return json({ error: "That question no longer exists." }, 404);
      const classId = access.classIds.includes(Number(v.classId)) ? Number(v.classId) : access.classIds[0] ?? null;
      const lang = TEACH_LANGS.includes(v.lang) ? v.lang : "";
      return json(await recordAnswer(user, lesson, q, v.selected, v.assisted === true, classId, lang), 201);
    }

    // ── private materials: streamed only after an access check ──
    if (a === "materials" && int(b) && c === "file" && method === "GET") {
      const [m] = await db.select().from(lessonMaterials).where(eq(lessonMaterials.id, int(b)!)).limit(1);
      if (!m || !m.blobKey) return json({ error: "Material not found." }, 404);
      const [lesson] = await db.select().from(lessons).where(eq(lessons.id, m.lessonId)).limit(1);
      if (!lesson || !(await lessonAccess(user, lesson)).ok) return json({ error: "This material is not available to you." }, 403);
      const data = await materialStore().get(m.blobKey, { type: "arrayBuffer" });
      if (!data) return json({ error: "The file is missing from storage." }, 404);
      return new Response(data, { headers: {
        "content-type": m.contentType || "application/octet-stream",
        "content-disposition": `${url.searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${m.fileName.replace(/[^\w.\- ]/g, "_") || "material"}"`,
        "cache-control": "private, no-store", "x-content-type-options": "nosniff",
      } });
    }

    // ── student: skills, points, level-ups, recommendation ──
    if (a === "me" && b === "skills" && method === "GET") {
      if (user.role !== "student") return json({ error: "Only students have skill mastery." }, 403);
      const r = await masteryRules();
      const skills = (await skillAggregates([user.id], r)).map((x) => skillView(x, r));
      const ups = await db.select().from(skillLevelUps).where(eq(skillLevelUps.studentId, user.id)).orderBy(desc(skillLevelUps.reachedAt)).limit(30);
      const classIds = await studentClassIds(user.id);
      // Recommend the next unfinished lesson, preferring one that covers a skill not yet proficient.
      let recommended = null;
      const weak = new Set(skills.filter((s) => rank(s.level) < rank("proficient")).map((s) => s.skill));
      for (const cid of classIds) {
        const flat = flatLessons(await classPath(cid, { staff: false, studentId: user.id }));
        const open = flat.filter((l) => !l.progress?.completed);
        const pick = open.find((l) => (l.skillTags || []).some((t: string) => weak.has(t))) || open[0];
        if (pick) { recommended = { lessonId: pick.lessonId, title: pick.title, classId: cid, skillTags: pick.skillTags }; break; }
      }
      return json({ skills, points: skills.reduce((s, x) => s + x.points, 0), levelUps: ups, recommended, rules: r });
    }

    // ═════ STAFF ONLY BELOW ═════
    if (!staff) return json({ error: "Only admins and mentors can manage lessons." }, 403);
    if (user.role === "mentor" && user.status !== "active") return json({ error: "Activate your mentor account first." }, 403);

    // ── class dashboard: lesson completion + skill proficiency per student ──
    if (a === "classes" && int(b) && c === "dashboard" && method === "GET") {
      const cls = await manageableClass(user, int(b)!);
      if (!cls) return json({ error: "You can only view dashboards for your own classes." }, 403);
      const r = await masteryRules();
      const members = await db.select({ id: users.id, displayName: users.displayName }).from(classEnrollments)
        .innerJoin(users, eq(classEnrollments.studentId, users.id))
        .where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.status, "active"))).orderBy(asc(users.displayName));
      const flat = flatLessons(await classPath(cls.id, { staff: false }));
      const lessonIds = flat.map((l) => l.lessonId);
      const ids = members.map((m) => m.id);
      const prog = ids.length && lessonIds.length ? await db.select().from(lessonProgress).where(and(inArray(lessonProgress.studentId, ids), inArray(lessonProgress.lessonId, lessonIds))) : [];
      const aggs = await skillAggregates(ids, r);
      const skillNames = Array.from(new Set([...flat.flatMap((l) => l.skillTags || []), ...aggs.map((x) => x.skill)])).sort();
      return json({
        class: { id: cls.id, name: cls.name }, rules: r, lessons: flat.map((l) => ({ lessonId: l.lessonId, title: l.title })), skills: skillNames,
        students: members.map((m) => {
          const mine = prog.filter((p) => p.studentId === m.id);
          const sk = aggs.filter((x) => x.studentId === m.id).map((x) => skillView(x, r));
          return {
            ...m, lessonsCompleted: mine.filter((p) => p.completedAt).length, lessonsStarted: mine.length, lessonsTotal: lessonIds.length,
            completedLessonIds: mine.filter((p) => p.completedAt).map((p) => p.lessonId),
            points: sk.reduce((s, x) => s + x.points, 0), skills: sk,
          };
        }),
      });
    }
    // ── drill-down: the evidence behind one student's level on one skill ──
    if (a === "classes" && int(b) && c === "students" && int(d) && method === "GET") {
      const cls = await manageableClass(user, int(b)!);
      if (!cls) return json({ error: "You can only view your own classes." }, 403);
      const studentId = int(d)!;
      const [member] = await db.select().from(classEnrollments).where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active"))).limit(1);
      if (!member) return json({ error: "That student is not in this class." }, 404);
      const skill = url.searchParams.get("skill") || undefined;
      const r = await masteryRules();
      const rows = await db.select({ e: skillEvidence, q: questions, lessonTitle: lessons.title }).from(skillEvidence)
        .leftJoin(questions, eq(skillEvidence.questionId, questions.id)).leftJoin(lessons, eq(skillEvidence.lessonId, lessons.id))
        .where(and(eq(skillEvidence.studentId, studentId), skill ? eq(skillEvidence.skill, skill) : undefined))
        .orderBy(desc(skillEvidence.lastAttemptAt));
      const [st] = await db.select({ id: users.id, displayName: users.displayName }).from(users).where(eq(users.id, studentId));
      const [agg] = await skillAggregates([studentId], r, skill);
      return json({
        student: st, skill: skill ?? null, summary: agg ? skillView(agg, r) : null, rules: r,
        evidence: rows.map(({ e, q, lessonTitle }) => ({
          questionId: e.questionId, skill: e.skill, attempts: e.attemptCount, assistedAnswers: e.assistedCount,
          firstIndependentAt: e.firstIndependentAt, firstIndependentCorrect: e.firstIndependentCorrect,
          independentCorrectAt: e.independentCorrectAt, points: e.pointsAwarded, lastSelected: e.lastSelected,
          lastCorrect: e.lastCorrect, lastAssisted: e.lastAssisted, lastAttemptAt: e.lastAttemptAt, lessonTitle: lessonTitle || "",
          lang: e.lang, question: q ? { id: q.id, prompt: q.prompt, passage: q.passage, choices: q.choices, answer: q.answer, explanation: q.explanation, type: q.type, section: q.section, category: q.category, subcategory: q.subcategory, questionImage: q.questionImage, choiceImages: q.choiceImages } : null,
        })),
      });
    }

    // ── library of reusable lessons ──
    if (a === "library" && method === "GET") {
      const mine = await staffClassIds(user);
      const placedInMine = mine.length ? (await db.select({ id: learningPlacements.lessonId }).from(learningPlacements).where(inArray(learningPlacements.classId, mine))).map((r) => r.id) : [];
      const rows = await db.select().from(lessons).where(isNull(lessons.archivedAt)).orderBy(desc(lessons.updatedAt));
      const visible = user.role === "admin" ? rows : rows.filter((l) => l.visibility === "public" || l.createdBy === user.id || placedInMine.includes(l.id));
      return json(visible.map((l) => ({ id: l.id, title: l.title, section: l.section, skillTags: l.skillTags, visibility: l.visibility, ownerClassId: l.ownerClassId, practiceCount: (l.practiceQuestionIds || []).length, videoProvider: l.videoProvider, hasUz: !!(l.content as any)?.explanation?.uz, hasRu: !!(l.content as any)?.explanation?.ru })));
    }

    // ── units ──
    if (a === "classes" && int(b) && c === "units" && method === "POST") {
      const cls = await manageableClass(user, int(b)!);
      if (!cls) return json({ error: "You can only build curricula for your own classes." }, 403);
      const v = await body();
      const title = str(v.title, 200);
      if (!title) return json({ error: "Enter a unit title." }, 400);
      const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${learningUnits.position}), -1)::int + 1` }).from(learningUnits).where(eq(learningUnits.classId, cls.id));
      const [row] = await db.insert(learningUnits).values({ classId: cls.id, title, titleI18n: i18n(v.titleI18n, false, 200), description: str(v.description, 2000), position: n, status: "draft", createdBy: user.id }).returning();
      return json(row, 201);
    }
    if (a === "units" && int(b)) {
      const [unit] = await db.select().from(learningUnits).where(eq(learningUnits.id, int(b)!)).limit(1);
      if (!unit || !(await manageableClass(user, unit.classId))) return json({ error: "Unit not found in your classes." }, 404);
      if (method === "PATCH" && !c) {
        const v = await body();
        const set: Partial<typeof learningUnits.$inferInsert> = { updatedAt: new Date() };
        if (v.title !== undefined) { const t = str(v.title, 200); if (!t) return json({ error: "Enter a unit title." }, 400); set.title = t; }
        if (v.titleI18n !== undefined) set.titleI18n = i18n(v.titleI18n, false, 200);
        if (v.description !== undefined) set.description = str(v.description, 2000);
        if (["draft", "published", "archived"].includes(v.status)) set.status = v.status;
        const [row] = await db.update(learningUnits).set(set).where(eq(learningUnits.id, unit.id)).returning();
        return json(row);
      }
      if (method === "POST" && c === "placements") {
        const v = await body();
        let lessonId = int(v.lessonId);
        if (lessonId) {
          const [l] = await db.select().from(lessons).where(eq(lessons.id, lessonId)).limit(1);
          if (!l || l.archivedAt || !(await lessonAccess(user, l)).ok) return json({ error: "That lesson is not available to reuse." }, 404);
        } else {
          const cols = await lessonColumns(v.lesson || {});
          const [created] = await db.insert(lessons).values({ ...cols, visibility: "class", ownerClassId: unit.classId, status: "published", createdBy: user.id, updatedBy: user.id }).returning();
          lessonId = created.id;
        }
        const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${learningPlacements.position}), -1)::int + 1` }).from(learningPlacements).where(eq(learningPlacements.unitId, unit.id));
        const [row] = await db.insert(learningPlacements).values({ classId: unit.classId, unitId: unit.id, lessonId, position: n, status: "draft", createdBy: user.id })
          .onConflictDoNothing({ target: [learningPlacements.unitId, learningPlacements.lessonId] }).returning();
        if (!row) return json({ error: "That lesson is already in this unit." }, 409);
        return json(row, 201);
      }
    }
    if (a === "classes" && int(b) && c === "reorder" && method === "POST") {
      const cls = await manageableClass(user, int(b)!);
      if (!cls) return json({ error: "You can only reorder your own classes." }, 403);
      const v = await body();
      const unitOrder = (Array.isArray(v.units) ? v.units : []).map(Number).filter(Number.isInteger);
      await db.transaction(async (tx) => {
        for (const [i, uid] of unitOrder.entries())
          await tx.update(learningUnits).set({ position: i }).where(and(eq(learningUnits.id, uid), eq(learningUnits.classId, cls.id)));
        for (const [uid, list] of Object.entries(v.lessons && typeof v.lessons === "object" ? v.lessons : {})) {
          const unitId = Number(uid);
          const [unit] = await tx.select().from(learningUnits).where(and(eq(learningUnits.id, unitId), eq(learningUnits.classId, cls.id)));
          if (!unit) continue;
          for (const [i, pid] of (Array.isArray(list) ? list : []).map(Number).entries())
            await tx.update(learningPlacements).set({ position: i, unitId }).where(and(eq(learningPlacements.id, pid), eq(learningPlacements.classId, cls.id)));
        }
      });
      return json({ ok: true });
    }

    // ── placements: publish, assign, move, remove, make class copy ──
    if (a === "placements" && int(b)) {
      const [p] = await db.select().from(learningPlacements).where(eq(learningPlacements.id, int(b)!)).limit(1);
      const cls = p ? await manageableClass(user, p.classId) : null;
      if (!p || !cls) return json({ error: "Lesson placement not found in your classes." }, 404);
      if (method === "PATCH" && !c) {
        const v = await body();
        const set: Partial<typeof learningPlacements.$inferInsert> = {};
        if (["draft", "published"].includes(v.status)) { set.status = v.status; if (v.status === "published" && !p.publishedAt) set.publishedAt = new Date(); }
        if (v.dueAt !== undefined) { const due = v.dueAt ? new Date(String(v.dueAt)) : null; if (due && Number.isNaN(due.getTime())) return json({ error: "Choose a valid due date." }, 400); set.dueAt = due; }
        if (v.assign === true) { set.assignedAt = new Date(); if (p.status !== "published") { set.status = "published"; set.publishedAt = p.publishedAt ?? new Date(); } }
        if (v.assign === false) set.assignedAt = null;
        const [row] = await db.update(learningPlacements).set(set).where(eq(learningPlacements.id, p.id)).returning();
        if (v.assign === true || (set.status === "published" && p.status !== "published")) {
          const [l] = await db.select({ title: lessons.title }).from(lessons).where(eq(lessons.id, p.lessonId));
          const members = (await db.select({ id: classEnrollments.studentId }).from(classEnrollments).where(and(eq(classEnrollments.classId, cls.id), eq(classEnrollments.status, "active")))).map((r) => r.id);
          await notify(members, { kind: "class", title: v.assign ? `New lesson assigned: “${l?.title}”` : `New lesson in ${cls.name}: “${l?.title}”`, link: { view: "learn" } });
        }
        return json(row);
      }
      if (method === "DELETE" && !c) {
        await db.delete(learningPlacements).where(eq(learningPlacements.id, p.id));
        return json({ removed: p.id });
      }
      if (method === "POST" && c === "copy") {
        const [src] = await db.select().from(lessons).where(eq(lessons.id, p.lessonId)).limit(1);
        if (!src) return json({ error: "Lesson not found." }, 404);
        const { id, createdAt, updatedAt, ...rest } = src;
        const copy = await db.transaction(async (tx) => {
          const [row] = await tx.insert(lessons).values({ ...rest, title: str(rest.title, 200), visibility: "class", ownerClassId: p.classId, sourceLessonId: src.id, createdBy: user.id, updatedBy: user.id, archivedAt: null }).returning();
          const mats = await tx.select().from(lessonMaterials).where(eq(lessonMaterials.lessonId, src.id));
          for (const m of mats) { const { id: _i, createdAt: _c, ...mr } = m; await tx.insert(lessonMaterials).values({ ...mr, lessonId: row.id }); }
          await tx.update(learningPlacements).set({ lessonId: row.id }).where(eq(learningPlacements.id, p.id));
          return row;
        });
        return json({ lesson: copy, placementId: p.id }, 201);
      }
    }

    // ── lesson authoring ──
    if (a === "lessons" && !b && method === "POST") {
      const v = await body();
      const cols = await lessonColumns(v);
      const [row] = await db.insert(lessons).values({ ...cols, visibility: v.visibility === "public" && user.role === "admin" ? "public" : "class", status: "published", createdBy: user.id, updatedBy: user.id }).returning();
      return json(row, 201);
    }
    if (a === "lessons" && int(b)) {
      const [lesson] = await db.select().from(lessons).where(eq(lessons.id, int(b)!)).limit(1);
      if (!lesson) return json({ error: "Lesson not found." }, 404);
      if (c === "scope" && method === "GET") return json(await lessonScope(user, lesson));
      const scope = await lessonScope(user, lesson);
      if (method === "PUT" && !c) {
        if (!scope.canEdit) return json({ error: scope.reason || "You cannot edit this lesson.", scope }, 403);
        const v = await body();
        const cols = await lessonColumns(v, lesson);
        const [row] = await db.update(lessons).set({ ...cols, updatedAt: new Date(), updatedBy: user.id }).where(eq(lessons.id, lesson.id)).returning();
        return json({ lesson: row, scope });
      }
      if (c === "materials" && method === "POST") {
        if (!scope.canEdit) return json({ error: scope.reason || "You cannot edit this lesson.", scope }, 403);
        const kind = ["pdf", "slides", "download", "captions", "link"].includes(url.searchParams.get("kind") || "") ? url.searchParams.get("kind")! : "download";
        const lang = ["en", "uz", "ru", "all"].includes(url.searchParams.get("lang") || "") ? url.searchParams.get("lang")! : "all";
        const [{ n }] = await db.select({ n: sql<number>`coalesce(max(${lessonMaterials.position}), -1)::int + 1` }).from(lessonMaterials).where(eq(lessonMaterials.lessonId, lesson.id));
        const type = (req.headers.get("content-type") || "").split(";")[0].trim();
        if (type === "application/json") {
          const v = await body();
          const link = httpsUrl(v.url);
          if (!link) return json({ error: "Paste an https:// link." }, 400);
          const [row] = await db.insert(lessonMaterials).values({ lessonId: lesson.id, kind: "link", title: str(v.title, 200) || link, lang: ["en", "uz", "ru", "all"].includes(v.lang) ? v.lang : "all", url: link, position: n, createdBy: user.id }).returning();
          return json(materialView(row), 201);
        }
        const buf = await req.arrayBuffer();
        if (!buf.byteLength) return json({ error: "Choose a file to upload." }, 400);
        if (buf.byteLength > MAX_MATERIAL_BYTES) return json({ error: "Files must be under 4.5 MB. Link larger files instead." }, 413);
        const fileName = str(url.searchParams.get("fileName"), 200) || "material";
        const key = `lesson/${lesson.id}/${randomBytes(12).toString("hex")}`;
        await materialStore().set(key, buf, { metadata: { contentType: type, fileName } });
        const [row] = await db.insert(lessonMaterials).values({ lessonId: lesson.id, kind, lang, title: str(url.searchParams.get("title"), 200) || fileName, blobKey: key, fileName, contentType: type || "application/octet-stream", size: buf.byteLength, position: n, createdBy: user.id }).returning();
        return json(materialView(row), 201);
      }
    }
    if (a === "materials" && int(b) && method === "DELETE") {
      const [m] = await db.select().from(lessonMaterials).where(eq(lessonMaterials.id, int(b)!)).limit(1);
      if (!m) return json({ error: "Material not found." }, 404);
      const [lesson] = await db.select().from(lessons).where(eq(lessons.id, m.lessonId)).limit(1);
      const scope = lesson ? await lessonScope(user, lesson) : null;
      if (!scope?.canEdit) return json({ error: scope?.reason || "You cannot edit this lesson." }, 403);
      await deleteMaterialRow(m);
      return json({ deleted: m.id });
    }

    return json({ error: "Not found" }, 404);
  } catch (e) {
    if (e instanceof Problem) return json({ error: e.message }, e.status);
    throw e;
  }
}
