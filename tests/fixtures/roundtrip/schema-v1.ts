import { pgTable, serial, varchar } from "drizzle-orm/pg-core";

export const widgets = pgTable("widgets", {
  id: serial("id").primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
});
