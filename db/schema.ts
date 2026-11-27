// db/schema.ts — PrepForge data model
import { pgTable, serial, text, integer, boolean, jsonb, timestamp, uniqueIndex, index, date } from "drizzle-orm/pg-core";

// The shared question bank. Created and curated by admins, practiced by students.
// section: "math" | "ebrw"
// category: a domain within a section (e.g. "Algebra", "Information and Ideas")
// subcategory: a specific SAT skill within a domain (e.g. "Linear functions")
// type: "mcq" | "spr" (student-produced response / grid-in)
// scope: "BANK" | "TEST_EXCLUSIVE". Only BANK questions are served to practice
// and to the bank pickers. TEST_EXCLUSIVE questions live inside one full-length
// test: either written by hand in the test builder, or a snapshot taken when a
// bank question was attached, so editing the test copy never touches the bank.
export const questions = pgTable("questions", {
  id: serial().primaryKey(),
  section: text().notNull(),
  category: text().notNull(),
  subcategory: text().notNull().default(""),
  difficulty: integer().notNull().default(3),
  type: text().notNull().default("mcq"),
  passage: text(),
  prompt: text().notNull(),
  questionImage: text("question_image"),
  choices: jsonb().$type<Record<string, string>>(),
  choiceImages: jsonb("choice_images").$type<Record<string, string>>(),
  answer: text().notNull(),
  explanation: text().notNull().default(""),
  scope: text().notNull().default("BANK"),
  // For a TEST_EXCLUSIVE snapshot: the bank question it was copied from (or the
  // bank copy a manually written test question was published to). Not a foreign
  // key — the bank original may be deleted without affecting the test.
  sourceQuestionId: integer("source_question_id"),
  // Extra grid-in answers that also score as correct (e.g. ["40", "40.0"]).
  acceptableAnswers: jsonb("acceptable_answers").$type<string[]>(),
  // The question's own id in an imported test file (e.g. "rw-m1-q11"), kept so
  // an imported test can be compared against, and exported back to, its source.
  externalId: text("external_id"),
  // CHALLENGE questions belong to exactly one Challenging Questions set (in its
  // order); they never appear in the bank, practice pickers or tests.
  challengeSetId: integer("challenge_set_id"),
  setPosition: integer("set_position").notNull().default(0),
  // A bank question that is referenced by published mocks, tasks, attempts or
  // lessons is never hard-deleted: "deleting" it moves scope to RETIRED, which
  // drops it from every bank picker while keeping the content for review.
  retiredAt: timestamp("retired_at"),
  retiredBy: integer("retired_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("questions_bank_import_lookup").on(t.scope, t.section, t.category, t.externalId),
  index("questions_challenge_set").on(t.challengeSetId, t.setPosition),
]);

// ─────────────── CHALLENGING QUESTIONS ───────────────
// Named practice sets (e.g. "Advanced Math Word Problems") grouped by section.
// Created by admins / mentors, usually from a JSON upload; `externalId` is the
// set's stable id in the file, so re-importing a file updates the same set.
export const challengeSets = pgTable("challenge_sets", {
  id: serial().primaryKey(),
  externalId: text("external_id").notNull().unique(),
  section: text().notNull(), // "math" | "ebrw"
  title: text().notNull(),
  description: text().notNull().default(""),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Every answer a student submits, used to power profile stats and progress.
export const attempts = pgTable("attempts", {
  id: serial().primaryKey(),
  student: text().notNull(),
  questionId: integer("question_id").notNull(),
  section: text().notNull(),
  category: text().notNull(),
  difficulty: integer().notNull().default(3),
  mode: text().notNull().default("bank"),
  selected: text().notNull().default(""),
  correct: boolean().notNull().default(false),
  // Unique id of one submission, sent by the browser (or derived from the
  // practice session + question). A retried request with the same key gets the
  // stored attempt back instead of a second scored attempt or credit charge.
  clientKey: text("client_key"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  // Leaderboards, usage and reports read one student's (or one period's) answers.
  index("attempts_student_created").on(t.student, t.createdAt),
  index("attempts_created").on(t.createdAt),
  uniqueIndex("attempts_student_client_key").on(t.student, t.clientKey),
]);

export const savedQuestions = pgTable("saved_questions", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  questionId: integer("question_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Editable site pages (About Us, dashboard announcements, etc.). Admin-managed.
export const pages = pgTable("pages", {
  slug: text().primaryKey(),
  title: text().notNull(),
  body: text().notNull().default(""),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Registered students. They can sign up with an email, a phone number and/or a
// username, set a password, or arrive through a Google / Apple identity.
// provider: "password" | "google" | "apple"
export const users = pgTable("users", {
  id: serial().primaryKey(),
  username: text().unique(),
  email: text().unique(),
  phone: text().unique(),
  passwordHash: text("password_hash"),
  provider: text().notNull().default("password"),
  providerId: text("provider_id"),
  displayName: text("display_name").notNull().default("Student"),
  // Profile photo URL supplied by a social provider (e.g. Google's `picture`).
  avatarUrl: text("avatar_url"),
  role: text().notNull().default("student"),
  status: text().notNull().default("active"),
  approvedAt: timestamp("approved_at"),
  bannedAt: timestamp("banned_at"),
  // Set when an admin issues a temporary password: every API call except
  // changing the password is refused until the user picks a new one.
  mustChangePassword: boolean("must_change_password").notNull().default(false),
  passwordChangedAt: timestamp("password_changed_at"),
  // Small per-user preferences (e.g. { vocabLang: "ru", vocabDir: "x2en" }).
  preferences: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  // status "deactivated": access revoked, data kept. status "deleted": personal
  // data erased; the row stays as an anonymous tombstone so historical scores
  // and analytics keep a valid owner.
  deactivatedAt: timestamp("deactivated_at"),
  deletedAt: timestamp("deleted_at"),
  // Leaderboard privacy: hidden entries keep their scores and history and are
  // only listed for the super admin. Existing accounts stay visible.
  leaderboardVisible: boolean("leaderboard_visible").notNull().default(true),
  // The login email in use before the last self-service email change. It keeps
  // signing in until the new address is verified (no email delivery is set up).
  previousEmail: text("previous_email"),
  emailVerifiedAt: timestamp("email_verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

// Opaque bearer tokens issued on login. The client stores the token and sends
// it back as `Authorization: Bearer <token>` to identify the signed-in user.
export const sessions = pgTable("sessions", {
  token: text().primaryKey(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// Free-form site configuration, edited from the admin Branding panel. One row
// per setting group (e.g. "site" → name/tagline/description, "branding" → which
// custom images exist). Uploaded logo/thumbnail images live in Netlify Blobs;
// this table only records the lightweight metadata around them.
export const settings = pgTable("settings", {
  key: text().primaryKey(),
  value: jsonb(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const mentorActivationCodes = pgTable("mentor_activation_codes", {
  id: serial().primaryKey(),
  codeHash: text("code_hash").notNull().unique(),
  mentorId: integer("mentor_id").notNull(),
  createdBy: integer("created_by").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const classes = pgTable("classes", {
  id: serial().primaryKey(),
  mentorId: integer("mentor_id").notNull(),
  name: text().notNull(),
  description: text().notNull().default(""),
  // Soft delete: a deleted class disappears from every list and loses lesson
  // access, while past tasks and scores that point at it still resolve.
  deletedAt: timestamp("deleted_at"),
  deletedBy: integer("deleted_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const classInvites = pgTable("class_invites", {
  id: serial().primaryKey(),
  classId: integer("class_id").notNull(),
  codeHash: text("code_hash").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  usedBy: integer("used_by"),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const classEnrollments = pgTable("class_enrollments", {
  id: serial().primaryKey(),
  classId: integer("class_id").notNull(),
  studentId: integer("student_id").notNull(),
  status: text().notNull().default("active"),
  joinedAt: timestamp("joined_at").defaultNow(),
});

export const assignments = pgTable("assignments", {
  id: serial().primaryKey(),
  classId: integer("class_id").notNull(),
  mentorId: integer("mentor_id").notNull(),
  title: text().notNull(),
  description: text().notNull().default(""),
  questionIds: jsonb("question_ids").$type<number[]>().notNull(),
  dueAt: timestamp("due_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─────────────── FULL-LENGTH TESTS ───────────────
// A full-length test is an ordered set of modules (the Digital SAT shape:
// Reading & Writing 1/2, Math 1/2), each module an ordered set of questions
// imported from the shared bank or written for the test alone. Admins build them; students sit them against a
// server-authoritative clock; mentors review and re-assign their questions.
export const tests = pgTable("tests", {
  id: serial().primaryKey(),
  title: text().notNull(),
  description: text().notNull().default(""),
  // Total minutes for the whole test. Used as one continuous countdown unless
  // individual modules carry their own limit.
  timeLimitMinutes: integer("time_limit_minutes").notNull().default(134),
  status: text().notNull().default("draft"), // "draft" | "published"
  createdBy: integer("created_by"),
  // The `testId` carried by an imported JSON file (e.g. "dsat-practice-01").
  externalId: text("external_id"),
  // Adaptive tests route each student to one Module 2 variant per section
  // (Easy / Standard / Hard) based on their Module 1 result.
  isAdaptive: boolean("is_adaptive").notNull().default(false),
  // Break between the Reading & Writing and Math sections (per-module timing only).
  breakMinutes: integer("break_minutes").notNull().default(10),
  source: text().notNull().default("builder"), // "builder" | "import"
  // SHA-256 of the imported file's content, so re-uploading the same file is
  // recognised instead of silently creating a duplicate test.
  importHash: text("import_hash"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const testModules = pgTable("test_modules", {
  id: serial().primaryKey(),
  testId: integer("test_id").notNull(),
  title: text().notNull(),
  section: text().notNull().default("math"),
  // Optional per-module clock. When any module in a test sets one, every module
  // is timed separately and the test total becomes the sum of the modules.
  timeLimitMinutes: integer("time_limit_minutes"),
  position: integer().notNull().default(0),
  // Imported structure: "rw_module_1", the module number within its section,
  // and the adaptive track ("Baseline" | "Standard" | "Easy" | "Hard").
  moduleKey: text("module_key").notNull().default(""),
  moduleNumber: integer("module_number"),
  difficultyTrack: text("difficulty_track").notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
});

export const testModuleQuestions = pgTable("test_module_questions", {
  id: serial().primaryKey(),
  moduleId: integer("module_id").notNull(),
  questionId: integer("question_id").notNull(),
  position: integer().notNull().default(0),
  // How the question entered the module: "BANK" (imported from the question
  // bank) or "TEST_EXCLUSIVE" (written by hand in the test builder).
  source: text().notNull().default("BANK"),
});

// One sitting of a test by one student. `expiresAt` is the deadline the server
// enforces for the module the student is currently on, so a reloaded page or a
// tampered clock cannot buy extra time.
export const testAttempts = pgTable("test_attempts", {
  id: serial().primaryKey(),
  testId: integer("test_id").notNull(),
  studentId: integer("student_id").notNull(),
  moduleIndex: integer("module_index").notNull().default(0),
  answers: jsonb().$type<Record<string, string>>().notNull().default({}),
  correctCount: integer("correct_count").notNull().default(0),
  totalCount: integer("total_count").notNull().default(0),
  startedAt: timestamp("started_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  submittedAt: timestamp("submitted_at"),
  // Pause & resume. While paused the deadline is cleared and the time left on
  // the clock is held in `remainingSeconds`; resuming turns it back into a
  // fresh `expiresAt`. The rest is the student's place in the module so a
  // reload or a resume lands on the exact question they left.
  status: text().notNull().default("active"), // "active" | "paused" | "submitted"
  remainingSeconds: integer("remaining_seconds"),
  pausedAt: timestamp("paused_at"),
  currentQuestionIndex: integer("current_question_index").notNull().default(0),
  flagged: jsonb().$type<number[]>().notNull().default([]),
  lastSavedAt: timestamp("last_saved_at"),
  // Exam task this sitting belongs to (null for self-started practice).
  assignmentId: integer("assignment_id"),
  // Ordered module ids this sitting covers. Null = every module of the test.
  // Adaptive routing prunes the Module 2 variants the student was not sent to.
  modulePlan: jsonb("module_plan").$type<number[]>(),
  allowPause: boolean("allow_pause").notNull().default(true),
  // During the break between sections the next module's deadline already
  // includes the break; this marks when the break itself ends.
  breakEndsAt: timestamp("break_ends_at"),
  // Raw / scaled scores and domain breakdown, written when the sitting closes.
  scoreReport: jsonb("score_report"),
  // Practice set-up chosen when the sitting began. Rows written before these
  // existed default to the original behaviour: the whole planned test, timed.
  // practiceScope: "full" | "modules" (student-selected modules, no adaptive routing)
  timed: boolean().notNull().default(true),
  practiceScope: text("practice_scope").notNull().default("full"),
  // Exam Mode: full-screen, monitored sitting. Browser integrity events are
  // advisory only — they raise the status for staff review, never auto-submit.
  // integrityStatus: "none" | "warning" | "review_required" | "reviewed"
  examMode: boolean("exam_mode").notNull().default(false),
  integrityStatus: text("integrity_status").notNull().default("none"),
  violationCount: integer("violation_count").notNull().default(0),
  warningCount: integer("warning_count").notNull().default(0),
  integrityNote: text("integrity_note").notNull().default(""),
  integrityReviewedBy: integer("integrity_reviewed_by"),
  integrityReviewedAt: timestamp("integrity_reviewed_at"),
  // Staff can exclude a reviewed sitting from leaderboards and badges.
  competitionExcluded: boolean("competition_excluded").notNull().default(false),
});

// A student's personal highlights inside one test sitting. Annotations only —
// the question itself is never modified. `field` names the content that was
// highlighted ("passage", "prompt" or "choice:A"), and the offsets count
// characters of that field's rendered text (math islands excluded), so a
// phrase that appears twice is pinned to the occurrence the student chose.
export const testHighlights = pgTable("test_highlights", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  attemptId: integer("attempt_id").notNull(),
  questionId: integer("question_id").notNull(),
  field: text().notNull(),
  startOffset: integer("start_offset").notNull(),
  endOffset: integer("end_offset").notNull(),
  // The highlighted text, kept to detect a question edited after the fact.
  quote: text().notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("test_highlights_attempt_question").on(t.attemptId, t.questionId)]);

// A full-length test (or a slice of its modules) handed out as a timed exam
// task. Reaches every listed student, every active member of the listed
// classes, or — admins only — every student on the platform.
export const testAssignments = pgTable("test_assignments", {
  id: serial().primaryKey(),
  testId: integer("test_id").notNull(),
  assignedBy: integer("assigned_by").notNull(),
  title: text().notNull(),
  instructions: text().notNull().default(""),
  classIds: jsonb("class_ids").$type<number[]>().notNull().default([]),
  studentIds: jsonb("student_ids").$type<number[]>().notNull().default([]),
  allStudents: boolean("all_students").notNull().default(false),
  // Empty = the whole test; otherwise only these modules, in test order.
  moduleIds: jsonb("module_ids").$type<number[]>().notNull().default([]),
  dueAt: timestamp("due_at").notNull(),
  allowPause: boolean("allow_pause").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─────────────── ONLINE LESSONS ───────────────
// A lesson is a YouTube video wrapped in our own player page, tagged with the
// same section / domain / SAT-skill taxonomy as the question bank so students
// can find the lesson that matches the skill they are practising. Admins and
// mentors author them; students only watch and comment.
export const lessons = pgTable("lessons", {
  id: serial().primaryKey(),
  title: text().notNull(),
  topic: text().notNull().default(""),
  section: text().notNull().default("math"),
  category: text().notNull().default(""),
  subcategory: text().notNull().default(""),
  // The link the author pasted, plus the extracted id we hand to the embed.
  youtubeUrl: text("youtube_url").notNull().default(""),
  videoId: text("video_id").notNull().default(""),
  // Rich-text (HTML) lesson notes written in the editor.
  description: text().notNull().default(""),
  difficulty: integer().notNull().default(3),
  status: text().notNull().default("published"), // "draft" | "published"
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  // ── Class learning paths ──
  // "public": listed in the open Online Lessons library (the original behaviour).
  // "class": only reachable through a class curriculum the student belongs to.
  visibility: text().notNull().default("public"),
  // Set on a class-specific copy: the class that owns it and the lesson it was copied from.
  ownerClassId: integer("owner_class_id"),
  sourceLessonId: integer("source_lesson_id"),
  // "youtube" (videoId) | "url" (direct video file link) | "none"
  videoProvider: text("video_provider").notNull().default("youtube"),
  videoUrl: text("video_url").notNull().default(""),
  // Bilingual teaching content: { en, uz, ru } strings. SAT questions stay English.
  objective: jsonb().$type<Record<string, string>>().notNull().default({}),
  // { explanation:{en,uz,ru}, transcript:{en,uz,ru}, vocabulary:[{term,en,uz,ru}],
  //   workedExamples:[{title, body:{en,uz,ru}}], slidesUrl }
  content: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  skillTags: jsonb("skill_tags").$type<string[]>().notNull().default([]),
  practiceQuestionIds: jsonb("practice_question_ids").$type<number[]>().notNull().default([]),
  archivedAt: timestamp("archived_at"),
  updatedBy: integer("updated_by"),
});

// One unit of a class curriculum (Class → Unit → Lesson → Practice).
// status: "draft" | "published" | "archived"
export const learningUnits = pgTable("learning_units", {
  id: serial().primaryKey(),
  classId: integer("class_id").notNull(),
  title: text().notNull(),
  titleI18n: jsonb("title_i18n").$type<Record<string, string>>().notNull().default({}),
  description: text().notNull().default(""),
  position: integer().notNull().default(0),
  status: text().notNull().default("draft"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [index("learning_units_class").on(t.classId, t.position)]);

// A lesson placed in a unit. The same lesson row can be placed in several
// classes (shared); a class-specific copy is a separate lesson row.
// status: "draft" | "published" | "archived"; assignedAt/dueAt mark it as assigned work.
export const learningPlacements = pgTable("learning_placements", {
  id: serial().primaryKey(),
  classId: integer("class_id").notNull(),
  unitId: integer("unit_id").notNull(),
  lessonId: integer("lesson_id").notNull(),
  position: integer().notNull().default(0),
  status: text().notNull().default("draft"),
  publishedAt: timestamp("published_at"),
  assignedAt: timestamp("assigned_at"),
  dueAt: timestamp("due_at"),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("learning_placements_unit_lesson").on(t.unitId, t.lessonId),
  index("learning_placements_class").on(t.classId, t.status),
  index("learning_placements_lesson").on(t.lessonId),
]);

// Files (Netlify Blobs) and links attached to a lesson.
// kind: "pdf" | "slides" | "download" | "captions" | "link"; lang: "en" | "uz" | "ru" | "all"
export const lessonMaterials = pgTable("lesson_materials", {
  id: serial().primaryKey(),
  lessonId: integer("lesson_id").notNull(),
  kind: text().notNull().default("download"),
  title: text().notNull(),
  lang: text().notNull().default("all"),
  blobKey: text("blob_key"),
  url: text().notNull().default(""),
  fileName: text("file_name").notNull().default(""),
  contentType: text("content_type").notNull().default(""),
  size: integer().notNull().default(0),
  position: integer().notNull().default(0),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("lesson_materials_lesson").on(t.lessonId, t.position)]);

// Lesson completion (separate from skill mastery). Keyed per student and
// lesson — not per class — so progress survives class moves and is shared by
// every class that reuses the lesson.
export const lessonProgress = pgTable("lesson_progress", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  lessonId: integer("lesson_id").notNull(),
  videoPositionSeconds: integer("video_position_seconds").notNull().default(0),
  videoDurationSeconds: integer("video_duration_seconds").notNull().default(0),
  videoCompletedAt: timestamp("video_completed_at"),
  completedAt: timestamp("completed_at"),
  // { answers: { [questionId]: { selected, correct, assisted } }, currentIndex }
  practiceState: jsonb("practice_state").$type<Record<string, unknown>>().notNull().default({}),
  lastClassId: integer("last_class_id"),
  lastLang: text("last_lang").notNull().default(""),
  startedAt: timestamp("started_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("lesson_progress_student_lesson").on(t.studentId, t.lessonId),
  index("lesson_progress_lesson").on(t.lessonId),
]);

// Mastery evidence: one row per student per distinct question, whatever the
// number of retries, classes or language modes it was answered in.
export const skillEvidence = pgTable("skill_evidence", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  questionId: integer("question_id").notNull(),
  skill: text().notNull(),
  domain: text().notNull().default(""),
  section: text().notNull().default(""),
  attemptCount: integer("attempt_count").notNull().default(0),
  assistedCount: integer("assisted_count").notNull().default(0),
  assistedCorrectCount: integer("assisted_correct_count").notNull().default(0),
  // First attempt without help — the one accuracy for "Mastered" is measured on.
  firstIndependentAt: timestamp("first_independent_at"),
  firstIndependentCorrect: boolean("first_independent_correct"),
  // First independently correct response — the one that earns points.
  independentCorrectAt: timestamp("independent_correct_at"),
  pointsAwarded: integer("points_awarded").notNull().default(0),
  lastSelected: text("last_selected").notNull().default(""),
  lastCorrect: boolean("last_correct").notNull().default(false),
  lastAssisted: boolean("last_assisted").notNull().default(false),
  lastAttemptAt: timestamp("last_attempt_at"),
  lessonId: integer("lesson_id"),
  classId: integer("class_id"),
  lang: text().notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("skill_evidence_student_question").on(t.studentId, t.questionId),
  index("skill_evidence_student_skill").on(t.studentId, t.skill),
]);

// Level-ups, recorded once per student, skill and level.
// level: "practising" | "proficient" | "mastered"
export const skillLevelUps = pgTable("skill_level_ups", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  skill: text().notNull(),
  level: text().notNull(),
  reachedAt: timestamp("reached_at").defaultNow(),
}, (t) => [uniqueIndex("skill_level_ups_student_skill_level").on(t.studentId, t.skill, t.level)]);

// Student questions on a lesson, and the replies admins and mentors leave.
export const lessonComments = pgTable("lesson_comments", {
  id: serial().primaryKey(),
  lessonId: integer("lesson_id").notNull(),
  authorId: integer("author_id").notNull(),
  body: text().notNull(),
  parentId: integer("parent_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

// ─────────────── SAT VOCABULARY ───────────────
// The shared vocabulary bank. Words arrive one at a time from the admin/mentor
// editor or in bulk from a JSON upload. Ids are strings so uploaded files can
// keep their own ids (e.g. "vocab-001"); a UUID is generated when one is missing.
// difficulty: "Foundation" | "Medium" | "Advanced"
export const vocabWords = pgTable("vocab_words", {
  id: text().primaryKey(),
  word: text().notNull(),
  partOfSpeech: text("part_of_speech").notNull().default("noun"),
  definition: text().notNull(),
  // Uzbek translation shown to students under the English definition ("" when none).
  uzbekTranslation: text("uzbek_translation").notNull().default(""),
  // Russian translation ("" when none). Never auto-generated.
  russianTranslation: text("russian_translation").notNull().default(""),
  // Contains "_____" where the target word fits.
  satContextSentence: text("sat_context_sentence").notNull().default(""),
  distractors: jsonb().$type<string[]>().notNull().default([]),
  synonyms: jsonb().$type<string[]>().notNull().default([]),
  antonyms: jsonb().$type<string[]>().notNull().default([]),
  difficulty: text().notNull().default("Medium"),
  tags: jsonb().$type<string[]>().notNull().default([]),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Curated word lists (decks) built by admins and mentors.
export const vocabSets = pgTable("vocab_sets", {
  id: text().primaryKey(),
  title: text().notNull(),
  description: text().notNull().default(""),
  wordIds: jsonb("word_ids").$type<string[]>().notNull().default([]),
  createdBy: integer("created_by"),
  isPublic: boolean("is_public").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

// Assigned vocab quizzes. A task reaches every student listed in `assignedTo`,
// every active member of the classes in `classIds`, or — when `allStudents` is
// set (admins only) — every student on the platform.
// taskType: "Flashcard_Review" | "Matching_Game" | "Multiple_Choice_Quiz" |
//           "Context_Fill_In_Blank" | "Mixed_Quiz"
export const vocabTasks = pgTable("vocab_tasks", {
  id: text().primaryKey(),
  title: text().notNull(),
  assignedBy: integer("assigned_by").notNull(),
  assignedTo: jsonb("assigned_to").$type<number[]>().notNull().default([]),
  classIds: jsonb("class_ids").$type<number[]>().notNull().default([]),
  allStudents: boolean("all_students").notNull().default(false),
  wordIds: jsonb("word_ids").$type<string[]>().notNull().default([]),
  taskType: text("task_type").notNull().default("Mixed_Quiz"),
  dueDate: timestamp("due_date").notNull(),
  passingScore: integer("passing_score").notNull().default(80),
  createdAt: timestamp("created_at").defaultNow(),
});

// One student's progress on one vocab task. The task status the student sees
// ("Pending" | "In_Progress" | "Completed" | "Overdue") is derived from this
// row plus the task's due date.
export const vocabTaskResults = pgTable("vocab_task_results", {
  id: serial().primaryKey(),
  taskId: text("task_id").notNull(),
  studentId: integer("student_id").notNull(),
  status: text().notNull().default("In_Progress"), // "In_Progress" | "Completed"
  bestScore: integer("best_score").notNull().default(0),
  lastScore: integer("last_score").notNull().default(0),
  attemptCount: integer("attempt_count").notNull().default(0),
  missedWordIds: jsonb("missed_word_ids").$type<string[]>().notNull().default([]),
  startedAt: timestamp("started_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => [uniqueIndex("vocab_task_results_task_student").on(t.taskId, t.studentId)]);

// Per-student, per-word progress.
// masteryLevel: "New" | "Learning" | "Reviewing" | "Mastered"
export const studentWordMastery = pgTable("student_word_mastery", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  wordId: text("word_id").notNull(),
  masteryLevel: text("mastery_level").notNull().default("New"),
  correctCount: integer("correct_count").notNull().default(0),
  incorrectCount: integer("incorrect_count").notNull().default(0),
  // Bookmarked into the student's personal study deck.
  starred: boolean().notNull().default(false),
  lastReviewedAt: timestamp("last_reviewed_at"),
}, (t) => [uniqueIndex("student_word_mastery_student_word").on(t.studentId, t.wordId)]);

// ─────────────── PLATFORM: ADMINISTRATION, COMMUNICATION, GAMIFICATION ───────────────
// Sensitive admin actions (password resets, class moves, limit changes, integrity
// reviews). `details` never holds a password or token.
export const auditLog = pgTable("audit_log", {
  id: serial().primaryKey(),
  actorId: integer("actor_id"),
  action: text().notNull(),
  targetType: text("target_type").notNull().default(""),
  targetId: text("target_id").notNull().default(""),
  details: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("audit_log_created").on(t.createdAt)]);

// In-platform notifications (no email / push). `link` is an in-app view key.
export const notifications = pgTable("notifications", {
  id: serial().primaryKey(),
  userId: integer("user_id").notNull(),
  kind: text().notNull(),
  title: text().notNull(),
  body: text().notNull().default(""),
  link: jsonb().$type<Record<string, unknown> | null>(),
  readAt: timestamp("read_at"),
  // Optional idempotency key ("announcement:12"): one notification per user per key.
  dedupeKey: text("dedupe_key"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("notifications_user_read").on(t.userId, t.readAt, t.createdAt),
  uniqueIndex("notifications_user_dedupe").on(t.userId, t.dedupeKey),
]);

// status: "new" | "under_review" | "resolved" | "rejected"
// source: "bank" | "challenge" | "practice" | "mock" | "review" | "task"
export const questionReports = pgTable("question_reports", {
  id: serial().primaryKey(),
  questionId: integer("question_id").notNull(),
  reporterId: integer("reporter_id").notNull(),
  reason: text().notNull(),
  comment: text().notNull().default(""),
  source: text().notNull().default("bank"),
  testAttemptId: integer("test_attempt_id"),
  status: text().notNull().default("new"),
  resolutionNote: text("resolution_note").notNull().default(""),
  resolvedBy: integer("resolved_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("question_reports_question").on(t.questionId),
  index("question_reports_status").on(t.status, t.createdAt),
  index("question_reports_reporter").on(t.reporterId, t.createdAt),
]);

// One-to-one mentor ↔ student messages.
export const messages = pgTable("messages", {
  id: serial().primaryKey(),
  senderId: integer("sender_id").notNull(),
  recipientId: integer("recipient_id").notNull(),
  body: text().notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  index("messages_pair").on(t.senderId, t.recipientId, t.createdAt),
  index("messages_recipient_unread").on(t.recipientId, t.readAt),
]);

// Browser-reported exam events. type: "fullscreen_exit" | "tab_hidden" |
// "window_blur" | "navigation" | "copy" | "paste". `counted` marks the events
// that counted as a violation after de-duplication.
export const examIntegrityEvents = pgTable("exam_integrity_events", {
  id: serial().primaryKey(),
  attemptId: integer("attempt_id").notNull(),
  studentId: integer("student_id").notNull(),
  type: text().notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  durationMs: integer("duration_ms"),
  occurrence: integer().notNull().default(1),
  counted: boolean().notNull().default(false),
  moduleIndex: integer("module_index"),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [index("exam_integrity_events_attempt").on(t.attemptId, t.occurredAt)]);

// Earned achievements — one row per student per badge, never duplicated.
export const badgeAwards = pgTable("badge_awards", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  badgeKey: text("badge_key").notNull(),
  meta: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  awardedAt: timestamp("awarded_at").defaultNow(),
}, (t) => [uniqueIndex("badge_awards_student_badge").on(t.studentId, t.badgeKey)]);

// Per-student, per-calendar-day counters (platform timezone). Drives streaks,
// usage limits and qualifying-day bonuses without rescanning history.
export const studentDailyActivity = pgTable("student_daily_activity", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  day: date({ mode: "string" }).notNull(),
  practiceAnswered: integer("practice_answered").notNull().default(0),
  bankUsed: integer("bank_used").notNull().default(0),
  challengeUsed: integer("challenge_used").notNull().default(0),
  mockStarts: integer("mock_starts").notNull().default(0),
  modulesCompleted: integer("modules_completed").notNull().default(0),
  vocabQuizzes: integer("vocab_quizzes").notNull().default(0),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  uniqueIndex("student_daily_activity_student_day").on(t.studentId, t.day),
  index("student_daily_activity_day").on(t.day),
]);

// Limit overrides. scope: "user" | "class"; limits: { bankDaily, challengeDaily,
// mockDaily, mockWeekly, vocabDaily } where a number is a cap, -1 is unlimited
// and a missing key inherits from the next level.
export const usageLimits = pgTable("usage_limits", {
  id: serial().primaryKey(),
  scope: text().notNull(),
  targetId: integer("target_id").notNull(),
  limits: jsonb().$type<Record<string, number>>().notNull().default({}),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [uniqueIndex("usage_limits_scope_target").on(t.scope, t.targetId)]);

// Each finished module of a test sitting, recorded once (streak qualification).
export const moduleCompletions = pgTable("module_completions", {
  id: serial().primaryKey(),
  attemptId: integer("attempt_id").notNull(),
  studentId: integer("student_id").notNull(),
  moduleIndex: integer("module_index").notNull(),
  completedAt: timestamp("completed_at").defaultNow(),
}, (t) => [uniqueIndex("module_completions_attempt_module").on(t.attemptId, t.moduleIndex)]);

// ─────────────── PRACTICE SESSIONS ───────────────
// One Question Bank or Challenging Questions run. The ordered question ids are
// fixed when the session starts, so the set and order survive a closed browser.
// answers: { [questionId]: { selected, submitted?, correct?, attemptId?, answer?, at } }
// kind: "bank" | "challenge"; status: "active" | "completed" | "abandoned"
export const practiceSessions = pgTable("practice_sessions", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  kind: text().notNull().default("bank"),
  label: text().notNull().default(""),
  filters: jsonb().$type<Record<string, unknown>>().notNull().default({}),
  challengeSetId: integer("challenge_set_id"),
  questionIds: jsonb("question_ids").$type<number[]>().notNull().default([]),
  position: integer().notNull().default(0),
  answers: jsonb().$type<Record<string, Record<string, unknown>>>().notNull().default({}),
  flagged: jsonb().$type<number[]>().notNull().default([]),
  status: text().notNull().default("active"),
  // Client-supplied key so a retried "start" never creates two sessions.
  clientKey: text("client_key"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
  completedAt: timestamp("completed_at"),
}, (t) => [
  index("practice_sessions_student").on(t.studentId, t.kind, t.status, t.updatedAt),
  uniqueIndex("practice_sessions_client_key").on(t.studentId, t.clientKey),
]);

// ─────────────── SUBJECT ACCESS ───────────────
// scope "user": an individual override set by an admin. scope "class": a class
// preset ("english" | "math" | "both" | "custom"). scope "snapshot": the last
// conflict-free effective access of a student, kept while class settings
// conflict. rules: { math: { enabled, bank, challenge, lessons, rush }, ebrw: {...} }
export const accessRules = pgTable("access_rules", {
  id: serial().primaryKey(),
  scope: text().notNull(),
  targetId: integer("target_id").notNull(),
  preset: text().notNull().default("custom"),
  rules: jsonb().$type<Record<string, Record<string, boolean>>>().notNull().default({}),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [uniqueIndex("access_rules_scope_target").on(t.scope, t.targetId)]);

// ─────────────── CLASS ANNOUNCEMENTS ───────────────
export const announcements = pgTable("announcements", {
  id: serial().primaryKey(),
  title: text().notNull(),
  body: text().notNull().default(""),
  classIds: jsonb("class_ids").$type<number[]>().notNull().default([]),
  authorId: integer("author_id").notNull(),
  // Idempotency key from the publishing browser: a retried publish returns the same row.
  clientKey: text("client_key"),
  publishedAt: timestamp("published_at").defaultNow(),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("announcements_author_client_key").on(t.authorId, t.clientKey),
  index("announcements_published").on(t.publishedAt),
]);

// ─────────────── READING LIBRARY ───────────────
// Short original articles and excerpts. Follows the SAT English master switch.
// question: { prompt, choices: {A..D}, answer, explanation, support } | null
export const libraryArticles = pgTable("library_articles", {
  id: serial().primaryKey(),
  title: text().notNull(),
  topic: text().notNull().default(""),
  excerpt: text().notNull().default(""),
  body: text().notNull().default(""),
  wordCount: integer("word_count").notNull().default(0),
  status: text().notNull().default("draft"), // "draft" | "published"
  question: jsonb().$type<Record<string, unknown> | null>(),
  // Stable id from an imported JSON file, so re-importing updates (never duplicates) the piece.
  externalId: text("external_id"),
  // Ordered content blocks: [{ type: "paragraph" | "image" | "chart", ... }].
  // Null for text-only pieces, which keep using `body`.
  blocks: jsonb().$type<Record<string, unknown>[] | null>(),
  createdBy: integer("created_by"),
  updatedBy: integer("updated_by"),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (t) => [
  index("library_articles_status").on(t.status, t.publishedAt),
  uniqueIndex("library_articles_external_id").on(t.externalId),
]);

// ─────────────── STUDENT CREDITS (optional, per student) ───────────────
// Credit mode is OFF for every student until the super admin enables it for
// that individual. Balances change only through the credit_* SQL functions
// (see the migration), which lock the account row, so concurrent requests can
// never double-charge or go negative. Every change is one ledger row with a
// unique key (attempt id, hold settlement, grant batch + recipient).
export const creditAccounts = pgTable("credit_accounts", {
  studentId: integer("student_id").primaryKey(),
  enabled: boolean().notNull().default(false),
  balance: integer().notNull().default(0),
  enabledBy: integer("enabled_by"),
  enabledAt: timestamp("enabled_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
});
// kind: "grant" | "topup" | "correction" | "debit" | "settle"
export const creditLedger = pgTable("credit_ledger", {
  id: serial().primaryKey(),
  studentId: integer("student_id").notNull(),
  key: text().notNull(),
  delta: integer().notNull(),
  balanceAfter: integer("balance_after").notNull(),
  kind: text().notNull(),
  reason: text().notNull().default(""),
  actorId: integer("actor_id"),
  batchId: text("batch_id"),
  attemptId: integer("attempt_id"),
  ref: text().notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
}, (t) => [
  uniqueIndex("credit_ledger_key").on(t.key),
  index("credit_ledger_student").on(t.studentId, t.createdAt),
  index("credit_ledger_batch").on(t.batchId),
]);
// Credits held for a timed / batch-submitted module (one hold per module of a
// sitting). status: "held" | "settled" | "released"
export const creditHolds = pgTable("credit_holds", {
  id: serial().primaryKey(),
  key: text().notNull(),
  studentId: integer("student_id").notNull(),
  amount: integer().notNull(),
  charged: integer().notNull().default(0),
  status: text().notNull().default("held"),
  ref: text().notNull().default(""),
  createdAt: timestamp("created_at").defaultNow(),
  settledAt: timestamp("settled_at"),
}, (t) => [
  uniqueIndex("credit_holds_key").on(t.key),
  index("credit_holds_student").on(t.studentId, t.status),
]);
