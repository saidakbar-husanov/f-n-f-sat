// netlify/lib/vocab.ts — SAT Vocabulary Bank, Sets, Tasks and Mastery API.
// Mounted by the main /api function under /api/vocab/*.
import { eq, and, inArray, desc, sql, isNull } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "../../db/index.js";
import {
  users, classes, classEnrollments,
  vocabWords, vocabSets, vocabTasks, vocabTaskResults, studentWordMastery,
} from "../../db/schema.js";
import { vocabAllowed, evaluateBadges } from "./platform.js";

type DbUser = typeof users.$inferSelect;
type WordRow = typeof vocabWords.$inferSelect;
type TaskRow = typeof vocabTasks.$inferSelect;
type ResultRow = typeof vocabTaskResults.$inferSelect;

export interface VocabDeps {
  json: (data: unknown, status?: number) => Response;
  requireUser: (req: Request, roles?: string[]) => Promise<{ error: Response | null; user: DbUser | null }>;
}

export const DIFFICULTIES = ["Foundation", "Medium", "Advanced"] as const;
export const PARTS_OF_SPEECH = ["noun", "verb", "adjective", "adverb"] as const;
export const TASK_TYPES = ["Flashcard_Review", "Matching_Game", "Multiple_Choice_Quiz", "Context_Fill_In_Blank", "Mixed_Quiz"] as const;
const MASTERY = ["New", "Learning", "Reviewing", "Mastered"] as const;
const MAX_IMPORT = 2000;

