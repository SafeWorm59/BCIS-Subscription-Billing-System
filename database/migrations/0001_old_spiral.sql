CREATE TABLE "login_rate_limit_buckets" (
	"key_hash" varchar(64) PRIMARY KEY NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"attempt_count" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "login_rate_limit_buckets_key_hash_check" CHECK ("login_rate_limit_buckets"."key_hash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "login_rate_limit_buckets_attempt_count_check" CHECK ("login_rate_limit_buckets"."attempt_count" > 0)
);
--> statement-breakpoint
CREATE INDEX "login_rate_limit_buckets_window_started_at_idx" ON "login_rate_limit_buckets" USING btree ("window_started_at");