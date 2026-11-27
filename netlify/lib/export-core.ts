// netlify/lib/export-core.ts — pure helpers behind the shared question export
// (no imports), used by netlify/lib/export.ts and the unit tests.
//
//  • filters: the Question Bank "current selection" (subject, difficulty band
//    or exact level, domain, skill, type, free-text search) — matched against
//    canonical tags, so legacy spellings never fall out of a filtered export;
//  • order: the bank's stable order (domain, skill, difficulty, id);
//  • collection documents: question objects in the collection importer format
//    (docs/collection-import/README.md), one importer-compatible document per
//    Question Bank domain (split at the importer's 500-question limit), or one
//    Challenging Questions set document;
//  • solution stripping: answer keys, accepted answers and explanations are
//    removed from both JSON and print payloads unless the export includes them.

export const EXPORT_FORMAT = "fnf-sat-export";
export const EXPORT_VERSION = "1.0";
export const PRINT_FORMAT = "fnf-sat-print";
export const COLLECTION_FORMAT_VERSION = "1.0"; // = collections.ts COLLECTION_FORMAT_VERSION
export const MAX_FILE_QUESTIONS = 500;          // = collections.ts MAX_QUESTIONS (one file)
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/; // = collections.ts ID_RE
const LETTERS = ["A", "B", "C", "D"];

export type Band = "easy" | "medium" | "hard";
export interface ExportRow {
  id: number; section: string; category: string; subcategory: string; difficulty: number; type: string;
  passage: string | null; prompt: string; questionImage: string | null;
  choices: Record<string, string> | null; choiceImages: Record<string, string> | null;
  answer: string; acceptableAnswers: string[] | null; explanation: string;
  externalId: string | null;
}
export interface ExportFilters {
  subjects: string[]; difficulties: Band[]; levels: number[]; domains: string[]; skills: string[]; types: string[]; q: string;
}
export type Canon = (section: string, category: string, subcategory: string) => { category: string; subcategory: string };

const SECTION_LABEL: Record<string, string> = { math: "Math", ebrw: "Reading and Writing" };
export const sectionLabel = (s: string) => SECTION_LABEL[s] ?? s;

// ─────────────── filters ───────────────
const list = (v: unknown, max = 40): string[] => {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(",") : [];
  return [...new Set(raw.map((x) => String(x ?? "").trim().slice(0, 160)).filter(Boolean))].slice(0, max);
};
export function normalizeExportFilters(raw: unknown): ExportFilters {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    subjects: list(r.subjects).filter((s) => s === "math" || s === "ebrw"),
    difficulties: list(r.difficulties).map((s) => s.toLowerCase()).filter((s): s is Band => s === "easy" || s === "medium" || s === "hard"),
    levels: list(r.levels).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 5),
    domains: list(r.domains),
    skills: list(r.skills, 80),
    types: list(r.types).map((s) => s.toLowerCase()).filter((s) => s === "mcq" || s === "spr"),
    q: String(r.q ?? "").trim().slice(0, 200),
  };
}
// Query string → filters. Several values per key (?skills=A&skills=B), since
// skill names may contain commas; a single comma-free value may also be a list.
export function exportFiltersFromParams(p: URLSearchParams): ExportFilters {
  const get = (k: string) => p.getAll(k);
  const split = (k: string) => get(k).flatMap((v) => v.split(","));
  return normalizeExportFilters({
    subjects: split("subjects"), difficulties: split("difficulties"), levels: split("levels"), types: split("types"),
    domains: get("domains"), skills: get("skills"), q: p.get("q") ?? "",
  });
}
export const hasExportFilters = (f: ExportFilters) =>
  !!(f.subjects.length || f.difficulties.length || f.levels.length || f.domains.length || f.skills.length || f.types.length || f.q);

export function difficultyBand(d: number): Band { return d <= 2 ? "easy" : d === 3 ? "medium" : "hard"; }
export function difficultyLabel(d: number) { return d <= 2 ? "Easy" : d >= 4 ? "Hard" : "Medium"; }

