ALTER TABLE "org"."member" ADD COLUMN "last_login_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "changed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "org"."member" ADD COLUMN "changed_by_name" text;