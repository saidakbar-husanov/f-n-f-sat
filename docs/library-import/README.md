# Reading Library JSON (`fnf-library`, version 1.0)

Import one article or a batch of articles into the Reading Library, with
paragraphs, images and charts in reading order and an optional comprehension
question.

- Sample file: [`library-sample.json`](library-sample.json). It uses the two images in [`media/`](media/): `tidepool-heron.svg` and `tide-heights.svg`.
- Where to import: `/admin/library` → **Import JSON**. Choose the JSON file, plus any image files it names, then click **Preview**. Nothing is saved until you click **Import**.
- **Download sample JSON** downloads the sample file. **Generate compatible JSON** shows a prompt you can paste into ChatGPT to get a file in this format.

## File shape

```jsonc
{
  "format": "fnf-library",        // optional, but must be exactly this if given
  "version": "1.0",               // optional; any 1.x is accepted
  "articles": [ ARTICLE, ... ]    // 1–100 articles
}
```

You can also send a single `ARTICLE` object at the top level, or a bare array of articles.

### ARTICLE

| Field | Required | Notes |
|---|---|---|
| `id` | yes | A stable id: 1–80 characters from letters, digits, `.`, `-` and `_`. It must start with a letter or digit. Re-importing the same id updates the same piece and never creates a duplicate. Each id may appear only once per file. |
| `title` | yes | Up to 200 characters. |
| `topic` | no | Up to 80 characters, e.g. `Science`. |
| `excerpt` | no | Card preview, up to 400 characters. If you leave it out, the first 220 characters of the text are used. |
| `status` | no | `"draft"` or `"published"`. If you leave it out, a new piece is created as a **draft** and an existing piece keeps its current status. |
| `blocks` | yes* | The content, in reading order. Up to 200 blocks (see below). |
| `body` | yes* | Plain text, with a blank line between paragraphs. Use this instead of `blocks` for a text-only piece. |
| `question` | no | The comprehension question (see below). |

\* Give either `blocks` or `body`.

All text is plain text, because HTML and Markdown are not interpreted. Control characters are removed. When a piece has blocks, its searchable text, excerpt and word count come from the paragraph blocks.

### Blocks

```jsonc
{ "type": "paragraph", "text": "Plain text. A single newline becomes a line break." }

{ "type": "image", "media": "heron.png", "alt": "Required description",
  "caption": "optional", "source": "optional attribution" }

{ "type": "chart", "chart": {
    "kind": "bar",                      // "bar" | "line"
    "title": "optional", "xLabel": "optional", "yLabel": "optional",
    "labels": ["Jan", "Feb", "Mar"],    // 1–60 labels, each up to 60 characters
    "series": [                         // 1–6 series
      { "name": "2024", "values": [12, 18.5, null] }   // exactly one value per label; null = no data
    ] },
  "alt": "optional summary", "caption": "optional", "source": "optional" }

{ "type": "chart", "media": "chart.png", "alt": "Required description",
  "caption": "optional", "source": "optional" }
```

- **`media`** can be any of the following:
  - the **file name** of an image you upload in the same import dialog. Names are matched case-insensitively, ignoring any folder.
  - an image already stored on the platform (`/api/question-media/…`).
  - an `https://` URL.

  Other URL schemes are rejected. Images can be PNG, JPEG, GIF, WebP or SVG, up to 3 MB each.
- On a re-import you don't need to upload a file again if the existing piece already uses an image with the same file name.
- `alt` is **required** for images and chart images. For a data chart it is optional: without it, screen readers hear the chart type and title, followed by the data table.
- A chart block has either `chart` (data) or `media` (image), never both.
- A line chart needs at least two labels. Values must be JSON numbers. Numeric strings such as `"12.5"` are also accepted. Don't use units or thousands separators.
- Data charts are drawn as accessible inline SVG, with a hidden data table for screen readers. The same renderer draws the editor preview and the student view.

### Question

```jsonc
"question": {
  "prompt": "Which choice best …?",
  "choices": { "A": "…", "B": "…", "C": "…", "D": "…" },   // 2–4 choices; an array is also accepted
  "answer": "B",
  "explanation": "Why B is right.",
  "support": "A sentence quoted exactly from the text."   // optional; highlighted after answering
}
```

## Preview and import rules

The preview checks the whole file and lists each article by `id` with one of these outcomes:

| Outcome | Meaning |
|---|---|
| **New** | No piece has this id yet. Importing creates it as a draft, or as published if `status` says so. |
| **Update** | A **draft** piece with this id exists, and the content differs. |
| **Unchanged** | The stored piece already matches. Importing skips it. |
| **Published — not overwritten** | A **published** piece with this id exists. Importing skips it unless you tick *Overwrite this published piece* for that article. |
| **Has problems** | The article has errors or missing media. Importing skips it. |

Errors and warnings point at the field that caused them, for example
`articles[2].blocks[3].alt: alt text is required for images`. **Missing media**
lists every `media` file name that was not uploaded and is not already stored for
that piece.

When you click Import, the selected media files are uploaded first. The server
then checks the whole file again before it writes anything. Only articles shown
as **New** or **Update**, plus any published pieces you ticked, are written.
