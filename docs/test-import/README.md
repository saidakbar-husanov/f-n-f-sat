# Full-length test import format (v2.0)

An administrator imports a complete SAT practice test by uploading **one JSON
file** on **Full-Length Tests → Import a full-length test**. The file holds
everything: sections, modules, passages, questions, answer choices, tables,
images, answer keys and explanations. You never upload images separately and
never repair individual questions after import.

| File | Purpose |
|---|---|
| [`sat-test-import.schema.json`](./sat-test-import.schema.json) | JSON Schema (draft 2020-12) for the format. You can also fetch it from `GET /api/tests/import/schema`. |
| [`example-test.json`](./example-test.json) | A small valid test with real embedded PNGs, a Markdown table, an image used by two questions, image answer choices and a grid-in question. The importer's **Example JSON** button downloads it. |

## How an import works

1. **Upload.** Choose one `.json` file. The server checks the structure,
   required fields, IDs, answer keys and every image reference. It decodes
   each embedded image, verifies it and stores it in the same question-media
   store that the question editor's **Upload image** button uses.
2. **Review.** A summary lists the sections, modules, questions (MCQ / SPR),
   tables and images. Each error gives the module, question and field, for
   example `Math / Module 2 / Q8 / option C — image asset "graph_08" is missing`.
   While a file has errors you cannot save it, and nothing is written.
3. **Save as draft.** The test is written in a single database transaction.
   A failure part-way through leaves nothing behind and never touches any
   other test.
4. **Preview.** The draft opens in an admin preview. It draws every question
   with the same renderer as the student test, and adds the answer key and
   explanation, which only admins and mentors see.
5. **Publish.** **Publish to students** checks the test again: every module
   has questions, every answer key matches its choices, every stored image
   exists, and adaptive routing is valid. If all checks pass, the test goes
   live.

**Re-uploading** never overwrites a test and never silently duplicates one:

- If the file has exactly the same content as one you already imported, it is reported as a
  duplicate, with a link to the existing test.
- If another test already has the same `testId`, that is reported too.
- In both cases you can cancel, or explicitly save the file as a separate
  draft copy (`<testId>-copy-2`). The existing test stays untouched.

## File structure

```jsonc
{
  "formatVersion": "2.0",
  "testId": "dsat-2026-11",              // stable, unique per test
  "title": "November 2026 SAT Practice Test",
  "description": "Optional",
  "isAdaptive": false,                   // fixed-form unless you supply Module 2 variants
  "breakMinutes": 10,                    // between Reading and Writing and Math
  "assets": [                            // every image, embedded once
    { "id": "graph_08", "mimeType": "image/png", "alt": "Scatterplot of …", "data": "iVBORw0KGgo…" }
  ],
  "modules": [                           // in the order students take them
    {
      "moduleId": "rw_module_1",         // unique in the file
      "section": "Reading and Writing",  // or "Math"
      "moduleNumber": 1,
      "timeLimitMinutes": 32,
      "difficultyTrack": "Baseline",
      "questions": [                     // in the order students see them
        {
          "id": "rw-m1-q01",             // unique in the whole file
          "questionNumber": 1,           // = position in the module
          "questionType": "MCQ",         // or "SPR"
          "domain": "Information and Ideas",
          "skill": "Command of Evidence",
          "difficulty": "Medium",        // Easy | Medium | Hard
          "passageText": "…Markdown…",
          "questionPrompt": "…Markdown…",
          "options": [ { "id": "A", "text": "…" }, { "id": "B", "text": "…" }, { "id": "C", "text": "…" }, { "id": "D", "text": "…" } ],
          "correctAnswer": "B",
          "explanation": "…Markdown…"
        }
      ]
    }
  ]
}
```

Required: `testId`, `title`, `modules`. Each module needs `moduleId`,
`section`, `moduleNumber`, `timeLimitMinutes` and `questions`. Each question
needs `id`, `questionType`, `questionPrompt` and `correctAnswer`. A
multiple-choice question also needs 2–4 `options`.

