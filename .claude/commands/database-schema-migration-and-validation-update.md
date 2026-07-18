---
name: database-schema-migration-and-validation-update
description: Workflow command scaffold for database-schema-migration-and-validation-update in lindocara.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /database-schema-migration-and-validation-update

Use this workflow when working on **database-schema-migration-and-validation-update** in `lindocara`.

## Goal

Updates the database schema, generates migrations, updates server validation, and adds/updates related tests.

## Common Files

- `src/server/db/schema.ts`
- `migrations/*.sql`
- `migrations/meta/*.json`
- `src/server/*.ts`
- `test/*.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit database schema file (src/server/db/schema.ts)
- Generate and add migration SQL files (migrations/*.sql)
- Update migration metadata (migrations/meta/*.json)
- Update server logic to handle schema changes (src/server/*.ts)
- Update or add tests in test/ directory

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.