const plain = (html: unknown) => String(html ?? "").replace(/<[^>]*>/g, " ");
// Same haystack as the staff question browser (index.html questionSearchText).
export function searchText(q: ExportRow) {
  return [q.id, q.prompt, q.passage, q.category, q.subcategory, q.explanation, ...Object.values(q.choices || {})]
    .map(plain).join(" ").toLowerCase();
}

// Rows and filter values must both be canonical (see canonicalRows / the
// caller's canonical filter values). Several values within one filter are
// OR-ed; filters are AND-ed; an empty filter does not narrow.
export function matchesExportFilter(q: ExportRow, f: ExportFilters) {
  if (f.subjects.length && !f.subjects.includes(q.section)) return false;
  if (f.difficulties.length || f.levels.length) {
    const okBand = f.difficulties.includes(difficultyBand(q.difficulty));
    const okLevel = f.levels.includes(q.difficulty);
    if (!okBand && !okLevel) return false;
  }
  if (f.domains.length && !f.domains.includes(q.category)) return false;
  if (f.skills.length && !f.skills.includes(q.subcategory)) return false;
  if (f.types.length && !f.types.includes((q.type || "mcq").toLowerCase())) return false;
  if (f.q) {
    const term = f.q.toLowerCase().replace(/^#/, "");
    if (term && String(q.id) !== term && !searchText(q).includes(term)) return false;
  }
  return true;
}
export function canonicalRows<T extends ExportRow>(rows: T[], canon: Canon): T[] {
  return rows.map((r) => ({ ...r, ...canon(r.section, r.category, r.subcategory || "") }));
}
export function filterExportRows<T extends ExportRow>(rows: T[], f: ExportFilters) {
  return rows.filter((r) => matchesExportFilter(r, f));
}

// Stable order: domain order, then skill order, difficulty, id — identical to
// practice-core stableOrder (the tests check both agree).
export function stableExportOrder<T extends { id: number; category: string; subcategory: string; difficulty: number }>(items: T[], domainOrder: string[], skillOrder: Record<string, string[]>) {
  const di = (d: string) => { const i = domainOrder.indexOf(d); return i < 0 ? 99 : i; };
  const si = (d: string, s: string) => { const i = (skillOrder[d] || []).indexOf(s); return i < 0 ? 99 : i; };
  return [...items].sort((a, b) => di(a.category) - di(b.category) || si(a.category, a.subcategory) - si(b.category, b.subcategory) || a.difficulty - b.difficulty || a.id - b.id);
}

export function bankScopeLabel(f: ExportFilters | null) {
  if (!f || !hasExportFilters(f)) return "Question Bank · entire bank";
  const parts: string[] = [];
  if (f.subjects.length) parts.push(f.subjects.map(sectionLabel).join(" + "));
  if (f.domains.length) parts.push(f.domains.join(" + "));
  if (f.skills.length) parts.push(f.skills.join(" + "));
  const diffs = [...f.difficulties.map((d) => d[0].toUpperCase() + d.slice(1)), ...f.levels.map((l) => `Level ${l}`)];
  if (diffs.length) parts.push(diffs.join(" + "));
  if (f.types.length) parts.push(f.types.map((t) => (t === "spr" ? "Grid-in" : "Multiple choice")).join(" + "));
  if (f.q) parts.push(`matching “${f.q}”`);
  return `Question Bank · ${parts.join(" · ")}`;
}

// ─────────────── ids ───────────────
// The question's own stable id when it is a valid importer id and not yet used
// in this file, else q-<database id>.
export function exportQuestionId(row: Pick<ExportRow, "id" | "externalId">, used: Set<string>) {
  const ext = String(row.externalId ?? "").trim();
  let id = ext && ID_RE.test(ext) && !used.has(ext) ? ext : `q-${row.id}`;
  if (used.has(id)) id = `q-${row.id}-${used.size}`;
  used.add(id);
  return id;
}

// ─────────────── one question ───────────────
const orderedChoices = (q: Pick<ExportRow, "choices" | "choiceImages">) => {
  const out: { id: string; text: string; image: string | null }[] = [];
  for (const l of LETTERS) {
    const text = q.choices?.[l];
    const image = q.choiceImages?.[l] ? String(q.choiceImages[l]) : null;
    if ((text === undefined || text === null) && !image) continue;
    out.push({ id: l, text: String(text ?? ""), image });
  }
  return out;
};
const isSpr = (q: Pick<ExportRow, "type">) => (q.type || "mcq").toLowerCase() === "spr";

/**
 * One stored question → one question object of the collection importer. Text
 * keeps its stored form (plain text with LaTeX islands, or editor HTML), which
 * the importer reads back unchanged; images stay platform media URLs
 * (/api/question-media/…), which the importer accepts after checking they
 * exist. Without solutions, the answer key, accepted answers and explanation
 * are left out.
 */
export function toCollectionQuestion(q: ExportRow, id: string, opts: { solutions: boolean; withDomain: boolean }) {
  const spr = isSpr(q);
  const out: Record<string, unknown> = { id };
  if (opts.withDomain) out.domain = q.category;
  out.skill = q.subcategory || "";
  out.difficulty = difficultyLabel(q.difficulty);
  out.questionType = spr ? "SPR" : "MCQ";
  out.passageText = q.passage || null;
  out.questionPrompt = q.prompt || "";
  if (q.questionImage) out.image = q.questionImage;
  out.options = spr ? [] : orderedChoices(q).map((o) => ({ id: o.id, text: o.text, ...(o.image ? { image: o.image } : {}) }));
  if (opts.solutions) {
    out.correctAnswer = q.answer;
    const acc = (Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : []).map(String).filter((a) => a && a !== q.answer);
    if (spr && acc.length) out.acceptableAnswers = acc;
    out.explanation = q.explanation || "";
  }
  return out;
}

export const SOLUTION_KEYS = ["correctAnswer", "acceptableAnswers", "explanation", "answer", "rationale", "solution"];
// Remove every answer key / explanation field from an export or print payload
// (any depth: test modules, bundle files, print groups).
export function stripSolutions<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripSolutions) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SOLUTION_KEYS.includes(k)) continue;
      out[k] = stripSolutions(v);
    }
    return out as T;
  }
  return value;
}

