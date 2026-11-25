// netlify/lib/collections.ts — one JSON file → one question collection.
//
// The shared import flow behind "Import JSON" on the management pages. Every
// file declares its destination, and the admin / mentor picks one on the page;
// the two must agree before anything is written:
//   • questionBankDomain → a batch of BANK questions for one Question Bank
//     domain (e.g. Math → Algebra).
//   • challengeSet       → one named Challenging Questions set (e.g. "Reading
//     Inference Challenge"); its questions are CHALLENGE-scoped and live only
//     in that set.
// Full-length tests keep their own importer (/api/tests/import), which rejects
// these files, just as this importer rejects full-length test files.
//
// Questions go through the full-test importer's normaliser, so passages,
// Markdown tables, embedded / asset images, image answer choices, MCQ and SPR
// answers are validated and stored exactly like an imported test question.
// Re-importing is idempotent: questions are matched by their stable `id`
// within the destination collection only, so an unrelated collection that
// happens to use the same id is never touched.
import { accessFor, allows, allowedSubjects } from "./access.js";
import { and, eq, inArray, sql } from "drizzle-orm";
const pick = (o: any, ...keys: string[]) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return undefined; };
import { createHash } from "node:crypto";
import { db } from "../../db/index.js";
import { questions, challengeSets, savedQuestions, users } from "../../db/schema.js";
import { ImageRegistry, questionMediaExists, MEDIA_URL_PREFIX } from "./test-import.js";
import {
  normalizeQuestion, difficultyNum, sanitizeRichHtml, MAX_STORED_FIELD, BANK,
  type NormQuestion, type ImportIssue, type FullTestDeps,
} from "./fulltests.js";
import DOMAIN_TEMPLATE from "../../docs/collection-import/question-bank-domain-template.json" with { type: "json" };
import CHALLENGE_TEMPLATE from "../../docs/collection-import/challenge-set-template.json" with { type: "json" };

type DbUser = typeof users.$inferSelect;
export const CHALLENGE = "CHALLENGE";
export const COLLECTION_FORMAT_VERSION = "1.0";

// The platform's section ids and Question Bank domains (same names the bank,
// lessons and student pages use).
export const DOMAINS = {
  math: ["Algebra", "Advanced Math", "Problem Solving and Data Analysis", "Geometry and Trigonometry"],
  ebrw: ["Information and Ideas", "Craft and Structure", "Expression of Ideas", "Standard English Conventions"],
} as const;
type Section = keyof typeof DOMAINS;
// SAT skills per domain — the same taxonomy the bank editor, lessons and
// student pages use. An imported question's skill must be one of these.
export const SKILLS: Record<string, string[]> = {
  "Craft and Structure": ["Cross-text connection", "Text structure and purpose", "Words in context"],
  "Expression of Ideas": ["Rhetorical synthesis", "Transitions"],
  "Information and Ideas": ["Central ideas and details", "Command of evidence", "Inferences"],
  "Standard English Conventions": ["Boundaries", "Form, structure, and sense"],
  "Algebra": ["Linear equations in one variable", "Linear functions", "Linear equations in two variables", "Systems of two linear equations in two variables", "Linear inequalities in one or two variables"],
  "Advanced Math": ["Equivalent expressions", "Nonlinear equations in one variable and systems of equations in two variables", "Nonlinear functions"],
  "Problem Solving and Data Analysis": ["Ratios, rates, proportional relationships, and units", "Percentages", "One-variable data: Distributions and measures of center and spread", "Two-variable data: Models and scatterplots", "Probability and conditional probability", "Inference from sample statistics and margin of error", "Evaluating statistical claims: Observational studies and experiments"],
  "Geometry and Trigonometry": ["Area and volume", "Lines, angles, and triangles", "Right triangles and trigonometry", "Circles"],
};
const skillKey = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function canonicalSkill(domain: string, v: unknown) {
  const t = skillKey(str(v, 200));
  return t ? (SKILLS[domain] || []).find((k) => skillKey(k) === t) ?? null : null;
}
type Diff = "Easy" | "Medium" | "Hard";
// Strict difficulty: Easy / Medium / Hard (any case) or the legacy 1–5 scale.
function strictDifficulty(v: unknown): Diff | null | "invalid" {
  const t = str(v, 20).toLowerCase();
  if (!t) return null;
  if (t === "easy" || t === "1" || t === "2") return "Easy";
  if (t === "medium" || t === "3") return "Medium";
  if (t === "hard" || t === "4" || t === "5") return "Hard";
  return "invalid";
}
// Question fields the importer reads; anything else is reported (and ignored).
const KNOWN_FIELDS = new Set(["id", "questionId", "section", "domain", "category", "skill", "subcategory", "subskill", "difficulty", "level",
  "questionType", "type", "format", "passageText", "passage", "stimulus", "text", "passages", "text1", "text2", "passageText1", "passageText2", "passage1", "passage2",
  "table", "tableData", "questionPrompt", "prompt", "question", "stem", "options", "choices", "answerChoices", "optionA", "optionB", "optionC", "optionD",
  "choiceA", "choiceB", "choiceC", "choiceD", "A", "B", "C", "D", "a", "b", "c", "d", "option_A", "option_B", "option_C", "option_D", "choice_A", "choice_B", "choice_C", "choice_D",
  "correctAnswer", "answer", "correct", "key", "acceptableAnswers", "acceptedAnswers", "alternateAnswers", "explanation", "rationale", "solution",
  "image", "questionImage", "imageUrl", "figureUrl", "imageAsset", "imageAssetId", "svgData", "svg", "questionNumber", "imageAlt", "alt", "tags", "notes"]);
