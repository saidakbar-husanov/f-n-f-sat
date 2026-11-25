// Leaderboard privacy: visibility before ranking, counting, search, pages and export.
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBoard, boardCsv, displayHandle } from "../netlify/lib/leaderboard-core.ts";

const scores = [
  { studentId: 1, value: 50, extra: {}, sort: [50] },
  { studentId: 2, value: 40, extra: {}, sort: [40] },
  { studentId: 3, value: 30, extra: {}, sort: [30] },
  { studentId: 4, value: 30, extra: {}, sort: [30] },
];
const people = [
  { id: 1, username: "ada", visible: false },
  { id: 2, username: "bo", visible: true },
  { id: 3, username: "cy", visible: true },
  { id: 4, username: null, visible: true },
];

test("students, mentors and ordinary admins never receive hidden entries", () => {
  const b = buildBoard(scores, people, { superAdmin: false });
  assert.deepEqual(b.rows.map((r) => r.studentId), [2, 3, 4]);
  assert.equal(b.total, 3, "counts exclude hidden entries");
  assert.equal(b.rows[0].rank, 1, "ranks computed without hidden entries");
  assert.deepEqual(b.rows.map((r) => r.rank), [1, 2, 2]);
  assert.ok(b.rows.every((r) => !r.hidden));
});

test("the super admin sees the complete board with hidden entries marked", () => {
  const b = buildBoard(scores, people, { superAdmin: true });
  assert.deepEqual(b.rows.map((r) => r.studentId), [1, 2, 3, 4]);
  assert.equal(b.rows[0].hidden, true);
  assert.equal(b.hiddenCount, 1);
});

test("search and pagination run on visible entries only", () => {
  assert.equal(buildBoard(scores, people, { superAdmin: false, search: "ada" }).total, 0);
  assert.equal(buildBoard(scores, people, { superAdmin: true, search: "ada" }).total, 1);
  const p = buildBoard(scores, people, { superAdmin: false, pageSize: 2, page: 1 });
  assert.deepEqual(p.rows.map((r) => r.studentId), [4]);
});

test("entries show usernames; a missing username becomes a neutral handle", () => {
  const b = buildBoard(scores, people, { superAdmin: false });
  assert.deepEqual(b.rows.map((r) => r.username).slice(0, 2), ["bo", "cy"]);
  assert.match(b.rows[2].username, /^learner-[a-z0-9]+$/);
  assert.equal(displayHandle({ id: 4, username: null }), b.rows[2].username);
});

test("exports contain the same visible rows and no names or emails", () => {
  const csv = boardCsv(buildBoard(scores, people, { superAdmin: false }).all, "points", false);
  assert.ok(!csv.includes("ada"));
  assert.equal(csv.split("\n").length, 4);
  assert.ok(!csv.includes("Hidden"));
  assert.ok(boardCsv(buildBoard(scores, people, { superAdmin: true }).all, "points", true).includes("ada,50,yes"));
});

test("people who are not students on the active roster never appear", () => {
  const b = buildBoard([...scores, { studentId: 99, value: 999, extra: {}, sort: [999] }], people, { superAdmin: true });
  assert.ok(!b.rows.some((r) => r.studentId === 99));
});
