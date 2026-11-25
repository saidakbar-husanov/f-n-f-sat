// netlify/lib/practice.ts — Question Bank / Challenging Questions practice
// sessions, the filtered practice pool and Question Rush draws.
//
// A session stores its ordered question ids, the student's position, every
// selection and every graded submission, so "Continue practice" restores the
// same set, order, filters, position and answers on any device. Question
// content is fetched a few questions at a time and every request re-checks the
// student's current subject access, so a permission change applies on the next
// request — including inside an open or resumed session.
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { attempts, challengeSets, practiceSessions, questions, users } from "../../db/schema.js";
import { accessFor, allows, allowedSubjects, type Area } from "./access.js";
import {
  filterPool, filtersFromParams, normalizeFilters, stableOrder, seededShuffle, applySelection, shouldGrade,
  effectiveSubjects, type PoolItem, type PracticeFilters, type AnswerEntry,
} from "./practice-core.js";
import { isAnswerCorrect, type FullTestDeps } from "./fulltests.js";
import { DOMAINS, SKILLS } from "./collections.js";

type DbUser = typeof users.$inferSelect;
type QuestionRow = typeof questions.$inferSelect;
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : r?.rows ?? []);
const int = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : null; };
const DOMAIN_ORDER = [...DOMAINS.math, ...DOMAINS.ebrw];
const MAX_SESSION = 600;
const MAX_ACTIVE_PER_KIND = 3;
const RUSH_DRAW = 90;

// ── Bank metadata cache ──
// Only the small columns needed to filter (plus a short plain-text preview)
// are cached, for a few seconds, per function instance. Content and keys are
// always read fresh.
type Meta = PoolItem & { type: string; preview: string };
let metaCache: { at: number; rows: Meta[] } | null = null;
const plain = (html: string) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim();
async function bankMeta(): Promise<Meta[]> {
  if (metaCache && Date.now() - metaCache.at < 20_000) return metaCache.rows;
  const rows = await db.select({
    id: questions.id, section: questions.section, category: questions.category, subcategory: questions.subcategory,
    difficulty: questions.difficulty, type: questions.type, preview: sql<string>`left(${questions.prompt}, 400)`,
  }).from(questions).where(eq(questions.scope, "BANK"));
  const out = rows.map((r) => ({ ...r, preview: plain(r.preview).slice(0, 160) }));
  metaCache = { at: Date.now(), rows: out };
  return out;
}
export function invalidateBankMeta() { metaCache = null; }

// Latest graded result per question for one student (any practice mode).
async function latestResults(studentId: number) {
  const rows = rowsOf(await db.execute(sql`select distinct on (question_id) question_id, correct from attempts
    where student = ${"u" + studentId} and mode not like 'mock%' order by question_id, created_at desc, id desc`));
  return new Map<number, "correct" | "incorrect">(rows.map((r) => [Number(r.question_id), r.correct ? "correct" : "incorrect"]));
}

const studentQuestion = (q: QuestionRow) => ({
  id: q.id, section: q.section, category: q.category, subcategory: q.subcategory, difficulty: q.difficulty, type: q.type,
  passage: q.passage, prompt: q.prompt, questionImage: q.questionImage, choices: q.choices, choiceImages: q.choiceImages,
});
const keyOf = (q: QuestionRow) => ({ answer: q.answer, acceptableAnswers: Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [], explanation: q.explanation ?? "" });

async function pool(req: Request, user: DbUser, f: PracticeFilters, area: Area) {
  const access = await accessFor(req, user);
  const allowed = allowedSubjects(access.rules, area);
  const meta = await bankMeta();
  const status = f.status.length ? await latestResults(user.id) : undefined;
  const items = filterPool(meta, f, allowed, status);
  return { items, allowed, status };
}

type Session = typeof practiceSessions.$inferSelect;
const areaOf = (s: Pick<Session, "kind">): Area => (s.kind === "challenge" ? "challenge" : "bank");

