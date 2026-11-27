// Taxonomy matching, legacy aliases and the question importer's tag checks.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tagKey, resolveDomain, resolveSkill, resolveSection, strictDifficulty, domainsOfSkill, suggestSkill,
  checkQuestionTags, groupBySubject, canonicalTags, TAXONOMY_SKILLS, SKILL_ALIASES, DOMAIN_ALIASES,
} from "../netlify/lib/taxonomy.ts";

const BANK = (domain: string, section: "math" | "ebrw" = "math") => ({ type: "questionBankDomain" as const, section, domain });
const SET = (section: "math" | "ebrw") => ({ type: "challengeSet" as const, section });

test("exact names match", () => {
  assert.deepEqual(resolveDomain("math", "Algebra"), { value: "Algebra", via: "exact" });
  assert.deepEqual(resolveSkill("Algebra", "Linear functions"), { value: "Linear functions", via: "exact" });
});

test("case, punctuation and spacing never decide a match", () => {
  assert.equal(tagKey("  Form, Structure,  and Sense "), "form structure and sense");
  assert.deepEqual(resolveDomain("math", "Problem-Solving and Data Analysis"), { value: "Problem Solving and Data Analysis", via: "exact" });
  assert.deepEqual(resolveDomain("ebrw", "craft AND structure"), { value: "Craft and Structure", via: "exact" });
  assert.deepEqual(resolveSkill("Standard English Conventions", "Form, Structure, and Sense"), { value: "Form, structure, and sense", via: "exact" });
  assert.deepEqual(resolveSkill("Problem Solving and Data Analysis", "One-variable data: distributions and measures of center and spread"),
    { value: "One-variable data: Distributions and measures of center and spread", via: "exact" });
  assert.equal(resolveSkill("Craft and Structure", "Words in Context").value, "Words in context");
});

test("confirmed legacy aliases map onto the taxonomy", () => {
  assert.deepEqual(resolveSkill("Craft and Structure", "Cross-Text Connections"), { value: "Cross-text connection", via: "alias" });
  assert.equal(resolveSkill("Information and Ideas", "Command of Evidence (Quantitative)").value, "Command of evidence");
  assert.equal(resolveSkill("Information and Ideas", "Command of Evidence (Textual)").value, "Command of evidence");
  assert.equal(resolveSkill("Advanced Math", "Nonlinear equations in one variable").value, "Nonlinear equations in one variable and systems of equations in two variables");
  assert.equal(resolveSkill("Advanced Math", "Systems of equations in two variables").value, "Nonlinear equations in one variable and systems of equations in two variables");
  assert.deepEqual(resolveDomain("math", "PSDA"), { value: "Problem Solving and Data Analysis", via: "alias" });
  assert.deepEqual(resolveDomain("ebrw", "SEC"), { value: "Standard English Conventions", via: "alias" });
  // An alias never crosses sections.
  assert.deepEqual(resolveDomain("ebrw", "PSDA"), { value: null, via: null });
  assert.deepEqual(canonicalTags("ebrw", "Craft and Structure", "Cross-Text Connections"), { category: "Craft and Structure", subcategory: "Cross-text connection" });
});

test("every alias points at a real skill / domain of its table", () => {
  for (const [dom, table] of Object.entries(SKILL_ALIASES))
    for (const target of Object.values(table)) assert.ok(TAXONOMY_SKILLS[dom].includes(target), `${dom}: ${target}`);
  for (const target of Object.values(DOMAIN_ALIASES)) assert.ok(TAXONOMY_SKILLS[target], target);
});

test("ambiguous legacy tags are not mapped", () => {
  assert.deepEqual(resolveSkill("Algebra", "Linear Equations and Functions"), { value: null, via: null, ambiguous: true });
  assert.equal(resolveSkill("Advanced Math", "Nonlinear Equations and Functions").ambiguous, true);
  assert.equal(resolveSkill("Problem Solving and Data Analysis", "Quantitative Reasoning").ambiguous, true);
  assert.equal(resolveSkill("Geometry and Trigonometry", "Geometry and Trigonometry").ambiguous, true);
  assert.equal(resolveSkill("Algebra", "Something else").ambiguous, false);
});

test("sections, difficulty and helpers", () => {
  assert.equal(resolveSection("Math").value, "math");
  assert.deepEqual(resolveSection("Reading and Writing"), { value: "ebrw", via: "alias" });
  assert.equal(resolveSection("science").value, null);
  assert.deepEqual(["easy", "3", "HARD", "5", "", "extreme"].map(strictDifficulty), ["Easy", "Medium", "Hard", "Hard", null, "invalid"]);
  assert.deepEqual(domainsOfSkill("Inferences"), ["Information and Ideas"]);
  assert.equal(suggestSkill("Geometry and Trigonometry", "Circle"), "Circles");
});

test("a clean question has no flags; aliases are reported as notices", () => {
  const r = checkQuestionTags({ questionId: "q-17", destination: BANK("Craft and Structure", "ebrw"), section: "ebrw", domain: "Craft and Structure", skill: "Cross-Text Connections", difficulty: "Hard" });
  assert.deepEqual(r.flags, []);
  assert.equal(r.skill, "Cross-text connection");
  assert.equal(r.difficulty, "Hard");
  assert.deepEqual(r.notices.map((n) => n.message), ['q-17 · skill: "Cross-Text Connections" → "Cross-text connection"']);
  assert.equal(r.notices[0].via, "alias");
});