// ─────────────── NORMALISATION ───────────────
const str = (v: unknown, max = 2000) => String(v ?? "").trim().slice(0, max);
function strList(v: unknown, max = 20): string[] {
  const arr = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,;|]/) : [];
  const out: string[] = [];
  for (const item of arr) {
    const s = str(item, 120);
    if (s && !out.some((o) => o.toLowerCase() === s.toLowerCase())) out.push(s);
    if (out.length >= max) break;
  }
  return out;
}
function normDifficulty(v: unknown) {
  const s = str(v).toLowerCase();
  if (["foundation", "easy", "basic", "1", "2"].includes(s)) return "Foundation";
  if (["advanced", "hard", "difficult", "4", "5"].includes(s)) return "Advanced";
  return "Medium";
}
function normPos(v: unknown) {
  const s = str(v, 40).toLowerCase().replace(/\.$/, "");
  const map: Record<string, string> = { n: "noun", v: "verb", adj: "adjective", adv: "adverb" };
  return map[s] || (s || "noun");
}
// Make sure the context sentence carries the "_____" blank: if the author wrote
// the target word into the sentence instead, swap it for the blank.
function normSentence(sentence: string, word: string) {
  let s = sentence.replace(/_{2,}/g, "_____");
  if (!s.includes("_____") && word) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\w*\\b`, "i");
    if (re.test(s)) s = s.replace(re, "_____");
  }
  return s;
}

export interface WordInput {
  id: string; word: string; partOfSpeech: string; definition: string; uzbekTranslation: string; russianTranslation: string; satContextSentence: string;
  distractors: string[]; synonyms: string[]; antonyms: string[]; difficulty: string; tags: string[];
}

// Map loosely-shaped JSON (aliases included) to a VocabWord, or null when the
// entry has no word or definition.
export function normalizeWord(raw: any): WordInput | null {
  if (!raw || typeof raw !== "object") return null;
  const word = str(raw.word ?? raw.term ?? raw.name, 80);
  const definition = str(raw.definition ?? raw.meaning ?? raw.def, 1000);
  if (!word || !definition) return null;
  const id = str(raw.id, 80) || randomUUID();
  return {
    id, word,
    partOfSpeech: normPos(raw.partOfSpeech ?? raw.part_of_speech ?? raw.pos),
    definition,
    // Exact key from the uploaded JSON is "uzbekTranslation"; keep Unicode
    // apostrophes such as o‘ / g‘ as-is (NFC only joins combining marks).
    uzbekTranslation: str(raw.uzbekTranslation ?? raw.uzbek_translation ?? raw.uzbek, 1000).normalize("NFC"),
    russianTranslation: str(raw.russianTranslation ?? raw.russian_translation ?? raw.russian, 1000).normalize("NFC"),
    satContextSentence: normSentence(str(raw.satContextSentence ?? raw.sat_context_sentence ?? raw.contextSentence ?? raw.sentence ?? raw.example, 1500), word),
    distractors: strList(raw.distractors, 3).filter((d) => d.toLowerCase() !== word.toLowerCase()),
    synonyms: strList(raw.synonyms),
    antonyms: strList(raw.antonyms),
    difficulty: normDifficulty(raw.difficulty ?? raw.level),
    tags: strList(raw.tags, 12),
  };
}

const shuffle = <T,>(arr: T[]) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

// Top up missing distractors with random words of the same part of speech from
// the pool (falling back to any part of speech when the pool runs dry).
export function fillDistractors(w: WordInput, pool: { word: string; partOfSpeech: string }[]) {
  if (w.distractors.length >= 3) return w;
  const taken = new Set([w.word.toLowerCase(), ...w.distractors.map((d) => d.toLowerCase())]);
  const pick = (cands: string[]) => {
    for (const c of shuffle(cands)) {
      if (w.distractors.length >= 3) break;
      if (!taken.has(c.toLowerCase())) { w.distractors.push(c); taken.add(c.toLowerCase()); }
    }
  };
  pick(pool.filter((p) => p.partOfSpeech === w.partOfSpeech).map((p) => p.word));
  pick(pool.map((p) => p.word));
  return w;
}

const publicWord = (w: WordRow) => ({
  id: w.id, word: w.word, partOfSpeech: w.partOfSpeech, definition: w.definition,
  uzbekTranslation: w.uzbekTranslation,
  russianTranslation: w.russianTranslation,
  satContextSentence: w.satContextSentence, distractors: w.distractors, synonyms: w.synonyms,
  antonyms: w.antonyms, difficulty: w.difficulty, tags: w.tags, createdBy: w.createdBy,
  createdAt: w.createdAt, updatedAt: w.updatedAt,
});

function nextMastery(level: string, correct: boolean, correctCount: number) {
  const i = Math.max(0, MASTERY.indexOf(level as any));
  if (correct) {
    // Mastered needs at least three correct recalls overall.
    const next = Math.min(3, i + 1);
    return next === 3 && correctCount < 3 ? "Reviewing" : MASTERY[next];
  }
  return i >= 2 ? MASTERY[i - 1] : "Learning";
}

// ─────────────── TASK HELPERS ───────────────
async function studentClassIds(studentId: number) {
  const rows = await db.select({ classId: classEnrollments.classId }).from(classEnrollments)
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  return rows.map((r) => r.classId);
}

// Student ids a task reaches right now.
async function taskAudience(task: TaskRow): Promise<number[]> {
  if (task.allStudents) {
    const rows = await db.select({ id: users.id }).from(users).where(eq(users.role, "student"));
    return rows.map((r) => r.id);
  }
  const ids = new Set<number>(task.assignedTo);
  if (task.classIds.length) {
    const rows = await db.select({ studentId: classEnrollments.studentId }).from(classEnrollments)
      .where(and(inArray(classEnrollments.classId, task.classIds), eq(classEnrollments.status, "active")));
    rows.forEach((r) => ids.add(r.studentId));
  }
  return [...ids];
}

function studentStatus(task: TaskRow, result?: ResultRow | null) {
  if (result?.status === "Completed") return "Completed";
  if (new Date(task.dueDate).getTime() < Date.now()) return "Overdue";
  if (result) return "In_Progress";
  return "Pending";
}

function aggregateStatus(task: TaskRow, statuses: string[]) {
  if (statuses.length && statuses.every((s) => s === "Completed")) return "Completed";
  if (new Date(task.dueDate).getTime() < Date.now()) return "Overdue";
  if (statuses.some((s) => s === "In_Progress" || s === "Completed")) return "In_Progress";
  return "Pending";
}

async function canManageTask(user: DbUser, task: TaskRow) {
  return user.role === "admin" || task.assignedBy === user.id;
}

// Students and classes a mentor (or admin) may target.
export async function assignableTargets(user: DbUser) {
  const ownClasses = user.role === "admin"
    ? await db.select().from(classes).where(isNull(classes.deletedAt)).orderBy(desc(classes.createdAt))
    : await db.select().from(classes).where(and(eq(classes.mentorId, user.id), isNull(classes.deletedAt))).orderBy(desc(classes.createdAt));
  const classIds = ownClasses.map((c) => c.id);
  const enroll = classIds.length
    ? await db.select().from(classEnrollments).where(and(inArray(classEnrollments.classId, classIds), eq(classEnrollments.status, "active")))
    : [];
  let studentRows: DbUser[];
  if (user.role === "admin") {
    studentRows = await db.select().from(users).where(eq(users.role, "student")).orderBy(users.displayName);
  } else {
    const ids = [...new Set(enroll.map((e) => e.studentId))];
    studentRows = ids.length ? await db.select().from(users).where(inArray(users.id, ids)).orderBy(users.displayName) : [];
  }
  return {
    classes: ownClasses.map((c) => ({ id: c.id, name: c.name, studentIds: enroll.filter((e) => e.classId === c.id).map((e) => e.studentId) })),
    students: studentRows.filter((s) => s.status !== "banned").map((s) => ({ id: s.id, displayName: s.displayName, username: s.username, email: s.email })),
  };
}

async function parseTaskBody(b: any, user: DbUser, json: VocabDeps["json"], current?: TaskRow) {
  const title = str(b.title ?? current?.title, 200);
  const taskType = String(b.taskType ?? current?.taskType ?? "");
  const passingScore = Math.round(Number(b.passingScore ?? current?.passingScore ?? 80));
  const dueDate = new Date(String(b.dueDate ?? current?.dueDate ?? ""));
  const wordIds = [...new Set((Array.isArray(b.wordIds) ? b.wordIds : current?.wordIds ?? []).map((v: unknown) => String(v)))] as string[];
  const allStudents = user.role === "admin" ? Boolean(b.allStudents ?? current?.allStudents ?? false) : false;
  let assignedTo = [...new Set((Array.isArray(b.assignedTo) ? b.assignedTo : current?.assignedTo ?? []).map(Number).filter(Number.isInteger))] as number[];
  let classIds = [...new Set((Array.isArray(b.classIds) ? b.classIds : current?.classIds ?? []).map(Number).filter(Number.isInteger))] as number[];

  if (!title) return { error: json({ error: "Enter a task title." }, 400) };
  if (!TASK_TYPES.includes(taskType as any)) return { error: json({ error: "Choose a task type." }, 400) };
  if (!Number.isFinite(passingScore) || passingScore < 0 || passingScore > 100) return { error: json({ error: "Passing score must be between 0 and 100." }, 400) };
  if (Number.isNaN(dueDate.getTime())) return { error: json({ error: "Choose a due date." }, 400) };
  if (!current && dueDate <= new Date()) return { error: json({ error: "Choose a future due date." }, 400) };
  if (!wordIds.length) return { error: json({ error: "Add at least one word to the task." }, 400) };
  const found = await db.select({ id: vocabWords.id }).from(vocabWords).where(inArray(vocabWords.id, wordIds));
  if (found.length !== wordIds.length) return { error: json({ error: "Some words are not saved in the bank yet. Publish them first." }, 400) };
  if (taskType === "Matching_Game" && wordIds.length < 2) return { error: json({ error: "A matching game needs at least 2 words." }, 400) };

  // Mentors may only target their own classes and students.
  const targets = await assignableTargets(user);
  const okClass = new Set(targets.classes.map((c) => c.id));
  const okStudent = new Set(targets.students.map((s) => s.id));
  classIds = classIds.filter((id) => okClass.has(id));
  assignedTo = assignedTo.filter((id) => okStudent.has(id));
  if (!allStudents && !classIds.length && !assignedTo.length)
    return { error: json({ error: "Choose at least one student or class to assign." }, 400) };

  return { values: { title, taskType, passingScore, dueDate, wordIds, allStudents, assignedTo, classIds } };
}

// ─────────────── SHARED BANK WRITE ───────────────
// The one path that writes uploaded words into the bank — used by the vocab
// JSON upload and by full-test imports that carry a "vocabulary" list. Callers
// must already have checked the user is an admin or mentor; this enforces the
// per-word ownership rules (a mentor never overwrites another author's word)
// and that only an admin may replace the whole bank.
export async function mergeVocabWords(list: unknown[], user: DbUser, mode: "merge" | "replace" | "translations" = "merge"): Promise<{ created: number; updated: number; skipped: number; removed: number; invalid: number; unmatched?: number; alreadySet?: number; wordIds: string[] }> {
  if (user.role !== "admin" && user.role !== "mentor") throw new Error("Only admins and mentors can change the vocabulary bank.");
  if (mode === "translations") return fillVocabTranslations(list, user);
  if (mode === "replace" && user.role !== "admin") throw new Error("Only the Super Admin can replace the whole bank.");
  const existing = await db.select().from(vocabWords);
  const byId = new Map(existing.map((w) => [w.id, w]));
  const byWord = new Map(existing.map((w) => [w.word.toLowerCase(), w]));
  const batch: WordInput[] = [];
  let invalid = 0;
  const seen = new Set<string>();
  for (const raw of list) {
    const w = normalizeWord(raw);
    if (!w) { invalid++; continue; }
    // Same word already in the bank under another id → update that entry.
    const twin = byWord.get(w.word.toLowerCase());
    if (twin && !byId.has(w.id)) w.id = twin.id;
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    batch.push(w);
  }
  if (!batch.length) return { created: 0, updated: 0, skipped: 0, removed: 0, invalid, wordIds: [] as string[] };

  const pool = [...batch, ...(mode === "merge" ? existing : [])].map((w) => ({ word: w.word, partOfSpeech: w.partOfSpeech }));
  let skipped = 0, created = 0, updated = 0;
  const savedIds: string[] = [];
  for (const w of batch) {
    fillDistractors(w, pool);
    const prior = byId.get(w.id);
    if (prior && user.role !== "admin" && prior.createdBy !== user.id) {
      // Mentors cannot overwrite another author's word, but it still counts
      // toward the uploaded batch so it can go straight into a set or task.
      skipped++; savedIds.push(w.id); continue;
    }
    // A file without a translation never wipes one that is already stored.
    if (!w.uzbekTranslation && prior?.uzbekTranslation) w.uzbekTranslation = prior.uzbekTranslation;
    if (!w.russianTranslation && prior?.russianTranslation) w.russianTranslation = prior.russianTranslation;
    const { id: wid, ...rest } = w;
    await db.insert(vocabWords).values({ ...w, createdBy: prior?.createdBy ?? user.id })
      .onConflictDoUpdate({ target: vocabWords.id, set: { ...rest, updatedAt: new Date() } });
    if (prior) updated++; else created++;
    savedIds.push(wid);
  }
  let removed = 0;
  if (mode === "replace") {
    const keep = new Set(savedIds);
    const drop = existing.filter((w) => !keep.has(w.id)).map((w) => w.id);
    if (drop.length) {
      await db.delete(vocabWords).where(inArray(vocabWords.id, drop));
      await db.delete(studentWordMastery).where(inArray(studentWordMastery.wordId, drop));
      removed = drop.length;
    }
  }
  return { created, updated, skipped, removed, invalid, wordIds: savedIds };
}

// Re-import of an already-imported file: only fills an empty Uzbek translation
// on entries that already exist (matched by id, then by word). Nothing else on
// the entry changes, no entries are created or removed, and mastery/progress
// rows are untouched. Mentors may only fill words they authored.
export async function fillVocabTranslations(list: unknown[], user: DbUser) {
  if (user.role !== "admin" && user.role !== "mentor") throw new Error("Only admins and mentors can change the vocabulary bank.");
  const existing = await db.select().from(vocabWords);
  const byId = new Map(existing.map((w) => [w.id, w]));
  const byWord = new Map(existing.map((w) => [w.word.toLowerCase(), w]));
  let updated = 0, skipped = 0, invalid = 0, unmatched = 0, alreadySet = 0;
  const wordIds: string[] = [];
  const done = new Set<string>();
  for (const raw of list) {
    const id = raw && typeof raw === "object" ? str((raw as any).id, 80) : "";
    const w = normalizeWord(raw);
    if (!w) { invalid++; continue; }
    const prior = (id && byId.get(id)) || byWord.get(w.word.toLowerCase());
    if (!prior) { unmatched++; continue; }
    if (done.has(prior.id)) continue;
    done.add(prior.id);
    wordIds.push(prior.id);
    // Fill whichever translations (Uzbek, Russian) are still empty on the entry.
    const fill: { uzbekTranslation?: string; russianTranslation?: string } = {};
    if (w.uzbekTranslation && !prior.uzbekTranslation) fill.uzbekTranslation = w.uzbekTranslation;
    if (w.russianTranslation && !prior.russianTranslation) fill.russianTranslation = w.russianTranslation;
    if (!w.uzbekTranslation && !w.russianTranslation) continue;
    if (!Object.keys(fill).length) { alreadySet++; continue; }
    if (user.role !== "admin" && prior.createdBy !== user.id) { skipped++; continue; }
    await db.update(vocabWords).set({ ...fill, updatedAt: new Date() }).where(eq(vocabWords.id, prior.id));
    updated++;
  }
  return { created: 0, updated, skipped, removed: 0, invalid, unmatched, alreadySet, wordIds };
}

// ─────────────── HANDLER ───────────────
export async function handleVocab(req: Request, parts: string[], deps: VocabDeps): Promise<Response> {
  const { json, requireUser } = deps;
  const method = req.method;
  const [, sub, id, action] = parts; // ["vocab", sub, id, action]

  // ── WORDS ──
  if (sub === "words") {
    if (method === "GET" && !id) {
      const auth = await requireUser(req);
      if (auth.error) return auth.error;
      const rows = await db.select().from(vocabWords).orderBy(vocabWords.word);
      const authorIds = [...new Set(rows.map((w) => w.createdBy).filter((v): v is number => v != null))];
      const authors = authorIds.length ? await db.select({ id: users.id, displayName: users.displayName, role: users.role }).from(users).where(inArray(users.id, authorIds)) : [];
      const byAuthor = new Map(authors.map((a) => [a.id, a]));
      return json(rows.map((w) => ({ ...publicWord(w), author: w.createdBy != null ? byAuthor.get(w.createdBy) ?? null : null })));
    }
    if (method === "POST" && !id) {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const w = normalizeWord(await req.json());
      if (!w) return json({ error: "A word needs both a word and a definition." }, 400);
      const [exists] = await db.select({ id: vocabWords.id }).from(vocabWords).where(eq(vocabWords.id, w.id));
      if (exists) w.id = randomUUID();
      const pool = await db.select({ word: vocabWords.word, partOfSpeech: vocabWords.partOfSpeech }).from(vocabWords);
      fillDistractors(w, pool);
      const [row] = await db.insert(vocabWords).values({ ...w, createdBy: auth.user!.id }).returning();
      return json(publicWord(row), 201);
    }
    if ((method === "PUT" || method === "PATCH") && id) {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const [current] = await db.select().from(vocabWords).where(eq(vocabWords.id, id));
      if (!current) return json({ error: "Word not found." }, 404);
      if (auth.user!.role !== "admin" && current.createdBy !== auth.user!.id)
        return json({ error: "Only the Super Admin can edit words created by others." }, 403);
      const b = await req.json();
      const w = normalizeWord({ ...publicWord(current), ...b, id });
      if (!w) return json({ error: "A word needs both a word and a definition." }, 400);
      const pool = await db.select({ word: vocabWords.word, partOfSpeech: vocabWords.partOfSpeech }).from(vocabWords);
      fillDistractors(w, pool);
      const { id: _id, ...rest } = w;
      const [row] = await db.update(vocabWords).set({ ...rest, updatedAt: new Date() }).where(eq(vocabWords.id, id)).returning();
      return json(publicWord(row));
    }
    if (method === "DELETE" && id) {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const [current] = await db.select().from(vocabWords).where(eq(vocabWords.id, id));
      if (!current) return json({ error: "Word not found." }, 404);
      if (auth.user!.role !== "admin" && current.createdBy !== auth.user!.id)
        return json({ error: "Only the Super Admin can delete words created by others." }, 403);
      await db.delete(vocabWords).where(eq(vocabWords.id, id));
      await db.delete(studentWordMastery).where(eq(studentWordMastery.wordId, id));
      return json({ deleted: id });
    }
  }

  // ── BULK JSON IMPORT ──
  // body: { words: [...], mode: "merge" | "replace" | "translations" }
  // "translations" only fills empty Uzbek translations on existing entries.
  if (sub === "import" && method === "POST") {
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    const user = auth.user!;
    const b = await req.json();
    const list = Array.isArray(b) ? b : Array.isArray(b?.words) ? b.words : null;
    if (!list) return json({ error: "Upload a JSON array of words." }, 400);
    if (list.length > MAX_IMPORT) return json({ error: `Upload at most ${MAX_IMPORT} words at a time.` }, 400);
    const mode = b?.mode === "replace" ? "replace" : b?.mode === "translations" ? "translations" : "merge";
    if (mode === "replace" && user.role !== "admin") return json({ error: "Only the Super Admin can replace the whole bank." }, 403);

    const merged = await mergeVocabWords(list, user, mode);
    if (!merged.wordIds.length) return json({ error: mode === "translations" ? "None of these entries match a word already in the bank." : "No valid words found — each entry needs a word and a definition." }, 400);
    const { created, updated, skipped, removed, invalid, wordIds: savedIds } = merged;
    const rows = await db.select().from(vocabWords).orderBy(vocabWords.word);
    return json({ mode, created, updated, skipped, removed, invalid, unmatched: merged.unmatched ?? 0, alreadySet: merged.alreadySet ?? 0, wordIds: savedIds, words: rows.map(publicWord) });
  }

  // ── SETS ──
  if (sub === "sets") {
    if (method === "GET" && !id) {
      const auth = await requireUser(req);
      if (auth.error) return auth.error;
      const u = auth.user!;
      const rows = await db.select().from(vocabSets).orderBy(desc(vocabSets.createdAt));
      const visible = u.role === "admin" ? rows : rows.filter((s) => s.isPublic || s.createdBy === u.id);
      const authorIds = [...new Set(visible.map((s) => s.createdBy).filter((v): v is number => v != null))];
      const authors = authorIds.length ? await db.select({ id: users.id, displayName: users.displayName, role: users.role }).from(users).where(inArray(users.id, authorIds)) : [];
      const byAuthor = new Map(authors.map((a) => [a.id, a]));
      return json(visible.map((s) => ({ ...s, author: s.createdBy != null ? byAuthor.get(s.createdBy) ?? null : null })));
    }
    if ((method === "POST" && !id) || (method === "PUT" && id)) {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const b = await req.json();
      let current: typeof vocabSets.$inferSelect | undefined;
      if (id) {
        [current] = await db.select().from(vocabSets).where(eq(vocabSets.id, id));
        if (!current) return json({ error: "Set not found." }, 404);
        if (auth.user!.role !== "admin" && current.createdBy !== auth.user!.id) return json({ error: "This set belongs to someone else." }, 403);
      }
      const title = str(b.title ?? current?.title, 200);
      const description = str(b.description ?? current?.description, 2000);
      const isPublic = Boolean(b.isPublic ?? current?.isPublic ?? true);
      const wordIds = [...new Set((Array.isArray(b.wordIds) ? b.wordIds : current?.wordIds ?? []).map((v: unknown) => String(v)))] as string[];
      if (!title) return json({ error: "Name the set." }, 400);
      if (!wordIds.length) return json({ error: "Add at least one word to the set." }, 400);
      const found = await db.select({ id: vocabWords.id }).from(vocabWords).where(inArray(vocabWords.id, wordIds));
      if (found.length !== wordIds.length) return json({ error: "Some words are not saved in the bank yet. Publish them first." }, 400);
      if (current) {
        const [row] = await db.update(vocabSets).set({ title, description, isPublic, wordIds }).where(eq(vocabSets.id, current.id)).returning();
        return json(row);
      }
      const [row] = await db.insert(vocabSets).values({ id: randomUUID(), title, description, isPublic, wordIds, createdBy: auth.user!.id }).returning();
      return json(row, 201);
    }
    if (method === "DELETE" && id) {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const [current] = await db.select().from(vocabSets).where(eq(vocabSets.id, id));
      if (!current) return json({ error: "Set not found." }, 404);
      if (auth.user!.role !== "admin" && current.createdBy !== auth.user!.id) return json({ error: "This set belongs to someone else." }, 403);
      await db.delete(vocabSets).where(eq(vocabSets.id, id));
      return json({ deleted: id });
    }
  }

  // ── ASSIGNABLE TARGETS ──
  if (sub === "targets" && method === "GET") {
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    return json(await assignableTargets(auth.user!));
  }

  // ── TASKS ──
  if (sub === "tasks") {
    if (method === "GET" && !id) {
      const auth = await requireUser(req);
      if (auth.error) return auth.error;
      const u = auth.user!;
      if (u.role === "student") {
        const myClasses = await studentClassIds(u.id);
        const all = await db.select().from(vocabTasks).orderBy(vocabTasks.dueDate);
        const mine = all.filter((t) => t.allStudents || t.assignedTo.includes(u.id) || t.classIds.some((c) => myClasses.includes(c)));
        const results = mine.length ? await db.select().from(vocabTaskResults)
          .where(and(eq(vocabTaskResults.studentId, u.id), inArray(vocabTaskResults.taskId, mine.map((t) => t.id)))) : [];
        const byTask = new Map(results.map((r) => [r.taskId, r]));
        const authorIds = [...new Set(mine.map((t) => t.assignedBy))];
        const authors = authorIds.length ? await db.select({ id: users.id, displayName: users.displayName, role: users.role }).from(users).where(inArray(users.id, authorIds)) : [];
        const byAuthor = new Map(authors.map((a) => [a.id, a]));
        return json(mine.map((t) => {
          const r = byTask.get(t.id) ?? null;
          return { ...t, assigner: byAuthor.get(t.assignedBy) ?? null, status: studentStatus(t, r), result: r };
        }));
      }
      const rows = u.role === "admin"
        ? await db.select().from(vocabTasks).orderBy(desc(vocabTasks.createdAt))
        : await db.select().from(vocabTasks).where(eq(vocabTasks.assignedBy, u.id)).orderBy(desc(vocabTasks.createdAt));
      const results = rows.length ? await db.select().from(vocabTaskResults).where(inArray(vocabTaskResults.taskId, rows.map((t) => t.id))) : [];
      const out = [];
      const nameCache = new Map<number, { id: number; displayName: string; role: string } | null>();
      const lookup = async (ids: number[]) => {
        const missing = ids.filter((i) => !nameCache.has(i));
        if (missing.length) {
          const found = await db.select({ id: users.id, displayName: users.displayName, role: users.role }).from(users).where(inArray(users.id, missing));
          missing.forEach((i) => nameCache.set(i, found.find((f) => f.id === i) ?? null));
        }
      };
      for (const t of rows) {
        const audience = await taskAudience(t);
        await lookup([...audience, t.assignedBy]);
        const progress = audience.map((sid) => {
          const r = results.find((x) => x.taskId === t.id && x.studentId === sid) ?? null;
          return {
            student: nameCache.get(sid) ?? { id: sid, displayName: `Student #${sid}`, role: "student" },
            status: studentStatus(t, r), bestScore: r?.bestScore ?? null, lastScore: r?.lastScore ?? null,
            attempts: r?.attemptCount ?? 0, missedWordIds: r?.missedWordIds ?? [], completedAt: r?.completedAt ?? null,
          };
        });
        const statuses = progress.map((p) => p.status);
        out.push({
          ...t, assigner: nameCache.get(t.assignedBy) ?? null, progress,
          completedCount: statuses.filter((s) => s === "Completed").length,
          status: aggregateStatus(t, statuses),
        });
      }
      return json(out);
    }

    if ((method === "POST" && !id) || (method === "PUT" && id && !action)) {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const u = auth.user!;
      if (u.role === "mentor" && u.status !== "active") return json({ error: "Activate your mentor account first." }, 403);
      let current: TaskRow | undefined;
      if (id) {
        [current] = await db.select().from(vocabTasks).where(eq(vocabTasks.id, id));
        if (!current) return json({ error: "Task not found." }, 404);
        if (!(await canManageTask(u, current))) return json({ error: "This task belongs to another mentor." }, 403);
      }
      const parsed = await parseTaskBody(await req.json(), u, json, current);
      if ("error" in parsed) return parsed.error!;
      if (current) {
        const [row] = await db.update(vocabTasks).set(parsed.values!).where(eq(vocabTasks.id, current.id)).returning();
        return json(row);
      }
      const [row] = await db.insert(vocabTasks).values({ id: randomUUID(), assignedBy: u.id, ...parsed.values! }).returning();
      return json(row, 201);
    }

    if (method === "DELETE" && id) {
      const auth = await requireUser(req, ["admin", "mentor"]);
      if (auth.error) return auth.error;
      const [current] = await db.select().from(vocabTasks).where(eq(vocabTasks.id, id));
      if (!current) return json({ error: "Task not found." }, 404);
      if (!(await canManageTask(auth.user!, current))) return json({ error: "This task belongs to another mentor." }, 403);
      await db.delete(vocabTasks).where(eq(vocabTasks.id, id));
      await db.delete(vocabTaskResults).where(eq(vocabTaskResults.taskId, id));
      return json({ deleted: id });
    }

    // Student lifecycle: start → submit (score). Passing marks it Completed.
    if (method === "POST" && id && (action === "start" || action === "submit")) {
      const auth = await requireUser(req, ["student"]);
      if (auth.error) return auth.error;
      const u = auth.user!;
      const [task] = await db.select().from(vocabTasks).where(eq(vocabTasks.id, id));
      if (!task) return json({ error: "Task not found." }, 404);
      const myClasses = await studentClassIds(u.id);
      if (!(task.allStudents || task.assignedTo.includes(u.id) || task.classIds.some((c) => myClasses.includes(c))))
        return json({ error: "This task is not assigned to you." }, 403);
      const [existing] = await db.select().from(vocabTaskResults)
        .where(and(eq(vocabTaskResults.taskId, id), eq(vocabTaskResults.studentId, u.id)));
      if (action === "start") {
        if (existing) return json({ ...existing, status: studentStatus(task, existing) });
        const [row] = await db.insert(vocabTaskResults).values({ taskId: id, studentId: u.id }).onConflictDoNothing().returning();
        return json({ ...(row ?? existing), status: studentStatus(task, row ?? existing) });
      }
      const b = await req.json();
      const score = Math.max(0, Math.min(100, Math.round(Number(b.score) || 0)));
      const missed = [...new Set((Array.isArray(b.missedWordIds) ? b.missedWordIds : []).map(String) as string[])].filter((w) => task.wordIds.includes(w));
      const passed = score >= task.passingScore;
      const now = new Date();
      const wasCompleted = existing?.status === "Completed";
      const values = {
        status: wasCompleted || passed ? "Completed" : "In_Progress",
        bestScore: Math.max(existing?.bestScore ?? 0, score),
        lastScore: score,
        attemptCount: (existing?.attemptCount ?? 0) + 1,
        missedWordIds: missed,
        completedAt: wasCompleted ? existing!.completedAt : passed ? now : null,
      };
      const [row] = existing
        ? await db.update(vocabTaskResults).set(values).where(eq(vocabTaskResults.id, existing.id)).returning()
        : await db.insert(vocabTaskResults).values({ taskId: id, studentId: u.id, ...values }).returning();
      return json({ ...row, passed, status: studentStatus(task, row) });
    }
  }

  // ── MASTERY & PERSONAL DECK ──
  if (sub === "mastery") {
    if (method === "GET") {
      const auth = await requireUser(req);
      if (auth.error) return auth.error;
      const rows = await db.select().from(studentWordMastery).where(eq(studentWordMastery.studentId, auth.user!.id));
      return json(rows);
    }
    // body: { results: [{ wordId, correct }] }
    if (method === "POST") {
      const auth = await requireUser(req, ["student"]);
      if (auth.error) return auth.error;
      const u = auth.user!;
      const b = await req.json();
      const results = (Array.isArray(b.results) ? b.results : []).slice(0, 500)
        .map((r: any) => ({ wordId: String(r?.wordId ?? ""), correct: Boolean(r?.correct) }))
        .filter((r: { wordId: string }) => r.wordId);
      if (!results.length) return json([]);
      // Quiz answers only count on a day with a counted quiz session (daily limit).
      if (!(await vocabAllowed(u.id))) return json({ error: "Daily vocabulary quiz limit reached. It resets tomorrow." }, 429);
      const ids = [...new Set(results.map((r: { wordId: string }) => r.wordId))] as string[];
      const known = new Set((await db.select({ id: vocabWords.id }).from(vocabWords).where(inArray(vocabWords.id, ids))).map((r) => r.id));
      const current = await db.select().from(studentWordMastery)
        .where(and(eq(studentWordMastery.studentId, u.id), inArray(studentWordMastery.wordId, ids)));
      const state = new Map(current.map((r) => [r.wordId, { ...r }]));
      for (const r of results) {
        if (!known.has(r.wordId)) continue;
        const s = state.get(r.wordId) ?? { studentId: u.id, wordId: r.wordId, masteryLevel: "New", correctCount: 0, incorrectCount: 0, starred: false } as any;
        if (r.correct) s.correctCount++; else s.incorrectCount++;
        s.masteryLevel = nextMastery(s.masteryLevel, r.correct, s.correctCount);
        s.lastReviewedAt = new Date();
        state.set(r.wordId, s);
      }
      const saved = [];
      for (const s of state.values()) {
        if (!known.has(s.wordId)) continue;
        const [row] = await db.insert(studentWordMastery).values({
          studentId: u.id, wordId: s.wordId, masteryLevel: s.masteryLevel, correctCount: s.correctCount,
          incorrectCount: s.incorrectCount, starred: s.starred, lastReviewedAt: s.lastReviewedAt,
        }).onConflictDoUpdate({
          target: [studentWordMastery.studentId, studentWordMastery.wordId],
          set: { masteryLevel: s.masteryLevel, correctCount: s.correctCount, incorrectCount: s.incorrectCount, lastReviewedAt: s.lastReviewedAt },
        }).returning();
        saved.push(row);
      }
      await evaluateBadges(u.id);
      return json(saved);
    }
  }

  // PUT /vocab/deck/:wordId { starred }
  if (sub === "deck" && id && method === "PUT") {
    const auth = await requireUser(req, ["student"]);
    if (auth.error) return auth.error;
    const u = auth.user!;
    const b = await req.json();
    const [word] = await db.select({ id: vocabWords.id }).from(vocabWords).where(eq(vocabWords.id, id));
    if (!word) return json({ error: "Word not found." }, 404);
    const starred = Boolean(b.starred);
    const [row] = await db.insert(studentWordMastery).values({ studentId: u.id, wordId: id, starred })
      .onConflictDoUpdate({ target: [studentWordMastery.studentId, studentWordMastery.wordId], set: { starred } }).returning();
    return json(row);
  }

  // ── ANALYTICS ── (admin: platform-wide; mentor: their own students)
  if (sub === "analytics" && method === "GET") {
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    const u = auth.user!;
    let studentScope: number[] | null = null;
    if (u.role === "mentor") studentScope = (await assignableTargets(u)).students.map((s) => s.id);

    const [{ count: totalWords }] = await db.select({ count: sql<number>`count(*)::int` }).from(vocabWords);
    const [{ count: totalSets }] = await db.select({ count: sql<number>`count(*)::int` }).from(vocabSets);
    const tasks = u.role === "admin" ? await db.select().from(vocabTasks) : await db.select().from(vocabTasks).where(eq(vocabTasks.assignedBy, u.id));
    const results = tasks.length ? await db.select().from(vocabTaskResults).where(inArray(vocabTaskResults.taskId, tasks.map((t) => t.id))) : [];
    let assigned = 0, completed = 0;
    for (const t of tasks) {
      const audience = await taskAudience(t);
      assigned += audience.length;
      completed += results.filter((r) => r.taskId === t.id && r.status === "Completed" && audience.includes(r.studentId)).length;
    }
    if (studentScope && !studentScope.length) {
      return json({ totalWords, totalSets, totalTasks: tasks.length, assigned, completed, completionRate: assigned ? Math.round((completed / assigned) * 100) : 0, topMissed: [], masteryBreakdown: {} });
    }
    const scopeCond = studentScope ? inArray(studentWordMastery.studentId, studentScope) : undefined;
    const missedRows = await db.select({
      wordId: studentWordMastery.wordId,
      missed: sql<number>`sum(${studentWordMastery.incorrectCount})::int`,
      correct: sql<number>`sum(${studentWordMastery.correctCount})::int`,
      students: sql<number>`count(*) filter (where ${studentWordMastery.incorrectCount} > 0)::int`,
    }).from(studentWordMastery).where(scopeCond)
      .groupBy(studentWordMastery.wordId)
      .orderBy(sql`sum(${studentWordMastery.incorrectCount}) desc`).limit(10);
    const top = missedRows.filter((r) => r.missed > 0);
    const words = top.length ? await db.select().from(vocabWords).where(inArray(vocabWords.id, top.map((r) => r.wordId))) : [];
    const breakdown = await db.select({ level: studentWordMastery.masteryLevel, count: sql<number>`count(*)::int` })
      .from(studentWordMastery).where(scopeCond).groupBy(studentWordMastery.masteryLevel);
    return json({
      totalWords, totalSets, totalTasks: tasks.length, assigned, completed,
      completionRate: assigned ? Math.round((completed / assigned) * 100) : 0,
      topMissed: top.map((r) => ({ ...r, word: words.find((w) => w.id === r.wordId)?.word ?? r.wordId })),
      masteryBreakdown: Object.fromEntries(breakdown.map((b) => [b.level, b.count])),
    });
  }

  return json({ error: "Not found" }, 404);
}
