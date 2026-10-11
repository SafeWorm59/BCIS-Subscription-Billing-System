CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"description" text,
	"price" numeric(12, 2) NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_name_not_empty_check" CHECK (length(btrim("plans"."name")) > 0),
	CONSTRAINT "plans_price_nonnegative_check" CHECK ("plans"."price" >= 0)
);
--> statement-breakpoint
CREATE TABLE "service_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_identifier" varchar(64) NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" varchar(16) DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_accounts_identifier_not_empty_check" CHECK (length(btrim("service_accounts"."account_identifier")) > 0),
	CONSTRAINT "service_accounts_status_check" CHECK ("service_accounts"."status" IN ('active', 'suspended', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"email" varchar(254),
	"phone" varchar(32),
	"address_line_1" varchar(200) NOT NULL,
	"address_line_2" varchar(200),
	"city" varchar(100) NOT NULL,
	"province" varchar(100) NOT NULL,
	"postal_code" varchar(20),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscribers_name_not_empty_check" CHECK (length(btrim("subscribers"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_key_check";--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_accounts" ADD CONSTRAINT "service_accounts_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plans_name_idx" ON "plans" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "service_accounts_identifier_unique" ON "service_accounts" USING btree ("account_identifier");--> statement-breakpoint
CREATE INDEX "service_accounts_subscriber_id_idx" ON "service_accounts" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "service_accounts_plan_id_idx" ON "service_accounts" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "service_accounts_status_idx" ON "service_accounts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "subscribers_name_idx" ON "subscribers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "subscribers_email_idx" ON "subscribers" USING btree ("email");--> statement-breakpoint
CREATE INDEX "subscribers_phone_idx" ON "subscribers" USING btree ("phone");--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_key_check" CHECK ("permissions"."key" IN ('users.read', 'users.manage', 'roles.manage', 'permissions.manage', 'plans.read', 'plans.manage', 'subscribers.read', 'subscribers.manage', 'service_accounts.read', 'service_accounts.manage'));