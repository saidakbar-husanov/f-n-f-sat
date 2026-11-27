// Shared question export: filters, stable order, importer-compatible documents,
// solution stripping and the bank bundle.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeExportFilters, exportFiltersFromParams, canonicalRows, filterExportRows, stableExportOrder, hasExportFilters,
  bankScopeLabel, exportQuestionId, toCollectionQuestion, stripSolutions, buildBankDocuments, assembleBankExport,
  buildChallengeDocument, collectionDocProblems, toPrintQuestion, bankPrintGroups, branchLabel, routingRule,
  MAX_FILE_QUESTIONS, EXPORT_FORMAT, type ExportRow,
} from "../netlify/lib/export-core.ts";
import { stableOrder } from "../netlify/lib/practice-core.ts";
import { canonicalTags, TAXONOMY_DOMAINS, TAXONOMY_SKILLS } from "../netlify/lib/taxonomy.ts";

const DOMAIN_ORDER = [...TAXONOMY_DOMAINS.math, ...TAXONOMY_DOMAINS.ebrw];
let seq = 0;
const Q = (o: Partial<ExportRow>): ExportRow => ({
  id: ++seq, section: "math", category: "Algebra", subcategory: "Linear functions", difficulty: 3, type: "mcq",
  passage: null, prompt: "If \\(3x+7=22\\), what is \\(x\\)?", questionImage: null,
  choices: { A: "\\(3\\)", B: "\\(5\\)", C: "\\(7\\)", D: "\\(15\\)" }, choiceImages: null,
  answer: "B", acceptableAnswers: null, explanation: "Subtract 7, divide by 3.", externalId: null, ...o,
});

const ROWS = [
  Q({ id: 10, category: "Advanced Math", subcategory: "Nonlinear equations in one variable", difficulty: 4 }), // legacy skill spelling
  Q({ id: 11, category: "Algebra", subcategory: "Linear functions", difficulty: 5, externalId: "alg-001" }),
  Q({ id: 12, category: "Algebra", subcategory: "Linear equations in one variable", difficulty: 2 }),
  Q({ id: 13, section: "ebrw", category: "Craft and Structure", subcategory: "Cross-Text Connections", difficulty: 3, passage: "<p>Text 1 …</p>" }),
  Q({ id: 14, category: "Problem-Solving and Data Analysis", subcategory: "Percentage", difficulty: 1, type: "spr", choices: null, answer: "14", acceptableAnswers: ["14.00", "14"] }),
  Q({ id: 15, category: "Algebra", subcategory: "Linear functions", difficulty: 3, questionImage: "/api/question-media/imp-abc", choiceImages: { A: "/api/question-media/imp-a", B: "", C: "", D: "" } }),
];
const canon = () => canonicalRows(ROWS, canonicalTags);

test("legacy domain / skill spellings are matched through canonicalTags", () => {
  const rows = canon();
  const f = normalizeExportFilters({ domains: ["Problem Solving and Data Analysis"], skills: ["Percentages"] });
  assert.deepEqual(filterExportRows(rows, f).map((r) => r.id), [14]);
  const g = normalizeExportFilters({ domains: ["Craft and Structure"], skills: ["Cross-text connection"] });
  assert.deepEqual(filterExportRows(rows, g).map((r) => r.id), [13]);
  const h = normalizeExportFilters({ skills: ["Nonlinear equations in one variable and systems of equations in two variables"] });
  assert.deepEqual(filterExportRows(rows, h).map((r) => r.id), [10]);
});

test("filters: OR within a group, AND across groups; bands and exact levels", () => {
  const rows = canon();
  const ids = (raw: unknown) => filterExportRows(rows, normalizeExportFilters(raw)).map((r) => r.id).sort((a, b) => a - b);
  assert.deepEqual(ids({ subjects: ["ebrw"] }), [13]);
  assert.deepEqual(ids({ difficulties: ["hard"] }), [10, 11]);
  assert.deepEqual(ids({ difficulties: ["easy"], subjects: ["math"] }), [12, 14]);
  assert.deepEqual(ids({ levels: [5] }), [11]);
  assert.deepEqual(ids({ types: ["spr"] }), [14]);
  assert.deepEqual(ids({ domains: ["Algebra"], difficulties: ["medium", "hard"] }), [11, 15]);
  assert.deepEqual(ids({ q: "#12" }), [12]);
  assert.deepEqual(ids({}), [10, 11, 12, 13, 14, 15]);
  assert.equal(hasExportFilters(normalizeExportFilters({})), false);
});

test("query params keep skill names with commas intact", () => {
  const p = new URLSearchParams();
  p.append("skills", "Ratios, rates, proportional relationships, and units");
  p.append("subjects", "math,ebrw");
  p.append("difficulties", "hard");
  const f = exportFiltersFromParams(p);
  assert.deepEqual(f.skills, ["Ratios, rates, proportional relationships, and units"]);
  assert.deepEqual(f.subjects, ["math", "ebrw"]);
  assert.match(bankScopeLabel(f), /Math \+ Reading and Writing · Ratios, rates.* · Hard/);
  assert.equal(bankScopeLabel(null), "Question Bank · entire bank");
});

