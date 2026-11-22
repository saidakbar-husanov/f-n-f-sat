CREATE TABLE "student_word_mastery" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"word_id" text NOT NULL,
	"mastery_level" text DEFAULT 'New' NOT NULL,
	"correct_count" integer DEFAULT 0 NOT NULL,
	"incorrect_count" integer DEFAULT 0 NOT NULL,
	"starred" boolean DEFAULT false NOT NULL,
	"last_reviewed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "vocab_sets" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"word_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_by" integer,
	"is_public" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vocab_task_results" (
	"id" serial PRIMARY KEY,
	"task_id" text NOT NULL,
	"student_id" integer NOT NULL,
	"status" text DEFAULT 'In_Progress' NOT NULL,
	"best_score" integer DEFAULT 0 NOT NULL,
	"last_score" integer DEFAULT 0 NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"missed_word_ids" jsonb DEFAULT '[]' NOT NULL,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "vocab_tasks" (
	"id" text PRIMARY KEY,
	"title" text NOT NULL,
	"assigned_by" integer NOT NULL,
	"assigned_to" jsonb DEFAULT '[]' NOT NULL,
	"class_ids" jsonb DEFAULT '[]' NOT NULL,
	"all_students" boolean DEFAULT false NOT NULL,
	"word_ids" jsonb DEFAULT '[]' NOT NULL,
	"task_type" text DEFAULT 'Mixed_Quiz' NOT NULL,
	"due_date" timestamp NOT NULL,
	"passing_score" integer DEFAULT 80 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "vocab_words" (
	"id" text PRIMARY KEY,
	"word" text NOT NULL,
	"part_of_speech" text DEFAULT 'noun' NOT NULL,
	"definition" text NOT NULL,
	"sat_context_sentence" text DEFAULT '' NOT NULL,
	"distractors" jsonb DEFAULT '[]' NOT NULL,
	"synonyms" jsonb DEFAULT '[]' NOT NULL,
	"antonyms" jsonb DEFAULT '[]' NOT NULL,
	"difficulty" text DEFAULT 'Medium' NOT NULL,
	"tags" jsonb DEFAULT '[]' NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX "student_word_mastery_student_word" ON "student_word_mastery" ("student_id","word_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vocab_task_results_task_student" ON "vocab_task_results" ("task_id","student_id");--> statement-breakpoint
-- Pre-loaded SAT starter bank (15 words) so the vocabulary module works out of the box.
INSERT INTO "vocab_words" ("id", "word", "part_of_speech", "definition", "sat_context_sentence", "distractors", "synonyms", "antonyms", "difficulty", "tags") VALUES
('vocab-001', 'ambivalent', 'adjective', 'Having mixed feelings or contradictory ideas about something or someone.', 'Although the urban planner praised the new transit line''s efficiency, she remained _____ about its long-term financial sustainability for low-income commuters.', '["resolute","indifferent","ostentatious"]'::jsonb, '["uncertain","conflicted","equivocal"]'::jsonb, '["decisive","certain","resolute"]'::jsonb, 'Foundation', '["Tone/Attitude","High-Frequency","Social Science"]'::jsonb),
('vocab-002', 'corroborate', 'verb', 'To confirm or give support to a statement, theory, or finding.', 'Ice core samples extracted from the Antarctic shelf _____ the paleoclimatologist''s hypothesis that atmospheric carbon levels spiked rapidly during the epoch.', '["repudiate","fabricate","obfuscate"]'::jsonb, '["substantiate","validate","verify"]'::jsonb, '["contradict","refute","disprove"]'::jsonb, 'Foundation', '["Rhetoric","Science Context","High-Frequency"]'::jsonb),
('vocab-003', 'ephemeral', 'adjective', 'Lasting for a very short time; transitory.', 'Unlike the enduring stone monuments of ancient Rome, the bamboo pavilions constructed for the festival were intentionally _____, designed to be dismantled within a week.', '["perpetual","ubiquitous","immutable"]'::jsonb, '["fleeting","transient","short-lived"]'::jsonb, '["permanent","enduring","perpetual"]'::jsonb, 'Medium', '["High-Frequency","Humanities","Contrast"]'::jsonb),
('vocab-004', 'mitigate', 'verb', 'To make less severe, serious, or painful.', 'Coastal wetlands act as natural buffers that _____ the destructive impact of storm surges on inland infrastructure.', '["exacerbate","proliferate","engender"]'::jsonb, '["alleviate","attenuate","assuage"]'::jsonb, '["aggravate","exacerbate","intensify"]'::jsonb, 'Foundation', '["Science Context","High-Frequency","Cause/Effect"]'::jsonb),
('vocab-005', 'pragmatic', 'adjective', 'Dealing with things sensibly and realistically in a way that is based on practical rather than theoretical considerations.', 'Faced with a tightening municipal budget, the council abandoned the grandiose architectural blueprint in favor of a more _____ renovation plan.', '["idealistic","quixotic","esoteric"]'::jsonb, '["practical","realistic","utilitarian"]'::jsonb, '["idealistic","impractical","visionary"]'::jsonb, 'Foundation', '["Tone/Attitude","Social Science","High-Frequency"]'::jsonb),
('vocab-006', 'ubiquitous', 'adjective', 'Present, appearing, or found everywhere.', 'Once considered a rare luxury reserved for research laboratories, microprocessors have become so _____ that they now regulate everything from toasters to traffic lights.', '["scarce","anomalous","clandestine"]'::jsonb, '["omnipresent","pervasive","universal"]'::jsonb, '["rare","scarce","infrequent"]'::jsonb, 'Medium', '["High-Frequency","Science Context"]'::jsonb),
('vocab-007', 'tenuous', 'adjective', 'Very weak or slight; lacking a strong basis or foundation.', 'Critics argued that the historian''s claim rested on a _____ connection between two undated letters rather than verifiable archival evidence.', '["robust","irrefutable","compelling"]'::jsonb, '["flimsy","fragile","dubious"]'::jsonb, '["strong","substantial","convincing"]'::jsonb, 'Medium', '["Rhetoric","Tone/Attitude","History"]'::jsonb),
('vocab-008', 'ameliorate', 'verb', 'To make something bad or unsatisfactory better.', 'The introduction of drought-resistant crop varieties helped _____ the severe food shortages that had plagued the arid region for decades.', '["compound","stagnate","preclude"]'::jsonb, '["improve","enhance","alleviate"]'::jsonb, '["worsen","deteriorate","exacerbate"]'::jsonb, 'Advanced', '["Social Science","High-Frequency"]'::jsonb),
('vocab-009', 'esoteric', 'adjective', 'Intended for or likely to be understood by only a small number of people with a specialized knowledge or interest.', 'While the physicist''s early textbooks were written in dense, _____ jargon aimed at fellow researchers, her later memoirs translated quantum mechanics into accessible everyday metaphors.', '["pedestrian","lucid","superficial"]'::jsonb, '["abstruse","arcane","obscure"]'::jsonb, '["accessible","familiar","exoteric"]'::jsonb, 'Advanced', '["Humanities","Science Context","Contrast"]'::jsonb),
('vocab-010', 'repudiate', 'verb', 'To refuse to accept or be associated with; to deny the truth or validity of.', 'In his landmark treatise, the astronomer sought to _____ the geocentric model of the universe, presenting mathematical proof that the planets revolve around the sun.', '["vindicate","espouse","bolster"]'::jsonb, '["reject","renounce","refute"]'::jsonb, '["embrace","confirm","validate"]'::jsonb, 'Advanced', '["Rhetoric","Science Context"]'::jsonb),
('vocab-011', 'bolster', 'verb', 'To support or strengthen; to prop up.', 'To _____ her argument that early amphibians adapted quickly to terrestrial environments, the paleontologist presented newly discovered fossilized footprints.', '["undermine","subvert","curtail"]'::jsonb, '["reinforce","fortify","buttress"]'::jsonb, '["undermine","weaken","hinder"]'::jsonb, 'Foundation', '["Rhetoric","High-Frequency","Science Context"]'::jsonb),
('vocab-012', 'equivocal', 'adjective', 'Open to more than one interpretation; ambiguous or uncertain in nature.', 'When pressed by reporters on whether he would veto the trade bill, the diplomat offered an intentionally _____ reply to avoid alienating either faction.', '["unambiguous","categorical","trenchant"]'::jsonb, '["ambiguous","noncommittal","evasive"]'::jsonb, '["clear","definite","unequivocal"]'::jsonb, 'Advanced', '["Tone/Attitude","Rhetoric","Politics/History"]'::jsonb),
('vocab-013', 'proliferate', 'verb', 'To increase rapidly in numbers; to multiply.', 'Following the invention of the movable-type printing press, independent pamphlets and scientific journals began to _____ across European urban centers.', '["dwindle","wane","recede"]'::jsonb, '["multiply","mushroom","burgeon"]'::jsonb, '["decrease","diminish","dwindle"]'::jsonb, 'Medium', '["History","Science Context","High-Frequency"]'::jsonb),
('vocab-014', 'disparate', 'adjective', 'Essentially different in kind; not allowing comparison.', 'The anthology brings together _____ literary traditions, weaving ancient Mesopotamian myths alongside contemporary cyberpunk fiction.', '["homogeneous","analogous","uniform"]'::jsonb, '["contrasting","divergent","distinct"]'::jsonb, '["similar","homogeneous","alike"]'::jsonb, 'Medium', '["Humanities","Contrast","High-Frequency"]'::jsonb),
('vocab-015', 'circumspect', 'adjective', 'Wary and unwilling to take risks; cautious and prudent.', 'Given the volatility of the emerging biotech sector, institutional investors remained _____ about committing capital before Phase III clinical trials concluded.', '["audacious","rash","impetuous"]'::jsonb, '["cautious","prudent","guarded"]'::jsonb, '["reckless","audacious","unguarded"]'::jsonb, 'Advanced', '["Tone/Attitude","Social Science"]'::jsonb)
ON CONFLICT ("id") DO NOTHING;