// ─────────────── collection documents ───────────────
export interface ExportMeta { scopeLabel: string; exportedAt: string; solutions: boolean }
const meta = (m: ExportMeta, extra: Record<string, unknown> = {}) => ({
  format: EXPORT_FORMAT, version: EXPORT_VERSION, scope: m.scopeLabel, exportedAt: m.exportedAt, solutions: m.solutions,
  importable: m.solutions, ...extra,
});
export const slug = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "export";

/**
 * Bank rows (canonical, in stable order) → one questionBankDomain document per
 * section + domain, split into parts of at most 500 questions (the importer's
 * one-file limit). Every document is directly importable on its own when
 * solutions are included. Rows whose domain is not a platform domain cannot go
 * into a domain file; they are returned in `unclassified`.
 */
export function buildBankDocuments(rows: ExportRow[], domains: Record<string, readonly string[]>, m: ExportMeta) {
  const groups = new Map<string, { section: string; domain: string; rows: ExportRow[] }>();
  const unclassified: ExportRow[] = [];
  for (const r of rows) {
    if (!(domains[r.section] || []).includes(r.category)) { unclassified.push(r); continue; }
    const k = `${r.section}\u0000${r.category}`;
    if (!groups.has(k)) groups.set(k, { section: r.section, domain: r.category, rows: [] });
    groups.get(k)!.rows.push(r);
  }
  const docs: Record<string, any>[] = [];
  for (const g of groups.values()) {
    const parts = Math.max(1, Math.ceil(g.rows.length / MAX_FILE_QUESTIONS));
    const used = new Set<string>(); // ids are unique per destination domain
    for (let p = 0; p < parts; p += 1) {
      const chunk = g.rows.slice(p * MAX_FILE_QUESTIONS, (p + 1) * MAX_FILE_QUESTIONS);
      docs.push({
        formatVersion: COLLECTION_FORMAT_VERSION,
        destination: { type: "questionBankDomain", section: g.section, domain: g.domain },
        export: meta(m, { part: p + 1, parts, fileName: `${g.section}-${slug(g.domain)}${parts > 1 ? `-part${p + 1}` : ""}.json` }),
        assets: [],
        questions: chunk.map((r) => toCollectionQuestion(r, exportQuestionId(r, used), { solutions: m.solutions, withDomain: true })),
      });
    }
  }
  return { docs, unclassified };
}

