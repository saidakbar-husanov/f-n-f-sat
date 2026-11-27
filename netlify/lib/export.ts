// netlify/lib/export.ts — the one export service behind every "Download"
// button (Question Bank, Challenging Questions sets, full-length tests).
//
// Routes (mounted from netlify/functions/api.ts; staff only):
//   GET /api/export/preview?scope=bank|challenge|test&…   scope label, question count,
//        whether answer keys are allowed / included, and whether the JSON re-imports.
//   GET /api/export?scope=…&format=json|print&solutions=1
//        json  → a versioned file for the matching importer (download)
//        print → structured JSON the client turns into a printable document (PDF)
//   scope=bank       ?all=1 (entire bank) or the current filters: subjects, difficulties
//                    (easy|medium|hard), levels (1–5), domains, skills, types (mcq|spr), q
//   scope=challenge  &setId=<challenge set id>
//   scope=test       &testId=<test id>
//
// Permissions (existing rules, reused):
//   • students: refused (403) — there is no student download;
//   • Question Bank and Challenging Questions: admins and mentors, who already
//     read every question with its key in All Questions / Challenging Questions;
//   • full-length tests: an admin, or the mentor who authored the test (the
//     same rule as GET /api/tests/:id/export), drafts included only for them.
// Answer keys, accepted answers and explanations are included only when
// solutions=1 is asked for AND the requester may see them; otherwise they are
// stripped from both formats and the file says "solutions": false /
// "importable": false. Exports only read: no attempts, sessions or credits.
//
// JSON formats:
//   • Challenging Questions set → one collection-import document
//     (docs/collection-import, destination challengeSet), importable as it is.
//   • Question Bank → one collection-import document per section + domain
//     (destination questionBankDomain, at most 500 questions each). A single
//     document is downloaded as it is; several are wrapped in a bundle
//     { format: "fnf-sat-export", version: "1.0", kind: "questionBankBundle", files: [ … ] }
//     whose every entry is a complete, directly importable document.
//   • Full-length test → exportTest() output (formatVersion 2.0, images
//     embedded as assets), importable from Full-Length Tests → Import.
// Question / choice images in collection documents stay platform media URLs
// (/api/question-media/…); the collection importer accepts them after checking
// the media exists, so a re-import on this platform keeps every image.
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/index.js";
import { questions, challengeSets, tests } from "../../db/schema.js";
import {
  BANK, exportTest, loadTestModules, loadModuleQuestions, isPerModuleTimed, ADAPTIVE_THRESHOLD, type FullTestDeps,
} from "./fulltests.js";
import { DOMAINS, SKILLS, CHALLENGE } from "./collections.js";
import { canonicalTags, resolveDomain, resolveSkill } from "./taxonomy.js";
import {
  EXPORT_FORMAT, EXPORT_VERSION, PRINT_FORMAT, type ExportRow, type ExportFilters,
  exportFiltersFromParams, hasExportFilters, canonicalRows, filterExportRows, stableExportOrder, bankScopeLabel,
  buildBankDocuments, assembleBankExport, buildChallengeDocument, stripSolutions, toPrintQuestion, bankPrintGroups,
  branchLabel, routingRule, sectionLabel, slug, exportQuestionId,
} from "./export-core.js";

const DOMAIN_ORDER = [...DOMAINS.math, ...DOMAINS.ebrw];
const ROW_COLUMNS = {
  id: questions.id, section: questions.section, category: questions.category, subcategory: questions.subcategory,
  difficulty: questions.difficulty, type: questions.type, passage: questions.passage, prompt: questions.prompt,
  questionImage: questions.questionImage, choices: questions.choices, choiceImages: questions.choiceImages,
  answer: questions.answer, acceptableAnswers: questions.acceptableAnswers, explanation: questions.explanation,
  externalId: questions.externalId,
};

const today = () => new Date().toISOString().slice(0, 10);

// Filter values → canonical taxonomy names (legacy spellings match too).
function canonicalFilters(f: ExportFilters): ExportFilters {
  const domains = f.domains.map((d) => resolveDomain(null, d).value ?? d);
  const skillDomains = domains.length ? domains : DOMAIN_ORDER;
  const skills = f.skills.map((s) => {
    for (const d of skillDomains) { const hit = resolveSkill(d, s).value; if (hit) return hit; }
    return s;
  });
  return { ...f, domains, skills };
}

async function bankRows(f: ExportFilters | null) {
  const conds = [eq(questions.scope, BANK)];
  if (f?.subjects.length) conds.push(inArray(questions.section, f.subjects));
  const rows = canonicalRows((await db.select(ROW_COLUMNS).from(questions).where(and(...conds))) as ExportRow[], canonicalTags);
  const picked = f && hasExportFilters(f) ? filterExportRows(rows, f) : rows;
  return stableExportOrder(picked, DOMAIN_ORDER, SKILLS);
}

