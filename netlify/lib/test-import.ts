// netlify/lib/test-import.ts — the content pipeline behind the single-file test
// importer: question media storage (shared with the editor's "Upload image"
// button), embedded-image decoding and validation, the `assets` collection,
// and the Markdown → HTML conversion that turns passage / prompt / choice /
// explanation text into the same rich HTML the question editor produces.
import { createHash, randomBytes } from "node:crypto";
import { getStore } from "@netlify/blobs";

// ─────────────── QUESTION MEDIA (Netlify Blobs) ───────────────
// One store, one URL scheme for every question graphic. Editor uploads get a
// random key; imported images get a content-addressed key, so the same picture
// used by several questions — or uploaded again in a later import — is stored
// once and always resolves to the same URL.
export const QUESTION_MEDIA_STORE = "question-media";
export const MEDIA_URL_PREFIX = "/api/question-media/";
export const MAX_IMAGE_BYTES = 3_000_000;
export const IMPORT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"] as const;
export type ImportImageType = typeof IMPORT_IMAGE_TYPES[number];

export const questionMediaStore = () => getStore({ name: QUESTION_MEDIA_STORE, consistency: "strong" });

export async function saveQuestionMedia(bytes: ArrayBuffer | Uint8Array, contentType: string, key?: string) {
  const store = questionMediaStore();
  const k = key || `${Date.now()}-${randomBytes(8).toString("hex")}`;
  if (key) {
    const existing = await store.getMetadata(k).catch(() => null);
    if (existing) return { key: k, url: MEDIA_URL_PREFIX + k, reused: true };
  }
  const body = bytes instanceof Uint8Array
    ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
    : bytes;
  await store.set(k, body, { metadata: { contentType } });
  return { key: k, url: MEDIA_URL_PREFIX + k, reused: false };
}

export async function questionMediaExists(key: string) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(key)) return false;
  return Boolean(await questionMediaStore().getMetadata(key).catch(() => null));
}

