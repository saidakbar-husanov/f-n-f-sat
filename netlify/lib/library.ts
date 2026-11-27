// netlify/lib/library.ts — the Reading Library: short articles and excerpts,
// each with an optional comprehension question. Admins write, publish and
// unpublish; students read published pieces while their SAT English (Reading
// and Writing) master switch is on. The question's key and explanation are
// returned only after the student answers.
//
// A piece is either text-only (`body`, `blocks` null) or an ordered list of
// content blocks (paragraphs, images, charts — see library-core.ts). Admins can
// also import pieces from a versioned JSON file ("fnf-library"), matched by a
// stable id → `externalId`; published pieces are never overwritten unless the
// admin ticks that article in the preview.
//
// Routes (all under /api/library):
//   GET    /                      list (students: published only)
//   GET    /:id                   one piece
//   POST   /:id/answer            check the comprehension answer
//   POST   /                      create            (admin)
//   PUT    /:id                   update            (admin)
//   POST   /:id/status            publish/unpublish (admin)
//   DELETE /:id                   delete            (admin)
//   POST   /media                 upload an image   (admin) → { url }
//   POST   /import/preview        validate a file   (admin) — writes nothing
//   POST   /import/commit         import a file     (admin)
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { libraryArticles } from "../../db/schema.js";
import { accessFor } from "./access.js";
import { chargeOnce, outOfCredits, receipt } from "./credits.js";
import type { FullTestDeps } from "./fulltests.js";
import { decodeImage, saveQuestionMedia, questionMediaExists, MAX_IMAGE_BYTES } from "./test-import.js";
import {
  cleanText, cleanArticleContent, cleanImportArticle, parseImportDoc, classifyImport, storedFileUrls, fileKey,
  mediaKeyOfUrl, readingMinutes as minutesFor, MEDIA_PREFIX, type BlockContext, type Issue, type ImportArticle,
} from "./library-core.js";

type Article = typeof libraryArticles.$inferSelect;
const str = (v: unknown, max: number) => cleanText(v, max);
export const readingMinutes = minutesFor;

const card = (a: Article) => ({
  id: a.id, title: a.title, topic: a.topic, excerpt: a.excerpt || a.body.slice(0, 220), readingMinutes: readingMinutes(a.wordCount),
  status: a.status, hasQuestion: !!a.question, hasMedia: Array.isArray(a.blocks) && a.blocks.some((b: any) => b?.type !== "paragraph"),
  publishedAt: a.publishedAt, updatedAt: a.updatedAt,
});
const full = (a: Article) => ({ ...card(a), body: a.body, blocks: a.blocks ?? null, question: a.question, externalId: a.externalId ?? null });
function forStudent(a: Article) {
  const q = a.question as any;
  return { ...card(a), body: a.body, blocks: a.blocks ?? null, question: q ? { prompt: q.prompt, choices: q.choices } : null };
}
const friendly = (issues: Issue[]) => {
  const e = issues[0];
  const m = /^blocks\[(\d+)\]/.exec(e.path);
  const msg = e.message.charAt(0).toUpperCase() + e.message.slice(1);
  return m ? `Block ${Number(m[1]) + 1}: ${msg}.` : `${msg}.`;
};

// Every platform-media URL a piece points at must exist in the store.
async function missingMedia(blocks: unknown, base: string, skip?: Set<string>): Promise<Issue[]> {
  const out: Issue[] = [];
  if (!Array.isArray(blocks)) return out;
  const cache = new Map<string, boolean>();
  for (let i = 0; i < blocks.length; i++) {
    const url = (blocks[i] as any)?.url;
    const key = typeof url === "string" ? mediaKeyOfUrl(url) : null;
    if (!key || skip?.has(url)) continue;
    if (!cache.has(key)) cache.set(key, await questionMediaExists(key));
    if (!cache.get(key)) out.push({ path: `${base}[${i}].url`, message: `image ${url} is not stored on the platform — upload it again` });
  }
  return out;
}

