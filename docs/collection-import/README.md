# Question collection JSON (Question Bank domains and Challenging Questions sets)

One file fills one collection. Every file states where it goes in its
`destination`. The platform never guesses the destination from the file name or
from difficulty labels.

| `destination.type` | One file creates or updates | Students see it in |
|---|---|---|
| `questionBankDomain` | A batch of questions for one domain, e.g. Math → Algebra | Question Bank → section → domain |
| `challengeSet` | One named set, e.g. "Reading Inference Challenge" | Challenging Questions → section → set |
| *(full-length test)* | One test with its sections, modules and timing | Full-Length Tests. Use the existing test format in [`../test-import/`](../test-import/README.md) and import it from **Full-Length Tests** |

Templates you can copy and fill in:

- [`question-bank-domain-template.json`](question-bank-domain-template.json): Math → Algebra, with a Markdown table, a grid-in and image answer choices.
- [`challenge-set-template.json`](challenge-set-template.json): a Reading and Writing set mixing three domains, with a Markdown table.

## Where to upload

- **Domain batch:** `/admin` → **All Questions** (or `/mentor` → **All Questions**) → **Import JSON**. The dialog preselects the section and domain from the list filter, and you can change them in the dialog.
- **Challenging set:** `/admin` or `/mentor` → **Challenging Questions** → **Import JSON (new set)** for the section, or **Import JSON** on an existing set's row.

Before anything is saved, the dialog shows:

- the full destination;
- the number of questions;
- how many are new, changed or unchanged.

If the file declares a different section, domain or set from the one selected, the dialog lists each difference. Nothing is imported until they match. You can switch to the file's destination with one click, or fix the file.

## File shape

```jsonc
{
  "formatVersion": "1.0",
  "destination": {
    "type": "questionBankDomain",          // or "challengeSet"
    "section": "math",                     // "math" | "ebrw" (Reading and Writing)
    "domain": "Algebra"                    // questionBankDomain only
    // challengeSet only:
    // "setId": "rw-inference-challenge",  // stable id: 2–80 of a–z 0–9 . _ -
    // "title": "Reading Inference Challenge",
    // "description": "optional"
  },
  "assets": [ { "id": "graph_a", "fileName": "graph_a.png", "mimeType": "image/png", "alt": "…", "data": "<base64>" } ],
  "questions": [ { … } ]
}
```

**Domains** (exact names; case, punctuation and spacing are ignored, so `Problem-Solving and Data Analysis` matches):

- `math`: `Algebra`, `Advanced Math`, `Problem Solving and Data Analysis`, `Geometry and Trigonometry`
- `ebrw`: `Information and Ideas`, `Craft and Structure`, `Expression of Ideas`, `Standard English Conventions`

### Question fields

These are the same fields as in a full-length test question.

| Field | Required | Notes |
|---|---|---|
| `id` | yes | Stable and unique within the file, using letters, digits and `. _ : -`. Re-importing matches questions by this id **within the destination collection only**. |
| `section` | optional | If present, `math` / `ebrw` (or `Math` / `Reading and Writing`) and it must equal `destination.section`. |
| `domain` | challenging sets: yes. Domain files: optional | In a domain file it must equal `destination.domain`. In a set it may be any domain of the set's section. |
| `skill` | required* | The SAT skill, e.g. `Linear functions` or `Inferences`. Must be one of the skills of the question's domain (case, punctuation and spacing are ignored; [confirmed legacy spellings](#legacy-tags-and-flags) are mapped). *May be omitted when a batch default skill is chosen in the Import JSON dialog. |
| `difficulty` | required* | `Easy` · `Medium` · `Hard` (legacy `1`–`5` also accepted). *May be omitted when a batch difficulty is chosen in the dialog; any other value is rejected. |
| `questionType` | yes | `MCQ` (2–4 options, ids `A`–`D` in order) or `SPR` (student-produced response) |
| `passageText` | optional | Markdown: paragraphs, **bold**, *italic*, lists, pipe tables, `![alt](asset:ID)` or `![alt](data:image/png;base64,…)` |
| `questionPrompt` | yes* | Same Markdown. `$…$` is inline math. *A passage or image alone is also accepted. |
| `image` | optional | Question figure: `"asset:ID"`, a data URI, or `{ "assetId": "ID" }` |
| `options` | MCQ | `[{ "id": "A", "text": "…", "image": "asset:ID" }]`. Text, an image, or both. |
| `correctAnswer` | yes | MCQ: the option id. SPR: the answer as typed, e.g. `14` or `3/4` (7 characters at most). |
| `acceptableAnswers` | SPR, optional | Other forms that also score, e.g. `["14.00"]` |
| `explanation` | recommended | Markdown, shown after the student checks the answer |

Images may be PNG, JPEG, GIF, WebP or SVG, up to 3 MB each. Identical images are stored once.

## Safety rules

- **The whole file is checked before anything is written.** Each problem is reported with the question and field it belongs to, e.g. `Q3 (id "alg-linear-003") / option B — image asset "graph_b" is missing`. Examples are a missing asset, an id used twice in the file, an invalid answer and a domain mismatch. A failed import saves nothing.
- **Re-uploading the same file creates no duplicates.** The preview reports every question as unchanged.
- **Changes apply only after you confirm.** A changed question is replaced by the file's version when you confirm the preview. If the file or the collection changes after the preview, you are asked to review again.
- **Other collections are never touched.** A question in another domain, set or test with the same `id` stays as it is. Questions already in a set but missing from the file are kept.
- **Challenging set questions stay in their set.** They never appear in the Question Bank, Question Rush, test builders or assignment pickers.
- **Permissions:** only admins and mentors can import. A mentor can update only the sets they created, and only admins can delete a set. Students can browse sets, practise and save their own progress.