test("export order is the bank's stable order (same as practice-core stableOrder)", () => {
  const rows = canon();
  const a = stableExportOrder(rows, DOMAIN_ORDER, TAXONOMY_SKILLS).map((r) => r.id);
  const b = stableOrder(rows, DOMAIN_ORDER, TAXONOMY_SKILLS).map((r) => r.id);
  assert.deepEqual(a, b);
  assert.deepEqual(a, [12, 15, 11, 10, 14, 13]);
});

test("ids: externalId when valid and unused, else q-<id>", () => {
  const used = new Set<string>();
  assert.equal(exportQuestionId({ id: 1, externalId: "alg-001" }, used), "alg-001");
  assert.equal(exportQuestionId({ id: 2, externalId: "alg-001" }, used), "q-2");
  assert.equal(exportQuestionId({ id: 3, externalId: "bad id!" }, used), "q-3");
  assert.equal(exportQuestionId({ id: 4, externalId: null }, used), "q-4");
});

test("a question keeps type, accepted answers, LaTeX source and media references", () => {
  const rows = canon();
  const spr = toCollectionQuestion(rows.find((r) => r.id === 14)!, "q-14", { solutions: true, withDomain: true }) as any;
  assert.equal(spr.questionType, "SPR");
  assert.deepEqual(spr.options, []);
  assert.equal(spr.correctAnswer, "14");
  assert.deepEqual(spr.acceptableAnswers, ["14.00"], "the key itself is not repeated");
  assert.equal(spr.domain, "Problem Solving and Data Analysis");
  assert.equal(spr.skill, "Percentages");
  assert.equal(spr.difficulty, "Easy");
  const img = toCollectionQuestion(rows.find((r) => r.id === 15)!, "q-15", { solutions: true, withDomain: false }) as any;
  assert.equal(img.image, "/api/question-media/imp-abc");
  assert.deepEqual(img.options[0], { id: "A", text: "\\(3\\)", image: "/api/question-media/imp-a" });
  assert.equal(img.options[1].image, undefined, "empty choice images are dropped");
  assert.equal(img.questionPrompt, "If \\(3x+7=22\\), what is \\(x\\)?");
  assert.equal(img.domain, undefined, "domain files carry the domain in the destination");
});

test("an exported bank domain document passes the importer's structural checks", () => {
  const m = { scopeLabel: "x", exportedAt: "2026-01-01T00:00:00Z", solutions: true };
  const rows = stableExportOrder(canon(), DOMAIN_ORDER, TAXONOMY_SKILLS);
  const { docs, unclassified } = buildBankDocuments(rows, TAXONOMY_DOMAINS, m);
  assert.equal(unclassified.length, 0);
  assert.deepEqual(docs.map((d) => `${d.destination.section}/${d.destination.domain}`),
    ["math/Algebra", "math/Advanced Math", "math/Problem Solving and Data Analysis", "ebrw/Craft and Structure"]);
  for (const d of docs) {
    assert.equal(d.formatVersion, "1.0");
    assert.equal(d.destination.type, "questionBankDomain");
    assert.ok(Array.isArray(d.assets));
    assert.deepEqual(collectionDocProblems(d, TAXONOMY_DOMAINS, TAXONOMY_SKILLS), [], JSON.stringify(d.destination));
  }
  const bundle = assembleBankExport(docs, unclassified, m) as any;
  assert.equal(bundle.format, EXPORT_FORMAT);
  assert.equal(bundle.version, "1.0");
  assert.equal(bundle.files.length, 4);
  assert.equal(bundle.questionCount, rows.length);
  assert.equal(bundle.importable, true);
  // One domain → the document itself (importable as downloaded).
  const one = buildBankDocuments(rows.filter((r) => r.category === "Algebra"), TAXONOMY_DOMAINS, m);
  const single = assembleBankExport(one.docs, one.unclassified, m) as any;
  assert.equal(single.destination.domain, "Algebra");
  assert.deepEqual(single.questions.map((q: any) => q.id), ["q-12", "q-15", "alg-001"]);
});

test("a domain over 500 questions is split into importable parts", () => {
  const many = Array.from({ length: MAX_FILE_QUESTIONS + 20 }, (_, i) => Q({ id: 1000 + i }));
  const { docs } = buildBankDocuments(many, TAXONOMY_DOMAINS, { scopeLabel: "x", exportedAt: "t", solutions: true });
  assert.equal(docs.length, 2);
  assert.deepEqual(docs.map((d) => d.questions.length), [MAX_FILE_QUESTIONS, 20]);
  assert.deepEqual(docs.map((d) => d.export.part), [1, 2]);
  docs.forEach((d) => assert.deepEqual(collectionDocProblems(d, TAXONOMY_DOMAINS, TAXONOMY_SKILLS), []));
});

