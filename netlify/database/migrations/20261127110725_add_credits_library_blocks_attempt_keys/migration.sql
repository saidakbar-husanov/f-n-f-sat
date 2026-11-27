CREATE TABLE "credit_accounts" (
	"student_id" integer PRIMARY KEY,
	"enabled" boolean DEFAULT false NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"enabled_by" integer,
	"enabled_at" timestamp,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_holds" (
	"id" serial PRIMARY KEY,
	"key" text NOT NULL,
	"student_id" integer NOT NULL,
	"amount" integer NOT NULL,
	"charged" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'held' NOT NULL,
	"ref" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"settled_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" serial PRIMARY KEY,
	"student_id" integer NOT NULL,
	"key" text NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"kind" text NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"actor_id" integer,
	"batch_id" text,
	"attempt_id" integer,
	"ref" text DEFAULT '' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "attempts" ADD COLUMN "client_key" text;--> statement-breakpoint
ALTER TABLE "library_articles" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "library_articles" ADD COLUMN "blocks" jsonb;--> statement-breakpoint
CREATE UNIQUE INDEX "attempts_student_client_key" ON "attempts" ("student","client_key");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_holds_key" ON "credit_holds" ("key");--> statement-breakpoint
CREATE INDEX "credit_holds_student" ON "credit_holds" ("student_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "credit_ledger_key" ON "credit_ledger" ("key");--> statement-breakpoint
CREATE INDEX "credit_ledger_student" ON "credit_ledger" ("student_id","created_at");--> statement-breakpoint
CREATE INDEX "credit_ledger_batch" ON "credit_ledger" ("batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_articles_external_id" ON "library_articles" ("external_id");--> statement-breakpoint
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_balance_nonneg" CHECK ("balance" >= 0);
--> statement-breakpoint
-- credit_apply: the only way a balance changes outside hold settlement. Locks
-- the account row, so concurrent calls (double clicks, two tabs, retries)
-- serialise; a key that was already applied returns the stored result.
--   delta > 0  grant / top-up (never enables the mode)
--   delta < 0  charge; refused when the mode is off or the available balance
--              (balance minus credits held for open sittings) is too small
--   p_target   correction: set the balance to this value (delta is computed)
CREATE OR REPLACE FUNCTION credit_apply(p_student int, p_key text, p_delta int, p_kind text, p_reason text,
  p_actor int, p_batch text, p_attempt int, p_ref text, p_target int DEFAULT NULL)
RETURNS TABLE(ok boolean, duplicate boolean, balance int, available int, delta int, error text)
LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE acc credit_accounts%ROWTYPE; prev credit_ledger%ROWTYPE; held int; d int;
BEGIN
  INSERT INTO credit_accounts (student_id) VALUES (p_student) ON CONFLICT (student_id) DO NOTHING;
  SELECT * INTO acc FROM credit_accounts WHERE student_id = p_student FOR UPDATE;
  SELECT coalesce(sum(h.amount), 0)::int INTO held FROM credit_holds h WHERE h.student_id = p_student AND h.status = 'held';
  SELECT * INTO prev FROM credit_ledger l WHERE l.key = p_key;
  IF FOUND THEN
    RETURN QUERY SELECT true, true, acc.balance, greatest(acc.balance - held, 0), prev.delta, NULL::text; RETURN;
  END IF;
  d := CASE WHEN p_target IS NOT NULL THEN greatest(p_target, 0) - acc.balance ELSE p_delta END;
  IF d < 0 AND p_kind = 'debit' THEN
    IF NOT acc.enabled THEN
      RETURN QUERY SELECT false, false, acc.balance, greatest(acc.balance - held, 0), 0, 'disabled'::text; RETURN;
    END IF;
    IF acc.balance - held + d < 0 THEN
      RETURN QUERY SELECT false, false, acc.balance, greatest(acc.balance - held, 0), 0, 'insufficient'::text; RETURN;
    END IF;
  END IF;
  IF acc.balance + d < 0 THEN d := -acc.balance; END IF;
  UPDATE credit_accounts SET balance = credit_accounts.balance + d, updated_at = now() WHERE student_id = p_student;
  INSERT INTO credit_ledger (student_id, key, delta, balance_after, kind, reason, actor_id, batch_id, attempt_id, ref)
    VALUES (p_student, p_key, d, acc.balance + d, p_kind, coalesce(p_reason, ''), p_actor, p_batch, p_attempt, coalesce(p_ref, ''));
  RETURN QUERY SELECT true, false, acc.balance + d, greatest(acc.balance + d - held, 0), d, NULL::text;
END $fn$;
--> statement-breakpoint
-- credit_hold: reserve up to p_amount credits for one module of a sitting.
-- Holds only while the mode is on; an existing hold with the same key is returned.
CREATE OR REPLACE FUNCTION credit_hold(p_student int, p_key text, p_amount int, p_ref text, p_require_full boolean)
RETURNS TABLE(ok boolean, amount int, balance int, available int, error text)
LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE acc credit_accounts%ROWTYPE; h credit_holds%ROWTYPE; held int; amt int; existing boolean;
BEGIN
  SELECT * INTO acc FROM credit_accounts WHERE student_id = p_student FOR UPDATE;
  IF NOT FOUND OR NOT acc.enabled THEN
    RETURN QUERY SELECT false, 0, coalesce(acc.balance, 0), 0, 'disabled'::text; RETURN;
  END IF;
  SELECT * INTO h FROM credit_holds WHERE key = p_key;
  existing := FOUND;
  SELECT coalesce(sum(x.amount), 0)::int INTO held FROM credit_holds x WHERE x.student_id = p_student AND x.status = 'held';
  IF existing THEN
    RETURN QUERY SELECT h.status = 'held', h.amount, acc.balance, greatest(acc.balance - held, 0), NULL::text; RETURN;
  END IF;
  amt := least(p_amount, greatest(acc.balance - held, 0));
  IF p_require_full AND amt < p_amount THEN
    RETURN QUERY SELECT false, 0, acc.balance, greatest(acc.balance - held, 0), 'insufficient'::text; RETURN;
  END IF;
  IF amt <= 0 THEN
    RETURN QUERY SELECT false, 0, acc.balance, greatest(acc.balance - held, 0), 'insufficient'::text; RETURN;
  END IF;
  INSERT INTO credit_holds (key, student_id, amount, ref) VALUES (p_key, p_student, amt, coalesce(p_ref, ''));
  RETURN QUERY SELECT true, amt, acc.balance, greatest(acc.balance - held - amt, 0), NULL::text;
END $fn$;
--> statement-breakpoint
-- credit_settle: close a hold once. Charges least(p_charge, held amount,
-- balance) and releases the rest; p_charge = 0 simply releases it.
CREATE OR REPLACE FUNCTION credit_settle(p_key text, p_charge int, p_reason text)
RETURNS TABLE(ok boolean, duplicate boolean, charged int, balance int)
LANGUAGE plpgsql AS $fn$
#variable_conflict use_column
DECLARE h credit_holds%ROWTYPE; acc credit_accounts%ROWTYPE; c int;
BEGIN
  SELECT * INTO h FROM credit_holds WHERE key = p_key;
  IF NOT FOUND THEN RETURN QUERY SELECT false, false, 0, NULL::int; RETURN; END IF;
  SELECT * INTO acc FROM credit_accounts WHERE student_id = h.student_id FOR UPDATE;
  SELECT * INTO h FROM credit_holds WHERE key = p_key FOR UPDATE;
  IF h.status <> 'held' THEN RETURN QUERY SELECT true, true, h.charged, acc.balance; RETURN; END IF;
  c := greatest(0, least(coalesce(p_charge, 0), h.amount, acc.balance));
  IF c > 0 THEN
    UPDATE credit_accounts SET balance = credit_accounts.balance - c, updated_at = now() WHERE student_id = h.student_id;
    INSERT INTO credit_ledger (student_id, key, delta, balance_after, kind, reason, ref)
      VALUES (h.student_id, 'settle:' || p_key, -c, acc.balance - c, 'settle', coalesce(p_reason, ''), h.ref);
  END IF;
  UPDATE credit_holds SET status = CASE WHEN c > 0 THEN 'settled' ELSE 'released' END, charged = c, settled_at = now() WHERE id = h.id;
  RETURN QUERY SELECT true, false, c, acc.balance - c;
END $fn$;
