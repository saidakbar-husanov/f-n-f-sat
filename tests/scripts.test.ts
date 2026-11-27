// Every page script shares one global scope. A top-level `const`/`let`/`class`
// declared twice (in two files, or in a file and the inline app script) makes
// the browser reject the later script with "Identifier … has already been
// declared", so the app never boots — which is what took /admin down.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";

const root = path.resolve(import.meta.dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

function pageScripts(): { name: string; code: string }[] {
  const out: { name: string; code: string }[] = [];
  const re = /<script(?:\s+src="\/([^"]+)")?[^>]*>([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  let inline = 0;
  while ((m = re.exec(html))) {
    if (m[1]) {
      const file = path.join(root, m[1]);
      if (fs.existsSync(file)) out.push({ name: m[1], code: fs.readFileSync(file, "utf8") });
    } else if (m[2].trim() && !/^\s*\{/.test(m[2])) {
      out.push({ name: `index.html inline #${++inline}`, code: m[2] });
    }
  }
  return out;
}

test("page scripts load into one realm without duplicate global declarations", () => {
  const scripts = pageScripts();
  assert.ok(scripts.some((s) => s.name === "workspace.js"), "workspace.js is loaded by index.html");
  const ctx = vm.createContext({});
  for (const s of scripts) {
    // Compile errors (syntax, redeclared globals) are what we check; runtime
    // errors from missing browser APIs in this bare realm are expected.
    try {
      new vm.Script(s.code, { filename: s.name }).runInContext(ctx);
    } catch (e: any) {
      if (e?.name === "SyntaxError" || /already been declared/.test(String(e?.message)))
        assert.fail(`${s.name}: ${e.message}`);
    }
  }
});
