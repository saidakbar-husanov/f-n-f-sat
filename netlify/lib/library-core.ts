// netlify/lib/library-core.ts — pure Reading Library rules (no database, no
// imports) shared by the API and the unit tests: content-block sanitising,
// the comprehension question, the versioned "fnf-library" import format and
// how an imported article compares with the stored one.
//
// Stored content blocks (library_articles.blocks, in order):
//   { type: "paragraph", text }
//   { type: "image", url, alt, caption, source, fileName? }
//   { type: "chart", chart: ChartData, alt, caption, source }      (data chart)
//   { type: "chart", url, alt, caption, source, fileName? }        (chart image)
// A piece made only of paragraphs is stored as `blocks: null` + `body`, exactly
// like a text-only piece. Otherwise `body` is the paragraphs joined by blank
// lines (search, excerpt and word count keep using it).

export const MEDIA_PREFIX = "/api/question-media/";
export const LIBRARY_FORMAT = "fnf-library";
export const LIBRARY_FORMAT_VERSION = "1.0";
export const LIMITS = {
  blocks: 200, bodyChars: 30000, paragraphChars: 8000, alt: 600, caption: 600, source: 300,
  chartLabels: 60, chartSeries: 6, labelChars: 60, articles: 100, fileName: 200,
} as const;

export type Issue = { path: string; message: string };
export type Unresolved = { path: string; ref: string };
export type ChartData = {
  kind: "bar" | "line"; title: string; xLabel: string; yLabel: string;
  labels: string[]; series: { name: string; values: (number | null)[] }[];
};
export type ParagraphBlock = { type: "paragraph"; text: string };
export type ImageBlock = { type: "image"; url: string; alt: string; caption: string; source: string; fileName?: string };
export type ChartBlock = { type: "chart"; url?: string; chart?: ChartData; alt: string; caption: string; source: string; fileName?: string };
export type Block = ParagraphBlock | ImageBlock | ChartBlock;
export type Question = { prompt: string; choices: Record<string, string>; answer: string; explanation: string; support: string };

// Plain text: no control characters (tabs and newlines kept), trimmed, capped.
export function cleanText(v: unknown, max: number, multiline = false): string {
  if (v === null || v === undefined || typeof v === "object") return "";
  let s = String(v).replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "");
  if (!multiline) s = s.replace(/\s+/g, " ");
  else s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  return s.trim().slice(0, max).trim();
}
export const countWords = (t: string) => (t.match(/\S+/g) || []).length;
export const readingMinutes = (wordCount: number) => Math.max(1, Math.round(wordCount / 200));

const MEDIA_KEY = /^[A-Za-z0-9._-]{1,120}$/;
// An image URL is allowed only if it is platform media or an https link.
export function safeMediaUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (s.startsWith(MEDIA_PREFIX)) return MEDIA_KEY.test(s.slice(MEDIA_PREFIX.length)) ? s : null;
  if (!/^https:\/\//i.test(s) || s.length > 2000) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname) return null;
    return u.href;
  } catch { return null; }
}
export const mediaKeyOfUrl = (url: string) => (url.startsWith(MEDIA_PREFIX) ? url.slice(MEDIA_PREFIX.length) : null);
// File names are matched case-insensitively on their base name.
export const fileKey = (name: string) => String(name || "").split(/[\\/]/).pop()!.trim().toLowerCase();
const looksLikeFileName = (s: string) => /^[^\\/:*?"<>|]{1,200}\.[A-Za-z0-9]{2,5}$/.test(s.trim());

export interface BlockContext {
  errors: Issue[]; warnings: Issue[]; unresolved: Unresolved[];
  // Import only: resolve a media file name to a stored/uploaded URL (null = not found).
  resolveFile?: (name: string) => string | null;
}

function cleanNumber(v: unknown): number | null | undefined {
  if (v === null || v === "" || v === undefined) return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "").trim()) : NaN;
  return Number.isFinite(n) && Math.abs(n) < 1e15 ? n : undefined;
}

