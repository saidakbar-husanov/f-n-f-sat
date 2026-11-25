// netlify/lib/announce-core.ts — pure announcement targeting (no imports).

export type Viewer = { id: number; role: string };
export type Ann = { id: number; authorId: number; classIds: number[] };

// One recipient per student, however many targeted classes they share.
export function recipients(members: { classId: number; studentId: number }[], classIds: number[]) {
  const target = new Set(classIds);
  return [...new Set(members.filter((m) => target.has(m.classId)).map((m) => m.studentId))].sort((a, b) => a - b);
}

// Which classes may this author publish to? Admins: any live class.
// Mentors: only the classes assigned to them.
export function publishableClassIds(viewer: Viewer, classes: { id: number; mentorId: number }[], requested: number[]) {
  const allowed = new Set(classes.filter((c) => viewer.role === "admin" || (viewer.role === "mentor" && c.mentorId === viewer.id)).map((c) => c.id));
  const want = [...new Set(requested)];
  return { ok: want.length > 0 && want.every((id) => allowed.has(id)), allowed: want.filter((id) => allowed.has(id)), refused: want.filter((id) => !allowed.has(id)) };
}

// Students: announcements for one of their active classes. Mentors: their own
// announcements and those for classes they teach. Admins: all.
export function canView(viewer: Viewer, ann: Ann, ctx: { studentClassIds?: number[]; mentorClassIds?: number[] }) {
  if (viewer.role === "admin") return true;
  if (viewer.role === "mentor") return ann.authorId === viewer.id || ann.classIds.some((c) => (ctx.mentorClassIds || []).includes(c));
  if (viewer.role === "student") return ann.classIds.some((c) => (ctx.studentClassIds || []).includes(c));
  return false;
}
