-- 1. Leaderboard handles: every active student or mentor without a username gets
--    a unique, non-identifying handle (never derived from a name or email).
DO $$
DECLARE r record; h text;
BEGIN
  FOR r IN SELECT id FROM users WHERE username IS NULL AND status <> 'deleted' AND role IN ('student', 'mentor') LOOP
    LOOP
      h := 'learner-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
      EXIT WHEN NOT EXISTS (SELECT 1 FROM users WHERE lower(username) = h);
    END LOOP;
    UPDATE users SET username = h WHERE id = r.id;
  END LOOP;
END $$;
--> statement-breakpoint
-- 2. Case-insensitive username uniqueness, enforced by the database so two
--    concurrent profile updates can never claim the same name. Skipped (with a
--    notice) only if legacy data already holds case-variant duplicates; the API
--    also serialises username changes with an advisory lock.
DO $$
BEGIN
  IF NOT EXISTS (SELECT lower(username) FROM users WHERE username IS NOT NULL GROUP BY 1 HAVING count(*) > 1) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_unique ON users (lower(username));
  ELSE
    RAISE NOTICE 'users_username_lower_unique not created: case-variant duplicate usernames exist';
  END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_previous_email ON users (previous_email);
--> statement-breakpoint
-- 3. Original sample pieces for the Reading Library.
INSERT INTO library_articles (title, topic, excerpt, body, word_count, status, question, published_at) VALUES
('The Night Shift of the Coral Reef', 'Science',
 'When the sun sets over a reef, a different community wakes up — and some of its members glow.',
 E'When the sun sets over a tropical reef, the cast of characters changes almost completely. Parrotfish tuck themselves into crevices, some even wrapping their bodies in a cocoon of mucus that may mask their scent from predators. Meanwhile, creatures that spent the day hidden begin to emerge.\n\nCoral polyps, the tiny animals that build the reef, are among the most active night workers. During daylight many species keep their tentacles withdrawn, relying on the algae living inside their tissues to supply sugars through photosynthesis. After dark, the polyps extend their tentacles to catch drifting plankton, which provides nutrients such as nitrogen and phosphorus that the algae cannot supply.\n\nSome reef organisms also produce their own light. Certain shrimp release glowing clouds when threatened, a tactic that can startle or distract an attacker long enough for the shrimp to escape. Researchers who study these displays caution, however, that the purpose of many glows remains uncertain; a light that seems defensive in one species may help another find a mate.\n\nUnderstanding the reef at night matters for conservation. A survey conducted only during the day can miss a large share of the animals that depend on the reef, which means it may underestimate how much life a damaged reef has lost.',
 214, 'published',
 '{"prompt":"According to the text, why do many coral polyps extend their tentacles at night?","choices":{"A":"To shade the algae in their tissues from moonlight","B":"To capture plankton that supplies nutrients the algae cannot provide","C":"To release glowing clouds that frighten predators","D":"To build new sections of the reef while fish are asleep"},"answer":"B","explanation":"The second paragraph states that after dark the polyps extend their tentacles to catch plankton, which provides nutrients the algae cannot supply.","support":"After dark, the polyps extend their tentacles to catch drifting plankton, which provides nutrients such as nitrogen and phosphorus that the algae cannot supply."}'::jsonb,
 now()),