// Session view for the browser. Items whose subject or area is now switched
// off are marked locked and never carry content.
async function sessionView(req: Request, user: DbUser, s: Session) {
  const access = await accessFor(req, user);
  const ids = s.questionIds;
  const secs = ids.length ? await db.select({ id: questions.id, section: questions.section, scope: questions.scope }).from(questions).where(inArray(questions.id, ids)) : [];
  const secOf = new Map(secs.map((r) => [r.id, r.section]));
  const area = areaOf(s);
  const answers = s.answers as Record<string, AnswerEntry>;
  const items = ids.map((id) => {
    const a = answers[String(id)] || {};
    const section = secOf.get(id) ?? null;
    const locked = !section || !allows(access.rules, section, area);
    // Compact: only the fields that are set (sessions can hold hundreds of items).
    const item: Record<string, unknown> = { id };
    if (section && !locked) item.section = section;
    if (locked) item.locked = true;
    if (a.selected != null && a.selected !== "") item.selected = a.selected;
    if (a.submitted) { item.submitted = true; item.correct = !!a.correct; }
    if ((s.flagged || []).includes(id)) item.flagged = true;
    return item as { id: number; section?: string; locked?: boolean; selected?: string; submitted?: boolean; correct?: boolean; flagged?: boolean };
  });
  const answered = items.filter((i) => i.submitted).length;
  return {
    id: s.id, kind: s.kind, label: s.label, filters: s.filters, challengeSetId: s.challengeSetId, status: s.status,
    position: Math.min(Math.max(0, s.position), Math.max(0, ids.length - 1)), items, total: ids.length, answered,
    correct: items.filter((i) => i.submitted && i.correct).length, locked: items.filter((i) => i.locked).length,
    createdAt: s.createdAt, updatedAt: s.updatedAt,
  };
}

async function ownSession(user: DbUser, id: number) {
  const [s] = await db.select().from(practiceSessions).where(and(eq(practiceSessions.id, id), eq(practiceSessions.studentId, user.id))).limit(1);
  return s ?? null;
}

function filterLabel(f: PracticeFilters, allowed: string[]) {
  const subj = effectiveSubjects(f, allowed).map((s) => (s === "math" ? "Math" : "Reading & Writing")).join(" + ");
  const bits = [f.skills.length ? f.skills.join(", ") : f.domains.length ? f.domains.join(", ") : subj];
  if (f.difficulties.length) bits.push(f.difficulties.map((d) => d[0].toUpperCase() + d.slice(1)).join("/"));
  if (f.status.length) bits.push(f.status.map((s) => (s === "incorrect" ? "previously incorrect" : "unanswered")).join(" or "));
  return bits.filter(Boolean).join(" · ").slice(0, 200) || "Question Bank practice";
}