// Several domain documents → one bundle file; a single document is returned
// as it is (then the downloaded file is itself importable).
export function assembleBankExport(docs: Record<string, any>[], unclassified: ExportRow[], m: ExportMeta) {
  const questionCount = docs.reduce((n, d) => n + d.questions.length, 0);
  if (docs.length === 1 && !unclassified.length) return docs[0];
  return {
    format: EXPORT_FORMAT, version: EXPORT_VERSION, kind: "questionBankBundle",
    scope: m.scopeLabel, exportedAt: m.exportedAt, solutions: m.solutions, importable: m.solutions,
    questionCount,
    note: "Each entry of `files` is one complete collection-import document (formatVersion 1.0, destination questionBankDomain). Save an entry as its own .json file (its export.fileName) and import it from All Questions → Import JSON; the bundle itself is not imported in one step.",
    files: docs,
    ...(unclassified.length ? { unclassified: unclassified.map((r) => ({ id: r.id, section: r.section, domain: r.category, skill: r.subcategory })) } : {}),
  };
}

export function buildChallengeDocument(set: { externalId: string; section: string; title: string; description: string }, rows: ExportRow[], m: ExportMeta) {
  const used = new Set<string>();
  return {
    formatVersion: COLLECTION_FORMAT_VERSION,
    destination: { type: "challengeSet", section: set.section, setId: set.externalId, title: set.title, description: set.description || "" },
    export: meta(m, { fileName: `${slug(set.externalId)}.json` }),
    assets: [],
    questions: rows.map((r) => toCollectionQuestion(r, exportQuestionId(r, used), { solutions: m.solutions, withDomain: true })),
  };
}

// Structural checks the collection importer applies before anything else
// (destination, ids, domains, skills, difficulty, type, answers). Returns the
// problems; an empty list means the document has every required field.
export function collectionDocProblems(doc: any, domains: Record<string, readonly string[]>, skills: Record<string, string[]>) {
  const problems: string[] = [];
  const d = doc?.destination;
  if (!d || (d.type !== "questionBankDomain" && d.type !== "challengeSet")) return ["destination.type"];
  if (d.section !== "math" && d.section !== "ebrw") problems.push("destination.section");
  if (d.type === "questionBankDomain" && !(domains[d.section] || []).includes(d.domain)) problems.push("destination.domain");
  if (d.type === "challengeSet") {
    if (!/^[a-z0-9][a-z0-9._-]{1,79}$/.test(String(d.setId ?? ""))) problems.push("destination.setId");
    if (!String(d.title ?? "").trim()) problems.push("destination.title");
  }
  if (!Array.isArray(doc.questions) || !doc.questions.length) return [...problems, "questions"];
  if (doc.questions.length > MAX_FILE_QUESTIONS) problems.push("questions (over 500)");
  const seen = new Set<string>();
  doc.questions.forEach((q: any, i: number) => {
    const at = `Q${i + 1}`;
    if (!ID_RE.test(String(q.id ?? "")) || seen.has(q.id)) problems.push(`${at} id`);
    seen.add(q.id);
    const domain = d.type === "questionBankDomain" ? d.domain : q.domain;
    if (!(domains[d.section] || []).includes(domain)) problems.push(`${at} domain`);
    if (!(skills[domain] || []).includes(q.skill)) problems.push(`${at} skill`);
    if (!["Easy", "Medium", "Hard"].includes(q.difficulty)) problems.push(`${at} difficulty`);
    if (q.questionType !== "MCQ" && q.questionType !== "SPR") problems.push(`${at} questionType`);
    if (!q.questionPrompt && !q.passageText && !q.image) problems.push(`${at} prompt`);
    if (!String(q.correctAnswer ?? "")) problems.push(`${at} correctAnswer`);
    if (q.questionType === "MCQ") {
      const ids = (q.options || []).map((o: any) => o.id);
      if (ids.length < 2 || ids.length > 4 || ids.some((x: string, j: number) => x !== LETTERS[j])) problems.push(`${at} options`);
      else if (!ids.includes(String(q.correctAnswer ?? "").toUpperCase())) problems.push(`${at} correctAnswer`);
    }
  });
  return problems;
}