const SECTION_LABEL: Record<Section, string> = { math: "Math", ebrw: "Reading and Writing" };
const MAX_QUESTIONS = 500;
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/;
const SET_ID_RE = /^[a-z0-9][a-z0-9._-]{1,79}$/;

const str = (v: unknown, max = 400) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
const isSection = (v: string): v is Section => v === "math" || v === "ebrw";
// Exact domain names, case-insensitively; the full-test spelling
// "Problem-Solving and Data Analysis" is the same domain.
function canonicalDomain(section: Section, v: unknown) {
  const t = str(v, 120).toLowerCase().replace(/-/g, " ");
  return DOMAINS[section].find((d) => d.toLowerCase() === t) ?? null;
}
const sectionOfDomain = (v: unknown) => (Object.keys(DOMAINS) as Section[]).find((sec) => canonicalDomain(sec, v)) ?? null;

export type DestType = "questionBankDomain" | "challengeSet";
export interface Destination {
  type: DestType; section: Section;
  // Batch defaults chosen on the page; question values override them, and
  // per-question corrections made in the preview override both.
  skill?: string | null; difficulty?: Diff | "mixed" | null;
  overrides?: Record<string, { skill?: string; difficulty?: string }>;
  domain?: string;                       // questionBankDomain
  setId?: string | null; title?: string; description?: string; // challengeSet (setId null = new set)
}

export function destinationLabel(d: Partial<Destination> | null | undefined, setTitle?: string) {
  if (!d?.type) return "(no destination)";
  const sec = d.section && isSection(d.section) ? SECTION_LABEL[d.section] : d.section || "?";
  if (d.type === "questionBankDomain") return `Question Bank → ${sec} → ${d.domain || "?"}`;
  return `Challenging Questions → ${sec} → ${setTitle || d.title || d.setId || "New set"}`;
}

// Read the destination the page selected (from the request body).
function readDefaults(raw: any, domain: string | null): Pick<Destination, "skill" | "difficulty" | "overrides"> | { error: string } {
  const d = str(raw?.difficulty, 20);
  const difficulty = !d || d.toLowerCase() === "mixed" ? (d ? "mixed" : null) : strictDifficulty(d);
  if (difficulty === "invalid") return { error: "Choose a difficulty: Easy, Medium, Hard or Mixed / Per question." };
  let skill: string | null = null;
  if (str(raw?.skill, 200)) {
    skill = domain ? canonicalSkill(domain, raw.skill) : null;
    if (!skill) return { error: `"${str(raw.skill, 200)}" is not a skill of ${domain || "the chosen domain"}.` };
  }
  const overrides: Destination["overrides"] = {};
  if (raw?.overrides && typeof raw.overrides === "object") {
    for (const [k, v] of Object.entries(raw.overrides).slice(0, MAX_QUESTIONS)) {
      if (!v || typeof v !== "object") continue;
      const o: { skill?: string; difficulty?: string } = {};
      if (str((v as any).skill, 200)) o.skill = str((v as any).skill, 200);
      if (str((v as any).difficulty, 20)) o.difficulty = str((v as any).difficulty, 20);
      if (Object.keys(o).length) overrides[str(k, 120)] = o;
    }
  }
  return { skill, difficulty: difficulty as Destination["difficulty"], overrides };
}
function readSelected(raw: any): Destination | { error: string } {
  const type = str(raw?.type, 40);
  const section = str(raw?.section, 10);
  if (type !== "questionBankDomain" && type !== "challengeSet") return { error: "Choose a destination: a Question Bank domain or a Challenging Questions set." };
  if (!isSection(section)) return { error: "Choose the destination section (Math or Reading and Writing)." };
  if (type === "questionBankDomain") {
    const domain = canonicalDomain(section, raw?.domain);
    if (!domain) return { error: `Choose one of the ${SECTION_LABEL[section]} domains: ${DOMAINS[section].join(", ")}.` };
    const defs = readDefaults(raw, domain);
    if ("error" in defs) return defs;
    return { type, section, domain, ...defs };
  }
  const setId = str(raw?.setId, 80) || null;
  const defs = readDefaults({ ...raw, skill: undefined }, null);
  if ("error" in defs) return defs;
  return { type, section, setId, ...defs };
}

