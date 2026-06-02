CREATE TABLE "gadgets" (
	"id" serial PRIMARY KEY NOT NULL
);
--> statement-breakpoint
ALTER TABLE "widgets" ADD COLUMN "price" integer;