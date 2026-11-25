// netlify/lib/library.ts — the Reading Library: short articles and excerpts,
// each with an optional comprehension question. Admins write, publish and
// unpublish; students read published pieces while their SAT English (Reading
// and Writing) master switch is on. The question's key and explanation are
// returned only after the student answers.
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { libraryArticles } from "../../db/schema.js";
import { accessFor } from "./access.js";
import type { FullTestDeps } from "./fulltests.js";

type Article = typeof libraryArticles.$inferSelect;
const str = (v: unknown, max: number) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
const words = (t: string) => (t.match(/\S+/g) || []).length;
export const readingMinutes = (wordCount: number) => Math.max(1, Math.round(wordCount / 200));

function cleanQuestion(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, any>;
  const prompt = str(r.prompt, 1000);
  if (!prompt) return null;
  const choices: Record<string, string> = {};
  for (const k of ["A", "B", "C", "D"]) { const v = str(r.choices?.[k], 600); if (v) choices[k] = v; }
  const answer = str(r.answer, 2).toUpperCase();
  if (Object.keys(choices).length < 2 || !choices[answer]) throw new Error("A comprehension question needs at least two choices and the correct letter.");
  return { prompt, choices, answer, explanation: str(r.explanation, 2000), support: str(r.support, 2000) };
}

const card = (a: Article) => ({
  id: a.id, title: a.title, topic: a.topic, excerpt: a.excerpt || a.body.slice(0, 220), readingMinutes: readingMinutes(a.wordCount),
  status: a.status, hasQuestion: !!a.question, publishedAt: a.publishedAt, updatedAt: a.updatedAt,
});
function forStudent(a: Article) {
  const q = a.question as any;
  return { ...card(a), body: a.body, question: q ? { prompt: q.prompt, choices: q.choices } : null };
}

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

  if (id && method === "GET") {
    const [a] = await db.select().from(libraryArticles).where(eq(libraryArticles.id, articleId)).limit(1);
    if (!a || (!staff && a.status !== "published")) return json({ error: "Article not found." }, 404);
    return json(staff ? { ...card(a), body: a.body, question: a.question, canEdit: u.role === "admin" } : forStudent(a));
  }

  if (id && sub === "answer" && method === "POST") {
    const [a] = await db.select().from(libraryArticles).where(eq(libraryArticles.id, articleId)).limit(1);
    if (!a || (!staff && a.status !== "published") || !a.question) return json({ error: "Article not found." }, 404);
    const b = await req.json().catch(() => ({}));
    const q = a.question as any;
    const selected = str(b.selected, 2).toUpperCase();
    if (!q.choices?.[selected]) return json({ error: "Choose an answer." }, 400);
    return json({ selected, correct: selected === q.answer, answer: q.answer, explanation: q.explanation || "", support: q.support || "" });
  }

  // ── Admin authoring ──
  if (u.role !== "admin") return json({ error: "Only admins can edit the Reading Library." }, 403);
  if ((method === "POST" && !id) || (method === "PUT" && id)) {
    const b = await req.json().catch(() => ({}));
    const title = str(b.title, 200), body = str(b.body, 30000);
    if (!title) return json({ error: "Enter a title." }, 400);
    if (!body) return json({ error: "Write the article text." }, 400);
    let question = null;
    try { question = cleanQuestion(b.question); } catch (e: any) { return json({ error: e.message }, 400); }
    const status = b.status === "published" ? "published" : "draft";
    const values = {
      title, body, topic: str(b.topic, 80), excerpt: str(b.excerpt, 400) || body.replace(/\s+/g, " ").slice(0, 220),
      wordCount: words(body), question, status, updatedBy: u.id, updatedAt: new Date(),
    };
    if (method === "POST") {
      const [row] = await db.insert(libraryArticles).values({ ...values, createdBy: u.id, publishedAt: status === "published" ? new Date() : null }).returning();
      return json({ ...card(row), body: row.body, question: row.question }, 201);
    }
    const [cur] = await db.select().from(libraryArticles).where(eq(libraryArticles.id, articleId)).limit(1);
    if (!cur) return json({ error: "Article not found." }, 404);
    const [row] = await db.update(libraryArticles).set({ ...values, publishedAt: status === "published" ? cur.publishedAt ?? new Date() : cur.publishedAt })
      .where(eq(libraryArticles.id, articleId)).returning();
    return json({ ...card(row), body: row.body, question: row.question });
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
  if (id && method === "DELETE") {
    await db.delete(libraryArticles).where(eq(libraryArticles.id, articleId));
    return json({ deleted: articleId });
  }
  return json({ error: "Method not allowed." }, 405);
}