## Batch defaults and corrections

The Import JSON dialog offers a **Skill** (Question Bank domains only) and a **Difficulty** default for the whole
file. Precedence for each question is: a correction picked in the preview table → the question's own `skill` /
`difficulty` → the batch default. A question that still has no valid skill for its domain, or no difficulty, is
listed as invalid and nothing is imported until it is fixed. **Download Sample JSON** generates a file in this
exact format for the current selections, and **Download validation report** saves the preview's errors and
warnings as text.

## Preview summary

The preview groups the questions by **subject → domain → skill**, using the canonical names that will be
stored. Each subject, domain and skill row shows its total and how many questions are new, changed, unchanged
and invalid (blocked). Tags outside the taxonomy are marked "not in the taxonomy".

## Legacy tags and flags

Tags are compared after lowercasing and replacing punctuation and spacing (`Form, Structure, and Sense` is
`Form, structure, and sense`). On top of that, these confirmed legacy spellings are mapped. The list is kept in
`netlify/lib/taxonomy.ts`. Each mapping is listed in the preview as a notice, e.g.
`q-17 · skill: "Cross-Text Connections" → "Cross-text connection"`, so you see exactly what will be stored.

| Legacy domain | Stored as |
|---|---|
| `PSDA`, `Problem-Solving and Data Analysis` | Problem Solving and Data Analysis |
| `SEC`, `Standard English`, `Conventions` | Standard English Conventions |
| `Geometry and Trig`, `Geometry` | Geometry and Trigonometry |

| Domain | Legacy skill | Stored as |
|---|---|---|
| Craft and Structure | `Cross-Text Connections` | Cross-text connection |
| Information and Ideas | `Command of Evidence (Textual)`, `Command of Evidence (Quantitative)` | Command of evidence |
| Information and Ideas | `Central Idea and Details` | Central ideas and details |
| Information and Ideas | `Inference` | Inferences |
| Standard English Conventions | `Sentence Boundaries`, `Boundary` | Boundaries |
| Standard English Conventions | `Form Structure Sense` | Form, structure, and sense |
| Advanced Math | `Nonlinear equations in one variable`, `Systems of equations in two variables`, `Nonlinear equations and systems` | Nonlinear equations in one variable and systems of equations in two variables |
| Algebra | `Systems of linear equations` | Systems of two linear equations in two variables |
| Algebra | `Linear inequalities` | Linear inequalities in one or two variables |
| Problem Solving and Data Analysis | `Ratios rates proportional relationships and units` | Ratios, rates, proportional relationships, and units |
| Problem Solving and Data Analysis | `Percentage` | Percentages |
| Problem Solving and Data Analysis | `Probability` | Probability and conditional probability |

A skill alias applies only within its domain, and a domain alias only within its section.

Some legacy tags cover several skills, so they are never mapped automatically: `Linear Equations and Functions`,
`Nonlinear Equations and Functions`, `Quantitative Reasoning`, and `Geometry and Trigonometry` used as a skill.

Anything that cannot be mapped safely is **flagged** by question id and field. The preview returns each flag as
`{ questionId, field, value, problem, message, suggestion? }` and shows them in a table:

| `field` | `problem` | When |
|---|---|---|
| `section` | `mismatch` / `unknown` | The question's `section` is not the destination section, or is not a section at all |
| `domain` | `mismatch` | The domain is a different domain from the destination (domain files), or belongs to the other section |
| `domain` | `unknown` / `missing` | Not a SAT domain, or missing in a challenging set |
| `skill` | `incompatible` | A real skill that belongs to another domain, e.g. `Circles` in an Algebra file. The suggestion names its domain |
| `skill` | `ambiguous` | A legacy tag that spans several skills (see above) |
| `skill` | `unknown` / `missing` | Not a skill of the domain (a close match is suggested when there is one), or no skill and no batch default |
| `difficulty` | `invalid` / `missing` | Not Easy / Medium / Hard / 1–5, or missing with no batch difficulty |

A flagged question blocks the import. Correct it in the file, or with the **Skill** / **Difficulty** selects in the
preview's question table. In a challenging set there is also a **Domain** select. The preview is then checked again.
Section and domain-file mismatches must be fixed in the file. The import endpoint runs the same checks again on
the server and saves nothing while any question is flagged.

## Exporting (Download)

The **Download** button on All Questions and on each Challenging Questions set produces files in this format
(`GET /api/export?scope=bank|challenge&format=json&solutions=1`, admins and mentors only):

- **Challenging set:** one `challengeSet` document, importable as downloaded.
- **Question Bank, one domain:** one `questionBankDomain` document, importable as downloaded.
- **Question Bank, several domains (or a domain over 500 questions):** a bundle
  `{ "format": "fnf-sat-export", "version": "1.0", "kind": "questionBankBundle", "files": [ … ] }`.
  Each entry of `files` is a complete document; save it as its own file (`export.fileName`) and import it.

Question ids are the stored `id` (or `q-<database id>` for questions that never had one), domains and skills use
the canonical taxonomy names, and images stay `/api/question-media/…` references, which this platform's importer
accepts. Every export carries an `export` block with `"solutions"`; a file exported without answer keys
(`"solutions": false`) is for reading only and is not importable.
