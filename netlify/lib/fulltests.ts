// netlify/lib/fulltests.ts — full-length Digital SAT tests: the shared module
// and grading helpers, the 1-click file importer / exporter, adaptive Module 2
// routing, scaled score reports, exam tasks (assigned tests) and analytics.
// The main /api function mounts the routes in `handleFullTests`.
import { eq, and, inArray, desc, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  users, classEnrollments, questions, settings, tests, testModules, testModuleQuestions,
  testAttempts, testAssignments,
} from "../../db/schema.js";
import { assignableTargets, normalizeWord, mergeVocabWords, type WordInput } from "./vocab.js";
import { SEED_FULL_TEST } from "./fulltest-seed.js";
import EXAMPLE_TEST from "../../docs/test-import/example-test.json" with { type: "json" };
import IMPORT_SCHEMA from "../../docs/test-import/sat-test-import.schema.json" with { type: "json" };
import {
  ImageRegistry, convertRichText, decodeImage, type RichStats, questionMediaStore, mediaKeyOf,
  mediaKeysInQuestion, questionMediaExists, saveQuestionMedia, MEDIA_URL_PREFIX,
} from "./test-import.js";
import { createHash } from "node:crypto";

type DbUser = typeof users.$inferSelect;
export type TestRow = typeof tests.$inferSelect;
export type TestModuleRow = typeof testModules.$inferSelect;
export type QuestionRow = typeof questions.$inferSelect;
export type TestAttemptRow = typeof testAttempts.$inferSelect;
export type AssignmentRow = typeof testAssignments.$inferSelect;

export const BANK = "BANK";
export const TEST_EXCLUSIVE = "TEST_EXCLUSIVE";
export type QuestionSource = typeof BANK | typeof TEST_EXCLUSIVE;
export type ModuleQuestion = QuestionRow & { source: QuestionSource };

export interface FullTestDeps {
  json: (data: unknown, status?: number) => Response;
  requireUser: (req: Request, roles?: string[]) => Promise<{ error: Response | null; user: DbUser | null }>;
}

// ─────────────── SANITISING ───────────────
// Rich text is stored as HTML. The browser sanitises again before rendering;
// this strips the obvious injection vectors so nothing dangerous is persisted.
export function sanitizeRichHtml(raw: unknown, limit = 200_000) {
  return String(raw ?? "")
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|form)\b[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta|form)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "")
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "")
    .slice(0, limit);
}
const escHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

// ─────────────── MODULES & QUESTIONS ───────────────
export async function loadTestModules(testId: number) {
  return db.select().from(testModules).where(eq(testModules.testId, testId))
    .orderBy(testModules.position, testModules.id);
}

