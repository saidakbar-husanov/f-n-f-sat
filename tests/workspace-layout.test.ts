// Guards the desktop question-workspace layout and the elimination toolbar.
// The split workspace once grew to its content height on Chrome/Edge because
// `.bb-work` kept `flex:1` (basis 0%) inside an indefinite-height flex column,
// which makes the browser ignore `height` — the page scrolled instead of the
// panes. These checks keep the fix (and the viewport-fit layout) in place.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

test("inline workspaces are sized by their height, not by flex", () => {
  assert.match(read("workspace.css"), /\.bb\.bb-inline>\.bb-work\{flex:0 0 auto\}/);
});

test("desktop question screens fit the viewport and only the panes scroll", () => {
  const css = read("workspace.css");
  assert.match(css, /body\.qw-wide \.main\{[^}]*height:100dvh[^}]*overflow:hidden/);
  assert.match(css, /body\.qw-wide \.q-shell\.pq>\.pq-work>\.bb-work\{flex:1 1 0;min-height:0/);
});

test("elimination controls are hidden until the ABC toggle is on", () => {
  const css = read("qtools.css");
  assert.match(css, /\.bb-work:not\(\.qa-elim-on\) \.bb-opt>\.qa-strike\{display:none\}/);
  const tools = read("qtools.js");
  assert.match(tools, /Enable"\} answer elimination/);
  assert.match(tools, /function QA_elimMode\(/);
});
