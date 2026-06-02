---
"drizzle-rollback": patch
---

`down` no longer fails when the `__drizzle_migrations` table contains a row with no matching `.sql` file — for example a `drizzle-kit push` baseline. Only the migrations actually being reverted are mapped to files now, so older unmatched rows are left untouched. Reverting a migration whose own file is missing still errors clearly.