export async function handlePractice(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  if (parts[0] !== "practice") return null;
  const { json, requireUser } = deps;
  const url = new URL(req.url);
  const method = req.method;
  const [, a, b, c] = parts;
  const auth = await requireUser(req, ["student"]);
  if (auth.error) return auth.error;
  const user = auth.user!;

  // ── Filtered pool: counts and the results list (no question content) ──
  if (a === "pool" && method === "GET") {
    const f = filtersFromParams(url.searchParams);
    const mode = url.searchParams.get("mode") === "rush" ? "rush" : "bank";
    if (mode === "rush") f.status = [];
    const { items, allowed } = await pool(req, user, f, mode);
    const page = Math.max(0, Number(url.searchParams.get("page")) || 0);
    const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get("pageSize")) || 25));
    const ordered = stableOrder(items, DOMAIN_ORDER, SKILLS);
    const status = await latestResults(user.id);
    return json({
      count: ordered.length, allowedSubjects: allowed, filters: { ...f, subjects: f.subjects.filter((s) => allowed.includes(s)) },
      page, pageSize,
      items: mode === "rush" ? [] : ordered.slice(page * pageSize, (page + 1) * pageSize).map((q) => ({ ...q, status: status.get(q.id) ?? "unanswered" })),
    });
  }

  // ── Question Rush: filter first, then draw. Never tops up with non-matching questions. ──
  if (a === "rush" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const f = normalizeFilters(body.filters); f.status = [];
    const { items } = await pool(req, user, f, "rush");
    const want = Math.min(RUSH_DRAW, Math.max(1, Number(body.count) || RUSH_DRAW));
    const drawn = seededShuffle(items, (Date.now() ^ user.id) >>> 0).slice(0, want);
    const rows = drawn.length ? await db.select().from(questions).where(and(inArray(questions.id, drawn.map((d) => d.id)), eq(questions.scope, "BANK"))) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    return json({ available: items.length, questions: drawn.map((d) => byId.get(d.id)).filter(Boolean).map((q) => studentQuestion(q!)) });
  }

  if (a !== "sessions") return json({ error: "Not found." }, 404);

  // ── List unfinished sessions (Continue practice) ──
  if (!b && method === "GET") {
    const kind = url.searchParams.get("kind") === "challenge" ? "challenge" : "bank";
    const rows = await db.select().from(practiceSessions).where(and(eq(practiceSessions.studentId, user.id), eq(practiceSessions.kind, kind), eq(practiceSessions.status, "active")))
      .orderBy(desc(practiceSessions.updatedAt)).limit(MAX_ACTIVE_PER_KIND);
    const out = [];
    for (const s of rows) {
      const v = await sessionView(req, user, s);
      out.push({ id: v.id, kind: v.kind, label: v.label, filters: v.filters, total: v.total, answered: v.answered, position: v.position, locked: v.locked, updatedAt: v.updatedAt });
    }
    return json(out);
  }

  // ── Start a session ──
  if (!b && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const kind = body.kind === "challenge" ? "challenge" : "bank";
    const clientKey = typeof body.clientKey === "string" ? body.clientKey.slice(0, 80) : null;
    if (clientKey) {
      const [dup] = await db.select().from(practiceSessions).where(and(eq(practiceSessions.studentId, user.id), eq(practiceSessions.clientKey, clientKey))).limit(1);
      if (dup) return json(await sessionView(req, user, dup));
    }
    const access = await accessFor(req, user);
    let ids: number[] = [], label = "", filters: Record<string, unknown> = {}, setId: number | null = null;
    if (kind === "challenge") {
      setId = int(body.setId);
      const [set] = setId ? await db.select().from(challengeSets).where(eq(challengeSets.id, setId)).limit(1) : [];
      if (!set) return json({ error: "Set not found." }, 404);
      if (!allows(access.rules, set.section, "challenge")) return json({ error: "Challenging Questions for this subject are not available on your account." }, 403);
      ids = (await db.select({ id: questions.id }).from(questions).where(and(eq(questions.scope, "CHALLENGE"), eq(questions.challengeSetId, set.id))).orderBy(questions.setPosition, questions.id)).map((r) => r.id);
      label = set.title;
    } else {
      const f = normalizeFilters(body.filters);
      const { items, allowed } = await pool(req, user, f, "bank");
      if (!allowed.length) return json({ error: "Question Bank practice is not available on your account." }, 403);
      let ordered = stableOrder(items, DOMAIN_ORDER, SKILLS);
      if (body.shuffle) ordered = seededShuffle(ordered, (Date.now() ^ (user.id * 2654435761)) >>> 0);
      ids = ordered.map((q) => q.id);
      filters = { ...f, subjects: f.subjects.filter((s) => allowed.includes(s)), shuffle: !!body.shuffle };
      label = typeof body.label === "string" && body.label.trim() ? body.label.trim().slice(0, 200) : filterLabel(f, allowed);
    }
    if (!ids.length) return json({ error: "No questions match these filters.", count: 0 }, 400);
    ids = ids.slice(0, MAX_SESSION);
    const start = int(body.startQuestionId);
    const position = start && ids.includes(start) ? ids.indexOf(start) : 0;
    const [row] = await db.insert(practiceSessions).values({
      studentId: user.id, kind, label, filters, challengeSetId: setId, questionIds: ids, position, clientKey,
    }).onConflictDoNothing().returning();
    const s = row ?? (await db.select().from(practiceSessions).where(and(eq(practiceSessions.studentId, user.id), eq(practiceSessions.clientKey, clientKey!))).limit(1))[0];
    // Keep the Continue list short: older unfinished runs of the same kind close.
    const keep = (await db.select({ id: practiceSessions.id }).from(practiceSessions).where(and(eq(practiceSessions.studentId, user.id), eq(practiceSessions.kind, kind), eq(practiceSessions.status, "active")))
      .orderBy(desc(practiceSessions.updatedAt)).limit(MAX_ACTIVE_PER_KIND)).map((r) => r.id);
    await db.update(practiceSessions).set({ status: "abandoned" }).where(and(eq(practiceSessions.studentId, user.id), eq(practiceSessions.kind, kind), eq(practiceSessions.status, "active"), sql`${practiceSessions.id} not in (${sql.join([s.id, ...keep].map((i) => sql`${i}`), sql`, `)})`));
    return json(await sessionView(req, user, s), 201);
  }

  const sid = int(b);
  if (!sid) return json({ error: "Session not found." }, 404);
  const s = await ownSession(user, sid);
  if (!s) return json({ error: "Session not found." }, 404);
  const area = areaOf(s);

  if (!c && method === "GET") return json(await sessionView(req, user, s));

  // ── Question content, a few at a time, re-checking access for each ──
  if (c === "questions" && method === "GET") {
    const wanted = (url.searchParams.get("ids") || "").split(",").map(Number).filter((n) => Number.isInteger(n) && s.questionIds.includes(n)).slice(0, 6);
    if (!wanted.length) return json({ questions: [], locked: [] });
    const access = await accessFor(req, user);
    const rows = await db.select().from(questions).where(inArray(questions.id, wanted));
    const answers = s.answers as Record<string, AnswerEntry>;
    const out = [], locked: number[] = [];
    for (const q of rows) {
      if (!allows(access.rules, q.section, area)) { locked.push(q.id); continue; }
      const a = answers[String(q.id)];
      out.push({ ...studentQuestion(q), ...(a?.submitted ? { result: { selected: a.selected ?? "", correct: !!a.correct, ...keyOf(q) } } : {}) });
    }
    return json({ questions: out, locked });
  }

  if (s.status !== "active" && method !== "GET" && c !== "complete")
    return json({ error: "This practice session has ended.", status: s.status }, 409);

  // ── Position, selections and review flags ──
  // Each change is one atomic UPDATE on a single key, so concurrent saves never
  // overwrite each other or a graded answer: a selection only lands if it is
  // newer than the stored one (seq) and the question has not been submitted.
  if (!c && method === "PATCH") {
    const body = await req.json().catch(() => ({}));
    const sidLit = s.id;
    if (Number.isInteger(body.position) && body.position >= 0 && body.position < s.questionIds.length)
      await db.execute(sql`update practice_sessions set position = ${body.position}, updated_at = now() where id = ${sidLit}`);
    for (const sel of Array.isArray(body.selections) ? body.selections.slice(0, 20) : []) {
      const qid = Number(sel?.questionId);
      if (!s.questionIds.includes(qid)) continue;
      const k = String(qid), v = String(sel.value ?? "").slice(0, 200), seq = Math.max(0, Math.floor(Number(sel.seq) || 0));
      await db.execute(sql`update practice_sessions set answers = case
          when coalesce((answers->${k}->>'submitted')::boolean, false) then answers
          when coalesce((answers->${k}->>'seq')::bigint, -1) >= ${seq}::bigint then answers
          else jsonb_set(answers, array[${k}]::text[], coalesce(answers->${k}, '{}'::jsonb) || jsonb_build_object('selected', ${v}::text, 'seq', ${seq}::bigint), true) end,
        updated_at = now() where id = ${sidLit}`);
    }
    for (const fl of Array.isArray(body.flags) ? body.flags.slice(0, 20) : []) {
      const qid = Number(fl?.questionId);
      if (!s.questionIds.includes(qid)) continue;
      if (fl.on) await db.execute(sql`update practice_sessions set flagged = case when flagged @> to_jsonb(${qid}::int) then flagged else flagged || to_jsonb(${qid}::int) end, updated_at = now() where id = ${sidLit}`);
      else await db.execute(sql`update practice_sessions set flagged = coalesce((select jsonb_agg(e) from jsonb_array_elements(flagged) e where e <> to_jsonb(${qid}::int)), '[]'::jsonb), updated_at = now() where id = ${sidLit}`);
    }
    return json({ ok: true, savedAt: new Date().toISOString() });
  }

  // ── Submit one answer. Graded and counted exactly once per question. ──
  // The first submission atomically claims the question (one conditional
  // UPDATE); a repeat — revisit, retry after a timeout, a second tab — finds
  // it claimed and gets the stored result back without a new attempt.
  if (c === "answer" && method === "POST") {
    const body = await req.json().catch(() => ({}));
    const qid = Number(body.questionId);
    if (!s.questionIds.includes(qid)) return json({ error: "That question is not part of this session." }, 400);
    const selected = String(body.selected ?? "").trim().slice(0, 200);
    if (!selected) return json({ error: "Choose an answer first." }, 400);
    const [q] = await db.select().from(questions).where(eq(questions.id, qid)).limit(1);
    if (!q) return json({ error: "That question no longer exists." }, 404);
    const access = await accessFor(req, user);
    if (!allows(access.rules, q.section, area)) return json({ error: "This subject is not available on your account.", locked: true }, 403);
    const { consumeUsage, evaluateBadges } = await import("./platform.js");
    const k = String(qid);
    const correct = isAnswerCorrect(q, selected);
    const entry = { selected, submitted: true, correct, at: new Date().toISOString() };
    const claimed = rowsOf(await db.execute(sql`update practice_sessions
      set answers = jsonb_set(answers, array[${k}]::text[], coalesce(answers->${k}, '{}'::jsonb) || ${JSON.stringify(entry)}::jsonb, true), updated_at = now()
      where id = ${s.id} and status = 'active' and not coalesce((answers->${k}->>'submitted')::boolean, false) returning id`));
    if (!claimed.length) {
      const [cur] = await db.select().from(practiceSessions).where(eq(practiceSessions.id, s.id)).limit(1);
      const prev = (cur?.answers as Record<string, AnswerEntry>)?.[k];
      if (!prev?.submitted) return json({ error: "This practice session has ended.", status: cur?.status }, 409);
      return json({ questionId: qid, selected: prev.selected, correct: !!prev.correct, duplicate: true, ...keyOf(q) });
    }
    const usage = await consumeUsage(user.id, area === "challenge" ? "challenge" : "bank");
    if (!usage.ok) {
      // Not counted: release the claim and keep the student's choice.
      await db.execute(sql`update practice_sessions set answers = jsonb_set(answers, array[${k}]::text[], jsonb_build_object('selected', ${selected}::text, 'seq', 0), true) where id = ${s.id}`);
      return json(usage, 429);
    }
    const [att] = await db.insert(attempts).values({
      student: `u${user.id}`, questionId: q.id, section: q.section, category: q.category, difficulty: q.difficulty,
      mode: area === "challenge" ? "challenge" : "bank", selected, correct,
    }).returning({ id: attempts.id });
    await db.execute(sql`update practice_sessions set answers = jsonb_set(answers, array[${k}, 'attemptId']::text[], to_jsonb(${att.id}::int), true) where id = ${s.id}`);
    await evaluateBadges(user.id).catch(() => null);
    return json({ questionId: qid, selected, correct, duplicate: false, ...keyOf(q) }, 201);
  }

  if ((c === "complete" || c === "abandon") && method === "POST") {
    const status = c === "complete" ? "completed" : "abandoned";
    await db.update(practiceSessions).set({ status, completedAt: new Date(), updatedAt: new Date() }).where(eq(practiceSessions.id, s.id));
    const v = await sessionView(req, user, { ...s, status });
    return json(v);
  }
  return json({ error: "Method not allowed." }, 405);
}
