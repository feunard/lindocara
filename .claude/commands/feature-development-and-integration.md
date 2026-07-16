---
name: feature-development-and-integration
description: Workflow command scaffold for feature-development-and-integration in lindocara.
allowed_tools: ["Bash", "Read", "Write", "Grep", "Glob"]
---

# /feature-development-and-integration

Use this workflow when working on **feature-development-and-integration** in `lindocara`.

## Goal

Implements or updates a feature across client, server, shared, and test code, ensuring all layers are consistent and tested.

## Common Files

- `src/client/game/*.ts`
- `src/client/ui/*.tsx`
- `src/server/*.ts`
- `src/server/world/*.ts`
- `src/shared/*.ts`
- `test/*.test.ts`

## Suggested Sequence

1. Understand the current state and failure mode before editing.
2. Make the smallest coherent change that satisfies the workflow goal.
3. Run the most relevant verification for touched files.
4. Summarize what changed and what still needs review.

## Typical Commit Signals

- Edit or add implementation files in src/client, src/server, and src/shared.
- Update protocol or shared data definitions if needed (e.g., src/shared/protocol.ts).
- Update or add relevant test files in test/.
- Update related UI components if necessary (e.g., src/client/ui/).

## Notes

- Treat this as a scaffold, not a hard-coded script.
- Update the command if the workflow evolves materially.