// What one stored row looks like for a normalised question; the fingerprint of
// these values decides new / changed / unchanged.
function rowValues(q: NormQuestion, section: Section, category: string, extra: { scope: string; challengeSetId: number | null; setPosition: number }) {
  const mcq = q.questionType === "MCQ";
  const choiceImages = mcq ? Object.fromEntries(q.options.filter((o) => o.imageUrl).map((o) => [o.id, o.imageUrl!])) : {};
  return {
    section, category,
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
    scope: extra.scope,
    externalId: q.id,
    challengeSetId: extra.challengeSetId,
    setPosition: extra.setPosition,
  };
}
type RowValues = ReturnType<typeof rowValues>;
const sortObj = (o: Record<string, string> | null) => (o && Object.keys(o).length ? Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b))) : null);
function fingerprint(r: Record<string, any>) {
  return createHash("sha256").update(JSON.stringify([
    r.section, r.category, r.subcategory ?? "", r.difficulty, r.type, r.passage ?? null, r.prompt, r.questionImage ?? null,
    sortObj(r.choices ?? null), sortObj(r.choiceImages ?? null), r.answer, r.acceptableAnswers?.length ? r.acceptableAnswers : null,
    r.explanation ?? "", r.setPosition ?? 0,
  ])).digest("hex");
}

export interface CollectionPreview {
  ok: boolean;
  errors: string[]; warnings: string[]; issues: ImportIssue[];
  mismatches: { field: string; selected: string; declared: string }[];
  declared: Destination | null;
  selected: Destination | null;
  destinationLabel: string;
  set: { id: number | null; externalId: string; title: string; description: string; exists: boolean; titleChanged: boolean } | null;
  counts: { questions: number; new: number; changed: number; unchanged: number; keptNotInFile: number; mcq: number; spr: number; tables: number; images: number;
    valid: number; invalid: number; missingExplanations: number; duplicates: number };
  difficulty: Record<string, number>;
  skills: { domain: string; skill: string; count: number }[];
  items: { id: string; status: "new" | "changed" | "unchanged"; domain: string; skill: string; difficulty: string | null; type: "MCQ" | "SPR"; valid: boolean; problems: string[] }[];
  sourceHash: string;
  previewToken: string;
}

interface Prepared extends CollectionPreview { rows: RowValues[]; existingByExt: Map<string, number> }

/**
 * Validate a whole collection file against the selected destination, and
 * compare it with what is already stored there. Nothing is written unless
 * `persist` is set (then new embedded images are stored — content-addressed,
 * so a repeat costs nothing — and stored-media references are verified).
 */