export async function loadModuleQuestions(moduleId: number) {
  const links = await db.select().from(testModuleQuestions)
    .where(eq(testModuleQuestions.moduleId, moduleId))
    .orderBy(testModuleQuestions.position, testModuleQuestions.id);
  const ids = links.map((l) => l.questionId);
  if (!ids.length) return [] as ModuleQuestion[];
  const rows = await db.select().from(questions).where(inArray(questions.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return links
    .map((l) => {
      const q = byId.get(l.questionId);
      return q ? { ...q, source: l.source === TEST_EXCLUSIVE ? TEST_EXCLUSIVE : BANK } : null;
    })
    .filter(Boolean) as ModuleQuestion[];
}

// ─────────────── GRADING ───────────────
// Mirrors the client's grid-in matching so a typed "3/4" scores the same as an
// authored \(\frac{3}{4}\).
const MATH_ISLAND_RE = /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$/g;
function mathPlainServer(str: unknown) {
  return String(str ?? "")
    .replace(MATH_ISLAND_RE, (_m, a, b, c) => ` ${a ?? b ?? c ?? ""} `)
    .replace(/\\(?:d?frac|tfrac)\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\\sqrt\{([^{}]*)\}/g, "sqrt($1)")
    .replace(/\\(?:left|right|displaystyle|,|;|!|quad|qquad)/g, "")
    .replace(/\\times/g, "*").replace(/\\cdot/g, "*").replace(/\\div/g, "/")
    .replace(/\\pi\b/g, "pi")
    .replace(/\\text\{([^{}]*)\}/g, "$1")
    .replace(/[{}]/g, "").replace(/\\[a-zA-Z]+/g, "")
    .replace(/\s+/g, " ").trim();
}
function sprCanonicalServer(value: unknown) {
  return mathPlainServer(value).toLowerCase()
    .replace(/[$\s,]/g, "")
    .replace(/π/g, "pi").replace(/×/g, "*").replace(/·/g, "*").replace(/÷/g, "/")
    .replace(/[()]/g, "")
    .replace(/^\+/, "");
}
function sprNumericServer(value: unknown) {
  const v = sprCanonicalServer(value);
  if (!/^[-+]?\d*\.?\d+(\/[-+]?\d*\.?\d+)?$/.test(v)) return null;
  const [a, b] = v.split("/");
  const n = Number(a), d = b === undefined ? 1 : Number(b);
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return null;
  return n / d;
}
function sprMatch(given: string, expected: string) {
  const a = sprCanonicalServer(given), b = sprCanonicalServer(expected);
  if (!a || !b) return false;
  if (a === b) return true;
  const na = sprNumericServer(given), nb = sprNumericServer(expected);
  return na !== null && nb !== null && Math.abs(na - nb) < 1e-9;
}
export function isAnswerCorrect(q: QuestionRow, given: string) {
  if (!given) return false;
  if (q.type !== "spr") return given === q.answer;
  if (sprMatch(given, q.answer)) return true;
  return (Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : []).some((alt) => sprMatch(given, String(alt)));
}

// ─────────────── MODULE PLANS & ADAPTIVE ROUTING ───────────────
// A sitting works through an ordered plan of module ids. Adaptive tests carry
// several Module 2 variants per section (Easy / Standard / Hard); the plan
// holds one placeholder for the group and routing swaps in the variant the
// student earned when they reach it.
export const ADAPTIVE_THRESHOLD = 0.6;
export const isPerModuleTimed = (mods: TestModuleRow[]) =>
  mods.length > 0 && mods.every((m) => (m.timeLimitMinutes ?? 0) > 0);
const trackOf = (m: TestModuleRow) => (m.difficultyTrack || "").trim().toLowerCase();
const groupKey = (m: TestModuleRow) => (m.moduleNumber != null ? `${m.section}:${m.moduleNumber}` : null);

export function initialPlan(test: TestRow, mods: TestModuleRow[], subset?: number[] | null) {
  const list = subset && subset.length ? mods.filter((m) => subset.includes(m.id)) : mods;
  if (!test.isAdaptive) return list.map((m) => m.id);
  const sizes = new Map<string, number>();
  for (const m of list) { const k = groupKey(m); if (k) sizes.set(k, (sizes.get(k) || 0) + 1); }
  const out: TestModuleRow[] = [];
  const slot = new Map<string, number>();
  for (const m of list) {
    const k = groupKey(m);
    if (!k || (sizes.get(k) || 0) < 2) { out.push(m); continue; }
    if (slot.has(k)) {
      if (trackOf(m) === "standard") out[slot.get(k)!] = m;
      continue;
    }
    slot.set(k, out.length);
    out.push(m);
  }
  return out.map((m) => m.id);
}

export async function planModules(attempt: TestAttemptRow) {
  const mods = await loadTestModules(attempt.testId);
  const plan = attempt.modulePlan;
  if (!Array.isArray(plan) || !plan.length) return mods;
  const byId = new Map(mods.map((m) => [m.id, m]));
  return plan.map((id) => byId.get(Number(id))).filter(Boolean) as TestModuleRow[];
}

// The plan after routing the module at `nextIndex`, or null when nothing changes.
async function routedPlan(test: TestRow, attempt: TestAttemptRow, planMods: TestModuleRow[], nextIndex: number) {
  // Selected-module practice sits exactly the modules (and tracks) the student
  // picked; only a full adaptive sitting is routed.
  if (!test.isAdaptive || attempt.practiceScope === "modules") return null;
  const next = planMods[nextIndex];
  const key = next ? groupKey(next) : null;
  if (!next || !key) return null;
  const variants = (await loadTestModules(test.id)).filter((m) => groupKey(m) === key);
  if (variants.length < 2) return null;
  let correct = 0, total = 0;
  const answers = attempt.answers || {};
  for (const m of planMods.slice(0, nextIndex)) {
    if (m.section !== next.section) continue;
    for (const q of await loadModuleQuestions(m.id)) {
      total += 1;
      if (isAnswerCorrect(q, String(answers[String(q.id)] ?? ""))) correct += 1;
    }
  }
  const strong = total > 0 && correct / total >= ADAPTIVE_THRESHOLD;
  const prefs = strong ? ["hard", "standard", "baseline", ""] : ["easy", "standard", "baseline", ""];
  let chosen: TestModuleRow | undefined;
  for (const p of prefs) { chosen = variants.find((v) => trackOf(v) === p); if (chosen) break; }
  chosen ||= variants[0];
  const plan = planMods.map((m) => m.id);
  plan[nextIndex] = chosen.id;
  return plan;
}

// Column updates that move a sitting onto the module at `nextIndex`: route an
// adaptive Module 2, start that module's clock, and open the break between the
// Reading & Writing and Math sections when modules are timed separately.
export async function moduleTransition(test: TestRow, attempt: TestAttemptRow, planMods: TestModuleRow[], nextIndex: number) {
  const now = Date.now();
  const routed = await routedPlan(test, attempt, planMods, nextIndex);
  let mods = planMods;
  if (routed) {
    const byId = new Map((await loadTestModules(test.id)).map((m) => [m.id, m]));
    mods = routed.map((id) => byId.get(id)).filter(Boolean) as TestModuleRow[];
  }
  const perModule = isPerModuleTimed(mods);
  const prev = mods[nextIndex - 1], next = mods[nextIndex];
  // Untimed practice: no clock and no timed break — the student moves on when ready.
  if (attempt.timed === false) {
    return {
      moduleIndex: nextIndex,
      currentQuestionIndex: 0,
      lastSavedAt: new Date(now),
      modulePlan: routed ?? attempt.modulePlan ?? mods.map((m) => m.id),
      breakEndsAt: null,
      expiresAt: null,
    } satisfies Partial<typeof testAttempts.$inferInsert>;
  }
  const breakMs = perModule && prev?.section === "ebrw" && next?.section === "math" && (test.breakMinutes ?? 0) > 0
    ? test.breakMinutes * 60_000 : 0;
  const minutes = next?.timeLimitMinutes ?? test.timeLimitMinutes;
  return {
    moduleIndex: nextIndex,
    currentQuestionIndex: 0,
    lastSavedAt: new Date(now),
    modulePlan: routed ?? attempt.modulePlan ?? mods.map((m) => m.id),
    breakEndsAt: breakMs ? new Date(now + breakMs) : null,
    expiresAt: perModule ? new Date(now + breakMs + minutes * 60_000) : attempt.expiresAt,
  } satisfies Partial<typeof testAttempts.$inferInsert>;
}

// ─────────────── SCORE REPORTS ───────────────
// Scaled scores are estimates: each section maps its raw percentage onto the
// 200–800 scale, and a student routed to the easier Module 2 has a lower
// ceiling — the same trade-off the real adaptive test makes.
const SECTION_LABEL: Record<string, string> = { ebrw: "Reading and Writing", math: "Math" };
function scaleSection(raw: number, total: number, track: string) {
  if (!total) return null;
  const p = raw / total;
  const t = track.toLowerCase();
  const span = t === "easy" ? 450 : 600;
  return Math.max(200, Math.min(800, Math.round((200 + span * p) / 10) * 10));
}

// Which sections of a selected-module sitting the scaled model can score: the
// estimate is calibrated on a whole section (every module of it, with exactly
// one variant from each adaptive Module 2 group), so a partial section gets a
// raw result only.
async function scaledSections(test: TestRow, planMods: TestModuleRow[]) {
  const all = await loadTestModules(test.id);
  const ok = new Set<string>();
  const planIds = new Set(planMods.map((m) => m.id));
  for (const sec of new Set(planMods.map((m) => m.section))) {
    const groups = new Map<string, TestModuleRow[]>();
    for (const m of all.filter((x) => x.section === sec)) {
      const k = groupKey(m) ?? `id:${m.id}`;
      groups.set(k, [...(groups.get(k) || []), m]);
    }
    if ([...groups.values()].every((g) => g.filter((m) => planIds.has(m.id)).length === 1)) ok.add(sec);
  }
  return ok;
}

export async function buildScoreReport(test: TestRow, planMods: TestModuleRow[], answers: Record<string, string>, attempt?: Pick<TestAttemptRow, "practiceScope" | "timed"> | null) {
  const partial = attempt?.practiceScope === "modules";
  const scalable = partial ? await scaledSections(test, planMods) : null;
  const sections: Record<string, { label: string; raw: number; total: number; scaled: number | null; track: string }> = {};
  const domains = new Map<string, { section: string; domain: string; correct: number; total: number }>();
  const skills = new Map<string, { section: string; domain: string; skill: string; correct: number; total: number }>();
  const modules: { id: number; title: string; section: string; moduleNumber: number | null; track: string; correct: number; total: number }[] = [];
  const questionResults: Record<string, boolean> = {};
  let correctCount = 0, totalCount = 0;
  for (const m of planMods) {
    const sec = (sections[m.section] ||= { label: SECTION_LABEL[m.section] || m.section, raw: 0, total: 0, scaled: null, track: "" });
    if ((m.moduleNumber ?? 0) >= 2 && m.difficultyTrack) sec.track = m.difficultyTrack;
    let modCorrect = 0;
    const qs = await loadModuleQuestions(m.id);
    for (const q of qs) {
      const ok = isAnswerCorrect(q, String(answers[String(q.id)] ?? ""));
      questionResults[String(q.id)] = ok;
      totalCount += 1; sec.total += 1;
      if (ok) { correctCount += 1; sec.raw += 1; modCorrect += 1; }
      const dk = `${q.section}|${q.category}`;
      const d = domains.get(dk) || { section: q.section, domain: q.category, correct: 0, total: 0 };
      d.total += 1; if (ok) d.correct += 1; domains.set(dk, d);
      const sk = `${dk}|${q.subcategory}`;
      const s = skills.get(sk) || { section: q.section, domain: q.category, skill: q.subcategory || "General", correct: 0, total: 0 };
      s.total += 1; if (ok) s.correct += 1; skills.set(sk, s);
    }
    modules.push({ id: m.id, title: m.title, section: m.section, moduleNumber: m.moduleNumber, track: m.difficultyTrack, correct: modCorrect, total: qs.length });
  }
  for (const [k, s] of Object.entries(sections)) s.scaled = !scalable || scalable.has(k) ? scaleSection(s.raw, s.total, s.track) : null;
  const rw = sections.ebrw?.scaled ?? null, math = sections.math?.scaled ?? null;
  return {
    correctCount, totalCount,
    // "modules" = selected-module practice: only the chosen modules are graded,
    // so questions outside them are never counted as skipped or incorrect.
    scope: partial ? "modules" : "full",
    timed: attempt?.timed !== false,
    sections,
    rwScaled: rw, mathScaled: math,
    totalScaled: rw !== null && math !== null ? rw + math : null,
    modules,
    domains: [...domains.values()],
    skills: [...skills.values()],
    questionResults,
    adaptive: test.isAdaptive,
    generatedAt: new Date().toISOString(),
  };
}
export type ScoreReport = Awaited<ReturnType<typeof buildScoreReport>>;

// Older sittings closed before reports existed get one on first read.
export async function ensureScoreReport(attempt: TestAttemptRow) {
  if (!attempt.submittedAt) return null;
  if (attempt.scoreReport) return attempt.scoreReport as ScoreReport;
  const [test] = await db.select().from(tests).where(eq(tests.id, attempt.testId)).limit(1);
  if (!test) return null;
  const report = await buildScoreReport(test, await planModules(attempt), attempt.answers || {}, attempt);
  await db.update(testAttempts).set({ scoreReport: report }).where(eq(testAttempts.id, attempt.id));
  return report;
}

// ─────────────── IMPORT FORMAT ───────────────
// One self-contained JSON file describes a whole test: top-level metadata, an
// optional `assets` collection of base64 images, and ordered modules of
// ordered questions. Text fields may carry Markdown (tables, embedded images,
// bold / italic, lists) or editor HTML. Everything is normalised into the
// canonical shape below — the same shape the admin preview edits, the commit
// endpoint re-validates and the exporter produces — so a test round-trips.
// The format is documented in docs/test-import/.
export interface NormOption { id: string; text: string; imageUrl: string | null }
export interface NormQuestion {
  id: string; questionNumber: number; domain: string; skill: string;
  questionType: "MCQ" | "SPR"; passageText: string | null; questionPrompt: string;
  options: NormOption[]; correctAnswer: string; acceptableAnswers: string[];
  explanation: string; imageUrl: string | null;
  difficulty: "Easy" | "Medium" | "Hard" | null;
  visuals: { tables: number; images: number };
}
export interface NormModule {
  moduleId: string; section: "Reading and Writing" | "Math"; moduleNumber: number;
  timeLimitMinutes: number; difficultyTrack: string; title: string; questions: NormQuestion[];
}
export interface NormTest {
  testId: string; title: string; description: string; isAdaptive: boolean;
  totalTimeMinutes: number; breakMinutes: number; modules: NormModule[];
  // Optional vocabulary carried by the file (top-level "vocabulary" and any
  // per-question "vocabulary" lists), merged into the shared vocab bank when an
  // admin or mentor saves the test. Never written on preview.
  vocabulary: WordInput[];
}
export interface ImportIssue { level: "error" | "warning"; location: string; message: string }
export const IMPORT_FORMAT_VERSION = "2.0";

const RW_DOMAINS = ["Craft and Structure", "Information and Ideas", "Standard English Conventions", "Expression of Ideas"];
const MATH_DOMAINS = ["Algebra", "Advanced Math", "Problem-Solving and Data Analysis", "Geometry and Trigonometry"];
const OFFICIAL = {
  ebrw: { minutes: 32, questions: 27, short: "rw" },
  math: { minutes: 35, questions: 22, short: "math" },
} as const;
const LETTERS = ["A", "B", "C", "D"];
const MAX_QUESTIONS = 400;
const MAX_FIELD = 2_000_000; // raw text, before embedded images are extracted
export const MAX_STORED_FIELD = 200_000; // converted HTML (images are URLs by then)
const SPR_INPUT_MAX = 7; // the student answer box (ftWorkspaceHTML) takes 7 characters

const s = (v: unknown, max = 20000) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
const pick = (o: any, ...keys: string[]) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return undefined; };
const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);

// `$…$` is the import format's inline-math delimiter, but the app treats a lone
// dollar sign as money. Convert `$x$` to `\(x\)` (and `$$x$$` to `\[x\]`) here,
// skipping anything that reads like prices ("$5 and $10").
export function dollarsToLatex(text: string) {
  if (!text || !text.includes("$")) return text;
  let out = text.replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex) => `\\[${tex}\\]`);
  out = out.replace(/(^|[^\\$])\$(?!\$)([^$\n]+?)\$(?!\$)/g, (m, pre, tex) => {
    if (/^\s|\s$/.test(tex)) return m;
    return `${pre}\\(${tex}\\)`;
  });
  return out;
}
export function latexToDollars(text: string | null) {
  if (!text) return text;
  return text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, t) => `$$${t}$$`).replace(/\\\(([\s\S]*?)\\\)/g, (_m, t) => `$${t}$`);
}

