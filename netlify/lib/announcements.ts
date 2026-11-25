// netlify/lib/announcements.ts — class announcements with in-app delivery.
// Every student in a targeted class gets exactly one notification per
// announcement (unique user + dedupe key), whatever the class overlap and
// however often a publish is retried (the browser's client key makes the
// publish itself idempotent). No email or push service is involved.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { announcements, classEnrollments, classes, notifications, users } from "../../db/schema.js";
import { recipients, publishableClassIds, canView } from "./announce-core.js";
import type { FullTestDeps } from "./fulltests.js";

type DbUser = typeof users.$inferSelect;
const str = (v: unknown, max: number) => (v === null || v === undefined ? "" : String(v)).trim().slice(0, max);
const dedupe = (id: number) => `announcement:${id}`;

async function studentClassIds(studentId: number) {
  return (await db.select({ id: classEnrollments.classId }).from(classEnrollments).innerJoin(classes, eq(classEnrollments.classId, classes.id))
    .where(and(eq(classEnrollments.studentId, studentId), eq(classEnrollments.status, "active"), isNull(classes.deletedAt)))).map((r) => r.id);
}
async function mentorClassIds(mentorId: number) {
  return (await db.select({ id: classes.id }).from(classes).where(and(eq(classes.mentorId, mentorId), isNull(classes.deletedAt)))).map((r) => r.id);
}
async function ctxFor(u: DbUser) {
  return u.role === "student" ? { studentClassIds: await studentClassIds(u.id) } : u.role === "mentor" ? { mentorClassIds: await mentorClassIds(u.id) } : {};
}

async function deliver(a: typeof announcements.$inferSelect) {
  const members = a.classIds.length ? await db.select({ classId: classEnrollments.classId, studentId: classEnrollments.studentId }).from(classEnrollments)
    .innerJoin(users, eq(classEnrollments.studentId, users.id))
    .where(and(inArray(classEnrollments.classId, a.classIds), eq(classEnrollments.status, "active"), eq(users.role, "student"), eq(users.status, "active"))) : [];
  const ids = recipients(members, a.classIds);
  for (let i = 0; i < ids.length; i += 500) {
    await db.insert(notifications).values(ids.slice(i, i + 500).map((userId) => ({
      userId, kind: "announcement", title: `Announcement: ${a.title}`.slice(0, 200), body: a.body.replace(/\s+/g, " ").slice(0, 280),
      link: { view: "announcements", announcementId: a.id }, dedupeKey: dedupe(a.id),
    }))).onConflictDoNothing();
  }
  return ids.length;
}

async function decorate(rows: (typeof announcements.$inferSelect)[], viewer: DbUser) {
  const authorIds = [...new Set(rows.map((r) => r.authorId))];
  const classIds = [...new Set(rows.flatMap((r) => r.classIds))];
  const [authors, cls, reads] = await Promise.all([
    authorIds.length ? db.select({ id: users.id, displayName: users.displayName, role: users.role }).from(users).where(inArray(users.id, authorIds)) : [],
    classIds.length ? db.select({ id: classes.id, name: classes.name }).from(classes).where(inArray(classes.id, classIds)) : [],
    viewer.role === "student" && rows.length ? db.select({ key: notifications.dedupeKey, readAt: notifications.readAt }).from(notifications)
      .where(and(eq(notifications.userId, viewer.id), inArray(notifications.dedupeKey, rows.map((r) => dedupe(r.id))))) : [],
  ]);
  const readMap = new Map(reads.map((r) => [r.key, r.readAt]));
  const mine = viewer.role === "student" ? new Set(await studentClassIds(viewer.id)) : null;
  return rows.map((r) => {
    const au = authors.find((x) => x.id === r.authorId);
    return {
      id: r.id, title: r.title, body: r.body, publishedAt: r.publishedAt,
      author: au ? { id: au.id, displayName: au.displayName, role: au.role } : { id: r.authorId, displayName: "Staff", role: "" },
      // Students only learn the names of their own classes.
      classes: r.classIds.filter((c) => !mine || mine.has(c)).map((c) => ({ id: c, name: cls.find((x) => x.id === c)?.name ?? `Class #${c}` })),
      unread: viewer.role === "student" ? readMap.has(dedupe(r.id)) && !readMap.get(dedupe(r.id)) : false,
    };
  });
}

