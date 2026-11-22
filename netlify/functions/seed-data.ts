// netlify/functions/seed-data.ts — starter content for a fresh database.
// Realistic SAT-style items spread across every section and category.

type Seed = {
  section: string;
  category: string;
  subcategory: string;
  difficulty: number;
  type: string;
  passage: string | null;
  prompt: string;
  choices: Record<string, string> | null;
  answer: string;
  explanation: string;
};

export const SEED_QUESTIONS: Seed[] = [
  // ───────── MATH · Algebra ─────────
  {
    section: "math", category: "Algebra", subcategory: "Linear equations in one variable", difficulty: 2, type: "mcq", passage: null,
    prompt: "If 3x − 7 = 11, what is the value of 6x + 1?",
    choices: { A: "13", B: "25", C: "37", D: "43" },
    answer: "C",
    explanation: "3x − 7 = 11 gives 3x = 18, so x = 6. Then 6x + 1 = 36 + 1 = 37.",
  },
  {
    section: "math", category: "Algebra", subcategory: "Linear functions", difficulty: 3, type: "mcq", passage: null,
    prompt: "A line passes through (2, 5) and (4, 11). What is its slope?",
    choices: { A: "2", B: "3", C: "4", D: "6" },
    answer: "B",
    explanation: "Slope = (11 − 5) / (4 − 2) = 6 / 2 = 3.",
  },
  {
    section: "math", category: "Algebra", subcategory: "Linear equations in one variable", difficulty: 4, type: "spr", passage: null,
    prompt: "If 5(x + 2) = 3x + 16, what is the value of x?",
    choices: null,
    answer: "3",
    explanation: "5x + 10 = 3x + 16 → 2x = 6 → x = 3.",
  },

  // ───────── MATH · Problem Solving and Data Analysis ─────────
  {
    section: "math", category: "Problem Solving and Data Analysis", subcategory: "Percentages", difficulty: 2, type: "mcq", passage: null,
    prompt: "A jacket originally priced at $80 is discounted by 25%. What is the sale price?",
    choices: { A: "$55", B: "$60", C: "$65", D: "$72" },
    answer: "B",
    explanation: "25% of 80 is 20, so the sale price is 80 − 20 = $60.",
  },
  {
    section: "math", category: "Problem Solving and Data Analysis", subcategory: "Ratios, rates, proportional relationships, and units", difficulty: 3, type: "mcq", passage: null,
    prompt: "The ratio of cats to dogs at a shelter is 3 : 5. If there are 40 animals total, how many are dogs?",
    choices: { A: "15", B: "20", C: "24", D: "25" },
    answer: "D",
    explanation: "The parts total 8. Each part is 40 / 8 = 5 animals, so dogs = 5 × 5 = 25.",
  },
  {
    section: "math", category: "Problem Solving and Data Analysis", subcategory: "Percentages", difficulty: 4, type: "spr", passage: null,
    prompt: "A survey of 200 students found that 35% prefer tea. How many students prefer tea?",
    choices: null,
    answer: "70",
    explanation: "35% of 200 = 0.35 × 200 = 70 students.",
  },

  // ───────── MATH · Geometry and Trigonometry ─────────
  {
    section: "math", category: "Geometry and Trigonometry", subcategory: "Right triangles and trigonometry", difficulty: 2, type: "mcq", passage: null,
    prompt: "A right triangle has legs of length 6 and 8. What is the length of the hypotenuse?",
    choices: { A: "10", B: "12", C: "14", D: "48" },
    answer: "A",
    explanation: "By the Pythagorean theorem, √(6² + 8²) = √(36 + 64) = √100 = 10.",
  },
  {
    section: "math", category: "Geometry and Trigonometry", subcategory: "Circles", difficulty: 3, type: "mcq", passage: null,
    prompt: "A circle has a radius of 5. What is its area, in terms of π?",
    choices: { A: "10π", B: "20π", C: "25π", D: "50π" },
    answer: "C",
    explanation: "Area = πr² = π(5²) = 25π.",
  },
  {
    section: "math", category: "Geometry and Trigonometry", subcategory: "Right triangles and trigonometry", difficulty: 4, type: "mcq", passage: null,
    prompt: "In a right triangle, the angle θ has sin θ = 0.6. What is cos θ if θ is acute?",
    choices: { A: "0.4", B: "0.6", C: "0.8", D: "1.0" },
    answer: "C",
    explanation: "Using sin²θ + cos²θ = 1: cos θ = √(1 − 0.36) = √0.64 = 0.8.",
  },

  // ───────── MATH · Advanced Math ─────────
  {
    section: "math", category: "Advanced Math", subcategory: "Nonlinear equations in one variable and systems of equations in two variables", difficulty: 3, type: "mcq", passage: null,
    prompt: "What are the solutions to x² − 5x + 6 = 0?",
    choices: { A: "x = 1 and x = 6", B: "x = 2 and x = 3", C: "x = −2 and x = −3", D: "x = 1 and x = 5" },
    answer: "B",
    explanation: "Factor: (x − 2)(x − 3) = 0, so x = 2 or x = 3.",
  },
  {
    section: "math", category: "Advanced Math", subcategory: "Nonlinear functions", difficulty: 4, type: "mcq", passage: null,
    prompt: "If f(x) = 2x² − 3x + 1, what is f(3)?",
    choices: { A: "8", B: "10", C: "12", D: "16" },
    answer: "B",
    explanation: "f(3) = 2(9) − 3(3) + 1 = 18 − 9 + 1 = 10.",
  },
  {
    section: "math", category: "Advanced Math", subcategory: "Nonlinear equations in one variable and systems of equations in two variables", difficulty: 5, type: "spr", passage: null,
    prompt: "The function g is defined by g(x) = (x − 4)(x + 2). For what positive value of x does g(x) = 0?",
    choices: null,
    answer: "4",
    explanation: "g(x) = 0 when x = 4 or x = −2. The positive solution is x = 4.",
  },

  // ───────── EBRW · Information and Ideas ─────────
  {
    section: "ebrw", category: "Information and Ideas", subcategory: "Central ideas and details", difficulty: 3, type: "mcq",
    passage: "Honeybees communicate the location of food through a 'waggle dance.' The angle of the dance relative to vertical indicates the direction of the food source relative to the sun, while the duration of the waggle encodes the distance.",
    prompt: "According to the passage, the duration of a honeybee's waggle conveys information about the food source's —",
    choices: { A: "quality", B: "direction", C: "distance", D: "freshness" },
    answer: "C",
    explanation: "The passage states the duration of the waggle 'encodes the distance' to the food source.",
  },
  {
    section: "ebrw", category: "Information and Ideas", subcategory: "Central ideas and details", difficulty: 4, type: "mcq",
    passage: "Researchers found that urban trees lower nearby surface temperatures by as much as several degrees. Yet the cooling effect was strongest only where trees were planted in continuous clusters rather than spaced individually along streets.",
    prompt: "Which choice best states the main idea of the passage?",
    choices: {
      A: "Urban trees provide no measurable cooling benefit.",
      B: "Clustered trees cool cities more effectively than scattered ones.",
      C: "Cities should remove individually spaced street trees.",
      D: "Surface temperature is unrelated to tree planting.",
    },
    answer: "B",
    explanation: "The passage emphasizes that cooling 'was strongest' where trees were in continuous clusters.",
  },

  // ───────── EBRW · Craft and Structure ─────────
  {
    section: "ebrw", category: "Craft and Structure", subcategory: "Words in context", difficulty: 3, type: "mcq",
    passage: "The novelist's later works were notably more restrained, trading the lavish description of her early career for spare, economical prose.",
    prompt: "As used in the text, 'spare' most nearly means —",
    choices: { A: "extra", B: "minimal", C: "generous", D: "harsh" },
    answer: "B",
    explanation: "Contrasted with 'lavish description,' 'spare' here means minimal or economical.",
  },
  {
    section: "ebrw", category: "Craft and Structure", subcategory: "Text structure and purpose", difficulty: 4, type: "mcq",
    passage: "Although the committee praised the proposal's ambition, members questioned whether its timeline was realistic given the limited budget.",
    prompt: "What function does the word 'Although' serve in the sentence?",
    choices: {
      A: "It introduces a contrast between praise and concern.",
      B: "It signals a chronological sequence of events.",
      C: "It provides an example of the committee's work.",
      D: "It restates the proposal's main goal.",
    },
    answer: "A",
    explanation: "'Although' sets up a contrast: the committee praised the ambition but doubted the timeline.",
  },

  // ───────── EBRW · Expression of Ideas ─────────
  {
    section: "ebrw", category: "Expression of Ideas", subcategory: "Rhetorical synthesis", difficulty: 3, type: "mcq",
    passage: "Student notes: (1) Maria Tallchief was a celebrated ballerina. (2) She was born in Oklahoma in 1925. (3) She became the first Native American prima ballerina. (4) She danced with the New York City Ballet.",
    prompt: "The writer wants to introduce Tallchief's historical significance. Which note best accomplishes this goal?",
    choices: { A: "Note 1", B: "Note 2", C: "Note 3", D: "Note 4" },
    answer: "C",
    explanation: "Note 3 highlights her significance as the first Native American prima ballerina.",
  },
  {
    section: "ebrw", category: "Expression of Ideas", subcategory: "Transitions", difficulty: 4, type: "mcq",
    passage: "The tide pools teemed with life. ____ visitors could spot anemones, hermit crabs, and the occasional darting fish.",
    prompt: "Which transition best fits the blank?",
    choices: { A: "Nevertheless,", B: "In contrast,", C: "Within minutes,", D: "Therefore," },
    answer: "C",
    explanation: "'Within minutes' smoothly continues the descriptive observation without implying contrast or cause.",
  },

  // ───────── EBRW · Standard English Conventions ─────────
  {
    section: "ebrw", category: "Standard English Conventions", subcategory: "Form, structure, and sense", difficulty: 2, type: "mcq",
    passage: "The team of engineers ____ reviewing the bridge design before construction begins.",
    prompt: "Which choice completes the text so that it conforms to the conventions of Standard English?",
    choices: { A: "are", B: "is", C: "were", D: "have been" },
    answer: "B",
    explanation: "The subject 'team' is singular, so the singular verb 'is' is correct.",
  },
  {
    section: "ebrw", category: "Standard English Conventions", subcategory: "Form, structure, and sense", difficulty: 3, type: "mcq",
    passage: "After hiking for hours, ____ a clearing with a stunning view of the valley.",
    prompt: "Which choice completes the text so that it conforms to the conventions of Standard English?",
    choices: {
      A: "the climbers reached",
      B: "a clearing was reached",
      C: "there was reached",
      D: "reaching happened at",
    },
    answer: "A",
    explanation: "The introductory phrase modifies 'the climbers,' who must directly follow it to avoid a dangling modifier.",
  },
];

export const SEED_PAGES = [
  {
    slug: "about",
    title: "About PrepForge",
    body:
      "PrepForge is a focused practice studio for the Digital SAT. Students drill a curated question bank across Math and EBRW, sharpen their pace in Question Rush, and track their accuracy over time. Educators curate every question, write the explanations, and shape the experience from the admin studio.\n\nThis platform was built for small tutoring practices that want full control over their material — no generic test mills, just the questions you choose, presented cleanly.",
  },
  {
    slug: "dashboard",
    title: "Welcome to the Studio",
    body: "Curate the question bank, edit the public pages, and keep an eye on how the bank is shaping up.",
  },
];
