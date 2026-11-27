// Reading Library: content blocks, sanitising, and the fnf-library import format.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanBlocks, cleanArticleContent, cleanImportArticle, parseImportDoc, classifyImport, safeMediaUrl,
  bodyFromBlocks, storedFileUrls, canonical, type BlockContext,
} from "../netlify/lib/library-core.ts";

const ctx = (resolveFile?: (n: string) => string | null): BlockContext => ({ errors: [], warnings: [], unresolved: [], resolveFile });
const chart = { kind: "bar", title: "Rain", xLabel: "Month", yLabel: "mm", labels: ["Jan", "Feb"], series: [{ name: "2024", values: [10, "12.5"] }] };

test("media URLs must be platform media or https", () => {
  assert.equal(safeMediaUrl("/api/question-media/imp-abc"), "/api/question-media/imp-abc");
  assert.equal(safeMediaUrl("/api/question-media/../secret"), null);
  assert.equal(safeMediaUrl("https://example.org/a.png"), "https://example.org/a.png");
  assert.equal(safeMediaUrl("http://example.org/a.png"), null);
  assert.equal(safeMediaUrl("javascript:alert(1)"), null);
  assert.equal(safeMediaUrl("https://user:pw@example.org/a.png"), null);
  assert.equal(safeMediaUrl("data:image/png;base64,AAAA"), null);
});

test("blocks are sanitised; images need alt text; charts are validated", () => {
  const c = ctx();
  const out = cleanBlocks([
    { type: "paragraph", text: "  Hello\u0007 world  " },
    { type: "paragraph", text: "   " },
    { type: "image", url: "/api/question-media/k1", alt: "A heron", caption: "c", source: "s", onclick: "x" },
    { type: "image", url: "/api/question-media/k2" },
    { type: "chart", chart },
    { type: "chart", chart: { ...chart, series: [{ name: "x", values: [1] }] } },
    { type: "video" },
  ], "blocks", c);
  assert.deepEqual(out[0], { type: "paragraph", text: "Hello world" });
  assert.deepEqual(out[1], { type: "image", url: "/api/question-media/k1", alt: "A heron", caption: "c", source: "s" });
  assert.equal(out.length, 3);
  assert.deepEqual((out[2] as any).chart.series[0].values, [10, 12.5]);
  const paths = c.errors.map((e) => e.path);
  assert.ok(paths.includes("blocks[3].alt"));
  assert.ok(paths.includes("blocks[5].chart.series[0].values"));
  assert.ok(paths.includes("blocks[6].type"));
  assert.ok(c.warnings.some((w) => w.path === "blocks[1].text"));
});

test("a chart block takes data or an image, not both", () => {
  const c = ctx();
  cleanBlocks([{ type: "chart", chart, url: "/api/question-media/k", alt: "x" }], "blocks", c);
  assert.equal(c.errors[0].path, "blocks[0]");
  const c2 = ctx();
  const out = cleanBlocks([{ type: "chart", url: "/api/question-media/k", alt: "Bar chart of rain" }], "blocks", c2);
  assert.equal(c2.errors.length, 0);
  assert.equal((out[0] as any).url, "/api/question-media/k");
});

test("paragraph-only content is stored text-only; body mirrors paragraphs", () => {
  const c = ctx();
  const a = cleanArticleContent({ title: "T", blocks: [{ type: "paragraph", text: "One." }, { type: "paragraph", text: "Two words." }] }, c);
  assert.equal(a.blocks, null);
  assert.equal(a.body, "One.\n\nTwo words.");
  assert.equal(a.wordCount, 3);
  const b = cleanArticleContent({ title: "T", blocks: [{ type: "paragraph", text: "One." }, { type: "chart", chart }] }, ctx());
  assert.equal(b.blocks!.length, 2);
  assert.equal(b.body, "One.");
  assert.equal(bodyFromBlocks(b.blocks!), "One.");
  const legacy = cleanArticleContent({ title: "T", body: "Para one.\n\nPara two." }, ctx());
  assert.equal(legacy.blocks, null);
  assert.equal(legacy.body, "Para one.\n\nPara two.");
});