async function prepare(raw: unknown, selectedRaw: unknown, user: DbUser, opts: { persist?: boolean; executor?: typeof db } = {}): Promise<Prepared> {
  const exec = opts.executor ?? db;
  const issues: ImportIssue[] = [];
  const addError = (location: string, message: string) => { if (issues.length < 500) issues.push({ level: "error", location, message }); };
  const addWarning = (location: string, message: string) => { if (issues.length < 500) issues.push({ level: "warning", location, message }); };
  const reg = new ImageRegistry(addError, addWarning);
  reg.errorCount = () => issues.filter((i) => i.level === "error").length;
  const out: Prepared = {
    ok: false, errors: [], warnings: [], issues, mismatches: [], declared: null, selected: null, destinationLabel: "",
    set: null, counts: { questions: 0, new: 0, changed: 0, unchanged: 0, keptNotInFile: 0, mcq: 0, spr: 0, tables: 0, images: 0, valid: 0, invalid: 0, missingExplanations: 0, duplicates: 0 },
    difficulty: { Easy: 0, Medium: 0, Hard: 0 }, skills: [],
    items: [], sourceHash: "", previewToken: "", rows: [], existingByExt: new Map(),
  };
  const finish = () => {
    out.errors = issues.filter((i) => i.level === "error").map((i) => `${i.location} — ${i.message}`);
    out.warnings = issues.filter((i) => i.level === "warning").map((i) => `${i.location} — ${i.message}`);
    out.ok = out.errors.length === 0 && out.mismatches.length === 0;
    out.destinationLabel = destinationLabel(out.selected ?? out.declared, out.set?.title);
    out.previewToken = createHash("sha256").update(JSON.stringify([out.sourceHash, out.selected, out.set?.id ?? null, out.items.map((i) => [i.id, i.status])])).digest("hex");
    return out;
  };

  const sel = readSelected(selectedRaw);
  if ("error" in sel) { addError("Destination", sel.error); return finish(); }
  out.selected = sel;

  let doc: any = raw;
  if (typeof doc === "string") { try { doc = JSON.parse(doc); } catch { addError("File", "is not valid JSON"); return finish(); } }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) { addError("File", "must be a JSON object with \"destination\" and \"questions\""); return finish(); }
  out.sourceHash = createHash("sha256").update(JSON.stringify(doc)).digest("hex");

  // ── declared destination ──
  const d = doc.destination;
  if (Array.isArray(doc.modules) || d?.type === "fullLengthTest") {
    addError("File", "is a full-length test file — import it from Full-Length Tests → Import test JSON");
    return finish();
  }
  if (!d || typeof d !== "object") {
    addError("destination", "is missing — add { \"type\": \"questionBankDomain\" | \"challengeSet\", \"section\": \"math\" | \"ebrw\", … } (the destination is never guessed from the file name)");
    return finish();
  }
  const dType = str(d.type, 40);
  const dSection = str(d.section, 10);
  if (dType !== "questionBankDomain" && dType !== "challengeSet") addError("destination.type", `"${dType || "(missing)"}" must be "questionBankDomain" or "challengeSet"`);
  if (!isSection(dSection)) addError("destination.section", `"${dSection || "(missing)"}" must be "math" or "ebrw"`);
  if (issues.length) return finish();
  const section = dSection as Section;
  const declared: Destination = { type: dType as DestType, section };
  if (declared.type === "questionBankDomain") {
    const dom = canonicalDomain(section, d.domain);
    if (!dom) addError("destination.domain", `"${str(d.domain, 120) || "(missing)"}" is not a ${SECTION_LABEL[section]} domain — use one of: ${DOMAINS[section].join(", ")}`);
    declared.domain = dom ?? str(d.domain, 120);
  } else {
    declared.setId = str(d.setId, 120);
    declared.title = str(d.title, 200);
    declared.description = str(d.description, 2000);
    if (!SET_ID_RE.test(declared.setId)) addError("destination.setId", `"${declared.setId || "(missing)"}" must be a stable id of 2–80 lowercase letters, digits, ".", "_" or "-" (e.g. "rw-inference-challenge")`);
    if (!declared.title) addError("destination.title", "is missing — every Challenging Questions set needs a title");
    else if (declared.title.length > 160) addError("destination.title", "must be 160 characters or fewer");
  }
  out.declared = declared;

  // ── declared vs selected ──
  const mm = (field: string, selected: string, dec: string) => out.mismatches.push({ field, selected, declared: dec });
  if (sel.type !== declared.type) mm("type", sel.type === "challengeSet" ? "Challenging Questions set" : "Question Bank domain", declared.type === "challengeSet" ? "Challenging Questions set" : "Question Bank domain");
  if (sel.section !== declared.section) mm("section", SECTION_LABEL[sel.section], SECTION_LABEL[declared.section]);
  if (sel.type === "questionBankDomain" && declared.type === "questionBankDomain" && sel.domain !== declared.domain) mm("domain", sel.domain!, declared.domain!);

  let setRow: typeof challengeSets.$inferSelect | null = null;
  if (declared.type === "challengeSet" && SET_ID_RE.test(declared.setId!)) {
    [setRow] = await exec.select().from(challengeSets).where(eq(challengeSets.externalId, declared.setId!)).limit(1);
    setRow = setRow ?? null;
    if (sel.type === "challengeSet") {
      if (sel.setId && sel.setId !== declared.setId) {
        const [chosen] = await exec.select({ title: challengeSets.title }).from(challengeSets).where(eq(challengeSets.externalId, sel.setId)).limit(1);
        mm("set", chosen ? `“${chosen.title}” (${sel.setId})` : sel.setId, `“${declared.title}” (${declared.setId})`);
      } else if (!sel.setId && setRow) {
        mm("set", "New set", `existing set “${setRow.title}” (${setRow.externalId}) — choose it as the destination to update it`);
      }
    }
    if (setRow && setRow.section !== section)
      addError("destination.section", `set "${setRow.externalId}" already exists under ${SECTION_LABEL[setRow.section as Section] ?? setRow.section}; a set cannot move between sections`);
    if (setRow && user.role === "mentor" && setRow.createdBy !== user.id)
      addError("destination.setId", `set “${setRow.title}” was created by another author — only its author or an admin can import into it`);
    out.set = {
      id: setRow?.id ?? null, externalId: declared.setId!, title: declared.title!, description: declared.description ?? "",
      exists: !!setRow, titleChanged: !!setRow && (setRow.title !== declared.title || setRow.description !== (declared.description ?? "")),
    };
  }

  // ── questions ──
  const list = doc.questions;
  if (!Array.isArray(list) || !list.length) { addError("questions", "must be a non-empty array of questions"); return finish(); }
  if (list.length > MAX_QUESTIONS) { addError("questions", `has ${list.length} questions — one file may hold at most ${MAX_QUESTIONS}`); return finish(); }
  reg.loadAssets(doc.assets);
  const loc = destinationLabel(declared);
  const seen = new Map<string, number>();
  const norm: NormQuestion[] = [];
  const qProblems: string[][] = [];
  const contentSeen = new Map<string, number>();
  const contentKeys: string[] = [];
  const unknown = new Set<string>();
  list.forEach((q: any, i: number) => {
    const before = issues.length;
    const id = str(q?.id ?? q?.questionId, 200);
    const qLoc = `Q${i + 1}${id ? ` (id "${id.slice(0, 120)}")` : ""}`;
    if (!id) addError(`${qLoc} / id`, "is missing — every question needs a stable \"id\" so re-importing the file updates it instead of duplicating it");
    else if (!ID_RE.test(id)) addError(`${qLoc} / id`, "may only contain letters, digits, \".\", \"_\", \":\" and \"-\" (max 120 characters)");
    else if (seen.has(id)) addError(`${qLoc} / id`, `"${id}" is also used by Q${seen.get(id)! + 1} — question ids must be unique within the file`);
    else seen.set(id, i);
    if (q && typeof q === "object" && q.section !== undefined && str(q.section, 10) !== section)
      addError(`${qLoc} / section`, `"${str(q.section, 40)}" does not match the file's destination section "${section}"`);
    // Domain: a domain batch holds its one domain; a challenging set may mix
    // the domains of its section. Either way the question keeps its own.
    let domain: string | null = null;
    const rawDomain = q && typeof q === "object" ? (q.domain ?? q.category) : undefined;
    if (declared.type === "questionBankDomain") {
      domain = declared.domain!;
      if (rawDomain !== undefined && rawDomain !== null && rawDomain !== "" && canonicalDomain(section, rawDomain) !== declared.domain)
        addError(`${qLoc} / domain`, `"${str(rawDomain, 120)}" does not match the file's destination domain "${declared.domain}" — move the question to a ${str(rawDomain, 120)} file`);
    } else {
      domain = canonicalDomain(section, rawDomain);
      if (!rawDomain) addError(`${qLoc} / domain`, `is missing — Challenging Questions keep each question's domain; use one of: ${DOMAINS[section].join(", ")}`);
      else if (!domain) addError(`${qLoc} / domain`, `"${str(rawDomain, 120)}" is not a ${SECTION_LABEL[section]} domain${sectionOfDomain(rawDomain) ? ` (it belongs to ${SECTION_LABEL[sectionOfDomain(rawDomain)!]})` : ""} — use one of: ${DOMAINS[section].join(", ")}`);
    }
    const nq = normalizeQuestion(q, i, section, loc, reg);
    // normalizeQuestion names questions "<loc> / Q<n>"; name them by id too.
    const prefix = `${loc} / Q${i + 1}`;
    for (let k = before; k < issues.length; k += 1) {
      const l = issues[k].location;
      if (l === prefix || l.startsWith(`${prefix} /`)) issues[k].location = qLoc + l.slice(prefix.length);
    }
    nq.id = id;
    nq.domain = domain ?? nq.domain;
    if (q && typeof q === "object") for (const k of Object.keys(q)) if (!KNOWN_FIELDS.has(k)) unknown.add(k);
    // Skill: preview correction > the question's own > the batch default.
    const ov = (sel.overrides || {})[id] || {};
    const rawSkill = ov.skill ?? str(q?.skill ?? q?.subcategory ?? q?.subskill, 200);
    if (domain) {
      if (rawSkill) {
        const sk = canonicalSkill(domain, rawSkill);
        if (sk) nq.skill = sk;
        else addError(`${qLoc} / skill`, `"${str(rawSkill, 120)}" is not a ${domain} skill — use one of: ${(SKILLS[domain] || []).join("; ")}`);
      } else if (sel.skill && canonicalSkill(domain, sel.skill)) nq.skill = sel.skill;
      else addError(`${qLoc} / skill`, `is missing — set "skill" on the question or choose a default skill for the batch (${(SKILLS[domain] || []).join("; ")})`);
    }
    // Difficulty: preview correction > the question's own > the batch default.
    const qd = strictDifficulty(ov.difficulty ?? pick(q, "difficulty", "level"));
    if (qd === "invalid") { addError(`${qLoc} / difficulty`, `"${str(ov.difficulty ?? q?.difficulty ?? q?.level, 40)}" must be Easy, Medium or Hard`); nq.difficulty = null; }
    else if (qd) nq.difficulty = qd;
    else if (sel.difficulty && sel.difficulty !== "mixed") nq.difficulty = sel.difficulty;
    else { nq.difficulty = null; addError(`${qLoc} / difficulty`, "is missing — set \"difficulty\" on the question or choose a batch difficulty"); }
    if (!nq.explanation) out.counts.missingExplanations += 1;
    // Same content twice in one file is almost always a copy-paste mistake.
    const ck = createHash("sha256").update(JSON.stringify([nq.passageText ?? "", nq.questionPrompt, nq.options.map((o) => o.text)])).digest("hex");
    contentKeys.push(ck);
    if (contentSeen.has(ck)) { addWarning(`${qLoc}`, `has the same content as Q${contentSeen.get(ck)! + 1}`); out.counts.duplicates += 1; }
    else contentSeen.set(ck, i);
    norm.push(nq);
    qProblems.push(issues.slice(before).filter((x) => x.level === "error").map((x) => `${x.location.replace(qLoc, "").replace(/^ \/ /, "") || "question"} — ${x.message}`));
  });
  if (unknown.size) addWarning("questions", `unsupported field${unknown.size === 1 ? "" : "s"} ignored: ${[...unknown].slice(0, 15).join(", ")}`);
  const unused = reg.unusedAssets();
  if (unused.length) addWarning("assets", `${unused.length} asset${unused.length === 1 ? " is" : "s are"} never referenced: ${unused.slice(0, 10).join(", ")}`);

  if (opts.persist && !issues.some((i) => i.level === "error") && !out.mismatches.length) {
    const failures = await reg.persist();
    failures.forEach((f) => addError("Images", f));
  } else if (!opts.persist) {
    // Preview stores nothing, but still checks that referenced platform media exists.
    const checked = new Map<string, boolean>();
    for (const ref of reg.storedRefs) {
      if (reg.pending.has(ref.key)) continue;
      if (!checked.has(ref.key)) checked.set(ref.key, await questionMediaExists(ref.key));
      if (!checked.get(ref.key)) addError(ref.where, `image ${MEDIA_URL_PREFIX}${ref.key} does not exist on the platform — embed the image data in the file`);
    }
  }

  // ── compare with the destination collection ──
  const ids = norm.map((q) => q.id).filter(Boolean);
  let existing: (typeof questions.$inferSelect)[] = [];
  if (declared.type === "questionBankDomain" && declared.domain && ids.length) {
    existing = await exec.select().from(questions).where(and(
      eq(questions.scope, BANK), eq(questions.section, section), eq(questions.category, declared.domain), inArray(questions.externalId, ids),
    )).orderBy(questions.id);
  } else if (declared.type === "challengeSet" && setRow) {
    existing = await exec.select().from(questions).where(and(eq(questions.scope, CHALLENGE), eq(questions.challengeSetId, setRow.id))).orderBy(questions.id);
  }
  const byExt = new Map<string, typeof questions.$inferSelect>();
  for (const r of existing) if (r.externalId && !byExt.has(r.externalId)) byExt.set(r.externalId, r);
  norm.forEach((q, i) => {
    const values = rowValues(q, section, q.domain, declared.type === "challengeSet"
      ? { scope: CHALLENGE, challengeSetId: setRow?.id ?? null, setPosition: i }
      : { scope: BANK, challengeSetId: null, setPosition: 0 });
    out.rows.push(values);
    const cur = byExt.get(q.id);
    if (cur) out.existingByExt.set(q.id, cur.id);
    const status = !cur ? "new" : fingerprint(cur) === fingerprint(values) ? "unchanged" : "changed";
    const problems = qProblems[i] || [];
    out.items.push({ id: q.id, status, domain: q.domain, skill: q.skill, difficulty: q.difficulty, type: q.questionType, valid: !problems.length, problems });
    out.counts[problems.length ? "invalid" : "valid"] += 1;
    if (q.difficulty) out.difficulty[q.difficulty] = (out.difficulty[q.difficulty] ?? 0) + 1;
    const sk = out.skills.find((x) => x.domain === q.domain && x.skill === q.skill);
    if (sk) sk.count += 1; else out.skills.push({ domain: q.domain, skill: q.skill, count: 1 });
    out.counts[status] += 1;
    out.counts[q.questionType === "MCQ" ? "mcq" : "spr"] += 1;
    out.counts.tables += q.visuals.tables; out.counts.images += q.visuals.images;
  });
  out.counts.questions = norm.length;
  // Content already in the destination under another id would be a duplicate.
  if (declared.type === "questionBankDomain" && declared.domain && norm.length) {
    const prompts = [...new Set(out.rows.map((r) => r.prompt))].slice(0, MAX_QUESTIONS);
    const twins = await exec.select({ id: questions.id, externalId: questions.externalId, prompt: questions.prompt, passage: questions.passage }).from(questions)
      .where(and(eq(questions.scope, BANK), eq(questions.section, section), eq(questions.category, declared.domain), inArray(questions.prompt, prompts)));
    out.rows.forEach((r, i) => {
      const twin = twins.find((t) => t.prompt === r.prompt && (t.passage ?? null) === (r.passage ?? null) && t.externalId !== r.externalId);
      if (twin) { addWarning(`Q${i + 1} (id "${r.externalId}")`, `matches bank question #${twin.id}${twin.externalId ? ` (id "${twin.externalId}")` : ""} — importing adds a duplicate`); out.counts.duplicates += 1; }
    });
  }
  if (declared.type === "challengeSet") out.counts.keptNotInFile = existing.filter((r) => !r.externalId || !seen.has(r.externalId)).length;
  return finish();
}

