---
name: feature-development-with-tests-and-i18n
description: Workflow command scaffold for feature-development-with-tests-and-i18n in lindocara.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-with-tests-and-i18n

Use this workflow when working on **feature-development-with-tests-and-i18n** in `lindocara`.

## Goal

Implements a new feature or major enhancement, updating implementation, tests, and internationalization files.

## Common Files

- `src/client/ui/*.tsx`
- `src/client/game/*.ts`
- `src/client/store.ts`
- `src/server/*.ts`
- `src/shared/i18n/en.ts`
- `src/shared/i18n/fr.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Implement feature logic in src/client or src/server files
- Update or create related UI components in src/client/ui
- Update shared data or protocol in src/shared
- Update i18n files (src/shared/i18n/en.ts, src/shared/i18n/fr.ts)
- Write or update tests in test/ directory

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.