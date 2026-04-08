# Claude Code Instructions — SiteMaintenance

## Database migrations

When creating a new migration file in `database/migrations/`, always also:

1. **Update `database/schema.sql`** — apply the same DDL so fresh installs are complete without running migrations manually
2. **Update `README.md`** — keep the Upgrading section and setup steps current

Any time a `database/migrations/NNN_*.sql` file is created or modified, update both files as part of the same change.

## Import / Export

Any time a table gains or loses columns, a new module is added, or field names change — review the relevant import/export route (e.g. `inventoryRoutes.js`) to ensure:
- Downloadable CSV/Excel templates have correct headers
- Export queries select correct columns
- Import parsers map to correct field names

## Permissions reference chart

When adding a new role or permission, always update the Permissions Reference modal table in `src/views/admin/users/form.ejs`:
- Add a new `<th>` column header in `<thead>`
- Add a `<td>` cell (with `y()`, `n()`, or `p('...')`) to every capability row
- Add a new section row (`table-secondary`) + capability row(s) for the new role's capabilities
- Update all `colspan` values on section header rows to match the new column count

## Production environment

- Production is hosted on **RHEL** — avoid Windows-specific assumptions in scripts, paths, or process management advice
- For production deployment: use `node server.js` via systemd or PM2, not nodemon
- Production SQL Server DB uses schema **sirnmx** (e.g. `sirnmx.Users`, `sirnmx.Sites`)
  - Write migrations and schema.sql using plain table names (no prefix) as normal
  - After writing any DB file, paste a second version in chat with all table references prefixed as `sirnmx.<TableName>` so it can be copy-pasted into prod