export const mediaKeyOf = (url: string) =>
  url.startsWith(MEDIA_URL_PREFIX) ? url.slice(MEDIA_URL_PREFIX.length).split(/[?#]/)[0] : null;

// Every question-media key a stored question points at (graphic fields plus
// <img> tags inside its rich text).
export function mediaKeysInQuestion(q: { passage: string | null; prompt: string; explanation: string; questionImage: string | null; choices: Record<string, string> | null; choiceImages: Record<string, string> | null }) {
  const keys = new Set<string>();
  const add = (u: unknown) => { const k = typeof u === "string" ? mediaKeyOf(u) : null; if (k) keys.add(k); };
  const scan = (html: unknown) => {
    for (const m of String(html ?? "").matchAll(/<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi)) add(m[1]);
  };
  add(q.questionImage);
  Object.values(q.choiceImages || {}).forEach(add);
  [q.passage, q.prompt, q.explanation, ...Object.values(q.choices || {})].forEach(scan);
  return keys;
}

// ─────────────── IMAGE VALIDATION ───────────────
function normMime(v: unknown): string {
  const t = String(v ?? "").trim().toLowerCase();
  if (t === "image/jpg" || t === "jpg" || t === "jpeg") return "image/jpeg";
  if (t === "png" || t === "gif" || t === "webp") return `image/${t}`;
  if (t === "svg" || t === "image/svg") return "image/svg+xml";
  return t;
}

// Identify the real image type from its first bytes.
function sniffImage(b: Buffer): ImportImageType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 6 && /^GIF8[79]a$/.test(b.subarray(0, 6).toString("latin1"))) return "image/gif";
  if (b.length >= 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  const head = b.subarray(0, 2048).toString("utf8").replace(/^﻿/, "");
  if (/^\s*(<\?xml[\s\S]*?\?>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(head)) return "image/svg+xml";
  return null;
}

export interface DecodedImage { bytes: Buffer; mimeType: ImportImageType; key: string; url: string; size: number }

// Decode and validate base64 image data. Returns the image, or a reason that
// can be shown next to the field it came from.
export function decodeImage(data: string, declaredMime: string): DecodedImage | { error: string } {
  const mime = normMime(declaredMime);
  if (!(IMPORT_IMAGE_TYPES as readonly string[]).includes(mime))
    return { error: `image type "${declaredMime || "(none)"}" is not supported — use PNG, JPEG, GIF, WebP or SVG` };
  const b64 = String(data ?? "").replace(/\s+/g, "");
  if (!b64) return { error: "the image data is empty" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || b64.length % 4 === 1)
    return { error: "the image data is not valid base64" };
  const bytes = Buffer.from(b64, "base64");
  if (!bytes.length) return { error: "the image data is empty" };
  if (bytes.length > MAX_IMAGE_BYTES)
    return { error: `the image is ${(bytes.length / 1_000_000).toFixed(1)} MB — each image must be 3 MB or smaller` };
  const actual = sniffImage(bytes);
  if (!actual) return { error: `the data does not decode to a ${mime.replace("image/", "").toUpperCase()} image (the file may be truncated or corrupted)` };
  if (actual !== mime) return { error: `the image is declared as ${mime} but the data is ${actual}` };
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `imp-${hash}`;
  return { bytes, mimeType: actual, key, url: MEDIA_URL_PREFIX + key, size: bytes.length };
}

// ─────────────── ASSETS COLLECTION ───────────────
export interface ImportAsset {
  id: string; fileName: string; alt: string; mimeType: string;
  image: DecodedImage | null;   // decoded from `data`
  url: string | null;           // already-stored media (or an http(s) link)
  uses: number;
}

// The import-time image registry: assets declared in the file, every embedded
// image found while converting text, and stored-media references to verify.
export class ImageRegistry {
  assets = new Map<string, ImportAsset>();
  byFileName = new Map<string, ImportAsset>();
  pending = new Map<string, DecodedImage>(); // key → image to store
  storedRefs: { key: string; where: string }[] = [];
  imageCount = 0;
  errorCount: () => number = () => 0;
  constructor(public addError: (where: string, message: string) => void, public addWarning: (where: string, message: string) => void) {}

  loadAssets(raw: unknown) {
    if (raw === undefined || raw === null) return;
    const list: any[] = Array.isArray(raw) ? raw
      : typeof raw === "object" ? Object.entries(raw as object).map(([id, v]) => (typeof v === "object" && v ? { id, ...(v as object) } : { id, data: v }))
      : [];
    if (!Array.isArray(raw) && typeof raw !== "object") { this.addError("assets", "must be an array of { id, mimeType, data } objects"); return; }
    list.forEach((a, i) => {
      const where = `assets[${i}]${a?.id ? ` ("${a.id}")` : ""}`;
      const id = String(a?.id ?? "").trim();
      if (!id) { this.addError(where, "every asset needs an \"id\""); return; }
      if (!/^[A-Za-z0-9._:-]{1,120}$/.test(id)) { this.addError(where, `asset id "${id}" may only contain letters, digits, ".", "_", "-" and ":"`); return; }
      if (this.assets.has(id)) { this.addError(where, `asset id "${id}" is used more than once — asset ids must be unique`); return; }
      const fileName = String(a?.fileName ?? a?.filename ?? a?.name ?? "").trim();
      const alt = String(a?.alt ?? a?.altText ?? a?.description ?? "").trim();
      let mimeType = String(a?.mimeType ?? a?.mime ?? a?.contentType ?? a?.type ?? "").trim();
      let data = a?.data ?? a?.base64 ?? a?.dataBase64;
      const url = String(a?.url ?? a?.src ?? "").trim();
      const asset: ImportAsset = { id, fileName, alt, mimeType, image: null, url: null, uses: 0 };
      if (typeof data === "string" && /^data:/i.test(data.trim())) {
        const m = data.trim().match(/^data:([^;,]+)(;base64)?,([\s\S]*)$/i);
        if (!m || !m[2]) { this.addError(where, "data URIs must be base64-encoded (data:<mime>;base64,<data>)"); return; }
        if (!mimeType) mimeType = m[1];
        else if (normMime(mimeType) !== normMime(m[1])) { this.addError(where, `mimeType "${mimeType}" does not match the data URI type "${m[1]}"`); return; }
        data = m[3];
      }
      if (typeof data === "string" && data.trim()) {
        if (!mimeType) { this.addError(where, "add a \"mimeType\" (e.g. \"image/png\")"); return; }
        const img = decodeImage(data, mimeType);
        if ("error" in img) { this.addError(where, img.error); return; }
        asset.image = img; asset.mimeType = img.mimeType;
      } else if (url) {
        const key = mediaKeyOf(url);
        if (key) { asset.url = url; this.storedRefs.push({ key, where }); }
        else if (/^https:\/\//i.test(url)) { asset.url = url; this.addWarning(where, "is loaded from an external https link; embed the image data to make the file self-contained"); }
        else { this.addError(where, `"url" must be platform media (${MEDIA_URL_PREFIX}…) or an https link`); return; }
      } else {
        this.addError(where, "has no image data — add \"data\" with the base64-encoded image and its \"mimeType\"");
        return;
      }
      this.assets.set(id, asset);
      if (fileName) this.byFileName.set(fileName.toLowerCase(), asset);
    });
  }

  private register(img: DecodedImage) { this.pending.set(img.key, img); return img.url; }

  // Resolve one image source to a persistent platform URL, or record why not.
  resolve(src: string, where: string): string | null {
    const raw = String(src ?? "").trim().replace(/^<|>$/g, "");
    if (!raw) { this.addError(where, "an image has an empty source"); return null; }
    this.imageCount += 1;
    if (/^data:/i.test(raw)) {
      const m = raw.match(/^data:([^;,]+)(;[^,]*)?,([\s\S]*)$/i);
      if (!m || !/;base64/i.test(m[2] || "")) { this.addError(where, "embedded images must be base64 data URIs (data:image/png;base64,…)"); return null; }
      const img = decodeImage(m[3], m[1]);
      if ("error" in img) { this.addError(where, `embedded image — ${img.error}`); return null; }
      return this.register(img);
    }
    const key = mediaKeyOf(raw);
    if (key) { this.storedRefs.push({ key, where }); return raw; }
    if (/^https:\/\//i.test(raw)) { this.addWarning(where, "image is loaded from an external https link; embed it to make the file self-contained"); return raw; }
    if (/^http:\/\//i.test(raw)) { this.addError(where, `image link "${raw.slice(0, 80)}" is not https — embed the image data instead`); return null; }
    const ref = raw.replace(/^asset:(\/\/)?/i, "").replace(/^#/, "");
    const asset = this.assets.get(ref) || this.byFileName.get(ref.toLowerCase()) || this.byFileName.get(raw.toLowerCase());
    if (asset) {
      asset.uses += 1;
      if (asset.image) return this.register(asset.image);
      return asset.url;
    }
    const explicit = /^asset:/i.test(raw);
    this.addError(where, explicit
      ? `image asset "${ref}" is missing — add an entry with this id, a mimeType and base64 data to the top-level "assets" array`
      : `image "${raw.slice(0, 120)}" has no image data — embed it as a data URI (![alt](data:image/png;base64,…)) or reference an entry in "assets" with ![alt](asset:ID)`);
    return null;
  }

  altFor(src: string) {
    const ref = String(src ?? "").trim().replace(/^asset:(\/\/)?/i, "");
    return this.assets.get(ref)?.alt || "";
  }

  unusedAssets() { return [...this.assets.values()].filter((a) => !a.uses).map((a) => a.id); }

  // Store every new image and confirm previously stored ones still exist.
  async persist() {
    const failures: string[] = [];
    for (const img of this.pending.values()) {
      try { await saveQuestionMedia(img.bytes, img.mimeType, img.key); }
      catch (e) { failures.push(`an image could not be saved (${(e as Error).message})`); }
    }
    const checked = new Map<string, boolean>();
    for (const ref of this.storedRefs) {
      if (this.pending.has(ref.key)) continue;
      if (!checked.has(ref.key)) checked.set(ref.key, await questionMediaExists(ref.key));
      if (!checked.get(ref.key)) this.addError(ref.where, `image ${MEDIA_URL_PREFIX}${ref.key} does not exist on the platform — embed the image data in the file`);
    }
    return failures;
  }
}

// ─────────────── MARKDOWN → HTML ───────────────
const escHtml = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const BLOCK_HTML = /<\s*(p|div|table|ul|ol|li|h[1-6]|blockquote|img|figure|pre)\b[^>]*>/i;
const INLINE_HTML = /<\/?(u|b|i|em|strong|sub|sup|s|del|ins|br)\s*\/?>/gi;
const TABLE_SEP = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;
const MD_IMAGE = /!\[([^\]\n]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+"([^"\n]*)")?\s*\)/g;

export interface RichStats { tables: number; images: number }

// Does this text need rich conversion, or can it stay plain text?
function needsRich(t: string) {
  return /\n/.test(t) || /!\[[^\]]*\]\(/.test(t) || /\*\*[^*]+\*\*|__[^_\s][^_]*__|(^|[\s(])\*[^\s*][^*\n]*\*(?=[\s).,;:!?]|$)/.test(t)
    || /^\s*\|.*\|\s*$/m.test(t) || /<\/?(u|b|i|em|strong|sub|sup|s|del|ins|br)\s*\/?>/i.test(t) || /\[[^\]]+\]\(https?:/.test(t);
}

function splitRow(line: string) {
  let t = line.trim();
  if (t.startsWith("|")) t = t.slice(1);
  if (t.endsWith("|") && !t.endsWith("\\|")) t = t.slice(0, -1);
  const cells: string[] = []; let cur = "";
  for (let i = 0; i < t.length; i += 1) {
    if (t[i] === "\\" && t[i + 1] === "|") { cur += "|"; i += 1; continue; }
    if (t[i] === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += t[i];
  }
  cells.push(cur.trim());
  return cells;
}

/**
 * Convert one authored text field to the stored form: plain text when it has
 * no formatting (exactly what a plain editor field holds), otherwise HTML made
 * of the same tags the rich-text editor writes — paragraphs, line breaks,
 * bold / italic / underline, lists, real <table>s and <img> tags pointing at
 * stored question media. LaTeX islands (\(..\), \[..\]) pass through untouched
 * for the client's math renderer.
 */
export function convertRichText(text: string, where: string, reg: ImageRegistry, kind: "question" | "choice", stats: RichStats): string {
  let src = String(text ?? "").replace(/\r\n?/g, "\n");
  if (!src.trim()) return "";
  const imgCls = kind === "choice" ? "choice-media" : "question-media";
  const imgTag = (url: string | null, alt: string) => url
    ? `<img class="${imgCls}" src="${escHtml(url)}" alt="${escHtml(alt || "Figure")}"${kind === "choice" ? "" : ' data-zoom="1"'}>`
    : "";

  // Already HTML (from the editor, an export, or a re-sent draft): only resolve
  // its image sources.
  if (BLOCK_HTML.test(src)) {
    src = src.replace(MD_IMAGE, (m, alt, s) => { stats.images += 1; const url = reg.resolve(s, where); return url ? imgTag(url, alt || reg.altFor(s)) : m; });
    src = src.replace(/<img\b([^>]*?)\bsrc\s*=\s*(["'])([\s\S]*?)\2([^>]*)>/gi, (m, pre, _q, s, post) => {
      if (mediaKeyOf(s) || /^https:/i.test(s)) { stats.images += 1; if (mediaKeyOf(s)) reg.resolve(s, where); return m; }
      stats.images += 1;
      const url = reg.resolve(s, where);
      return url ? `<img${pre}src="${escHtml(url)}"${post}>` : m;
    });
    stats.tables += (src.match(/<table\b/gi) || []).length;
    return src.trim();
  }
  if (!needsRich(src)) return src.trim();

  // Placeholders keep images, math and allowed inline tags out of the
  // Markdown parser (a "|" inside \(|x|\) must not split a table cell).
  const slots: string[] = [];
  const hold = (html: string) => `\u0000${slots.push(html) - 1}\u0000`;
  // An image that cannot be resolved keeps its original Markdown, so the
  // draft shown in the preview still fails validation if it is sent back.
  src = src.replace(MD_IMAGE, (m, alt, s) => { stats.images += 1; const url = reg.resolve(s, where); return hold(url ? imgTag(url, alt || reg.altFor(s)) : escHtml(m)); });
  src = src.replace(/\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]/g, (m) => hold(escHtml(m)));
  src = src.replace(INLINE_HTML, (m) => hold(m.toLowerCase().replace(/\s+/g, "").replace("<br/>", "<br>")));

  const inline = (t: string) => escHtml(t)
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_\s][^_]*?)__/g, "<strong>$1</strong>")
    .replace(/(^|[\s(])\*([^\s*][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>');
  const restore = (t: string) => t.replace(/\u0000(\d+)\u0000/g, (_m, i) => slots[Number(i)]);

  const lines = src.split("\n");
  const out: string[] = [];
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    // A paragraph that is only images becomes standalone figures.
    const joined = para.join("\n");
    if (/^(\s*\u0000\d+\u0000\s*)+$/.test(joined) && [...joined.matchAll(/\u0000(\d+)\u0000/g)].every((m) => slots[Number(m[1])].startsWith("<img"))) out.push(joined.replace(/\s+/g, ""));
    else out.push(`<p>${para.map(inline).join("<br>")}</p>`);
    para = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) { flush(); continue; }
    // Table: a header row, a --- separator, then body rows.
    if (line.includes("|") && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1]) && lines[i + 1].includes("-")) {
      flush();
      const head = splitRow(line);
      const aligns = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? "center" : /-+:$/.test(c) ? "right" : ""));
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) { rows.push(splitRow(lines[i])); i += 1; }
      i -= 1;
      const width = Math.max(head.length, ...rows.map((r) => r.length));
      const cell = (tag: string, c: string, j: number) => `<${tag}${aligns[j] ? ` style="text-align:${aligns[j]}"` : ""}>${inline(c ?? "")}</${tag}>`;
      const pad = (r: string[]) => Array.from({ length: width }, (_v, j) => r[j] ?? "");
      out.push(`<table><thead><tr>${pad(head).map((c, j) => cell("th", c, j)).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${pad(r).map((c, j) => cell("td", c, j)).join("")}</tr>`).join("")}</tbody></table>`);
      stats.tables += 1;
      continue;
    }
    const h = line.match(/^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) { flush(); const lvl = Math.min(6, h[1].length + 2); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); continue; }
    if (/^\s*([-*•]|\d+[.)])\s+\S/.test(line)) {
      flush();
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*([-*•]|\d+[.)])\s+/, "")); i += 1; }
      i -= 1;
      const tag = ordered ? "ol" : "ul";
      out.push(`<${tag}>${items.map((it) => `<li>${inline(it)}</li>`).join("")}</${tag}>`);
      continue;
    }
    if (/^\s*>\s?/.test(line)) {
      flush();
      const q: string[] = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, "")); i += 1; }
      i -= 1;
      out.push(`<blockquote>${q.map(inline).join("<br>")}</blockquote>`);
      continue;
    }
    para.push(line);
  }
  flush();
  return restore(out.join(""));
}