const publicPreview = (p: Prepared): CollectionPreview => {
  const { rows, existingByExt, ...rest } = p;
  return rest;
};

/**
 * Write a validated file in one transaction. The caller must send the preview
 * token it was shown: if the file, the destination or the stored collection
 * changed since, nothing is written and a fresh preview is required.
 */
async function commit(raw: unknown, selected: unknown, user: DbUser, previewToken: string) {
  // Validate (and store new images) before opening the transaction.
  const pre = await prepare(raw, selected, user, { persist: true });
  if (!pre.ok) return { status: 400 as const, body: { error: "The file cannot be imported until these problems are fixed. Nothing was saved.", ...publicPreview(pre) } };
  if (!previewToken || previewToken !== pre.previewToken)
    return { status: 409 as const, body: { error: "The file or the collection changed since the preview. Review the new preview and confirm again. Nothing was saved.", stale: true, ...publicPreview(pre) } };
  const dec = pre.declared!;
  const lockKey = dec.type === "challengeSet" ? `set:${dec.setId}` : `bank:${dec.section}:${dec.domain}`;
  const result = await db.transaction(async (tx) => {
    // One import per collection at a time, so two simultaneous uploads of the
    // same file cannot both insert.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
    const again = await prepare(raw, selected, user, { executor: tx as unknown as typeof db });
    if (!again.ok || again.previewToken !== previewToken) return null;
    let setId: number | null = null;
    if (dec.type === "challengeSet") {
      const [cur] = await tx.select().from(challengeSets).where(eq(challengeSets.externalId, dec.setId!)).limit(1);
      if (cur) {
        setId = cur.id;
        if (again.set?.titleChanged) await tx.update(challengeSets).set({ title: dec.title!, description: dec.description ?? "", updatedAt: new Date() }).where(eq(challengeSets.id, cur.id));
      } else {
        const [row] = await tx.insert(challengeSets).values({ externalId: dec.setId!, section: dec.section, title: dec.title!, description: dec.description ?? "", createdBy: user.id }).returning();
        setId = row.id;
      }
    }
    let created = 0, updated = 0;
    for (let i = 0; i < again.rows.length; i += 1) {
      const values = { ...again.rows[i], challengeSetId: dec.type === "challengeSet" ? setId : null };
      const status = again.items[i].status;
      if (status === "new") { await tx.insert(questions).values(values); created += 1; }
      else if (status === "changed") {
        const rowId = again.existingByExt.get(values.externalId)!;
        await tx.update(questions).set(values).where(eq(questions.id, rowId)); updated += 1;
      }
    }
    return { created, updated, unchanged: again.counts.unchanged, setId };
  });
  if (!result) {
    const fresh = await prepare(raw, selected, user);
    return { status: 409 as const, body: { error: "The collection changed while importing. Review the new preview and confirm again. Nothing was saved.", stale: true, ...publicPreview(fresh) } };
  }
  return { status: 201 as const, body: { ...result, destinationLabel: pre.destinationLabel, counts: pre.counts, warnings: pre.warnings } };
}