export function cleanChart(raw: unknown, path: string, ctx: BlockContext): ChartData | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) { ctx.errors.push({ path, message: "chart must be an object with labels and series" }); return null; }
  const r = raw as Record<string, unknown>;
  const kindRaw = cleanText(r.kind ?? r.type ?? "bar", 10).toLowerCase();
  if (kindRaw !== "bar" && kindRaw !== "line") ctx.errors.push({ path: `${path}.kind`, message: `chart kind must be "bar" or "line"` });
  const kind = kindRaw === "line" ? "line" : "bar";
  const labelsRaw = Array.isArray(r.labels) ? r.labels : null;
  if (!labelsRaw || !labelsRaw.length) { ctx.errors.push({ path: `${path}.labels`, message: "add at least one label" }); return null; }
  if (labelsRaw.length > LIMITS.chartLabels) { ctx.errors.push({ path: `${path}.labels`, message: `at most ${LIMITS.chartLabels} labels` }); return null; }
  const labels = labelsRaw.map((l) => cleanText(l, LIMITS.labelChars));
  labels.forEach((l, i) => { if (!l) ctx.errors.push({ path: `${path}.labels[${i}]`, message: "label is empty" }); });
  if (kind === "line" && labels.length < 2) ctx.errors.push({ path: `${path}.labels`, message: "a line chart needs at least two labels" });
  const seriesRaw = Array.isArray(r.series) ? r.series : null;
  if (!seriesRaw || !seriesRaw.length) { ctx.errors.push({ path: `${path}.series`, message: "add at least one data series" }); return null; }
  if (seriesRaw.length > LIMITS.chartSeries) { ctx.errors.push({ path: `${path}.series`, message: `at most ${LIMITS.chartSeries} series` }); return null; }
  let any = false;
  const series = seriesRaw.map((s, si) => {
    const sp = `${path}.series[${si}]`;
    const so = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
    const vals = Array.isArray(so.values) ? so.values : null;
    if (!vals) { ctx.errors.push({ path: `${sp}.values`, message: "values must be a list of numbers" }); return { name: "", values: [] }; }
    if (vals.length !== labels.length) ctx.errors.push({ path: `${sp}.values`, message: `has ${vals.length} values but there are ${labels.length} labels` });
    const values = vals.slice(0, labels.length).map((v, vi) => {
      const n = cleanNumber(v);
      if (n === undefined) { ctx.errors.push({ path: `${sp}.values[${vi}]`, message: "must be a number (or null for no data)" }); return null; }
      if (n !== null) any = true;
      return n;
    });
    return { name: cleanText(so.name, LIMITS.labelChars) || (seriesRaw.length > 1 ? `Series ${si + 1}` : ""), values };
  });
  if (!any) ctx.errors.push({ path: `${path}.series`, message: "the chart has no numeric values" });
  return {
    kind, title: cleanText(r.title, 200), xLabel: cleanText(r.xLabel, 80), yLabel: cleanText(r.yLabel, 80), labels, series,
  };
}

// The image reference of an image / chart-image block: `url` or `media`.
function resolveRef(raw: Record<string, unknown>, path: string, ctx: BlockContext): { url: string; fileName?: string } | null {
  const refRaw = raw.media ?? raw.url ?? raw.src;
  const ref = typeof refRaw === "string" ? refRaw.trim() : "";
  const field = raw.media !== undefined ? "media" : "url";
  const keptName = cleanText(raw.fileName, LIMITS.fileName);
  if (!ref) { ctx.errors.push({ path: `${path}.${field}`, message: "upload an image (no file or URL given)" }); return null; }
  const safe = safeMediaUrl(ref);
  if (safe) return { url: safe, ...(keptName ? { fileName: keptName } : {}) };
  if (ctx.resolveFile && looksLikeFileName(ref)) {
    const url = ctx.resolveFile(ref);
    if (url) return { url, fileName: cleanText(ref, LIMITS.fileName) };
    ctx.unresolved.push({ path: `${path}.${field}`, ref });
    return null;
  }
  ctx.errors.push({ path: `${path}.${field}`, message: ctx.resolveFile
    ? `"${ref.slice(0, 80)}" must be an uploaded file name, platform media (${MEDIA_PREFIX}…) or an https link`
    : `image must be platform media (${MEDIA_PREFIX}…) or an https link` });
  return null;
}