// ─────────────── IMPORT ───────────────
// Preview sends the media files it is about to upload as { name, sha256 }; the
// upload endpoint stores images content-addressed ("imp-<sha256>"), so the
// final URL is known before anything is written. Commit sends { name: url }
// for the files it has uploaded.
interface PlannedArticle extends ImportArticle {
  action: "create" | "update" | "unchanged" | "blocked" | "invalid";
  existing: Article | null;
}
async function planImport(data: unknown, files: Map<string, string>, preview: boolean) {
  const doc = parseImportDoc(data);
  const ids = doc.articles.map((a: any) => (a && typeof a === "object" ? cleanText(a.id ?? a.externalId, 80) : "")).filter(Boolean);
  const rows = ids.length ? await db.select().from(libraryArticles).where(inArray(libraryArticles.externalId, ids)) : [];
  const byExt = new Map(rows.map((r) => [r.externalId!, r]));
  const seen = new Set<string>();
  const uploaded = new Set(files.values());
  const plan: PlannedArticle[] = [];
  for (let i = 0; i < doc.articles.length; i++) {
    const raw = doc.articles[i] as any;
    const existing = byExt.get(cleanText(raw?.id ?? raw?.externalId, 80)) ?? null;
    const stored = storedFileUrls(existing?.blocks);
    const resolve = (name: string) => files.get(fileKey(name)) ?? stored.get(fileKey(name)) ?? null;
    const path = doc.articles.length === 1 && !Array.isArray((data as any)?.articles) ? "article" : `articles[${i}]`;
    const a = cleanImportArticle(raw, i, path, resolve, seen);
    if (!a.errors.length && a.blocks) a.errors.push(...await missingMedia(a.blocks, `${path}.blocks`, preview ? uploaded : undefined));
    const action = a.errors.length || a.unresolved.length ? "invalid" : classifyImport(a, existing);
    plan.push({ ...a, action, existing });
  }
  return { plan, fileErrors: doc.errors };
}
const planSummary = (p: PlannedArticle) => ({
  index: p.index, path: p.path, id: p.externalId, title: p.title, topic: p.topic, action: p.action,
  existingId: p.existing?.id ?? null, existingStatus: p.existing?.status ?? null,
  status: p.status ?? (p.existing ? p.existing.status : "draft"),
  blocks: p.blocks?.length ?? 0, words: p.wordCount, hasQuestion: !!p.question,
  errors: p.errors, warnings: p.warnings, unresolvedMedia: p.unresolved,
});

