---
name: merge-main-and-resolve-conflicts
description: Workflow command scaffold for merge-main-and-resolve-conflicts in lindocara.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /merge-main-and-resolve-conflicts

Use this workflow when working on **merge-main-and-resolve-conflicts** in `lindocara`.

## Goal

Merges changes from the main branch, resolves conflicts, and integrates new or updated assets, documentation, and code.

## Common Files

- `docs/superpowers/plans/*.md`
- `docs/superpowers/specs/*.md`
- `migrations/*.sql`
- `migrations/meta/*.json`
- `public/assets/**/*.png`
- `public/assets/**/*.json`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Merge remote-tracking branch 'origin/main'.
- Resolve merge conflicts in code, tests, or assets.
- Integrate new or updated assets (e.g., images, sprites).
- Update documentation and plans/specs if needed.
- Update or add migration and meta files if database/schema changes are involved.

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.