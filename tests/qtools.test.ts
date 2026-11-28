// Question navigator logic (qtools.js): difficulty bands, answer-status
// counts, completion / accuracy, combined filters and "next …" navigation.
// Loads the real browser script into a bare realm with minimal stubs.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const noop = () => {};
const store = new Map<string, string>();
const ctx: any = vm.createContext({
  document: { addEventListener: noop, body: { classList: { contains: () => false, toggle: noop } }, querySelectorAll: () => [], getElementById: () => null },
  window: { addEventListener: noop, dispatchEvent: noop },
  MutationObserver: class { observe() {} },
  requestAnimationFrame: noop, matchMedia: () => ({ matches: false }), Event: class {},
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  state: { user: { key: "u1", role: "student" } },
  esc: (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`),
  svg: () => "", toast: noop,
});
vm.runInContext(fs.readFileSync(path.join(root, "qtools.js"), "utf8") + "\n;globalThis.__qt={qnBand,qnCounts,qnMatches,qnNext,qnSummaryHTML,qnGridHTML,qnFiltersHTML,qaGet,qaPut,qtShellClass,QT_setSide,qnDiffText};", ctx);
const Q = ctx.__qt;

const cells = [
  { i: 0, status: "correct", diff: 1, flagged: false, cur: false },
  { i: 1, status: "incorrect", diff: 5, flagged: true, cur: true },
  { i: 2, status: "unanswered", diff: 3, flagged: false, cur: false },
  { i: 3, status: "pending", diff: null, flagged: true, cur: false },
  { i: 4, status: "incorrect", diff: 4, flagged: false, cur: false },
  { i: 5, status: "unanswered", diff: 2, flagged: false, cur: false },
];

test("difficulty uses the stored 1–5 scale and the platform's bands", () => {
  assert.deepEqual([1, 2, 3, 4, 5, null, undefined, ""].map(Q.qnBand), ["easy", "easy", "medium", "hard", "hard", "none", "none", "none"]);
  assert.equal(Q.qnDiffText(5), "Hard (level 5 of 5)");
  assert.equal(Q.qnDiffText(null), "Difficulty not set");
});

test("counts keep review flags independent of answers", () => {
  const c = Q.qnCounts(cells);
  assert.equal(c.total, 6); assert.equal(c.correct, 1); assert.equal(c.incorrect, 2); assert.equal(c.pending, 1);
  assert.equal(c.unanswered, 2); assert.equal(c.flagged, 2); assert.equal(c.done, 4); assert.equal(c.graded, 3);
});

test("accuracy uses graded answers only; zero graded shows a neutral state", () => {
  const html = Q.qnSummaryHTML(cells, { correctness: true });
  assert.match(html, /<b>67%<\/b>Complete/); // 4 of 6 answered
  assert.match(html, /<b>33%<\/b>Accuracy/); // 1 of 3 graded (pending excluded)
  const none = Q.qnSummaryHTML([{ i: 0, status: "pending", diff: 3, flagged: false, cur: true }], { correctness: true });
  assert.match(none, /<b>—<\/b>Accuracy/);
});

test("a sitting never shows correctness", () => {
  const live = cells.map((x) => ({ ...x, status: x.status === "unanswered" ? "unanswered" : "answered" }));
  const html = Q.qnSummaryHTML(live, { correctness: false }) + Q.qnFiltersHTML(live, { st: "all", df: "all" }, { correctness: false, showDiff: false }, "f") + Q.qnGridHTML(live, { st: "all", df: "all" }, { correctness: false, showDiff: false }, "j");
  assert.doesNotMatch(html, /Correct|Incorrect|Accuracy|qn-diff|Difficulty/);
});

test("status and difficulty filters combine and keep original numbering", () => {
  const m = (f: any) => cells.filter((x) => Q.qnMatches(x, f)).map((x) => x.i + 1);
  assert.deepEqual(m({ st: "incorrect", df: "hard" }), [2, 5]);
  assert.deepEqual(m({ st: "unanswered", df: "medium" }), [3]);
  assert.deepEqual(m({ st: "flagged", df: "all" }), [2, 4]);
  assert.deepEqual(m({ st: "answered", df: "all" }), [1, 2, 4, 5]);
  assert.deepEqual(m({ st: "all", df: "none" }), [4]);
  assert.match(Q.qnGridHTML(cells, { st: "correct", df: "hard" }, { correctness: true, showDiff: true }, "j"), /No questions match/);
  const grid = Q.qnGridHTML(cells, { st: "incorrect", df: "all" }, { correctness: true, showDiff: true }, "j");
  assert.match(grid, />5<\/span>/);
});

test("next unanswered / incorrect / flagged wraps around from the current question", () => {
  assert.equal(Q.qnNext(cells, 1, "unanswered"), 2);
  assert.equal(Q.qnNext(cells, 2, "unanswered"), 5);
  assert.equal(Q.qnNext(cells, 4, "incorrect"), 1);
  assert.equal(Q.qnNext(cells, 3, "flagged"), 1);
  assert.equal(Q.qnNext(cells.map((x) => ({ ...x, flagged: false })), 0, "flagged"), -1);
});

test("a hard, incorrect, flagged question shows every indicator at once", () => {
  const html = Q.qnGridHTML([cells[1]], { st: "all", df: "all" }, { correctness: true, showDiff: true }, "j");
  for (const part of ["st-incorrect", "d-hard", "qn-flag", "cur", "bb-pin"]) assert.ok(html.includes(part), part);
});

test("annotations are stored per user, context and question, apart from content", () => {
  Q.qaPut("ps7", 42, { hl: [{ id: "a", field: "passage", startOffset: 0, endOffset: 4, quote: "Some", color: "green" }], el: ["B"] });
  assert.equal(Q.qaGet("ps7", 42).el.join(), "B");
  assert.equal(Q.qaGet("ps8", 42).el.length, 0);
  assert.ok(store.has("fnf_qa_u1_ps7"));
  Q.qaPut("mem:review", 42, { hl: [], el: ["A"] });
  assert.ok(![...store.keys()].some((k) => k.includes("mem:")), "previews stay in memory");
  Q.qaPut("ps7", 42, { hl: [], el: [] });
  assert.ok(!store.has("fnf_qa_u1_ps7"));
});

test("sidebar preference is remembered per user and role", () => {
  Q.QT_setSide("compact");
  assert.equal(store.get("fnf_side_u1_student"), "compact");
  assert.match(Q.qtShellClass(), /side-compact/);
});
