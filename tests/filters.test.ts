// Regression: skill names containing commas ("Form, structure, and sense")
// were split by the comma-joined filter query, and legacy tag spellings were
// not unified, so the displayed count and the practice set disagreed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { filtersFromParams, filterPool, normalizeFilters } from "../netlify/lib/practice-core.ts";
import { canonicalTags } from "../netlify/lib/taxonomy.ts";

test("JSON filter param keeps comma-containing skill names intact", () => {
  const f = filtersFromParams(new URLSearchParams({ f: JSON.stringify({ skills: ["Form, structure, and sense", "Boundaries"] }) }));
  assert.deepEqual(f.skills, ["Form, structure, and sense", "Boundaries"]);
});
test("repeated plain params also keep names whole", () => {
  const p = new URLSearchParams(); p.append("skills", "Form, structure, and sense"); p.append("subjects", "ebrw,math");
  const f = filtersFromParams(p);
  assert.deepEqual(f.skills, ["Form, structure, and sense"]);
  assert.deepEqual(f.subjects, ["ebrw", "math"]);
});
test("legacy spellings map to canonical tags", () => {
  assert.equal(canonicalTags("ebrw", "Craft and Structure", "Cross-Text Connections").subcategory, "Cross-text connection");
  assert.equal(canonicalTags("math", "Problem-Solving and Data Analysis", "Percentages").category, "Problem Solving and Data Analysis");
  assert.equal(canonicalTags("ebrw", "Standard English Conventions", "Form, Structure, and Sense").subcategory, "Form, structure, and sense");
});
test("count and set use one rule: OR within, AND across, empty = no restriction; Boundaries with no records is a real zero", () => {
  const pool = [
    { id: 1, section: "ebrw", category: "Standard English Conventions", subcategory: "Form, structure, and sense", difficulty: 2 },
    { id: 2, section: "ebrw", category: "Standard English Conventions", subcategory: "Form, structure, and sense", difficulty: 4 },
    { id: 3, section: "math", category: "Algebra", subcategory: "Linear functions", difficulty: 3 },
  ];
  const all = ["math", "ebrw"];
  assert.equal(filterPool(pool, normalizeFilters({ skills: ["Boundaries"] }), all).length, 0);
  assert.equal(filterPool(pool, normalizeFilters({ skills: ["Boundaries", "Form, structure, and sense"] }), all).length, 2);
  assert.equal(filterPool(pool, normalizeFilters({ skills: ["Form, structure, and sense"], difficulties: ["hard"] }), all).length, 1);
  assert.equal(filterPool(pool, normalizeFilters({}), all).length, 3);
});