('A Map Drawn From Memory', 'Literature',
 'An original short excerpt: a grandmother redraws the village she left fifty years ago.',
 E'My grandmother asked for a pencil, not a pen. "Pens are for things you are sure of," she said, and pulled the paper toward her across the kitchen table.\n\nShe began with the river, a single confident curve, and then the bridge, which she drew twice because the first version was too short. "It always felt longer when I was carrying water," she explained, erasing it without regret.\n\nThe houses came next, small squares lined up along a road that bent for no reason I could see. Some squares she filled in; others she left open. When I asked about the empty ones, she tapped them with the eraser. "Those families moved away before I did. I remember the doors, but not who lived behind them."\n\nBy the time she finished, the map was smudged gray in a dozen places. It would not have helped a traveler find anything. But she studied it for a long time, the way a person reads a letter twice, and then she folded it carefully and put it in her pocket.',
 196, 'published',
 '{"prompt":"Based on the text, why does the grandmother prefer a pencil to a pen?","choices":{"A":"She expects her memories to need correcting as she draws.","B":"She wants the map to be precise enough for a traveler.","C":"She has never learned to write with a pen.","D":"She plans to give the finished map to a neighbor."},"answer":"A","explanation":"She says pens are for things you are sure of, and she later erases the bridge without regret, showing she expects to revise uncertain memories.","support":"\"Pens are for things you are sure of,\" she said, and pulled the paper toward her across the kitchen table."}'::jsonb,
 now()),
('Why Cities Are Planting Tiny Forests', 'Environment',
 'Dense patches of native trees, some no bigger than a tennis court, are appearing in neighborhoods worldwide.',
 E'In several cities, volunteers are planting forests that could fit inside a school courtyard. The method behind many of these projects calls for planting dozens of native seedlings of different species very close together, often three to five per square meter, in soil that has been loosened and enriched beforehand.\n\nSupporters argue that crowding the seedlings encourages them to grow upward quickly as they compete for light. They also point out that a mix of native species can attract local insects and birds that rarely visit lawns or single rows of street trees.\n\nScientists are more cautious. Some early measurements suggest that tiny forests can cool the ground beneath them and absorb rainwater that would otherwise rush into drains. Yet researchers note that few projects have been monitored for more than a decade, so claims that these forests grow "ten times faster" than ordinary plantings have not been firmly established.\n\nFor now, the strongest case for tiny forests may be a practical one: they fit into spaces that are too small for a park, and they give neighbors a reason to work together.',
 190, 'published',
 '{"prompt":"Which statement best describes the scientists'' view of tiny forests, as presented in the text?","choices":{"A":"They reject the idea that tiny forests have any benefits.","B":"They believe tiny forests always grow ten times faster than other plantings.","C":"They see some promising early evidence but say long-term claims are not yet established.","D":"They think tiny forests should replace all urban parks."},"answer":"C","explanation":"The third paragraph describes promising early measurements but stresses that few projects have been monitored long enough to confirm the bigger claims.","support":"Yet researchers note that few projects have been monitored for more than a decade, so claims that these forests grow \"ten times faster\" than ordinary plantings have not been firmly established."}'::jsonb,
 now()),
('The Invention of the Public Library Card', 'History',
 'Borrowing books for free once required letters of reference. A short history of opening the doors.',
 E'Today a library card is usually free and easy to obtain, but early lending libraries often worked differently. Many charged a yearly subscription, and some required a new member to bring a letter from a respected person who would vouch for the borrower''s honesty.\n\nDuring the nineteenth century, reformers in several countries began arguing that access to books should not depend on income or social connections. They claimed that public libraries, funded by taxes, would benefit entire communities by helping workers educate themselves.\n\nNot everyone agreed. Critics worried that free libraries would be expensive to maintain and that borrowers would damage or fail to return books. Early public libraries responded with rules that might seem strict today: some kept books behind counters, so patrons had to request each title from a clerk.\n\nOver time, open shelves became common, letting readers browse on their own. That change may sound small, but it shifted the library from a place where people asked permission to read into a place where they could discover books they had not known to look for.',
 198, 'published',
 '{"prompt":"What is the main purpose of the final paragraph?","choices":{"A":"To explain why critics opposed tax-funded libraries","B":"To describe how subscription libraries chose their members","C":"To argue that library rules today are too strict","D":"To highlight how open shelves changed readers'' relationship with libraries"},"answer":"D","explanation":"The final paragraph explains that open shelves turned the library into a place of independent discovery rather than permission.","support":"That change may sound small, but it shifted the library from a place where people asked permission to read into a place where they could discover books they had not known to look for."}'::jsonb,
 now());