// ─────────────── ROUTES ───────────────
// /api/collections/import/preview   POST  admin | mentor
// /api/collections/import           POST  admin | mentor (requires the preview token)
// /api/collections/import/template/domain|challenge  GET  (downloadable templates)
// /api/challenge-sets               GET   signed-in users: sets with question counts
// /api/challenge-sets/:id           GET   signed-in users: the set and its questions, in order
// /api/challenge-sets/:id           DELETE admin: the set and its questions
export async function handleCollections(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  const { json, requireUser } = deps;
  const [resource, id] = parts;
  const method = req.method;

  if (resource === "collections" && id === "taxonomy" && method === "GET") return json({ domains: DOMAINS, skills: SKILLS });
  if (resource === "collections" && id === "import") {
    if (parts[2] === "template" && method === "GET") {
      const tpl = parts[3] === "challenge" ? CHALLENGE_TEMPLATE : parts[3] === "domain" ? DOMAIN_TEMPLATE : null;
      if (!tpl) return json({ error: "Unknown template." }, 404);
      return new Response(JSON.stringify(tpl, null, 2), { headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${parts[3] === "challenge" ? "challenge-set-template.json" : "question-bank-domain-template.json"}"`,
      } });
    }
    const auth = await requireUser(req, ["admin", "mentor"]);
    if (auth.error) return auth.error;
    if (method !== "POST") return json({ error: "Method not allowed." }, 405);
    const b = await req.json().catch(() => null);
    if (!b || b.data === undefined) return json({ error: "Send { data, destination } with the file contents." }, 400);
    if (parts[2] === "preview") return json(publicPreview(await prepare(b.data, b.destination, auth.user!)));
    if (parts[2]) return json({ error: "Not found." }, 404);
    if (b.confirm !== true) return json({ error: "Confirm the preview before importing." }, 400);
    const r = await commit(b.data, b.destination, auth.user!, String(b.previewToken || ""));
    return json(r.body, r.status);
  }

  if (resource === "challenge-sets") {
    if (method === "GET" && !id) {
      const auth = await requireUser(req);
      if (auth.error) return auth.error;
      const rows = await db.select({
        id: challengeSets.id, externalId: challengeSets.externalId, section: challengeSets.section, title: challengeSets.title,
        description: challengeSets.description, createdBy: challengeSets.createdBy, updatedAt: challengeSets.updatedAt,
      }).from(challengeSets).orderBy(challengeSets.section, challengeSets.title);
      const counts = await db.select({ setId: questions.challengeSetId, n: sql<number>`count(*)::int` }).from(questions)
        .where(eq(questions.scope, CHALLENGE)).groupBy(questions.challengeSetId);
      const bySet = new Map(counts.map((c) => [c.setId, Number(c.n)]));
      // Students only see sets of subjects whose Challenging Questions are open.
      const open = auth.user!.role === "student" ? allowedSubjects((await accessFor(req, auth.user!)).rules, "challenge") : null;
      return json(rows.filter((r) => !open || open.includes(r.section)).map((r) => ({ ...r, questionCount: bySet.get(r.id) ?? 0 })));
    }
    const setId = Number(id);
    if (!Number.isInteger(setId)) return json({ error: "Set not found." }, 404);
    const [set] = await db.select().from(challengeSets).where(eq(challengeSets.id, setId)).limit(1);
    if (!set) return json({ error: "Set not found." }, 404);
    if (method === "GET") {
      const auth = await requireUser(req);
      if (auth.error) return auth.error;
      if (auth.user!.role === "student" && !allows((await accessFor(req, auth.user!)).rules, set.section, "challenge"))
        return json({ error: "Challenging Questions for this subject are not available on your account.", locked: true }, 403);
      const qs = await db.select().from(questions).where(and(eq(questions.scope, CHALLENGE), eq(questions.challengeSetId, setId))).orderBy(questions.setPosition, questions.id);
      // Students get the questions without the key; POST /api/attempts
      // grades each answer and returns the key and explanation afterwards.
      if (auth.user!.role === "student")
        return json({ set, questions: qs.map(({ answer, acceptableAnswers, explanation, ...rest }) => rest) });
      return json({ set, questions: qs });
    }
    if (method === "DELETE") {
      const auth = await requireUser(req, ["admin"]);
      if (auth.error) return auth.error;
      await db.transaction(async (tx) => {
        const qIds = (await tx.select({ id: questions.id }).from(questions).where(and(eq(questions.scope, CHALLENGE), eq(questions.challengeSetId, setId)))).map((r) => r.id);
        if (qIds.length) {
          await tx.delete(savedQuestions).where(inArray(savedQuestions.questionId, qIds));
          await tx.delete(questions).where(inArray(questions.id, qIds));
        }
        await tx.delete(challengeSets).where(eq(challengeSets.id, setId));
      });
      return json({ deleted: setId });
    }
    return json({ error: "Method not allowed." }, 405);
  }
  return null;
}