### Answers and scoring

- **MCQ:** list the options in order `A`, `B`, `C`, `D`. Their order and IDs
  are kept exactly. `correctAnswer` is the option ID.
- **SPR (student-produced response):** `correctAnswer` is the answer as a
  student would type it, e.g. `"36.75"`, `"3/4"` or `"-12"`.
  `acceptableAnswers` lists other accepted forms. Equivalent fractions and
  decimals already match, so `"3/4"` also accepts `"0.75"`. The student answer
  box holds 7 characters, so at least one accepted form must fit.
- Scores use the platform's existing grading. Section scores are scaled to
  200–800.

### Fixed-form and adaptive tests

A test is **fixed-form** unless `isAdaptive` is `true`. In a fixed-form test
every student takes every module in file order, so give each module its own
`section` + `moduleNumber`.

For an **adaptive** test, give each routed section a Module 1 and two or
three Module 2 variants. The variants use the same `section` and
`moduleNumber: 2`, and each has a different `difficultyTrack` (`"Easy"`,
`"Standard"`, `"Hard"`). A student who scores at least **60%** on Module 1
goes to the Hard (or Standard) variant; everyone else goes to Easy (or
Standard). A `routing` object is optional. The only threshold it can state is
`{ "threshold": 0.6 }`, and anything else is reported as an error before you
can save. If a file asks for adaptive routing without the variants it needs,
the review lists what is missing. You can then untick **Adaptive** to import
the test as fixed-form.

### Vocabulary (optional)

A file may carry SAT vocabulary in a top-level `vocabulary` array, and any
question may carry its own `vocabulary` array. Each entry uses the same fields
as a vocabulary upload — `word` and `definition` are required; `id`,
`partOfSpeech`, `satContextSentence` (with `_____` where the word fits),
`distractors`, `synonyms`, `antonyms`, `difficulty` (`Foundation`, `Medium`,
`Advanced`) and `tags` are optional.

The words are added to the shared vocabulary bank when an admin or mentor
saves the test (previewing writes nothing). A word already in the bank is
updated in place; a mentor only updates words they created, and other
authors' words are left exactly as they are. Students can read and practise
the words but cannot add, edit, delete or import them.

```json
"vocabulary": [
  { "id": "vocab-ubiquitous", "word": "ubiquitous", "partOfSpeech": "adjective",
    "definition": "present or found everywhere",
    "satContextSentence": "Smartphones have become _____ in modern classrooms.",
    "difficulty": "Medium", "tags": ["test:dsat-2026-11"] }
]
```

## Text: Markdown, HTML and math

`passageText`, `questionPrompt`, option `text` and `explanation` accept plain
text, Markdown or HTML. Line breaks are preserved: a single newline becomes a
line break and a blank line starts a new paragraph.

| Markdown | Result |
|---|---|
| `**bold**`, `*italic*`, `<u>underline</u>`, `<sub>`, `<sup>` | inline formatting |
| `- item` / `1. item` | bulleted / numbered list (e.g. "notes" questions) |
| `> quoted line` | block quote |
| `# Heading` | heading |
| pipe table, see below | a real table with header and data cells |
| `![alt text](asset:ID)` | an image from `assets`, at that exact position |
| `![alt text](data:image/png;base64,…)` | an inline embedded image (September-style) |
| `$x^2$`, `$$\frac{a}{b}$$` | LaTeX math (`$5 and $10` are left as prices) |

A table needs a header row, a separator row of dashes, and data rows. A title
written on the line above stays above the table, and text after a blank line
stays below it. Use `---:` to right-align a column and `:---:` to centre it.
Inside a cell, write `\|` for a literal pipe. `|` inside math such as `$|x|$`
is safe. Wide tables scroll sideways on small screens.