test("an exported challenge set passes the importer's structural checks", () => {
  const rows = canon().filter((r) => r.section === "math");
  const doc = buildChallengeDocument({ externalId: "sat-hard-word-problems-50", section: "math", title: "Hard Word Problems", description: "" }, rows,
    { scopeLabel: "x", exportedAt: "t", solutions: true }) as any;
  assert.equal(doc.destination.type, "challengeSet");
  assert.equal(doc.destination.setId, "sat-hard-word-problems-50");
  assert.ok(doc.questions.every((q: any) => q.domain), "set questions keep their own domain");
  assert.deepEqual(collectionDocProblems(doc, TAXONOMY_DOMAINS, TAXONOMY_SKILLS), []);
  assert.deepEqual(doc.questions.map((q: any) => q.id), rows.map((r) => r.externalId || `q-${r.id}`), "set order is kept");
});

test("without solutions, keys and explanations are stripped and the file is not importable", () => {
  const rows = canon();
  const m = { scopeLabel: "x", exportedAt: "t", solutions: false };
  const doc = buildChallengeDocument({ externalId: "set-a", section: "math", title: "A", description: "" }, rows.filter((r) => r.section === "math"), m) as any;
  assert.equal(doc.export.solutions, false);
  assert.equal(doc.export.importable, false);
  const text = JSON.stringify(doc);
  for (const k of ["correctAnswer", "acceptableAnswers", "explanation"]) assert.ok(!text.includes(`"${k}"`), k);
  assert.ok(collectionDocProblems(doc, TAXONOMY_DOMAINS, TAXONOMY_SKILLS).some((p) => p.includes("correctAnswer")));
  const { docs, unclassified } = buildBankDocuments(rows, TAXONOMY_DOMAINS, m);
  const bundle = assembleBankExport(docs, unclassified, m) as any;
  assert.equal(bundle.solutions, false);
  assert.ok(!JSON.stringify(bundle).includes("correctAnswer"));
  // Print payload.
  const pq = toPrintQuestion(rows[0], 1, "q", false);
  assert.equal(pq.answer, undefined); assert.equal(pq.explanation, undefined); assert.equal(pq.acceptableAnswers, undefined);
  const groups = bankPrintGroups(rows, false);
  assert.ok(!JSON.stringify(groups).match(/"(answer|explanation|acceptableAnswers)"/));
  assert.equal(toPrintQuestion(rows[0], 1, "q", true).answer, "B");
});

test("stripSolutions removes keys at any depth (full-test export)", () => {
  const test = { formatVersion: "2.0", modules: [{ moduleId: "m1", difficultyTrack: "Hard", timeLimitMinutes: 32,
    questions: [{ id: "a", questionPrompt: "p", correctAnswer: "A", acceptableAnswers: [], explanation: "e", options: [{ id: "A", text: "x" }] }] }] };
  const out = stripSolutions(test);
  assert.deepEqual(out.modules[0].questions[0], { id: "a", questionPrompt: "p", options: [{ id: "A", text: "x" }] });
  assert.equal(out.modules[0].difficultyTrack, "Hard", "structure and timing stay");
  assert.equal(out.modules[0].timeLimitMinutes, 32);
  assert.equal(test.modules[0].questions[0].correctAnswer, "A", "the source is not mutated");
});

test("print groups: one per domain, continuous numbering, page break between", () => {
  const rows = stableExportOrder(canon(), DOMAIN_ORDER, TAXONOMY_SKILLS);
  const g = bankPrintGroups(rows, true);
  assert.deepEqual(g.map((x) => x.heading), ["Math · Algebra", "Math · Advanced Math", "Math · Problem Solving and Data Analysis", "Reading and Writing · Craft and Structure"]);
  assert.deepEqual(g.flatMap((x) => x.questions.map((q) => q.n)), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(g.map((x) => x.breakBefore), [false, true, true, true]);
});

test("adaptive branch labels follow the routing rule", () => {
  assert.match(branchLabel({ difficultyTrack: "Hard", moduleNumber: 2 }, true, 2, 0.6), /Hard branch.*at least 60%/);
  assert.match(branchLabel({ difficultyTrack: "Easy", moduleNumber: 2 }, true, 2, 0.6), /Easy branch.*fewer than 60%/);
  assert.equal(branchLabel({ difficultyTrack: "Hard", moduleNumber: 2 }, false, 1, 0.6), "Hard track");
  assert.equal(branchLabel({ difficultyTrack: "", moduleNumber: 1 }, false, 1, 0.6), "");
  assert.equal(routingRule(false, 0.6), "");
  assert.match(routingRule(true, 0.6), /60%/);
});