export async function handleLibrary(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  const [resource, id, sub] = parts;
  if (resource !== "library") return null;
  const { json, requireUser } = deps;
  const auth = await requireUser(req, ["student", "mentor", "admin"]);
  if (auth.error) return auth.error;
  const u = auth.user!;
  const method = req.method;
  const url = new URL(req.url);
  const staff = u.role === "admin" || u.role === "mentor";
  if (u.role === "student") {
    const access = await accessFor(req, u);
    if (!access.library) return json({ error: "The Reading Library is not available on your account.", locked: true }, 403);
  }

  // ── Admin: media upload and JSON import ──
  if (id === "media" || id === "import") {
    if (u.role !== "admin") return json({ error: "Only admins can edit the Reading Library." }, 403);
    if (method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (id === "media" && !sub) {
      const contentType = (req.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
      if (!contentType.startsWith("image/")) return json({ error: "Upload an image file (PNG, JPEG, GIF, WebP or SVG)." }, 400);
      const bytes = await req.arrayBuffer();
      if (!bytes.byteLength || bytes.byteLength > MAX_IMAGE_BYTES) return json({ error: "Images must be between 1 byte and 3 MB." }, 400);
      // Same validation, store and content-addressed key as the test importer.
      const img = decodeImage(Buffer.from(bytes).toString("base64"), contentType);
      if ("error" in img) return json({ error: `This file can't be used: ${img.error}.` }, 400);
      const saved = await saveQuestionMedia(img.bytes, img.mimeType, img.key);
      return json({ url: saved.url, reused: saved.reused, size: img.size, type: img.mimeType }, 201);
    }
    if (id === "import" && (sub === "preview" || sub === "commit")) {
      const b = await req.json().catch(() => null);
      if (!b || typeof b !== "object") return json({ error: "Send { data, files } as JSON." }, 400);
      const files = new Map<string, string>();
      if (sub === "preview") {
        for (const f of Array.isArray(b.files) ? b.files.slice(0, 300) : []) {
          const sha = String(f?.sha256 || "").toLowerCase();
          if (f?.name && /^[0-9a-f]{64}$/.test(sha)) files.set(fileKey(String(f.name)), `${MEDIA_PREFIX}imp-${sha}`);
        }
      } else if (b.media && typeof b.media === "object") {
        for (const [name, u2] of Object.entries(b.media).slice(0, 300)) {
          const s = String(u2 || "");
          if (s.startsWith(MEDIA_PREFIX) && /^[A-Za-z0-9._-]{1,120}$/.test(s.slice(MEDIA_PREFIX.length))) files.set(fileKey(name), s);
        }
      }
      const { plan, fileErrors } = await planImport(b.data, files, sub === "preview");
      const counts = { create: 0, update: 0, unchanged: 0, blocked: 0, invalid: 0 };
      plan.forEach((p) => counts[p.action]++);
      if (sub === "preview") return json({ fileErrors, counts, articles: plan.map(planSummary) });

      // Commit: re-validated above; write only what the preview would allow.
      if (fileErrors.length) return json({ error: "Fix the file before importing.", fileErrors, counts, articles: plan.map(planSummary) }, 400);
      const overwrite = new Set((Array.isArray(b.overwritePublished) ? b.overwritePublished : []).map((x: unknown) => String(x)));
      const results: { id: string; path: string; result: string; articleId?: number; error?: string }[] = [];
      for (const p of plan) {
        const base = { id: p.externalId, path: p.path };
        if (p.action === "invalid" || p.action === "unchanged") { results.push({ ...base, result: p.action === "invalid" ? "skipped (has errors)" : "unchanged", articleId: p.existing?.id }); continue; }
        if (p.action === "blocked" && !overwrite.has(p.externalId)) { results.push({ ...base, result: "published — not overwritten", articleId: p.existing?.id }); continue; }
        const values = {
          title: p.title, topic: p.topic, excerpt: p.excerpt, body: p.body, wordCount: p.wordCount, blocks: p.blocks as any,
          question: p.question as any, updatedBy: u.id, updatedAt: new Date(),
        };
        try {
          if (!p.existing) {
            const status = p.status ?? "draft";
            const [row] = await db.insert(libraryArticles).values({ ...values, externalId: p.externalId, status, createdBy: u.id, publishedAt: status === "published" ? new Date() : null }).returning();
            results.push({ ...base, result: "created", articleId: row.id });
          } else {
            const status = p.status ?? p.existing.status;
            const [row] = await db.update(libraryArticles).set({ ...values, status, publishedAt: status === "published" ? p.existing.publishedAt ?? new Date() : p.existing.publishedAt })
              .where(eq(libraryArticles.id, p.existing.id)).returning();
            results.push({ ...base, result: "updated", articleId: row.id });
          }
        } catch (e: any) {
          results.push({ ...base, result: "failed", error: /unique|duplicate/i.test(String(e?.message)) ? "another import created this id at the same time — preview again" : "could not be saved" });
        }
      }
      return json({ counts, results });
    }
    return json({ error: "Not found." }, 404);
  }

  if (!id && method === "GET") {
    const q = str(url.searchParams.get("q"), 80).toLowerCase();
    const topic = str(url.searchParams.get("topic"), 80);
    const conds = [];
    if (!staff) conds.push(eq(libraryArticles.status, "published"));
    if (topic) conds.push(eq(libraryArticles.topic, topic));
    if (q) conds.push(sql`(lower(${libraryArticles.title}) like ${"%" + q + "%"} or lower(${libraryArticles.topic}) like ${"%" + q + "%"} or lower(${libraryArticles.body}) like ${"%" + q + "%"})`);
    const rows = await db.select().from(libraryArticles).where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(libraryArticles.publishedAt), desc(libraryArticles.id)).limit(200);
    const topics = (await db.selectDistinct({ topic: libraryArticles.topic }).from(libraryArticles)
      .where(staff ? undefined : eq(libraryArticles.status, "published"))).map((t) => t.topic).filter(Boolean).sort();
    return json({ articles: rows.map(card), topics, canEdit: u.role === "admin" });
  }

  const articleId = Number(id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    if (id === undefined && method === "POST") { /* create below */ } else return json({ error: "Article not found." }, 404);
  }

  if (id && !sub && method === "GET") {
    const [a] = await db.select().from(libraryArticles).where(eq(libraryArticles.id, articleId)).limit(1);
    if (!a || (!staff && a.status !== "published")) return json({ error: "Article not found." }, 404);
    return json(staff ? { ...full(a), canEdit: u.role === "admin" } : forStudent(a));
  }

  if (id && sub === "answer" && method === "POST") {
    const [a] = await db.select().from(libraryArticles).where(eq(libraryArticles.id, articleId)).limit(1);
    if (!a || (!staff && a.status !== "published") || !a.question) return json({ error: "Article not found." }, 404);
    const b = await req.json().catch(() => ({}));
    const q = a.question as any;
    const selected = str(b.selected, 2).toUpperCase();
    // Optional client attempt key, passed through untouched (no trimming or validation here).
    const attemptKey: string | undefined = typeof b.attemptKey === "string" ? b.attemptKey : undefined;
    if (!q.choices?.[selected]) return json({ error: "Choose an answer." }, 400);
    // CREDITS — a scored comprehension submission costs 1 credit when (and
    // only when) the student's credit mode is on. Keyed by the browser's
    // attempt id, so a retried request is never charged twice; an
    // intentional retry sends a new id and costs 1 more.
    let credit: Record<string, unknown> | undefined;
    if (u.role === "student") {
      const key = /^[A-Za-z0-9_.:-]{8,80}$/.test(String(attemptKey || "")) ? String(attemptKey) : `srv${Date.now()}${Math.random().toString(36).slice(2)}`;
      const ch = await chargeOnce(u.id, `lib:${u.id}:${key}`, `Reading Library · ${a.title}`.slice(0, 200), `library:${a.id}`);
      if (!ch.ok && ch.credit) return json(outOfCredits(ch.credit), 402);
      if (ch.credit) credit = receipt(ch.credit, ch.charged, ch.duplicate);
    }
    return json({ selected, correct: selected === q.answer, answer: q.answer, explanation: q.explanation || "", support: q.support || "", ...(attemptKey !== undefined ? { attemptKey } : {}), ...(credit ? { credit } : {}) });
  }

  // ── Admin authoring ──
  if (u.role !== "admin") return json({ error: "Only admins can edit the Reading Library." }, 403);
  if ((method === "POST" && !id) || (method === "PUT" && id && !sub)) {
    const b = await req.json().catch(() => ({}));
    const ctx: BlockContext = { errors: [], warnings: [], unresolved: [] };
    const content = cleanArticleContent(b && typeof b === "object" ? b : {}, ctx);
    if (!ctx.errors.length && content.blocks) ctx.errors.push(...await missingMedia(content.blocks, "blocks"));
    if (ctx.errors.length) return json({ error: friendly(ctx.errors), issues: ctx.errors }, 400);
    const status = b.status === "published" ? "published" : "draft";
    const values = { ...content, blocks: content.blocks as any, question: content.question as any, status, updatedBy: u.id, updatedAt: new Date() };
    if (method === "POST") {
      const [row] = await db.insert(libraryArticles).values({ ...values, createdBy: u.id, publishedAt: status === "published" ? new Date() : null }).returning();
      return json(full(row), 201);
    }
    const [cur] = await db.select().from(libraryArticles).where(eq(libraryArticles.id, articleId)).limit(1);
    if (!cur) return json({ error: "Article not found." }, 404);
    const [row] = await db.update(libraryArticles).set({ ...values, publishedAt: status === "published" ? cur.publishedAt ?? new Date() : cur.publishedAt })
      .where(eq(libraryArticles.id, articleId)).returning();
    return json(full(row));
  }
  if (id && sub === "status" && method === "POST") {
    const b = await req.json().catch(() => ({}));
    const status = b.status === "published" ? "published" : "draft";
    const [cur] = await db.select().from(libraryArticles).where(eq(libraryArticles.id, articleId)).limit(1);
    if (!cur) return json({ error: "Article not found." }, 404);
    const [row] = await db.update(libraryArticles).set({ status, updatedBy: u.id, updatedAt: new Date(), publishedAt: status === "published" ? cur.publishedAt ?? new Date() : cur.publishedAt })
      .where(eq(libraryArticles.id, articleId)).returning();
    return json(card(row));
  }
  if (id && !sub && method === "DELETE") {
    await db.delete(libraryArticles).where(eq(libraryArticles.id, articleId));
    return json({ deleted: articleId });
  }
  return json({ error: "Method not allowed." }, 405);
}