async function loadSet(raw: string | null) {
  const v = String(raw ?? "").trim();
  if (!v) return null;
  const n = Number(v);
  const [set] = Number.isInteger(n) && n > 0
    ? await db.select().from(challengeSets).where(eq(challengeSets.id, n)).limit(1)
    : await db.select().from(challengeSets).where(eq(challengeSets.externalId, v)).limit(1);
  return set ?? null;
}
async function setRows(setId: number) {
  const rows = await db.select(ROW_COLUMNS).from(questions)
    .where(and(eq(questions.scope, CHALLENGE), eq(questions.challengeSetId, setId)))
    .orderBy(questions.setPosition, questions.id);
  return canonicalRows(rows as ExportRow[], canonicalTags);
}

// Big payloads (the whole bank) are streamed, so they are not cut off by the
// buffered response size limit.
function textResponse(text: string, headers: Record<string, string>) {
  if (text.length < 4_000_000) return new Response(text, { headers });
  const enc = new TextEncoder();
  const CHUNK = 256 * 1024;
  let i = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(c) {
      if (i >= text.length) { c.close(); return; }
      c.enqueue(enc.encode(text.slice(i, i + CHUNK)));
      i += CHUNK;
    },
  });
  return new Response(body, { headers });
}
function jsonFile(obj: unknown, fileName: string) {
  const compact = JSON.stringify(obj);
  const text = compact.length > 4_000_000 ? compact : JSON.stringify(obj, null, 2);
  return textResponse(text, {
    "content-type": "application/json; charset=utf-8",
    "content-disposition": `attachment; filename="${fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
    "cache-control": "no-store",
  });
}
function jsonData(obj: unknown) {
  return textResponse(JSON.stringify(obj), { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
}

export async function handleExport(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  if (parts[0] !== "export") return null;
  const { json, requireUser } = deps;
  if (req.method !== "GET") return json({ error: "Method not allowed." }, 405);
  if (parts[1] && parts[1] !== "preview") return json({ error: "Not found." }, 404);
  // Students have no download permission anywhere.
  const auth = await requireUser(req, ["admin", "mentor"]);
  if (auth.error) return auth.error;
  const user = auth.user!;
  const url = new URL(req.url);
  const p = url.searchParams;
  const scope = p.get("scope");
  const isPreview = parts[1] === "preview";
  const format = p.get("format") === "print" ? "print" : "json";
  // Admins and mentors already read every bank / challenge key, and a test is
  // only exportable by those who may edit it — so whoever reaches this point
  // may export solutions; they are still only included when asked for.
  const solutionsAllowed = true;
  const solutions = p.get("solutions") === "1" && solutionsAllowed;
  const exportedAt = new Date().toISOString();
  const keysSuffix = solutions ? "" : "-questions-only";

  if (scope === "bank") {
    const all = p.get("all") === "1";
    const f = all ? null : canonicalFilters(exportFiltersFromParams(p));
    const filtered = !!f && hasExportFilters(f);
    const scopeLabel = bankScopeLabel(filtered ? f : null);
    const rows = await bankRows(filtered ? f : null);
    const m = { scopeLabel, exportedAt, solutions };
    if (isPreview || format === "json") {
      const { docs, unclassified } = buildBankDocuments(rows, DOMAINS, m);
      if (isPreview) return json({
        scope, label: scopeLabel, filtered, questionCount: rows.length, solutionsAllowed, solutions, importable: solutions && !unclassified.length,
        files: docs.length, unclassified: unclassified.length,
        jsonNote: docs.length > 1 ? `${docs.length} importable domain files in one bundle` : docs.length === 1 ? "one importable domain file" : "",
      });
      if (!rows.length) return json({ error: "No question matches this selection." }, 404);
      return jsonFile(assembleBankExport(docs, unclassified, m), `question-bank${filtered ? "-selection" : ""}-${today()}${keysSuffix}.json`);
    }
    if (!rows.length) return json({ error: "No question matches this selection." }, 404);
    return jsonData({
      format: PRINT_FORMAT, version: EXPORT_VERSION, kind: "bank", title: filtered ? "Question Bank — selection" : "Question Bank",
      scopeLabel, solutions, generatedAt: exportedAt, questionCount: rows.length, intro: [], groups: bankPrintGroups(rows, solutions),
    });
  }

  if (scope === "challenge") {
    const set = await loadSet(p.get("setId"));
    if (!set) return json({ error: "Set not found." }, 404);
    const rows = await setRows(set.id);
    const scopeLabel = `Challenging Questions · ${sectionLabel(set.section)} · ${set.title}`;
    const m = { scopeLabel, exportedAt, solutions };
    if (isPreview) return json({ scope, label: scopeLabel, questionCount: rows.length, solutionsAllowed, solutions, importable: solutions && rows.length > 0, files: 1 });
    if (!rows.length) return json({ error: "This set has no questions yet." }, 404);
    if (format === "json") return jsonFile(buildChallengeDocument(set, rows, m), `${slug(set.externalId)}${keysSuffix}.json`);
    const used = new Set<string>();
    return jsonData({
      format: PRINT_FORMAT, version: EXPORT_VERSION, kind: "challenge", title: set.title, scopeLabel, solutions, generatedAt: exportedAt,
      questionCount: rows.length, intro: set.description ? [set.description] : [],
      groups: [{ heading: set.title, subheading: `Challenging Questions · ${sectionLabel(set.section)}`, meta: [`${rows.length} question${rows.length === 1 ? "" : "s"}`], breakBefore: false,
        questions: rows.map((r, i) => toPrintQuestion(r, i + 1, exportQuestionId(r, used), solutions)) }],
    });
  }

  if (scope === "test") {
    const testId = Number(p.get("testId"));
    const [test] = Number.isInteger(testId) && testId > 0 ? await db.select().from(tests).where(eq(tests.id, testId)).limit(1) : [];
    if (!test) return json({ error: "Test not found." }, 404);
    // Same rule as GET /api/tests/:id/export.
    if (user.role !== "admin" && test.createdBy !== user.id)
      return json({ error: "Only the author of this test, or an admin, can export it." }, 403);
    const mods = await loadTestModules(test.id);
    const modQs = await Promise.all(mods.map((m) => loadModuleQuestions(m.id)));
    const questionCount = modQs.reduce((n, q) => n + q.length, 0);
    const scopeLabel = `Full-Length Test · ${test.title}${test.status !== "published" ? ` (${test.status})` : ""}`;
    if (isPreview) return json({ scope, label: scopeLabel, questionCount, modules: mods.length, solutionsAllowed, solutions, importable: solutions && questionCount > 0, files: 1 });
    if (format === "json") {
      const data = await exportTest(test.id);
      if (!data) return json({ error: "Test not found." }, 404);
      const out = { ...(solutions ? data : stripSolutions(data)), export: { format: EXPORT_FORMAT, version: EXPORT_VERSION, scope: scopeLabel, exportedAt, solutions, importable: solutions } };
      return jsonFile(out, `${slug(String(data.testId))}${keysSuffix}.json`);
    }
    const perModule = isPerModuleTimed(mods);
    const groupSize = new Map<string, number>();
    for (const m of mods) if (m.moduleNumber != null) { const k = `${m.section}:${m.moduleNumber}`; groupSize.set(k, (groupSize.get(k) || 0) + 1); }
    const counters: Record<string, number> = {};
    const totalMinutes = perModule ? mods.reduce((n, m) => n + (m.timeLimitMinutes ?? 0), 0) : test.timeLimitMinutes;
    const intro = [
      `${mods.length} module${mods.length === 1 ? "" : "s"} · ${questionCount} questions · ${totalMinutes} minutes in total${perModule ? " (each module timed separately)" : " (one continuous clock)"}`,
      ...(perModule && test.breakMinutes > 0 && mods.some((m) => m.section === "ebrw") && mods.some((m) => m.section === "math") ? [`${test.breakMinutes}-minute break between Reading and Writing and Math`] : []),
      ...(test.description ? [test.description] : []),
    ];
    const rule = routingRule(test.isAdaptive && [...groupSize.values()].some((n) => n > 1), ADAPTIVE_THRESHOLD);
    if (rule) intro.push(rule);
    const groups = mods.map((m, mi) => {
      const section = m.section === "math" ? "math" : "ebrw";
      counters[section] = (counters[section] || 0) + 1;
      const num = m.moduleNumber ?? counters[section];
      const variants = m.moduleNumber != null ? groupSize.get(`${m.section}:${m.moduleNumber}`) || 1 : 1;
      const branch = branchLabel({ difficultyTrack: m.difficultyTrack, moduleNumber: m.moduleNumber }, test.isAdaptive, variants, ADAPTIVE_THRESHOLD);
      const qs = modQs[mi];
      return {
        heading: m.title, subheading: `${sectionLabel(section)} · Module ${num}`,
        meta: [perModule ? `${m.timeLimitMinutes} minutes` : "", `${qs.length} question${qs.length === 1 ? "" : "s"}`, branch].filter(Boolean),
        breakBefore: mi > 0, moduleKey: m.moduleKey || "",
        questions: qs.map((q, i) => toPrintQuestion(canonicalRows([q as ExportRow], canonicalTags)[0], i + 1, q.externalId || `${m.moduleKey || `m${m.id}`}-q${i + 1}`, solutions)),
      };
    });
    return jsonData({
      format: PRINT_FORMAT, version: EXPORT_VERSION, kind: "test", title: test.title, scopeLabel, solutions, generatedAt: exportedAt,
      questionCount, intro, groups,
    });
  }

  return json({ error: "Choose what to export: scope=bank, challenge or test." }, 400);
}
