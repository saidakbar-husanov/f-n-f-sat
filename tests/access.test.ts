// Subject access: presets, overrides, conflicts and enforcement helpers.
import { test } from "node:test";
import assert from "node:assert/strict";
import { presetRules, normalizeRules, resolveAccess, allows, allowedSubjects, libraryAllowed, sameRules, describePreset } from "../netlify/lib/access-core.ts";

test("missing settings mean full access (existing students keep everything)", () => {
  const r = resolveAccess({ user: null, classes: [], snapshot: null });
  assert.equal(r.source, "default");
  assert.deepEqual(allowedSubjects(r.rules, "bank"), ["math", "ebrw"]);
  assert.equal(libraryAllowed(r.rules), true);
});

test("English-only preset closes every Math area and keeps the Library", () => {
  const r = presetRules("english");
  for (const a of ["bank", "challenge", "lessons", "rush"] as const) {
    assert.equal(allows(r, "math", a), false, a);
    assert.equal(allows(r, "ebrw", a), true, a);
  }
  assert.equal(libraryAllowed(r), true);
  assert.equal(libraryAllowed(presetRules("math")), false, "Library follows the English master switch");
});

test("a switched-off subject keeps its area choices for restoration", () => {
  const custom = normalizeRules({ math: { enabled: false, bank: true, challenge: false } });
  assert.equal(allows(custom, "math", "bank"), false);
  const restored = normalizeRules({ ...custom, math: { ...custom.math, enabled: true } });
  assert.equal(allows(restored, "math", "bank"), true);
  assert.equal(allows(restored, "math", "challenge"), false, "Math Challenges stays off");
});

test("mixed permissions: Math Question Bank on, Math Challenges off", () => {
  const r = normalizeRules({ math: { challenge: false } });
  assert.equal(allows(r, "math", "bank"), true);
  assert.equal(allows(r, "math", "challenge"), false);
  assert.deepEqual(allowedSubjects(r, "challenge"), ["ebrw"]);
});

test("individual override beats class presets", () => {
  const r = resolveAccess({ user: presetRules("both"), classes: [{ classId: 1, preset: "english", rules: presetRules("english") }], snapshot: null });
  assert.equal(r.source, "user");
  assert.equal(allows(r.rules, "math", "bank"), true);
});

test("students inherit an agreeing class preset", () => {
  const r = resolveAccess({ user: null, classes: [{ classId: 1, preset: "english", rules: presetRules("english") }, { classId: 2, preset: "english", rules: presetRules("english") }], snapshot: null });
  assert.equal(r.source, "class");
  assert.equal(allows(r.rules, "math", "bank"), false);
});

test("conflicting classes are flagged and keep the student's current access", () => {
  const before = presetRules("english");
  const r = resolveAccess({ user: null, classes: [{ classId: 1, preset: "english", rules: presetRules("english") }, { classId: 2, preset: "math", rules: presetRules("math") }], snapshot: before });
  assert.equal(r.source, "conflict");
  assert.ok(r.conflict);
  assert.equal(r.conflict!.keptFrom, "snapshot");
  assert.ok(sameRules(r.rules, before), "current access preserved");
});

test("settings with the same effect do not conflict", () => {
  const a = presetRules("english");
  const b = normalizeRules({ math: { enabled: false, bank: false } });
  assert.ok(sameRules(a, b));
  const r = resolveAccess({ user: null, classes: [{ classId: 1, preset: "english", rules: a }, { classId: 2, preset: "custom", rules: b }], snapshot: null });
  assert.equal(r.source, "class");
  assert.equal(describePreset(r.rules), "english");
});

test("unknown subjects are never allowed", () => {
  assert.equal(allows(presetRules("both"), "science", "bank"), false);
});
