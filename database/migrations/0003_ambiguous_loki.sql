CREATE TABLE "invoice_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" varchar(240) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_price" numeric(12, 2) NOT NULL,
	"line_total" numeric(12, 2) NOT NULL,
	CONSTRAINT "invoice_items_quantity_positive_check" CHECK ("invoice_items"."quantity" > 0),
	CONSTRAINT "invoice_items_amounts_nonnegative_check" CHECK ("invoice_items"."unit_price" >= 0 AND "invoice_items"."line_total" >= 0)
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_number" varchar(64) NOT NULL,
	"service_account_id" uuid NOT NULL,
	"account_identifier_snapshot" varchar(64) NOT NULL,
	"subscriber_id" uuid NOT NULL,
	"subscriber_name_snapshot" varchar(160) NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_name_snapshot" varchar(160) NOT NULL,
	"billing_period_start" date NOT NULL,
	"billing_period_end" date NOT NULL,
	"issue_date" date NOT NULL,
	"due_date" date NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_amounts_nonnegative_check" CHECK ("invoices"."subtotal" >= 0 AND "invoices"."total" >= 0),
	CONSTRAINT "invoices_period_check" CHECK ("invoices"."billing_period_end" >= "invoices"."billing_period_start"),
	CONSTRAINT "invoices_due_date_check" CHECK ("invoices"."due_date" >= "invoices"."issue_date")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payments_amount_positive_check" CHECK ("payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "permissions" DROP CONSTRAINT "permissions_key_check";--> statement-breakpoint
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_service_account_id_service_accounts_id_fk" FOREIGN KEY ("service_account_id") REFERENCES "public"."service_accounts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriber_id_subscribers_id_fk" FOREIGN KEY ("subscriber_id") REFERENCES "public"."subscribers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invoice_items_invoice_id_idx" ON "invoice_items" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_service_account_period_unique" ON "invoices" USING btree ("service_account_id","billing_period_start");--> statement-breakpoint
CREATE INDEX "invoices_period_idx" ON "invoices" USING btree ("billing_period_start");--> statement-breakpoint
CREATE INDEX "invoices_subscriber_idx" ON "invoices" USING btree ("subscriber_id");--> statement-breakpoint
CREATE INDEX "invoices_due_date_idx" ON "invoices" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "payments_invoice_id_idx" ON "payments" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "payments_received_at_idx" ON "payments" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "permissions" ADD CONSTRAINT "permissions_key_check" CHECK ("permissions"."key" IN ('users.read', 'users.manage', 'roles.manage', 'permissions.manage', 'plans.read', 'plans.manage', 'subscribers.read', 'subscribers.manage', 'service_accounts.read', 'service_accounts.manage', 'invoices.read', 'invoices.manage'));
--> statement-breakpoint
INSERT INTO "permissions" ("key") VALUES ('invoices.read'), ('invoices.manage') ON CONFLICT ("key") DO NOTHING;
--> statement-breakpoint
INSERT INTO "role_permissions" ("role_id", "permission_id")
SELECT roles.id, permissions.id
FROM "roles" AS roles
CROSS JOIN "permissions" AS permissions
WHERE roles.name = 'Administrator'
  AND permissions.key IN ('invoices.read', 'invoices.manage')
ON CONFLICT DO NOTHING;
