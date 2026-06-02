CREATE TYPE "public"."book_status" AS ENUM('draft', 'published');--> statement-breakpoint
ALTER TABLE "books" ADD COLUMN "status" "book_status";--> statement-breakpoint
ALTER TABLE "books" ADD CONSTRAINT "books_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "books_title_author_idx" ON "books" USING btree ("title" DESC NULLS LAST,"author_id");