test("comprehension question needs two choices and a matching answer", () => {
  const c = ctx();
  cleanArticleContent({ title: "T", body: "x", question: { prompt: "Why?", choices: { A: "a", B: "b" }, answer: "C" } }, c);
  assert.equal(c.errors[0].path, "question.answer");
  const ok = cleanArticleContent({ title: "T", body: "x", question: { prompt: "Why?", choices: ["a", "b"], answer: "b" } }, ctx());
  assert.deepEqual(ok.question!.choices, { A: "a", B: "b" });
  assert.equal(ok.question!.answer, "B");
});

test("import file: versioned batch or single article", () => {
  assert.equal(parseImportDoc({ format: "fnf-library", version: "1.0", articles: [{ title: "a" }, { title: "b" }] }).articles.length, 2);
  assert.equal(parseImportDoc({ id: "x", title: "a", body: "b" }).articles.length, 1);
  assert.ok(parseImportDoc({ format: "other", articles: [] }).errors.some((e) => e.path === "format"));
  assert.ok(parseImportDoc({ version: "2.0", articles: [{}] }).errors.some((e) => e.path === "version"));
  assert.ok(parseImportDoc(42).errors.length);
});

test("import article: ids, media resolution, field paths", () => {
  const seen = new Set<string>();
  const files = new Map([["heron.png", "/api/question-media/imp-1"]]);
  const resolve = (n: string) => files.get(n.toLowerCase()) ?? null;
  const a = cleanImportArticle({
    id: "tide-1", title: "Tides", blocks: [
      { type: "paragraph", text: "Water rises." },
      { type: "image", media: "Heron.PNG", alt: "Heron" },
      { type: "chart", media: "missing.png", alt: "Chart" },
      { type: "image", media: "nope.png" },
    ],
  }, 2, "articles[2]", resolve, seen);
  assert.equal((a.blocks![1] as any).url, "/api/question-media/imp-1");
  assert.equal((a.blocks![1] as any).fileName, "Heron.PNG");
  assert.deepEqual(a.unresolved.map((u) => u.path), ["articles[2].blocks[2].media", "articles[2].blocks[3].media"]);
  assert.ok(a.errors.some((e) => e.path === "articles[2].blocks[3].alt"));
  assert.equal(a.status, null);
  const dup = cleanImportArticle({ id: "TIDE-1", title: "x", body: "y" }, 3, "articles[3]", resolve, seen);
  assert.ok(dup.errors.some((e) => e.path === "articles[3].id"));
  const bad = cleanImportArticle({ id: "bad id!", title: "x", body: "y", status: "live" }, 4, "articles[4]", resolve, seen);
  assert.deepEqual(bad.errors.map((e) => e.path).sort(), ["articles[4].id", "articles[4].status"]);
});

test("re-import: create, update, unchanged, published blocked", () => {
  const seen = new Set<string>();
  const a = cleanImportArticle({ id: "p1", title: "Title", topic: "Science", body: "Text here." }, 0, "articles[0]", () => null, seen);
  assert.equal(classifyImport(a, null), "create");
  const row = { id: 9, status: "draft", title: "Title", topic: "Science", excerpt: a.excerpt, body: "Text here.", blocks: null, question: null };
  assert.equal(classifyImport(a, row), "unchanged");
  assert.equal(classifyImport({ ...a, title: "New" }, row), "update");
  assert.equal(classifyImport({ ...a, title: "New" }, { ...row, status: "published" }), "blocked");
  assert.equal(classifyImport(a, { ...row, status: "published" }), "unchanged");
  assert.equal(classifyImport({ ...a, status: "published" }, row), "update");
});

test("stored file names let a re-import reuse earlier uploads; canonical JSON ignores key order", () => {
  const m = storedFileUrls([{ type: "image", url: "/api/question-media/imp-9", fileName: "Map.png" }, { type: "paragraph", text: "x" }]);
  assert.equal(m.get("map.png"), "/api/question-media/imp-9");
  assert.equal(canonical({ b: 1, a: [{ y: 2, x: 1 }] }), canonical({ a: [{ x: 1, y: 2 }], b: 1 }));
});