```markdown
**Airline Performance, 2023**
| Airline | Flights | On-time (%) |
|---|---:|---:|
| Skyway | 1,240 | 84 |

The researcher concluded that …
```

## Images

Put each image **once** in the top-level `assets` array:

```json
{ "id": "graph_08", "mimeType": "image/png", "alt": "Line graph of …", "fileName": "graph_08.png", "data": "<base64>" }
```

Then reference it wherever it appears:

- in any text field: `![Line graph of …](asset:graph_08)`;
- as a question figure, shown above the passage, or above the prompt when
  there is no passage: `"image": "asset:graph_08"`;
- as an answer-choice image: `{ "id": "C", "text": "![Graph C: line falling to the right](asset:graph_08)" }`,
  or `{ "id": "C", "text": "", "image": "asset:graph_08" }`.

Images written inline with `![alt](…)`, in any text field including answer
choices, keep their alternative text. The `image` fields use the same graphic
slots as the editor's Upload image button, and those slots show the
platform's generic alt text ("Figure for this question", "Answer choice C").
Prefer the inline form whenever the alt text matters.

Any number of questions can reference the same asset, and it is stored once.
Several images in one field keep their order, along with the text between
them. Inline `data:` URIs inside Markdown are also accepted, and identical
images are still stored only once.

**Supported types:** PNG, JPEG, GIF, WebP and SVG (`image/png`, `image/jpeg`,
`image/gif`, `image/webp`, `image/svg+xml`).

**Limits:**

- Each decoded image must be **3 MB** or smaller. This is the same limit as
  the editor's Upload image button.
- The importer reads the first bytes of every image, and they must match its
  declared `mimeType`. Truncated or corrupted data is rejected and the error
  names the field.
- The browser accepts files up to 60 MB. A file over about 4.5 MB sends its
  embedded images ahead one at a time, with the same validation, and then
  sends the text. After its images are taken out, the remaining text must be
  under about 5.6 MB.
- One import can hold up to 400 questions. Each text field can hold up to
  200,000 characters after its images become references.

**Errors:** an image reference that cannot be resolved blocks the import.
Examples are a bare filename like `graph_08.png` with no matching asset
`fileName`, an `asset:` ID that is not in `assets`, or an `http://` link. The
error message explains what to add. You can reference an `https://` image
URL, but the importer warns you about it, because the file is then no longer
self-contained.

## Checklist for test generators

1. Emit `"formatVersion": "2.0"`, a unique `testId` and a `title`.
2. Emit modules in test order. Every `moduleId`, and every question `id`
   across the whole file, must be unique.
3. Use `section` = `"Reading and Writing"` or `"Math"`, plus `moduleNumber`,
   `timeLimitMinutes` (official: 32 RW, 35 Math) and `difficultyTrack`.
4. Number questions `1…n` in array order. The official counts are 27 per
   Reading and Writing module and 22 per Math module. Other counts work, but
   the review notes them.
5. For MCQ, emit exactly the options `A`–`D` in order, with `correctAnswer`
   set to the letter. For grid-ins, emit `questionType: "SPR"`, an empty
   `options` array, `correctAnswer`, and any `acceptableAnswers`.
6. Write tables as Markdown pipe tables, with real newlines (`\n` in the JSON
   string).
7. Base64-encode every image into `assets` with its true `mimeType` and an
   `alt` description, then reference it with `asset:ID`. Never emit a bare
   filename.
8. Include `domain`, `skill`, `difficulty` and an `explanation` for each
   question.
9. Validate the file against `sat-test-import.schema.json` before you upload
   it.

## Legacy fields still accepted

The importer still accepts the September 2026 format: no `formatVersion`,
inline `![alt](data:…)` images and Markdown tables. It also accepts:

- `imageUrl` / `svgData` on a question;
- `table: { title, headers, rows }`;
- `text1` / `text2` and `passages[]`;
- options as an object (`{ "A": "…" }`);
- a flat top-level `questions` array (CSV).