// ─────────────── print payload ───────────────
export interface PrintQuestion {
  n: number; id: string; section: string; domain: string; skill: string; difficulty: string; type: "MCQ" | "SPR";
  passage: string | null; prompt: string; image: string | null; choices: { id: string; text: string; image: string | null }[];
  answer?: string; acceptableAnswers?: string[]; explanation?: string;
}
export function toPrintQuestion(q: ExportRow, n: number, id: string, solutions: boolean): PrintQuestion {
  const spr = isSpr(q);
  const out: PrintQuestion = {
    n, id, section: q.section, domain: q.category, skill: q.subcategory || "", difficulty: difficultyLabel(q.difficulty),
    type: spr ? "SPR" : "MCQ", passage: q.passage || null, prompt: q.prompt || "", image: q.questionImage || null,
    choices: spr ? [] : orderedChoices(q),
  };
  if (solutions) {
    out.answer = q.answer;
    out.acceptableAnswers = (Array.isArray(q.acceptableAnswers) ? q.acceptableAnswers : []).map(String).filter((a) => a && a !== q.answer);
    out.explanation = q.explanation || "";
  }
  return out;
}

// Bank rows → print groups, one per section + domain, numbered continuously.
export function bankPrintGroups(rows: ExportRow[], solutions: boolean) {
  const groups: { heading: string; subheading: string; meta: string[]; breakBefore: boolean; questions: PrintQuestion[] }[] = [];
  const used = new Set<string>();
  let n = 0;
  for (const r of rows) {
    const heading = `${sectionLabel(r.section)} · ${r.category}`;
    let g = groups[groups.length - 1];
    if (!g || g.heading !== heading) { g = { heading, subheading: "", meta: [], breakBefore: groups.length > 0, questions: [] }; groups.push(g); }
    n += 1;
    g.questions.push(toPrintQuestion(r, n, exportQuestionId(r, used), solutions));
  }
  for (const g of groups) g.meta = [`${g.questions.length} question${g.questions.length === 1 ? "" : "s"}`];
  return groups;
}

// Adaptive branch label for one module of a test, following fulltests.ts
// routing: after Module 1 of a section, ≥ threshold correct → Hard variant,
// otherwise Easy (Standard / Baseline when that variant is missing).
export function branchLabel(m: { difficultyTrack: string; moduleNumber: number | null }, isAdaptive: boolean, variants: number, threshold: number) {
  const track = (m.difficultyTrack || "").trim();
  const t = track.toLowerCase();
  const pct = `${Math.round(threshold * 100)}%`;
  if (!isAdaptive || variants < 2) return track ? `${track} track` : "";
  if (t === "hard") return `Hard branch — taken when at least ${pct} of the section's earlier answers are correct`;
  if (t === "easy") return `Easy branch — taken when fewer than ${pct} of the section's earlier answers are correct`;
  if (t === "standard") return "Standard branch — the default variant, and the fallback when the Hard or Easy variant is missing";
  return track ? `${track} branch` : "Branch variant";
}
export function routingRule(isAdaptive: boolean, threshold: number) {
  if (!isAdaptive) return "";
  const pct = `${Math.round(threshold * 100)}%`;
  return `Adaptive test: Module 1 of each section is the same for everyone. Students with at least ${pct} of that section's Module 1 answers correct take the Hard Module 2; others take the Easy Module 2 (the Standard variant is used when the preferred one does not exist). Every Module 2 variant is printed below.`;
}
