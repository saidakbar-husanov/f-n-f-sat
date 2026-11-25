// Class announcements: targeting, one notification per student, server-side access.
import { test } from "node:test";
import assert from "node:assert/strict";
import { recipients, publishableClassIds, canView } from "../netlify/lib/announce-core.ts";

const members = [
  { classId: 1, studentId: 10 }, { classId: 1, studentId: 11 },
  { classId: 2, studentId: 11 }, { classId: 2, studentId: 12 },
  { classId: 3, studentId: 13 },
];

test("overlapping classes produce one recipient per student", () => {
  assert.deepEqual(recipients(members, [1, 2]), [10, 11, 12]);
  assert.deepEqual(recipients(members, [1, 1, 2]), [10, 11, 12]);
  assert.deepEqual(recipients(members, [3]), [13]);
});

test("mentors publish only to their assigned classes; admins to any", () => {
  const classes = [{ id: 1, mentorId: 100 }, { id: 2, mentorId: 200 }];
  assert.equal(publishableClassIds({ id: 100, role: "mentor" }, classes, [1]).ok, true);
  const bad = publishableClassIds({ id: 100, role: "mentor" }, classes, [1, 2]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.refused, [2]);
  assert.equal(publishableClassIds({ id: 1, role: "admin" }, classes, [1, 2]).ok, true);
  assert.equal(publishableClassIds({ id: 10, role: "student" }, classes, [1]).ok, false);
  assert.equal(publishableClassIds({ id: 1, role: "admin" }, classes, []).ok, false);
});

test("a student cannot open another class's announcement", () => {
  const ann = { id: 5, authorId: 100, classIds: [2] };
  assert.equal(canView({ id: 10, role: "student" }, ann, { studentClassIds: [1] }), false);
  assert.equal(canView({ id: 11, role: "student" }, ann, { studentClassIds: [1, 2] }), true);
  assert.equal(canView({ id: 100, role: "mentor" }, ann, { mentorClassIds: [] }), true, "author");
  assert.equal(canView({ id: 300, role: "mentor" }, ann, { mentorClassIds: [1] }), false);
  assert.equal(canView({ id: 1, role: "admin" }, ann, {}), true);
});
