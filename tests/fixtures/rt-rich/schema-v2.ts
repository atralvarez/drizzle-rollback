import { index, integer, pgEnum, pgTable, serial, varchar } from "drizzle-orm/pg-core";

export const bookStatus = pgEnum("book_status", ["draft", "published"]);

export const authors = pgTable("authors", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }),
});

export const books = pgTable(
  "books",
  {
    id: serial("id").primaryKey(),
    title: varchar("title", { length: 255 }),
    authorId: integer("author_id").references(() => authors.id),
    status: bookStatus("status"),
  },
  (t) => [index("books_title_author_idx").on(t.title.desc(), t.authorId)],
);