test("batch defaults fill missing skill and difficulty", () => {
  const r = checkQuestionTags({ questionId: "a", destination: BANK("Algebra"), defaultSkill: "Linear functions", defaultDifficulty: "Easy" });
  assert.deepEqual([r.domain, r.skill, r.difficulty, r.flags.length], ["Algebra", "Linear functions", "Easy", 0]);
});

const problems = (r: ReturnType<typeof checkQuestionTags>) => r.flags.map((f) => `${f.field}:${f.problem}`);

test("incompatible: a skill of another domain", () => {
  const r = checkQuestionTags({ questionId: "m1", destination: BANK("Algebra"), skill: "Circles", difficulty: "Easy" });
  assert.deepEqual(problems(r), ["skill:incompatible"]);
  assert.equal(r.flags[0].questionId, "m1");
  assert.equal(r.flags[0].value, "Circles");
  assert.match(r.flags[0].message, /skill of Geometry and Trigonometry, not of Algebra/);
  assert.equal(r.skill, null);
  // In a set, the fix is to change the question's domain.
  const s = checkQuestionTags({ questionId: "s1", destination: SET("ebrw"), domain: "Craft and Structure", skill: "Inferences", difficulty: "Medium" });
  assert.deepEqual(problems(s), ["skill:incompatible"]);
  assert.match(s.flags[0].suggestion!, /domain to "Information and Ideas"/);
});

test("unknown, ambiguous, mismatched and invalid tags are flagged by field", () => {
  const r = checkQuestionTags({ questionId: "x", destination: SET("math"), section: "ebrw", domain: "Algebra", skill: "Linear Equations and Functions", difficulty: "extreme" });
  assert.deepEqual(problems(r), ["section:mismatch", "skill:ambiguous", "difficulty:invalid"]);
  assert.deepEqual(problems(checkQuestionTags({ questionId: "x", destination: SET("math"), domain: "Calculus", skill: "Limits", difficulty: 3 })), ["domain:unknown", "skill:unknown"]);
  assert.deepEqual(problems(checkQuestionTags({ questionId: "x", destination: SET("math"), domain: "Craft and Structure", skill: "Words in context", difficulty: 3 })), ["domain:mismatch"]);
  assert.deepEqual(problems(checkQuestionTags({ questionId: "x", destination: SET("math"), skill: "Circles", difficulty: 3 })), ["domain:missing"]);
  assert.deepEqual(problems(checkQuestionTags({ questionId: "x", destination: BANK("Algebra"), domain: "Advanced Math", skill: "Linear functions", difficulty: 3 })), ["domain:mismatch"]);
  assert.deepEqual(problems(checkQuestionTags({ questionId: "x", destination: BANK("Algebra"), skill: "Lineer functons" })), ["skill:unknown", "difficulty:missing"]);
  const u = checkQuestionTags({ questionId: "x", destination: BANK("Geometry and Trigonometry"), skill: "Circle", difficulty: "Hard" });
  assert.match(u.flags[0].suggestion!, /did you mean "Circles"/);
});

test("a correction (override value) clears the flag", () => {
  const before = checkQuestionTags({ questionId: "x", destination: BANK("Algebra"), skill: "Linear Equations and Functions", difficulty: "Easy" });
  assert.equal(before.flags.length, 1);
  const after = checkQuestionTags({ questionId: "x", destination: BANK("Algebra"), skill: "Linear functions", difficulty: "Easy" });
  assert.deepEqual([after.flags.length, after.skill], [0, "Linear functions"]);
});

test("preview counts group subject → domain → skill in taxonomy order", () => {
  const g = groupBySubject([
    { section: "math", domain: "Geometry and Trigonometry", skill: "Circles", status: "new", valid: true },
    { section: "math", domain: "Algebra", skill: "Linear functions", status: "changed", valid: true },
    { section: "math", domain: "Algebra", skill: "Linear equations in one variable", status: "unchanged", valid: true },
    { section: "math", domain: "Algebra", skill: "Linear functions", status: "new", valid: false },
    { section: "math", domain: "Algebra", skill: "Mystery", status: "new", valid: false },
  ]);
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].label, g[0].total, g[0].new, g[0].changed, g[0].unchanged, g[0].invalid], ["Math", 5, 3, 1, 1, 2]);
  assert.deepEqual(g[0].domains.map((d) => [d.domain, d.total]), [["Algebra", 4], ["Geometry and Trigonometry", 1]]);
  const alg = g[0].domains[0];
  assert.deepEqual(alg.skills.map((s) => [s.skill, s.total, s.known]), [["Linear equations in one variable", 1, true], ["Linear functions", 2, true], ["Mystery", 1, false]]);
  assert.deepEqual([alg.skills[1].new, alg.skills[1].changed, alg.skills[1].invalid], [1, 1, 1]);
});
