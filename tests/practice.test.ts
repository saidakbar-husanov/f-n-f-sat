// Practice filters (OR within a group, AND across groups) and answer bookkeeping.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filterPool, normalizeFilters, difficultyBand, applySelection, shouldGrade, stableOrder, seededShuffle, filtersFromParams } from "../netlify/lib/practice-core.ts";

const Q = (id: number, section: string, category: string, subcategory: string, difficulty: number) => ({ id, section, category, subcategory, difficulty });
const POOL = [
  Q(1, "math", "Algebra", "Linear functions", 5),
  Q(2, "math", "Algebra", "Linear functions", 3),
  Q(3, "math", "Advanced Math", "Nonlinear functions", 4),
  Q(4, "math", "Geometry and Trigonometry", "Circles", 4),
  Q(5, "ebrw", "Craft and Structure", "Words in context", 4),
  Q(6, "ebrw", "Information and Ideas", "Inferences", 1),
  Q(7, "math", "Advanced Math", "Equivalent expressions", 4),
];
const ids = (r: { id: number }[]) => r.map((q) => q.id).sort((a, b) => a - b);
const BOTH = ["math", "ebrw"];

test("difficulty bands follow the 1–5 scale", () => {
  assert.deepEqual([1, 2, 3, 4, 5].map(difficultyBand), ["easy", "easy", "medium", "hard", "hard"]);
});

test("Hard + two domains = hard questions from either domain", () => {
  const f = normalizeFilters({ difficulties: ["hard"], domains: ["Algebra", "Advanced Math"] });
  assert.deepEqual(ids(filterPool(POOL, f, BOTH)), [1, 3, 7]);
});

test("two topics narrow that pool to either topic", () => {
  const f = normalizeFilters({ difficulties: ["hard"], domains: ["Algebra", "Advanced Math"], skills: ["Linear functions", "Nonlinear functions"] });
  assert.deepEqual(ids(filterPool(POOL, f, BOTH)), [1, 3]);
});

test("several subjects / difficulties widen within the group", () => {
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({ difficulties: ["easy", "medium"] }), BOTH)), [2, 6]);
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({ subjects: ["math", "ebrw"] }), BOTH)), [1, 2, 3, 4, 5, 6, 7]);
});

test("an English-only student never reaches Math, even when asking for it", () => {
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({}), ["ebrw"])), [5, 6]);
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({ subjects: ["math"] }), ["ebrw"])), [], "no silent fallback to other subjects");
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({ domains: ["Algebra"] }), ["ebrw"])), []);
});

test("Previously incorrect and Unanswered combine with the other filters", () => {
  const status = new Map<number, "correct" | "incorrect">([[1, "incorrect"], [3, "correct"], [5, "incorrect"]]);
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({ status: ["incorrect"] }), BOTH, status)), [1, 5]);
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({ status: ["incorrect"], subjects: ["math"] }), BOTH, status)), [1]);
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({ status: ["unanswered"], difficulties: ["hard"] }), BOTH, status)), [4, 7]);
  assert.deepEqual(ids(filterPool(POOL, normalizeFilters({ status: ["unanswered", "incorrect"], domains: ["Algebra"] }), BOTH, status)), [1, 2]);
});

test("filters parse from URL parameters and drop unknown values", () => {
  const f = filtersFromParams(new URLSearchParams("subjects=math,science&difficulties=Hard,impossible&status=incorrect,maybe"));
  assert.deepEqual(f.subjects, ["math"]);
  assert.deepEqual(f.difficulties, ["hard"]);
  assert.deepEqual(f.status, ["incorrect"]);
});

test("session order is stable and reproducible", () => {
  const order = ["Algebra", "Advanced Math", "Geometry and Trigonometry", "Information and Ideas", "Craft and Structure"];
  const a = stableOrder(POOL, order, {}).map((q) => q.id);
  const b = stableOrder([...POOL].reverse(), order, {}).map((q) => q.id);
  assert.deepEqual(a, b);
  assert.deepEqual(seededShuffle([1, 2, 3, 4, 5, 6], 42), seededShuffle([1, 2, 3, 4, 5, 6], 42));
});

test("answer persistence: newer selections win, a submitted answer is final", () => {
  let e = applySelection(undefined, "A", 10)!;
  assert.equal(e.selected, "A");
  assert.equal(applySelection(e, "B", 9), null, "an older (late-arriving) save is ignored");
  e = applySelection(e, "C", 11)!;
  assert.equal(e.selected, "C");
  const submitted = { ...e, submitted: true, correct: false };
  assert.equal(applySelection(submitted, "D", 12), null, "cannot change a checked answer");
});

test("revisiting a question never grades (or scores) it twice", () => {
  assert.equal(shouldGrade(undefined), true);
  assert.equal(shouldGrade({ selected: "A", seq: 3 }), true);
  assert.equal(shouldGrade({ selected: "A", submitted: true, correct: true }), false);
});
