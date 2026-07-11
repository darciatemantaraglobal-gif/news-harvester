---
name: Settings storage in the AINA scraper's Supabase project
description: Where app-level toggles/settings should be persisted for this project, and a caveat about an unrelated pre-existing table.
---

This project's own Supabase project has an existing `system_settings` table, but it is
not created or used by this codebase (not referenced anywhere in the repo) and its
schema/ownership is unknown — it likely belongs to a different app (e.g. the main AINA
app) sharing the same Supabase project.

**Why:** Do not assume `system_settings` is a generic key/value store you can reuse.
Discovering it (via a Postgrest "did you mean" error hint) is not the same as it being
safe to write to — writing into a table you don't own risks colliding with another
app's data model.

**How to apply:** For new app-level toggles/settings in this codebase, use a
purpose-built table declared in this repo's own SQL migration file (e.g.
`app_settings` with `key text primary key, value jsonb`), and remember new tables
require the user to run the SQL manually in the Supabase SQL editor — this project has
no automatic migration runner.
