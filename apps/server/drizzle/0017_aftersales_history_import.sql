CREATE TABLE "aftersales"."history_import" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"aftersales_id" uuid NOT NULL,
	"source_key" text NOT NULL,
	"source_file" text NOT NULL,
	"source_row" integer NOT NULL,
	"usd_assumed" boolean NOT NULL,
	"fee_date_from_registered" boolean NOT NULL,
	"source" jsonb NOT NULL,
	"imported_at" timestamp with time zone NOT NULL,
	CONSTRAINT "history_import_aftersales_id_key" UNIQUE("aftersales_id"),
	CONSTRAINT "history_import_source_key_key" UNIQUE("source_key")
);
--> statement-breakpoint
ALTER TABLE "aftersales"."history_import" ADD CONSTRAINT "history_import_aftersales_id_aftersales_id_fk" FOREIGN KEY ("aftersales_id") REFERENCES "aftersales"."aftersales"("id") ON DELETE no action ON UPDATE no action;