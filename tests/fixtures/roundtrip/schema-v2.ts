import { integer, pgTable, serial, varchar } from "drizzle-orm/pg-core";

export const widgets = pgTable("widgets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  price: integer("price"),
});

export const gadgets = pgTable("gadgets", {
  id: serial("id").primaryKey(),
});