export function cleanBlocks(raw: unknown, path: string, ctx: BlockContext): Block[] {
  if (!Array.isArray(raw)) { ctx.errors.push({ path, message: "blocks must be a list" }); return []; }
  if (raw.length > LIMITS.blocks) { ctx.errors.push({ path, message: `at most ${LIMITS.blocks} blocks` }); return []; }
  const out: Block[] = [];
  raw.forEach((b, i) => {
    const p = `${path}[${i}]`;
    if (!b || typeof b !== "object" || Array.isArray(b)) { ctx.errors.push({ path: p, message: "each block must be an object" }); return; }
    const r = b as Record<string, unknown>;
    const type = cleanText(r.type, 20).toLowerCase();
    const meta = () => ({
      alt: cleanText(r.alt, LIMITS.alt), caption: cleanText(r.caption, LIMITS.caption), source: cleanText(r.source, LIMITS.source),
    });
    if (type === "paragraph" || type === "text") {
      const text = cleanText(r.text, LIMITS.paragraphChars, true);
      if (!text) { ctx.warnings.push({ path: `${p}.text`, message: "empty paragraph skipped" }); return; }
      out.push({ type: "paragraph", text });
    } else if (type === "image") {
      const m = meta();
      if (!m.alt) ctx.errors.push({ path: `${p}.alt`, message: "alt text is required for images" });
      const ref = resolveRef(r, p, ctx);
      if (ref && m.alt) out.push({ type: "image", url: ref.url, ...m, ...(ref.fileName ? { fileName: ref.fileName } : {}) });
    } else if (type === "chart") {
      const m = meta();
      const hasMedia = [r.media, r.url, r.src].some((x) => typeof x === "string" && x.trim());
      if (r.chart !== undefined && r.chart !== null && hasMedia) { ctx.errors.push({ path: p, message: "a chart block uses either chart data or a chart image, not both" }); return; }
      if (hasMedia) {
        if (!m.alt) ctx.errors.push({ path: `${p}.alt`, message: "alt text is required for chart images (describe what the chart shows)" });
        const ref = resolveRef(r, p, ctx);
        if (ref && m.alt) out.push({ type: "chart", url: ref.url, ...m, ...(ref.fileName ? { fileName: ref.fileName } : {}) });
      } else {
        const before = ctx.errors.length;
        const chart = cleanChart(r.chart, `${p}.chart`, ctx);
        if (!m.alt && !chart?.title) ctx.warnings.push({ path: `${p}.alt`, message: "no alt text or title — screen readers will hear a generic description" });
        if (chart && ctx.errors.length === before) out.push({ type: "chart", chart, ...m });
      }
    } else {
      ctx.errors.push({ path: `${p}.type`, message: `unknown block type "${cleanText(r.type, 20)}" — use paragraph, image or chart` });
    }
  });
  return out;
}

export const bodyFromBlocks = (blocks: Block[]) =>
  blocks.filter((b): b is ParagraphBlock => b.type === "paragraph").map((b) => b.text).join("\n\n");
export const onlyParagraphs = (blocks: Block[]) => blocks.every((b) => b.type === "paragraph");
export const blocksFromBody = (body: string): Block[] =>
  body.split(/\n{2,}/).map((t) => t.trim()).filter(Boolean).map((text) => ({ type: "paragraph", text }));

export function cleanQuestion(raw: unknown, path: string, errors: Issue[]): Question | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const prompt = cleanText(r.prompt, 1000, true);
  if (!prompt) return null;
  const src = Array.isArray(r.choices) ? Object.fromEntries(r.choices.map((v: unknown, i: number) => ["ABCD"[i], v])) : (r.choices || {});
  const choices: Record<string, string> = {};
  for (const k of ["A", "B", "C", "D"]) { const v = cleanText(src?.[k], 600); if (v) choices[k] = v; }
  const answer = cleanText(r.answer, 2).toUpperCase();
  if (Object.keys(choices).length < 2) errors.push({ path: `${path}.choices`, message: "a comprehension question needs at least two choices" });
  else if (!choices[answer]) errors.push({ path: `${path}.answer`, message: "the correct letter must match one of the choices" });
  return { prompt, choices, answer, explanation: cleanText(r.explanation, 2000, true), support: cleanText(r.support, 2000, true) };
}

export interface ArticleValues {
  title: string; topic: string; excerpt: string; body: string; wordCount: number;
  blocks: Block[] | null; question: Question | null;
}

// Title, topic, excerpt, content (blocks or plain body) and question — shared
// by the editor (POST/PUT) and the importer.
export function cleanArticleContent(raw: Record<string, any>, ctx: BlockContext, base = ""): ArticleValues {
  const at = (f: string) => (base ? `${base}.${f}` : f);
  const title = cleanText(raw.title, 200);
  if (!title) ctx.errors.push({ path: at("title"), message: "enter a title" });
  let blocks: Block[] | null = null;
  let body: string;
  if (Array.isArray(raw.blocks)) {
    const clean = cleanBlocks(raw.blocks, at("blocks"), ctx);
    body = bodyFromBlocks(clean);
    blocks = onlyParagraphs(clean) ? null : clean;
    if (!clean.length) ctx.errors.push({ path: at("blocks"), message: "add at least one paragraph, image or chart" });
  } else if (raw.blocks !== undefined && raw.blocks !== null) {
    ctx.errors.push({ path: at("blocks"), message: "blocks must be a list" });
    body = "";
  } else {
    body = cleanText(raw.body, LIMITS.bodyChars, true);
    if (!body) ctx.errors.push({ path: at("body"), message: "write the article text" });
  }
  if (body.length > LIMITS.bodyChars) ctx.errors.push({ path: at(blocks ? "blocks" : "body"), message: `the text is longer than ${LIMITS.bodyChars} characters` });
  const question = cleanQuestion(raw.question, at("question"), ctx.errors);
  return {
    title, topic: cleanText(raw.topic, 80), body,
    excerpt: cleanText(raw.excerpt, 400) || body.replace(/\s+/g, " ").slice(0, 220),
    wordCount: countWords(body), blocks, question,
  };
}