function sectionOf(v: unknown): "ebrw" | "math" | null {
  const t = s(v, 80).toLowerCase();
  if (!t) return null;
  if (/math/.test(t)) return "math";
  if (/read|writ|rw|ebrw|verbal|english/.test(t)) return "ebrw";
  return null;
}
function sectionFromDomain(domain: string): "ebrw" | "math" | null {
  const d = domain.toLowerCase();
  if (RW_DOMAINS.some((x) => x.toLowerCase() === d)) return "ebrw";
  if (MATH_DOMAINS.some((x) => x.toLowerCase() === d)) return "math";
  return null;
}
function normTrack(v: unknown) {
  const t = s(v, 40).toLowerCase();
  if (!t) return "";
  if (/hard|upper|difficult|high/.test(t)) return "Hard";
  if (/easy|lower|low/.test(t)) return "Easy";
  if (/standard|medium|normal/.test(t)) return "Standard";
  if (/base/.test(t)) return "Baseline";
  return s(v, 40);
}
function normQDifficulty(v: unknown): NormQuestion["difficulty"] {
  const t = s(v, 20).toLowerCase();
  if (!t) return null;
  if (/easy|^1$|^2$|foundation/.test(t)) return "Easy";
  if (/hard|^4$|^5$|advanced/.test(t)) return "Hard";
  return "Medium";
}
function tableHtml(t: any) {
  if (!t) return "";
  const headers: unknown[] = Array.isArray(t.headers) ? t.headers : Array.isArray(t.columns) ? t.columns : [];
  const rows: unknown[][] = Array.isArray(t.rows) ? t.rows : Array.isArray(t) ? t : [];
  if (!headers.length && !rows.length) return "";
  const cap = t.title || t.caption ? `<p><strong>${escHtml(t.title || t.caption)}</strong></p>` : "";
  const head = headers.length ? `<thead><tr>${headers.map((h) => `<th>${escHtml(h)}</th>`).join("")}</tr></thead>` : "";
  const body = `<tbody>${rows.map((r) => `<tr>${(Array.isArray(r) ? r : Object.values(r as object)).map((c) => `<td>${escHtml(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
  return `${cap}<table>${head}${body}</table>`;
}
const looksHtml = (v: string) => /^</.test(v.trim()) && /<\/?[a-z][\s\S]*?>/i.test(v);

const SECTION_NAME = { ebrw: "Reading and Writing", math: "Math" } as const;
const sectionLabelOf = (sec: "ebrw" | "math") => SECTION_NAME[sec];

// The text pipeline every authored field goes through: `$…$` math → LaTeX,
// then Markdown / embedded images → editor-equivalent HTML.
function richField(raw: unknown, where: string, reg: ImageRegistry, kind: "question" | "choice", stats: RichStats) {
  if (raw === undefined || raw === null) return "";
  // Invalid values are passed through unchanged (never silently dropped), so a
  // draft built from a file with errors keeps failing until the file is fixed.
  if (typeof raw !== "string" && typeof raw !== "number") { reg.addError(where, "must be text"); return raw as any; }
  const text = String(raw);
  if (text.length > MAX_FIELD) { reg.addError(where, `is ${text.length.toLocaleString()} characters long — the limit is ${MAX_FIELD.toLocaleString()}`); return text; }
  const converted = convertRichText(dollarsToLatex(text), where, reg, kind, stats);
  if (converted.length > MAX_STORED_FIELD) { reg.addError(where, `is too long after conversion (${converted.length.toLocaleString()} characters; limit ${MAX_STORED_FIELD.toLocaleString()})`); return text; }
  return converted;
}
const wrapBlock = (v: string) => (!v ? "" : looksHtml(v) ? v : `<p>${escHtml(v)}</p>`);

function buildPassage(q: any, where: string, reg: ImageRegistry, stats: RichStats) {
  const passage = richField(pick(q, "passageText", "passage", "stimulus", "text"), `${where} / passage`, reg, "question", stats);
  const parts: { title: string; html: string }[] = [];
  if (Array.isArray(q.passages)) q.passages.forEach((p: any, i: number) => {
    const html = richField(typeof p === "string" ? p : (p?.text ?? p?.passageText), `${where} / passages[${i}]`, reg, "question", stats);
    if (html) parts.push({ title: s(p?.title, 80) || `Text ${i + 1}`, html });
  });
  const t1 = richField(pick(q, "text1", "passageText1", "passage1"), `${where} / text1`, reg, "question", stats);
  const t2 = richField(pick(q, "text2", "passageText2", "passage2"), `${where} / text2`, reg, "question", stats);
  if (t1) parts.push({ title: "Text 1", html: t1 });
  if (t2) parts.push({ title: "Text 2", html: t2 });
  const table = tableHtml(q.table ?? q.tableData);
  if (table) stats.tables += 1;
  if (!parts.length && !table) return passage || null;
  let html = wrapBlock(passage);
  for (const p of parts) html += `<p><strong>${escHtml(p.title)}</strong></p>${wrapBlock(p.html)}`;
  if (table) html += table;
  return html;
}

interface RawOption { id: string; text: unknown; image: unknown }
function readOptions(q: any): RawOption[] {
  const raw = q.options ?? q.choices ?? q.answerChoices;
  const out: RawOption[] = [];
  if (Array.isArray(raw)) {
    raw.forEach((o: any, i: number) => {
      if (typeof o === "string" || typeof o === "number") { out.push({ id: LETTERS[i] || String(i + 1), text: o, image: null }); return; }
      const id = s(o?.id ?? o?.letter ?? o?.key ?? o?.label, 40) || LETTERS[i] || String(i + 1);
      out.push({ id, text: o?.text ?? o?.value ?? o?.content, image: pick(o, "image", "imageUrl", "imageAsset", "imageAssetId", "asset") ?? null });
    });
  } else if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw)) out.push({ id: k, text: typeof v === "object" && v ? (v as any).text : v, image: typeof v === "object" && v ? pick(v, "image", "imageUrl", "imageAsset", "imageAssetId") ?? null : null });
  }
  if (!out.length) {
    for (const l of LETTERS) {
      const v = pick(q, `option${l}`, `option_${l}`, `choice${l}`, `choice_${l}`, l, l.toLowerCase());
      if (v !== undefined) out.push({ id: l, text: v, image: null });
    }
  }
  return out;
}

function readList(v: unknown) {
  if (Array.isArray(v)) return v.map((x) => s(x, 200)).filter(Boolean);
  const t = s(v, 2000);
  return t ? t.split(/[|;]/).map((x) => x.trim()).filter(Boolean) : [];
}

// An image given as a field (question `image`, option `image`, legacy
// `imageUrl` / `svgData`): an asset reference, a data URI or a stored URL.
function imageField(v: unknown, where: string, reg: ImageRegistry): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "object") {
    const o = v as any;
    const ref = o.assetId ?? o.asset ?? o.id;
    if (ref) return reg.resolve(`asset:${ref}`, where) ?? `asset:${ref}`;
    if (o.data) {
      const mime = String(o.mimeType ?? o.mime ?? "");
      const img = decodeImage(String(o.data), mime);
      if ("error" in img) { reg.addError(where, img.error); return `data:${mime || "application/octet-stream"};base64,${String(o.data)}`; }
      reg.imageCount += 1; reg.pending.set(img.key, img); return img.url;
    }
    reg.addError(where, "image objects need an \"assetId\" or base64 \"data\" with a \"mimeType\""); return "asset:";
  }
  // An unresolved reference is kept as written (see richField).
  return reg.resolve(String(v), where) ?? String(v);
}
function svgField(v: unknown, where: string, reg: ImageRegistry) {
  const svg = s(v, MAX_FIELD);
  if (!svg) return null;
  if (/^data:image\/svg\+xml/i.test(svg)) {
    if (/;base64,/i.test(svg)) return reg.resolve(svg, where);
    const body = decodeURIComponent(svg.replace(/^data:image\/svg\+xml[^,]*,/i, ""));
    return reg.resolve(`data:image/svg+xml;base64,${Buffer.from(body, "utf8").toString("base64")}`, where);
  }
  if (!/^<svg[\s>]|^<\?xml/i.test(svg)) { reg.addError(where, "svgData is not an <svg> document"); return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64").slice(0, 8)}`; }
  return reg.resolve(`data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`, where);
}

export function normalizeQuestion(q: any, index: number, section: "ebrw" | "math", loc: string, reg: ImageRegistry): NormQuestion {
  const where = `${loc} / Q${index + 1}`;
  const err = (field: string, m: string) => reg.addError(field ? `${where} / ${field}` : where, m);
  const warn = (field: string, m: string) => reg.addWarning(field ? `${where} / ${field}` : where, m);
  if (!q || typeof q !== "object" || Array.isArray(q)) { err("", "each question must be an object"); q = { questionType: "MCQ", options: [] }; }
  const stats: RichStats = { tables: 0, images: 0 };
  const prompt = richField(pick(q, "questionPrompt", "prompt", "question", "stem"), `${where} / prompt`, reg, "question", stats);
  const passage = buildPassage(q, where, reg, stats);
  const imgBefore = reg.imageCount;
  const imageUrl = imageField(pick(q, "image", "questionImage", "imageUrl", "figureUrl", "imageAsset", "imageAssetId"), `${where} / image`, reg)
    ?? svgField(pick(q, "svgData", "svg"), `${where} / svgData`, reg);
  stats.images += reg.imageCount - imgBefore;
  if (!prompt && !passage && !imageUrl) err("prompt", "the question has no prompt, passage or image");

  const rawOptions = readOptions(q);
  const typeRaw = s(pick(q, "questionType", "type", "format"), 20).toUpperCase();
  let questionType: "MCQ" | "SPR" = /SPR|GRID|FREE|STUDENT|NUMERIC|OPEN/.test(typeRaw) ? "SPR"
    : typeRaw ? "MCQ" : rawOptions.length ? "MCQ" : "SPR";
  const typeKey = typeRaw.replace(/[^A-Z]/g, "");
  if (typeKey && !/^(MCQ|MC|MULTIPLECHOICE|SPR|GRIDIN|STUDENTPRODUCEDRESPONSE|FREERESPONSE|NUMERIC)$/.test(typeKey))
    warn("questionType", `"${typeRaw}" is not a known type — treated as ${questionType}`);
  const correctRaw = s(pick(q, "correctAnswer", "answer", "correct", "key"), 200);
  const acceptable = readList(pick(q, "acceptableAnswers", "acceptedAnswers", "alternateAnswers"));
  let options: NormOption[] = [];
  let correct = correctRaw;

  if (questionType === "MCQ") {
    if (rawOptions.length < 2) err("options", `a multiple-choice question needs 2–4 options (found ${rawOptions.length}); use "questionType": "SPR" for a student-produced response`);
    else if (rawOptions.length > 4) err("options", `has ${rawOptions.length} options — the platform supports at most 4 (A–D)`);
    const ids = rawOptions.map((o) => o.id.toUpperCase());
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    if (dupes.length) err("options", `option id "${dupes[0]}" is used more than once`);
    const lettered = ids.every((id, i) => id === LETTERS[i]);
    if (!lettered && ids.every((id) => LETTERS.includes(id)))
      err("options", `option ids must be listed in order A, B, C, D (found ${ids.join(", ")})`);
    else if (!lettered && rawOptions.length >= 2 && rawOptions.length <= 4)
      warn("options", `option ids ${ids.join(", ")} were stored as ${LETTERS.slice(0, ids.length).join(", ")} (the platform letters choices A–D in their listed order)`);
    const idProblem = dupes.length > 0 || rawOptions.length > 4 || (!lettered && ids.every((id) => LETTERS.includes(id)));
    rawOptions.forEach((o, i) => {
      const letter = idProblem ? o.id : LETTERS[i];
      const ostats: RichStats = { tables: 0, images: 0 };
      const field = `option ${letter}`;
      const text = richField(o.text, `${where} / ${field}`, reg, "choice", ostats);
      const before = reg.imageCount;
      const img = imageField(o.image, `${where} / ${field}`, reg);
      ostats.images += reg.imageCount - before;
      stats.tables += ostats.tables; stats.images += ostats.images;
      if (!text && !img) err(field, "has no text or image");
      options.push({ id: letter, text, imageUrl: img });
    });
    const up = correctRaw.toUpperCase();
    let at = ids.indexOf(up);
    if (at < 0 && /^[1-4]$/.test(correctRaw) && !ids.includes(correctRaw)) at = Number(correctRaw) - 1;
    if (at < 0) at = rawOptions.findIndex((o) => s(o.text).toLowerCase() === correctRaw.toLowerCase() && correctRaw);
    if (!correctRaw) err("correctAnswer", "is missing");
    else if (at < 0 || at >= options.length) err("correctAnswer", `"${correctRaw}" is not one of the option ids (${ids.join(", ")})`);
    else if (!idProblem) correct = LETTERS[at];
  } else {
    if (rawOptions.length) warn("options", "student-produced response questions ignore options");
    if (!correct && acceptable.length) correct = acceptable[0];
    if (!correct) err("correctAnswer", "a student-produced response question needs a correct answer");
    const fits = [correct, ...acceptable].some((a) => a.replace(/\s+/g, "").length <= SPR_INPUT_MAX);
    if (correct && !fits) warn("correctAnswer", `no accepted answer fits the ${SPR_INPUT_MAX}-character answer box — add a shorter form to acceptableAnswers`);
  }
  const explanation = richField(pick(q, "explanation", "rationale", "solution"), `${where} / explanation`, reg, "question", stats);
  if (!explanation) warn("explanation", "no explanation was provided");
  let domain = s(pick(q, "domain", "category"), 120);
  if (!domain) { domain = section === "math" ? "Algebra" : "Information and Ideas"; warn("domain", `missing — set to "${domain}"`); }
  const qn = Number(q.questionNumber);
  if (q.questionNumber !== undefined && qn !== index + 1)
    warn("questionNumber", `is ${q.questionNumber} but the question is in position ${index + 1}; the file's array order is used`);
  return {
    id: s(pick(q, "id", "questionId"), 120) || "",
    questionNumber: index + 1,
    domain,
    skill: s(pick(q, "skill", "subcategory", "subskill"), 120) || "General",
    questionType,
    passageText: passage || null,
    questionPrompt: prompt,
    options,
    correctAnswer: correct,
    acceptableAnswers: questionType === "SPR" ? [...new Set(acceptable.filter((a) => a !== correct))] : [],
    explanation,
    imageUrl,
    difficulty: normQDifficulty(pick(q, "difficulty", "level")),
    visuals: stats,
  };
}

function moduleDefaults(section: "ebrw" | "math", num: number, track: string) {
  const label = SECTION_LABEL[section];
  const key = `${OFFICIAL[section].short}_module_${num}${track && !/^(baseline|standard)$/i.test(track) && num > 1 ? `_${track.toLowerCase()}` : ""}`;
  return { key, title: `${label} · Module ${num}${num > 1 && track && !/^baseline$/i.test(track) ? ` (${track})` : ""}`, minutes: OFFICIAL[section].minutes };
}

// Routing the platform can run: per section, Module 1 then a Module 2 chosen
// from variants tagged Easy / Standard / Hard (≥ 60% on Module 1 → Hard).
function adaptiveProblems(modules: NormModule[], doc: any) {
  const problems: string[] = [];
  const bySection = new Map<string, NormModule[]>();
  modules.forEach((m) => bySection.set(m.section, [...(bySection.get(m.section) || []), m]));
  let routed = 0;
  for (const [sec, mods] of bySection) {
    const nums = new Map<number, number>();
    mods.forEach((m) => nums.set(m.moduleNumber, (nums.get(m.moduleNumber) || 0) + 1));
    for (const [n, count] of nums) if (n !== 2 && count > 1)
      problems.push(`${sec}: ${count} modules share moduleNumber ${n} — only Module 2 can have adaptive variants`);
    const m2 = mods.filter((m) => m.moduleNumber === 2);
    if (!mods.some((m) => m.moduleNumber === 1)) problems.push(`${sec}: adaptive routing needs a Module 1 (moduleNumber 1) to route from`);
    if (m2.length < 2) continue;
    routed += 1;
    const tracks = m2.map((m) => m.difficultyTrack.toLowerCase());
    if (!tracks.includes("easy") && !tracks.includes("standard")) problems.push(`${sec} / Module 2: no variant is tagged "Easy" or "Standard" for students below the routing threshold`);
    if (!tracks.includes("hard") && !tracks.includes("standard")) problems.push(`${sec} / Module 2: no variant is tagged "Hard" or "Standard" for students above the routing threshold`);
    const dup = tracks.find((t, i) => tracks.indexOf(t) !== i);
    if (dup) problems.push(`${sec} / Module 2: two variants share the difficultyTrack "${dup || "(blank)"}"`);
  }
  if (!routed) problems.push("the file requests adaptive routing but every section has a single Module 2. Add Module 2 variants with difficultyTrack \"Easy\" and \"Hard\" (same section and moduleNumber 2), or import the test as fixed-form");
  const r = doc?.routing;
  if (r && typeof r === "object") {
    const th = Number(r.threshold ?? r.cutoff ?? r.hardThreshold);
    if (Number.isFinite(th)) {
      const frac = th > 1 ? th / 100 : th;
      if (Math.abs(frac - ADAPTIVE_THRESHOLD) > 1e-6) problems.push(`routing threshold ${th} is not supported — the platform sends students scoring at least ${ADAPTIVE_THRESHOLD * 100}% on Module 1 to the Hard Module 2`);
    }
    const known = new Set(["threshold", "cutoff", "hardThreshold", "rule", "description"]);
    const extra = Object.keys(r).filter((k) => !known.has(k));
    if (extra.length) problems.push(`routing fields ${extra.map((k) => `"${k}"`).join(", ")} are not supported — the platform routes on the Module 1 percentage only`);
  }
  return problems;
}

export interface ImportSummary {
  sections: { section: string; modules: number; questions: number }[];
  modules: { moduleId: string; title: string; section: string; moduleNumber: number; difficultyTrack: string; timeLimitMinutes: number; questions: number; mcq: number; spr: number; tables: number; images: number }[];
  totals: { modules: number; questions: number; mcq: number; spr: number; tables: number; images: number; distinctImages: number; assets: number; unusedAssets: string[]; minutes: number; vocabulary: number };
}

/**
 * Validate and normalise an import file. With `persist`, every embedded image
 * is stored (content-addressed, so repeats are free) and every reference to
 * already-stored media is checked. Errors name the module, question and field.
 */
export async function prepareImport(raw: any, opts: { fallbackTitle?: string; persist?: boolean } = {}) {
  const issues: ImportIssue[] = [];
  const addError = (location: string, message: string) => { if (issues.length < 500) issues.push({ level: "error", location, message }); };
  const addWarning = (location: string, message: string) => { if (issues.length < 500) issues.push({ level: "warning", location, message }); };
  const reg = new ImageRegistry(addError, addWarning);
  const result = (test: NormTest | null, summary: ImportSummary | null = null, sourceHash = "") => {
    const errors = issues.filter((i) => i.level === "error");
    const warnings = issues.filter((i) => i.level === "warning");
    return {
      issues, sourceHash,
      errors: errors.map((i) => `${i.location} — ${i.message}`),
      warnings: warnings.map((i) => `${i.location} — ${i.message}`),
      test: errors.length ? null : test, draft: test, summary,
    };
  };
  let doc = raw;
  if (typeof doc === "string") { try { doc = JSON.parse(doc); } catch { addError("File", "is not valid JSON"); return result(null); } }
  if (Array.isArray(doc)) doc = { questions: doc };
  if (!doc || typeof doc !== "object") { addError("File", "does not describe a test"); return result(null); }
  // Question Bank domain files and Challenging Questions set files declare
  // their own destination; they never become a full-length test.
  const declaredType = doc.destination && typeof doc.destination === "object" ? s(doc.destination.type, 40) : "";
  if (declaredType && declaredType !== "fullLengthTest") {
    addError("destination.type", `this file is a ${declaredType === "challengeSet" ? "Challenging Questions set" : declaredType === "questionBankDomain" ? "Question Bank domain batch" : `"${declaredType}"`} file, not a full-length test — import it from ${declaredType === "challengeSet" ? "Manage Questions → Challenging Questions" : "Manage Questions → Question Bank"}`);
    return result(null);
  }
  if (doc.test && typeof doc.test === "object" && !doc.modules) doc = { ...doc.test, assets: doc.assets ?? doc.test.assets };
  const sourceHash = createHash("sha256").update(JSON.stringify(doc)).digest("hex");
  const version = s(doc.formatVersion ?? doc.schemaVersion, 20);
  if (version && !/^[12](\.\d+)?$/.test(version)) addWarning("formatVersion", `"${version}" is newer than this importer (${IMPORT_FORMAT_VERSION}); unknown fields are ignored`);
  reg.loadAssets(doc.assets);
  reg.errorCount = () => issues.filter((i) => i.level === "error").length;

  type RawMod = { meta: any; section: "ebrw" | "math"; num: number; track: string; qs: any[]; index: number };
  const rawMods: RawMod[] = [];
  if (Array.isArray(doc.modules) && doc.modules.length) {
    doc.modules.forEach((m: any, i: number) => {
      const key = s(m?.moduleId ?? m?.id, 80);
      const qs = Array.isArray(m?.questions) ? m.questions : [];
      let section = sectionOf(m?.section) || sectionOf(key);
      if (!section) {
        section = sectionFromDomain(s(qs[0]?.domain)) || (i < 2 ? "ebrw" : "math");
        addWarning(`modules[${i}]${key ? ` (${key})` : ""}`, `"section" is missing or unknown — treated as ${SECTION_NAME[section]}`);
      }
      const numMatch = key.match(/module[_\s-]?(\d)/i);
      const num = Number(m?.moduleNumber) || (numMatch ? Number(numMatch[1]) : 0) || 1;
      rawMods.push({ meta: m, section, num, index: i, track: normTrack(m?.difficultyTrack ?? m?.track ?? m?.difficulty ?? (key.match(/_(easy|hard|standard)$/i)?.[1] || "")), qs });
    });
  } else if (Array.isArray(doc.questions)) {
    const groups = new Map<string, RawMod>();
    const order: string[] = [];
    const counters = { ebrw: 0, math: 0 };
    for (const q of doc.questions) {
      const key = s(q?.moduleId ?? q?.module, 80);
      const section = sectionOf(q?.section) || sectionOf(key) || sectionFromDomain(s(q?.domain)) || "ebrw";
      let gk = key;
      let num = Number(q?.moduleNumber) || Number(key.match(/module[_\s-]?(\d)/i)?.[1]) || 0;
      if (!gk) {
        if (!num) num = Math.floor(counters[section] / OFFICIAL[section].questions) + 1;
        counters[section] += 1;
        gk = `${OFFICIAL[section].short}_module_${num}`;
      }
      if (!groups.has(gk)) {
        groups.set(gk, { meta: { moduleId: key || gk, timeLimitMinutes: q?.timeLimitMinutes }, section, num: num || 1, index: order.length, track: normTrack(q?.difficultyTrack ?? key.match(/_(easy|hard|standard)$/i)?.[1] ?? ""), qs: [] });
        order.push(gk);
      }
      groups.get(gk)!.qs.push(q);
    }
    // A flat list has no module order of its own: Reading & Writing, then Math.
    order.map((k) => groups.get(k)!).sort((a, b) => (a.section === b.section ? a.num - b.num : a.section === "ebrw" ? -1 : 1)).forEach((m) => rawMods.push(m));
  } else {
    addError("File", "no modules or questions were found — add a \"modules\" array");
    return result(null, null, sourceHash);
  }

  const modules: NormModule[] = [];
  const usedKeys = new Set<string>();
  const usedQIds = new Map<string, string>();
  let questionTotal = 0;
  for (const rm of rawMods) {
    const d = moduleDefaults(rm.section, rm.num, rm.track);
    const loc = `${sectionLabelOf(rm.section)} / Module ${rm.num}${rm.num > 1 && rm.track && !/^(baseline)$/i.test(rm.track) ? ` (${rm.track})` : ""}`;
    const key = s(rm.meta?.moduleId ?? rm.meta?.id, 80) || d.key;
    if (usedKeys.has(key)) addError(loc, `moduleId "${key}" is used by more than one module`);
    usedKeys.add(key);
    const minutesRaw = Number(rm.meta?.timeLimitMinutes ?? rm.meta?.minutes);
    let minutes: number = d.minutes;
    if (rm.meta?.timeLimitMinutes === undefined && rm.meta?.minutes === undefined) addWarning(loc, `timeLimitMinutes is missing — set to the official ${d.minutes} minutes`);
    else if (!Number.isFinite(minutesRaw) || minutesRaw <= 0 || minutesRaw > 600) { addError(`${loc} / timeLimitMinutes`, `"${rm.meta?.timeLimitMinutes ?? rm.meta?.minutes}" must be a number of minutes between 1 and 600`); minutes = rm.meta?.timeLimitMinutes ?? rm.meta?.minutes; }
    else minutes = Math.round(minutesRaw);
    if (!rm.qs.length) addError(loc, "the module has no questions");
    const qs: NormQuestion[] = [];
    rm.qs.forEach((q: any, qi: number) => {
      if (questionTotal + qi === MAX_QUESTIONS) addError(loc, `the file has more than ${MAX_QUESTIONS} questions`);
      const rawId = s(q?.id ?? q?.questionId, 120);
      if (rawId) {
        const seen = usedQIds.get(rawId);
        if (seen) addError(`${loc} / Q${qi + 1} / id`, `question id "${rawId}" is also used by ${seen}`);
        else usedQIds.set(rawId, `${loc} / Q${qi + 1}`);
      }
      const nq = normalizeQuestion(q, qi, rm.section, loc, reg);
      if (!nq.id) { nq.id = `${key}-q${qi + 1}`; addWarning(`${loc} / Q${qi + 1}`, `has no "id" — assigned "${nq.id}"`); }
      qs.push(nq);
    });
    questionTotal += rm.qs.length;
    const official = OFFICIAL[rm.section].questions;
    if (rm.qs.length !== official) addWarning(loc, `${rm.qs.length} question${rm.qs.length === 1 ? "" : "s"} (official modules have ${official})`);
    modules.push({
      moduleId: key,
      section: SECTION_NAME[rm.section],
      moduleNumber: rm.num,
      timeLimitMinutes: minutes,
      difficultyTrack: rm.track || (rm.num === 1 ? "Baseline" : ""),
      title: s(rm.meta?.title, 160) || d.title,
      questions: qs,
    });
  }
  if (!rawMods.length) addError("File", "the \"modules\" array is empty");

  const title = s(doc.title ?? doc.name, 200) || opts.fallbackTitle || "Imported Digital SAT Test";
  if (!s(doc.title ?? doc.name, 200)) addWarning("title", `missing — using "${title}"`);
  const hasVariants = modules.some((m, i) => modules.some((o, j) => j !== i && o.section === m.section && o.moduleNumber === m.moduleNumber));
  const isAdaptive = doc.isAdaptive === undefined ? hasVariants : doc.isAdaptive === true || doc.isAdaptive === "true";
  if (isAdaptive) adaptiveProblems(modules, doc).forEach((p) => addError("Adaptive routing", p));
  else if (hasVariants) addError("Adaptive routing", "the file is fixed-form (isAdaptive is false) but has more than one module with the same section and moduleNumber — every student would sit all of them. Set \"isAdaptive\": true or give each module its own moduleNumber");
  const sum = modules.reduce((n, m) => n + m.timeLimitMinutes, 0);
  // Vocabulary: top-level list first, then per-question lists, one entry per word.
  const vocabulary: WordInput[] = [];
  const vocabSeen = new Set<string>();
  const addVocab = (list: unknown, where: string) => {
    if (list === undefined || list === null) return;
    if (!Array.isArray(list)) { addWarning(where, "must be an array of word objects — ignored"); return; }
    list.forEach((raw, i) => {
      const w = normalizeWord(raw);
      if (!w) { addWarning(`${where}[${i}]`, "needs a \"word\" and a \"definition\" — skipped"); return; }
      const k = w.word.toLowerCase();
      if (vocabSeen.has(k) || vocabulary.length >= 2000) return;
      vocabSeen.add(k); vocabulary.push(w);
    });
  };
  addVocab(doc.vocabulary ?? doc.vocab, "vocabulary");
  rawMods.forEach((rm) => rm.qs.forEach((q: any, qi: number) => {
    if (q && typeof q === "object") addVocab(q.vocabulary, `${sectionLabelOf(rm.section)} / Module ${rm.num} / Q${qi + 1} / vocabulary`);
  }));
  const totalRaw = Number(doc.totalTimeMinutes ?? doc.timeLimitMinutes);
  const breakRaw = Number(doc.breakMinutes);
  const test: NormTest = {
    testId: s(doc.testId ?? doc.id, 120) || slug(title) || `test-${Date.now()}`,
    title,
    description: s(doc.description, 4000),
    isAdaptive,
    totalTimeMinutes: Number.isFinite(totalRaw) && totalRaw > 0 ? Math.min(600, Math.round(totalRaw)) : sum,
    breakMinutes: doc.breakMinutes !== undefined && Number.isFinite(breakRaw) && breakRaw >= 0 ? Math.min(60, Math.round(breakRaw)) : 10,
    modules,
    vocabulary,
  };
  if (!s(doc.testId ?? doc.id, 120)) addWarning("testId", `missing — using "${test.testId}"`);
  const unused = reg.unusedAssets();
  if (unused.length) addWarning("assets", `${unused.length} asset${unused.length === 1 ? " is" : "s are"} never referenced: ${unused.slice(0, 10).join(", ")}`);

  if (opts.persist) {
    const failures = await reg.persist();
    failures.forEach((f) => addError("Images", f));
  }

  const summary: ImportSummary = {
    sections: (["Reading and Writing", "Math"] as const).map((sec) => ({
      section: sec,
      modules: modules.filter((m) => m.section === sec).length,
      questions: modules.filter((m) => m.section === sec).reduce((n, m) => n + m.questions.length, 0),
    })).filter((x) => x.modules),
    modules: modules.map((m) => ({
      moduleId: m.moduleId, title: m.title, section: m.section, moduleNumber: m.moduleNumber, difficultyTrack: m.difficultyTrack,
      timeLimitMinutes: m.timeLimitMinutes, questions: m.questions.length,
      mcq: m.questions.filter((q) => q.questionType === "MCQ").length, spr: m.questions.filter((q) => q.questionType === "SPR").length,
      tables: m.questions.reduce((n, q) => n + q.visuals.tables, 0), images: m.questions.reduce((n, q) => n + q.visuals.images, 0),
    })),
    totals: {
      modules: modules.length,
      questions: modules.reduce((n, m) => n + m.questions.length, 0),
      mcq: modules.reduce((n, m) => n + m.questions.filter((q) => q.questionType === "MCQ").length, 0),
      spr: modules.reduce((n, m) => n + m.questions.filter((q) => q.questionType === "SPR").length, 0),
      tables: modules.reduce((n, m) => n + m.questions.reduce((k, q) => k + q.visuals.tables, 0), 0),
      images: modules.reduce((n, m) => n + m.questions.reduce((k, q) => k + q.visuals.images, 0), 0),
      distinctImages: new Set([...reg.pending.keys(), ...reg.storedRefs.map((r) => r.key)]).size,
      assets: reg.assets.size,
      unusedAssets: unused,
      minutes: sum,
      vocabulary: vocabulary.length,
    },
  };
  return result(test, summary, sourceHash);
}

// ─────────────── IMPORT / EXPORT ───────────────
export const difficultyNum = (d: NormQuestion["difficulty"]) => (d === "Easy" ? 2 : d === "Hard" ? 4 : 3);

// Writes the whole test in one transaction: a failure part-way leaves nothing
// behind, and never touches any other test.
export async function createTestFromImport(norm: NormTest, createdBy: number | null, status: "draft" | "published", externalId = norm.testId, importHash: string | null = null) {
  return db.transaction(async (tx) => {
    const [test] = await tx.insert(tests).values({
      title: norm.title,
      description: norm.description,
      timeLimitMinutes: Math.max(1, norm.totalTimeMinutes || norm.modules.reduce((n, m) => n + m.timeLimitMinutes, 0) || 134),
      status,
      createdBy,
      externalId,
      isAdaptive: norm.isAdaptive,
      breakMinutes: norm.breakMinutes,
      source: "import",
      importHash,
    }).returning();
    for (let i = 0; i < norm.modules.length; i += 1) {
      const m = norm.modules[i];
      const section = m.section === "Math" ? "math" : "ebrw";
      const [mod] = await tx.insert(testModules).values({
        testId: test.id, title: m.title, section, timeLimitMinutes: m.timeLimitMinutes, position: i,
        moduleKey: m.moduleId, moduleNumber: m.moduleNumber, difficultyTrack: m.difficultyTrack,
      }).returning();
      if (!m.questions.length) continue;
      const rows = await tx.insert(questions).values(m.questions.map((q) => {
        const mcq = q.questionType === "MCQ";
        const choiceImages = mcq ? Object.fromEntries(q.options.filter((o) => o.imageUrl).map((o) => [o.id, o.imageUrl!])) : {};
        return {
          section,
          category: q.domain,
          subcategory: q.skill,
          difficulty: difficultyNum(q.difficulty),
          type: mcq ? "mcq" : "spr",
          passage: q.passageText ? sanitizeRichHtml(q.passageText, MAX_STORED_FIELD) : null,
          prompt: sanitizeRichHtml(q.questionPrompt || "Refer to the figure.", MAX_STORED_FIELD),
          questionImage: q.imageUrl || null,
          choices: mcq ? Object.fromEntries(q.options.map((o) => [o.id, sanitizeRichHtml(o.text, MAX_STORED_FIELD)])) : null,
          choiceImages: Object.keys(choiceImages).length ? choiceImages : null,
          answer: q.correctAnswer,
          acceptableAnswers: q.acceptableAnswers.length ? q.acceptableAnswers : null,
          explanation: sanitizeRichHtml(q.explanation, MAX_STORED_FIELD),
          scope: TEST_EXCLUSIVE,
          externalId: q.id || null,
        };
      })).returning();
      rows.sort((a, b) => a.id - b.id);
      await tx.insert(testModuleQuestions).values(rows.map((r, idx) => ({ moduleId: mod.id, questionId: r.id, position: idx, source: TEST_EXCLUSIVE })));
    }
    return test;
  });
}

// Export produces the documented self-contained format: every stored image is
// embedded once in `assets` and referenced by id, so the file re-imports
// anywhere with no separate uploads.
export async function exportTest(testId: number) {
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return null;
  const mods = await loadTestModules(testId);
  const store = questionMediaStore();
  const assets = new Map<string, { id: string; mimeType: string; data: string }>();
  const assetFor = async (url: string | null) => {
    if (!url) return null;
    const key = mediaKeyOf(url);
    if (!key) return url;
    const id = `img_${key.replace(/^imp-/, "").slice(0, 16)}`;
    if (!assets.has(id)) {
      const found = await store.getWithMetadata(key, { type: "arrayBuffer" }).catch(() => null);
      if (!found?.data) return url;
      assets.set(id, { id, mimeType: String(found.metadata?.contentType || "image/png"), data: Buffer.from(found.data as ArrayBuffer).toString("base64") });
    }
    return `asset:${id}`;
  };
  const embed = async (html: string | null) => {
    if (!html) return html;
    let out = html;
    for (const m of html.matchAll(/(<img\b[^>]*?\bsrc\s*=\s*["'])([^"']+)(["'])/gi)) {
      const ref = await assetFor(m[2]);
      if (ref && ref !== m[2]) out = out.split(m[0]).join(`${m[1]}${ref}${m[3]}`);
    }
    return latexToDollars(out);
  };
  const modules = [];
  const counters: Record<string, number> = {};
  for (const m of mods) {
    const qs = await loadModuleQuestions(m.id);
    const section = m.section === "math" ? "math" : "ebrw";
    counters[section] = (counters[section] || 0) + 1;
    const num = m.moduleNumber ?? counters[section];
    const outQs = [];
    for (let i = 0; i < qs.length; i += 1) {
      const q = qs[i];
      const spr = q.type === "spr";
      const options = [];
      if (!spr) for (const l of LETTERS) {
        if (q.choices?.[l] == null && !q.choiceImages?.[l]) continue;
        const image = await assetFor(q.choiceImages?.[l] || null);
        options.push({ id: l, text: (await embed(q.choices?.[l] ?? "")) || "", ...(image ? { image } : {}) });
      }
      const image = await assetFor(q.questionImage || null);
      outQs.push({
        id: q.externalId || `${m.moduleKey || `m${m.id}`}-q${i + 1}`,
        questionNumber: i + 1,
        questionType: spr ? "SPR" : "MCQ",
        domain: q.category,
        skill: q.subcategory || "General",
        difficulty: q.difficulty <= 2 ? "Easy" : q.difficulty >= 4 ? "Hard" : "Medium",
        passageText: await embed(q.passage),
        questionPrompt: (await embed(q.prompt)) || "",
        ...(image ? { image } : {}),
        options,
        correctAnswer: q.answer,
        acceptableAnswers: Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : [],
        explanation: (await embed(q.explanation)) || "",
      });
    }
    modules.push({
      moduleId: m.moduleKey || `${OFFICIAL[section].short}_module_${num}`,
      title: m.title,
      section: section === "math" ? "Math" : "Reading and Writing",
      moduleNumber: num,
      difficultyTrack: m.difficultyTrack || "",
      timeLimitMinutes: m.timeLimitMinutes ?? test.timeLimitMinutes,
      questions: outQs,
    });
  }
  return {
    formatVersion: IMPORT_FORMAT_VERSION,
    testId: test.externalId || `test-${test.id}`,
    title: test.title,
    description: test.description,
    isAdaptive: test.isAdaptive,
    breakMinutes: test.breakMinutes,
    totalTimeMinutes: isPerModuleTimed(mods) ? mods.reduce((n, m) => n + (m.timeLimitMinutes ?? 0), 0) : test.timeLimitMinutes,
    assets: [...assets.values()],
    modules,
  };
}

// ─────────────── PUBLISH CHECKS ───────────────
// Run before a test goes live (publish button, visibility switch, assigning a
// draft): structure, answer keys and every stored graphic must be in place.
export async function publishProblems(testId: number) {
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return ["Test not found."];
  const problems: string[] = [];
  const mods = await loadTestModules(testId);
  if (!mods.length) problems.push("The test has no modules.");
  const keys = new Map<string, string>();
  for (const m of mods) {
    const qs = await loadModuleQuestions(m.id);
    const loc = m.title;
    if (!qs.length) problems.push(`${loc} — the module has no questions.`);
    qs.forEach((q, i) => {
      const where = `${loc} / Q${i + 1}`;
      if (q.type === "mcq") {
        const letters = LETTERS.filter((l) => q.choices?.[l]?.trim() || q.choiceImages?.[l]);
        if (letters.length < 2) problems.push(`${where} — needs at least two answer choices.`);
        if (!letters.includes(q.answer)) problems.push(`${where} — the correct answer "${q.answer}" is not one of its choices.`);
      } else if (!String(q.answer || "").trim()) problems.push(`${where} — has no correct answer.`);
      for (const k of mediaKeysInQuestion(q)) if (!keys.has(k)) keys.set(k, where);
    });
  }
  for (const [k, where] of keys) if (!(await questionMediaExists(k))) problems.push(`${where} — image ${MEDIA_URL_PREFIX}${k} is missing.`);
  if (test.isAdaptive) {
    const groups = new Map<string, number>();
    mods.forEach((m) => { if (m.moduleNumber != null) groups.set(`${m.section}:${m.moduleNumber}`, (groups.get(`${m.section}:${m.moduleNumber}`) || 0) + 1); });
    if (![...groups.values()].some((n) => n > 1)) problems.push("The test is marked adaptive but has no Module 2 variants to route between.");
  }
  return problems;
}

// Imported content against the stored test, for an at-a-glance integrity check.
export async function integrityReport(testId: number) {
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return null;
  const mods = await loadTestModules(testId);
  const modules = [];
  for (const m of mods) {
    const qs = await loadModuleQuestions(m.id);
    modules.push({
      moduleId: m.moduleKey, title: m.title, section: m.section, moduleNumber: m.moduleNumber, difficultyTrack: m.difficultyTrack,
      timeLimitMinutes: m.timeLimitMinutes, questionCount: qs.length,
      questions: qs.map((q, i) => ({
        position: i + 1, id: q.externalId, type: q.type, answer: q.answer, acceptableAnswers: q.acceptableAnswers || [],
        optionIds: q.type === "mcq" ? LETTERS.filter((l) => q.choices?.[l] != null || q.choiceImages?.[l]) : [],
        tables: [q.passage, q.prompt, q.explanation, ...Object.values(q.choices || {})].reduce((n, h) => n + (String(h ?? "").match(/<table\b/gi) || []).length, 0),
        images: mediaKeysInQuestion(q).size,
      })),
    });
  }
  return {
    test: { id: test.id, externalId: test.externalId, title: test.title, status: test.status, isAdaptive: test.isAdaptive, breakMinutes: test.breakMinutes, timeLimitMinutes: test.timeLimitMinutes },
    modules,
    problems: await publishProblems(testId),
  };
}

// The sample test is imported once, on the first visit to the test list. A
// settings row records that it happened, so an admin who deletes the sample
// does not see it come back.
const SEED_KEY = `seed:fulltest:${SEED_FULL_TEST.testId}`;
let seedChecked = false;
export async function ensureSeedFullTest() {
  if (seedChecked) return;
  const [claimed] = await db.insert(settings).values({ key: SEED_KEY, value: { at: new Date().toISOString() } })
    .onConflictDoNothing().returning();
  seedChecked = true;
  if (!claimed) return;
  const [existing] = await db.select({ id: tests.id }).from(tests).where(eq(tests.externalId, SEED_FULL_TEST.testId)).limit(1);
  if (existing) return;
  const { test } = await prepareImport(SEED_FULL_TEST, { persist: true });
  if (test) await createTestFromImport(test, null, "published");
}

// ─────────────── EXAM TASKS ───────────────
async function studentClassIds(studentId: number) {
  const rows = await db.select({ classId: classEnrollments.classId }).from(classEnrollments)
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active")));
  return rows.map((r) => r.classId);
}
export async function assignmentReaches(a: AssignmentRow, studentId: number) {
  if (a.allStudents) return true;
  if (a.studentIds.includes(studentId)) return true;
  if (!a.classIds.length) return false;
  const mine = await studentClassIds(studentId);
  return a.classIds.some((c) => mine.includes(c));
}
async function assignmentAudience(a: AssignmentRow) {
  let ids: number[];
  if (a.allStudents) {
    ids = (await db.select({ id: users.id }).from(users).where(eq(users.role, "student"))).map((r) => r.id);
  } else {
    const set = new Set<number>(a.studentIds);
    if (a.classIds.length) {
      const rows = await db.select({ studentId: classEnrollments.studentId }).from(classEnrollments)
        .where(and(inArray(classEnrollments.classId, a.classIds), eq(classEnrollments.status, "active")));
      rows.forEach((r) => set.add(r.studentId));
    }
    ids = [...set];
  }
  if (!ids.length) return [] as DbUser[];
  return (await db.select().from(users).where(inArray(users.id, ids))).filter((u) => u.status !== "banned");
}
export async function loadAssignment(id: number) {
  const [row] = await db.select().from(testAssignments).where(eq(testAssignments.id, id)).limit(1);
  return row ?? null;
}
function studentTaskStatus(a: AssignmentRow, attempt?: TestAttemptRow | null) {
  if (attempt?.submittedAt) return new Date(attempt.submittedAt) > new Date(a.dueAt) ? "Completed_Late" : "Completed";
  if (attempt) return new Date(a.dueAt).getTime() < Date.now() ? "Overdue" : "In_Progress";
  return new Date(a.dueAt).getTime() < Date.now() ? "Overdue" : "Pending";
}
const publicStudent = (u: DbUser) => ({ id: u.id, displayName: u.displayName, username: u.username, email: u.email, avatarUrl: u.avatarUrl });

async function parseAssignmentBody(b: any, user: DbUser, current?: AssignmentRow) {
  const testId = Number(b.testId ?? current?.testId);
  const [test] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
  if (!test) return { error: "Choose a test to assign." };
  const mods = await loadTestModules(test.id);
  if (!mods.length) return { error: "That test has no modules yet." };
  const title = s(b.title ?? current?.title, 200) || test.title;
  const dueAt = new Date(String(b.dueAt ?? current?.dueAt ?? ""));
  if (Number.isNaN(dueAt.getTime())) return { error: "Choose a due date." };
  if (!current && dueAt <= new Date()) return { error: "Choose a future due date." };
  const modIds = new Set(mods.map((m) => m.id));
  const moduleIds = ([...new Set((Array.isArray(b.moduleIds) ? b.moduleIds : current?.moduleIds ?? []).map(Number))] as number[])
    .filter((id) => modIds.has(id));
  if (moduleIds.length === mods.length) moduleIds.length = 0;
  const allStudents = user.role === "admin" ? Boolean(b.allStudents ?? current?.allStudents ?? false) : false;
  const targets = await assignableTargets(user);
  const okClass = new Set(targets.classes.map((c) => c.id));
  const okStudent = new Set(targets.students.map((st) => st.id));
  const classIds = ([...new Set((Array.isArray(b.classIds) ? b.classIds : current?.classIds ?? []).map(Number))] as number[]).filter((id) => okClass.has(id));
  const studentIds = ([...new Set((Array.isArray(b.studentIds) ? b.studentIds : current?.studentIds ?? []).map(Number))] as number[]).filter((id) => okStudent.has(id));
  if (!allStudents && !classIds.length && !studentIds.length) return { error: "Choose at least one class or student." };
  return {
    test,
    values: {
      testId: test.id, title, instructions: s(b.instructions ?? current?.instructions, 4000),
      classIds, studentIds, allStudents, moduleIds, dueAt,
      allowPause: b.allowPause === undefined ? (current?.allowPause ?? true) : Boolean(b.allowPause),
    },
  };
}

async function latestAttemptFor(assignmentId: number, studentId: number) {
  const [row] = await db.select().from(testAttempts)
    .where(and(eq(testAttempts.assignmentId, assignmentId), eq(testAttempts.studentId, studentId)))
    .orderBy(desc(testAttempts.startedAt)).limit(1);
  return row ?? null;
}

function moduleSummary(mods: TestModuleRow[], ids: number[]) {
  const list = ids.length ? mods.filter((m) => ids.includes(m.id)) : mods;
  return list.map((m) => ({ id: m.id, title: m.title, section: m.section, timeLimitMinutes: m.timeLimitMinutes }));
}

// ─────────────── ROUTES ───────────────
export async function handleFullTests(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  const { json, requireUser } = deps;
  const [resource, id] = parts;
  const method = req.method;
  const url = new URL(req.url);

  // /api/tests/import[/preview|/template|/schema|/asset]
  if (resource === "tests" && id === "import") {
    if (parts[2] === "template" && method === "GET") return json(EXAMPLE_TEST);
    if (parts[2] === "schema" && method === "GET") return json(IMPORT_SCHEMA);
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    if (method !== "POST") return json({ error: "Method not allowed." }, 405);

    // One embedded image, sent ahead of a file too large for a single request.
    // Validated exactly like images inside the file, and stored under the same
    // content-addressed key, so the file can then reference it by URL.
    if (parts[2] === "asset") {
      const contentType = (req.headers.get("content-type") || "").split(";")[0].trim();
      const bytes = Buffer.from(await req.arrayBuffer());
      const img = decodeImage(bytes.toString("base64"), contentType);
      if ("error" in img) return json({ error: `The image could not be used: ${img.error}.` }, 400);
      await saveQuestionMedia(img.bytes, img.mimeType, img.key);
      return json({ url: img.url, key: img.key, mimeType: img.mimeType, size: img.size }, 201);
    }

    const b = await req.json().catch(() => null);
    if (!b) return json({ error: "Send the test file contents." }, 400);
    const fallbackTitle = s(b.fileName, 200).replace(/\.(json|csv)$/i, "") || undefined;
    const result = await prepareImport(b.data ?? b.test ?? b, { fallbackTitle, persist: true });
    const sourceHash = /^[a-f0-9]{64}$/.test(String(b.sourceHash || "")) ? String(b.sourceHash) : result.sourceHash;
    const draft = result.draft;
    const sameId = draft
      ? (await db.select({ id: tests.id, title: tests.title, status: tests.status }).from(tests).where(eq(tests.externalId, draft.testId)).orderBy(tests.id).limit(1))[0] ?? null
      : null;
    const sameFile = sourceHash
      ? (await db.select({ id: tests.id, title: tests.title, status: tests.status }).from(tests).where(eq(tests.importHash, sourceHash)).orderBy(tests.id).limit(1))[0] ?? null
      : null;

    if (parts[2] === "preview") return json({ ...result, sourceHash, existing: sameId, duplicateOf: sameFile });

    if (!result.test) {
      const n = result.errors.length;
      return json({ error: `The file has ${n} problem${n === 1 ? "" : "s"} to fix before it can be imported. Nothing was saved.`, issues: result.issues, errors: result.errors, warnings: result.warnings, summary: result.summary, sourceHash }, 400);
    }
    // Never overwrite and never silently duplicate: the same file, or another
    // file with the same testId, is only imported again as an explicit copy.
    if (sameFile && !b.asCopy)
      return json({ error: `This exact file was already imported as “${sameFile.title}” (${sameFile.status}). Nothing was changed.`, duplicate: true, existing: sameFile }, 409);
    let externalId = result.test.testId;
    const clash = async (eid: string) => (await db.select({ id: tests.id }).from(tests).where(eq(tests.externalId, eid)).limit(1))[0];
    if (sameId && !b.asCopy)
      return json({ error: `A test with id "${externalId}" already exists (“${sameId.title}”, ${sameId.status}). Nothing was changed.`, conflict: true, existing: sameId }, 409);
    if (await clash(externalId)) {
      let n = 2;
      while (await clash(`${result.test.testId}-copy-${n}`)) n += 1;
      externalId = `${result.test.testId}-copy-${n}`;
    }
    const created = await createTestFromImport(result.test, auth.user!.id, "draft", externalId, sourceHash || null);
    // Words carried by the file go into the shared bank through the same
    // checked path as a vocab upload (this route is admin / mentor only).
    let vocabulary: { created: number; updated: number; skipped: number; wordIds: string[] } | null = null;
    if (result.test.vocabulary?.length) {
      try { vocabulary = await mergeVocabWords(result.test.vocabulary, auth.user!, "merge"); }
      catch (err) { console.error("Vocabulary from the test file was not saved", err); }
    }
    let test = created;
    let problems: string[] = [];
    if (b.status === "published") {
      problems = await publishProblems(created.id);
      if (!problems.length) [test] = await db.update(tests).set({ status: "published" }).where(eq(tests.id, created.id)).returning();
    }
    const mods = await loadTestModules(created.id);
    return json({ test, modules: mods, summary: result.summary, warnings: result.warnings, problems, vocabulary }, 201);
  }

  // /api/tests/:id/publish — the checked way to take a draft live.
  // /api/tests/:id/integrity — the stored structure, for comparing with the source file.
  if (resource === "tests" && id && (parts[2] === "publish" || parts[2] === "integrity")) {
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    const testId = Number(id);
    const [row] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
    if (!row) return json({ error: "Test not found." }, 404);
    if (parts[2] === "integrity" && method === "GET") return json(await integrityReport(testId));
    if (parts[2] === "publish" && method === "POST") {
      if (auth.user!.role === "mentor" && row.createdBy !== auth.user!.id)
        return json({ error: "Only the author of this test, or an admin, can publish it." }, 403);
      const problems = await publishProblems(testId);
      if (problems.length) return json({ error: `The test cannot be published yet: ${problems[0]}`, problems }, 400);
      const [updated] = await db.update(tests).set({ status: "published" }).where(eq(tests.id, testId)).returning();
      return json(updated);
    }
    return json({ error: "Method not allowed." }, 405);
  }

  // /api/tests/:id/export
  if (resource === "tests" && id && parts[2] === "export" && method === "GET") {
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    const testId = Number(id);
    const [row] = await db.select().from(tests).where(eq(tests.id, testId)).limit(1);
    if (!row) return json({ error: "Test not found." }, 404);
    if (auth.user!.role === "mentor" && row.createdBy !== auth.user!.id)
      return json({ error: "Only the author of this test, or an admin, can export it." }, 403);
    return json(await exportTest(testId));
  }

  // /api/test-analytics[?testId=]
  if (resource === "test-analytics" && method === "GET") {
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    const u = auth.user!;
    const testFilter = Number(url.searchParams.get("testId")) || null;
    let scope: number[] | null = null;
    if (u.role === "mentor") scope = (await assignableTargets(u)).students.map((st) => st.id);
    if (scope && !scope.length) return json({ attempts: [], distribution: [], students: [] });
    const conds = [sql`${testAttempts.submittedAt} is not null`];
    if (testFilter) conds.push(eq(testAttempts.testId, testFilter));
    if (scope) conds.push(inArray(testAttempts.studentId, scope));
    const rows = await db.select({ attempt: testAttempts, title: tests.title })
      .from(testAttempts).innerJoin(tests, eq(testAttempts.testId, tests.id))
      .where(and(...conds)).orderBy(desc(testAttempts.submittedAt)).limit(500);
    const studentIds = [...new Set(rows.map((r) => r.attempt.studentId))];
    const people = studentIds.length ? await db.select().from(users).where(inArray(users.id, studentIds)) : [];
    const byId = new Map(people.map((p) => [p.id, p]));
    const out = [];
    for (const r of rows) {
      const report = await ensureScoreReport(r.attempt);
      const student = byId.get(r.attempt.studentId);
      if (!report || !student) continue;
      out.push({
        attemptId: r.attempt.id, testId: r.attempt.testId, testTitle: r.title, assignmentId: r.attempt.assignmentId,
        submittedAt: r.attempt.submittedAt, student: publicStudent(student),
        totalScaled: report.totalScaled, rwScaled: report.rwScaled, mathScaled: report.mathScaled,
        correctCount: report.correctCount, totalCount: report.totalCount, domains: report.domains,
      });
    }
    return json({ attempts: out });
  }

  if (resource !== "test-assignments") return null;
  const auth = await requireUser(req, ["admin", "mentor", "student"]);
  if (auth.error) return auth.error;
  const u = auth.user!;

  if (method === "GET" && !id) {
    if (u.role === "student") {
      const rows = await db.select({ a: testAssignments, test: tests }).from(testAssignments)
        .innerJoin(tests, eq(testAssignments.testId, tests.id)).orderBy(testAssignments.dueAt);
      const mine = [];
      const classIds = await studentClassIds(u.id);
      for (const r of rows) {
        const reach = r.a.allStudents || r.a.studentIds.includes(u.id) || r.a.classIds.some((c) => classIds.includes(c));
        if (!reach) continue;
        const attempt = await latestAttemptFor(r.a.id, u.id);
        const report = attempt?.submittedAt ? await ensureScoreReport(attempt) : null;
        const mods = await loadTestModules(r.test.id);
        mine.push({
          ...r.a, testTitle: r.test.title, modules: moduleSummary(mods, r.a.moduleIds),
          status: studentTaskStatus(r.a, attempt),
          attempt: attempt ? { id: attempt.id, submittedAt: attempt.submittedAt, status: attempt.status, moduleIndex: attempt.moduleIndex, correctCount: attempt.correctCount, totalCount: attempt.totalCount } : null,
          totalScaled: report?.totalScaled ?? null, rwScaled: report?.rwScaled ?? null, mathScaled: report?.mathScaled ?? null,
        });
      }
      return json(mine);
    }
    const rows = await db.select({ a: testAssignments, test: tests }).from(testAssignments)
      .innerJoin(tests, eq(testAssignments.testId, tests.id))
      .where(u.role === "admin" ? undefined : eq(testAssignments.assignedBy, u.id))
      .orderBy(desc(testAssignments.createdAt));
    const out = [];
    for (const r of rows) {
      const audience = await assignmentAudience(r.a);
      const submitted = audience.length ? await db.select({ studentId: testAttempts.studentId }).from(testAttempts)
        .where(and(eq(testAttempts.assignmentId, r.a.id), sql`${testAttempts.submittedAt} is not null`)) : [];
      const done = new Set(submitted.map((x) => x.studentId).filter((sid) => audience.some((p) => p.id === sid)));
      const [author] = await db.select().from(users).where(eq(users.id, r.a.assignedBy)).limit(1);
      out.push({
        ...r.a, testTitle: r.test.title, modules: moduleSummary(await loadTestModules(r.test.id), r.a.moduleIds),
        audienceCount: audience.length, completedCount: done.size,
        assignedByName: author?.displayName || "—", canManage: u.role === "admin" || r.a.assignedBy === u.id,
      });
    }
    return json(out);
  }

  if (u.role === "student") return json({ error: "Only admins and mentors can manage exam tasks." }, 403);

  if (method === "POST" && !id) {
    const b = await req.json().catch(() => ({}));
    const parsed = await parseAssignmentBody(b, u);
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    // Assigning a draft publishes it — the student has to be able to open it —
    // so it has to pass the same checks as the Publish button.
    if (parsed.test.status !== "published") {
      const problems = await publishProblems(parsed.test.id);
      if (problems.length) return json({ error: `This draft cannot be assigned until it can be published: ${problems[0]}`, problems }, 400);
    }
    if (parsed.test.status !== "published") await db.update(tests).set({ status: "published" }).where(eq(tests.id, parsed.test.id));
    const [row] = await db.insert(testAssignments).values({ ...parsed.values, assignedBy: u.id }).returning();
    return json(row, 201);
  }

  const assignmentId = Number(id);
  const current = Number.isInteger(assignmentId) ? await loadAssignment(assignmentId) : null;
  if (!current) return json({ error: "Exam task not found." }, 404);
  const canManage = u.role === "admin" || current.assignedBy === u.id;

  if (method === "GET" && parts[2] === "report") {
    if (!canManage) return json({ error: "You do not have access to this exam task." }, 403);
    const [test] = await db.select().from(tests).where(eq(tests.id, current.testId)).limit(1);
    const audience = await assignmentAudience(current);
    const students = [];
    for (const p of audience) {
      const attempt = await latestAttemptFor(current.id, p.id);
      const report = attempt?.submittedAt ? await ensureScoreReport(attempt) : null;
      students.push({
        student: publicStudent(p),
        status: studentTaskStatus(current, attempt),
        attemptId: attempt?.id ?? null,
        submittedAt: attempt?.submittedAt ?? null,
        moduleIndex: attempt?.moduleIndex ?? null,
        report: report ? {
          totalScaled: report.totalScaled, rwScaled: report.rwScaled, mathScaled: report.mathScaled,
          correctCount: report.correctCount, totalCount: report.totalCount,
          domains: report.domains, skills: report.skills, modules: report.modules, sections: report.sections,
        } : null,
      });
    }
    return json({ assignment: current, test, modules: moduleSummary(await loadTestModules(current.testId), current.moduleIds), students });
  }

  if (!canManage) return json({ error: "Only the mentor who assigned this exam, or an admin, can change it." }, 403);

  if (method === "PUT") {
    const b = await req.json().catch(() => ({}));
    const parsed = await parseAssignmentBody({ ...b, testId: current.testId }, u, current);
    if ("error" in parsed) return json({ error: parsed.error }, 400);
    const [row] = await db.update(testAssignments).set(parsed.values).where(eq(testAssignments.id, current.id)).returning();
    return json(row);
  }

  if (method === "DELETE") {
    // Sittings already taken stay on the student's record as practice.
    await db.update(testAttempts).set({ assignmentId: null }).where(eq(testAttempts.assignmentId, current.id));
    await db.delete(testAssignments).where(eq(testAssignments.id, current.id));
    return json({ deleted: current.id });
  }

  return json({ error: "Method not allowed." }, 405);
}