export async function handleAnnouncements(req: Request, parts: string[], deps: FullTestDeps): Promise<Response | null> {
  const [resource, id] = parts;
  if (resource !== "announcements") return null;
  const { json, requireUser } = deps;
  const auth = await requireUser(req, ["student", "mentor", "admin"]);
  if (auth.error) return auth.error;
  const u = auth.user!;
  const method = req.method;
  if ((u.role === "mentor") && u.status !== "active") return json({ error: "Activate your mentor account first." }, 403);

  if (id === "targets" && method === "GET") {
    if (u.role === "student") return json({ error: "Only staff publish announcements." }, 403);
    const rows = await db.select({ id: classes.id, name: classes.name, mentorId: classes.mentorId }).from(classes)
      .where(u.role === "admin" ? isNull(classes.deletedAt) : and(isNull(classes.deletedAt), eq(classes.mentorId, u.id))).orderBy(classes.name);
    return json(rows.map(({ id, name }) => ({ id, name })));
  }

  if (!id && method === "GET") {
    const ctx = await ctxFor(u);
    let rows: (typeof announcements.$inferSelect)[] = [];
    if (u.role === "admin") rows = await db.select().from(announcements).orderBy(desc(announcements.publishedAt), desc(announcements.id)).limit(200);
    else {
      const ids = (u.role === "student" ? ctx.studentClassIds : ctx.mentorClassIds) || [];
      // Filtered on the server: the announcement's classes overlap the viewer's.
      rows = await db.select().from(announcements).where(u.role === "mentor" ? sql`(${announcements.authorId} = ${u.id} or exists (select 1 from jsonb_array_elements(${announcements.classIds}) e where e::text::int in (${ids.length ? sql.join(ids.map((i) => sql`${i}`), sql`, `) : sql`null`})))`
        : sql`exists (select 1 from jsonb_array_elements(${announcements.classIds}) e where e::text::int in (${ids.length ? sql.join(ids.map((i) => sql`${i}`), sql`, `) : sql`null`}))`)
        .orderBy(desc(announcements.publishedAt), desc(announcements.id)).limit(200);
      rows = rows.filter((r) => canView(u, r, ctx));
    }
    return json(await decorate(rows, u));
  }

  if (id && id !== "targets" && method === "GET") {
    const annId = Number(id);
    const [a] = Number.isInteger(annId) ? await db.select().from(announcements).where(eq(announcements.id, annId)).limit(1) : [];
    // Same answer whether it does not exist or belongs to another class.
    if (!a || !canView(u, a, await ctxFor(u))) return json({ error: "Announcement not found." }, 404);
    if (u.role === "student") await db.update(notifications).set({ readAt: new Date() })
      .where(and(eq(notifications.userId, u.id), eq(notifications.dedupeKey, dedupe(a.id)), isNull(notifications.readAt)));
    const [view] = await decorate([a], u);
    return json({ ...view, unread: false });
  }

  if (!id && method === "POST") {
    if (u.role === "student") return json({ error: "Only staff publish announcements." }, 403);
    const b = await req.json().catch(() => ({}));
    const title = str(b.title, 160), body = str(b.body, 6000);
    if (!title) return json({ error: "Enter a title." }, 400);
    if (!body) return json({ error: "Write the message." }, 400);
    const requested = (Array.isArray(b.classIds) ? b.classIds : []).map(Number).filter((n: number) => Number.isInteger(n) && n > 0);
    const live = requested.length ? await db.select({ id: classes.id, mentorId: classes.mentorId }).from(classes).where(and(inArray(classes.id, requested), isNull(classes.deletedAt))) : [];
    const check = publishableClassIds(u, live, requested);
    if (!requested.length) return json({ error: "Choose at least one class." }, 400);
    if (!check.ok) return json({ error: u.role === "mentor" ? "Mentors can publish only to their assigned classes." : "One of the chosen classes no longer exists.", refused: check.refused }, 403);
    const clientKey = str(b.clientKey, 80) || null;
    const [inserted] = await db.insert(announcements).values({ title, body, classIds: check.allowed, authorId: u.id, clientKey }).onConflictDoNothing().returning();
    const a = inserted ?? (await db.select().from(announcements).where(and(eq(announcements.authorId, u.id), eq(announcements.clientKey, clientKey!))).limit(1))[0];
    // Delivery is idempotent, so a retried publish also completes a partial one.
    const delivered = await deliver(a);
    const [view] = await decorate([a], u);
    return json({ ...view, delivered, duplicate: !inserted }, inserted ? 201 : 200);
  }
  return json({ error: "Method not allowed." }, 405);
}