// ─────────────── IMPORT FORMAT ───────────────
export const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function parseImportDoc(data: unknown): { articles: unknown[]; errors: Issue[] } {
  const errors: Issue[] = [];
  if (Array.isArray(data)) return { articles: data.slice(0, LIMITS.articles), errors: data.length > LIMITS.articles ? [{ path: "articles", message: `at most ${LIMITS.articles} articles per file` }] : [] };
  if (!data || typeof data !== "object") return { articles: [], errors: [{ path: "", message: "the file must contain a JSON object" }] };
  const d = data as Record<string, unknown>;
  if (d.format !== undefined && d.format !== LIBRARY_FORMAT) errors.push({ path: "format", message: `format must be "${LIBRARY_FORMAT}"` });
  if (d.version !== undefined && !/^1(\.\d+)?$/.test(String(d.version))) errors.push({ path: "version", message: `version ${String(d.version).slice(0, 20)} is not supported — use "${LIBRARY_FORMAT_VERSION}"` });
  if (Array.isArray(d.articles)) {
    if (!d.articles.length) errors.push({ path: "articles", message: "the file has no articles" });
    if (d.articles.length > LIMITS.articles) errors.push({ path: "articles", message: `at most ${LIMITS.articles} articles per file` });
    return { articles: d.articles.slice(0, LIMITS.articles), errors };
  }
  if (d.articles !== undefined) return { articles: [], errors: [...errors, { path: "articles", message: "articles must be a list" }] };
  if ("title" in d || "blocks" in d || "body" in d) return { articles: [d], errors }; // single article at top level
  return { articles: [], errors: [...errors, { path: "", message: `expected { "format": "${LIBRARY_FORMAT}", "articles": [ … ] } or a single article object` }] };
}

export interface ImportArticle extends ArticleValues {
  index: number; path: string; externalId: string; status: "draft" | "published" | null;
  errors: Issue[]; warnings: Issue[]; unresolved: Unresolved[];
}

export function cleanImportArticle(raw: unknown, index: number, path: string, resolveFile: (name: string) => string | null, seen: Set<string>): ImportArticle {
  const ctx: BlockContext = { errors: [], warnings: [], unresolved: [], resolveFile };
  const r = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, any>;
  if (r !== raw) ctx.errors.push({ path, message: "each article must be an object" });
  const externalId = cleanText(r.id ?? r.externalId, 80);
  if (!externalId) ctx.errors.push({ path: `${path}.id`, message: "a stable id is required (re-importing the same id updates the same piece)" });
  else if (!EXTERNAL_ID.test(externalId)) ctx.errors.push({ path: `${path}.id`, message: "id must be 1–80 letters, digits, dots, dashes or underscores, starting with a letter or digit" });
  else if (seen.has(externalId.toLowerCase())) ctx.errors.push({ path: `${path}.id`, message: `id "${externalId}" appears more than once in the file` });
  if (externalId) seen.add(externalId.toLowerCase());
  let status: "draft" | "published" | null = null;
  if (r.status !== undefined && r.status !== null && r.status !== "") {
    if (r.status === "draft" || r.status === "published") status = r.status;
    else ctx.errors.push({ path: `${path}.status`, message: `status must be "draft" or "published"` });
  }
  const content = cleanArticleContent(r, ctx, path);
  return { ...content, index, path, externalId, status, errors: ctx.errors, warnings: ctx.warnings, unresolved: ctx.unresolved };
}

// Stable JSON (sorted keys) — Postgres jsonb does not keep key order.
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canonical((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

export type ImportAction = "create" | "update" | "unchanged" | "blocked";
export interface ExistingRow { id: number; status: string; title: string; topic: string; excerpt: string; body: string; blocks: unknown; question: unknown }

export function classifyImport(a: ArticleValues & { status: "draft" | "published" | null }, existing: ExistingRow | null | undefined): ImportAction {
  if (!existing) return "create";
  const same = a.title === existing.title && a.topic === existing.topic && a.excerpt === existing.excerpt && a.body === existing.body
    && canonical(a.blocks) === canonical(existing.blocks ?? null) && canonical(a.question) === canonical(existing.question ?? null)
    && (a.status === null || a.status === existing.status);
  if (same) return "unchanged";
  if (existing.status === "published") return "blocked";
  return "update";
}

// Media file names already used by a stored article (so a re-import does not
// need the same files uploaded again).
export function storedFileUrls(blocks: unknown): Map<string, string> {
  const m = new Map<string, string>();
  if (Array.isArray(blocks)) for (const b of blocks) {
    if (b && typeof b === "object" && typeof (b as any).fileName === "string" && typeof (b as any).url === "string") m.set(fileKey((b as any).fileName), (b as any).url);
  }
  return m;
}
