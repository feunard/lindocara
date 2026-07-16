```markdown
# lindocara Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill introduces the core development patterns and workflows used in the `lindocara` repository—a TypeScript codebase built with React. It covers conventions for file organization, coding style, and testing, as well as step-by-step guides for common workflows such as feature development and merging from the main branch. By following these patterns, contributors can ensure code consistency, maintainability, and smooth collaboration.

## Coding Conventions

### File Naming
- Use **snake_case** for all file names.
  - Example: `game_logic.ts`, `user_profile.tsx`

### Import Style
- Use **relative imports** for referencing modules within the project.
  - Example:
    ```typescript
    import { calculateScore } from '../shared/score_utils';
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // src/shared/math_utils.ts
    export function add(a: number, b: number): number {
      return a + b;
    }
    ```

### React Components
- Use `.tsx` extension for React components.
- Place UI components under `src/client/ui/`.

### Commit Patterns
- Commit messages are freeform, sometimes with prefixes.
- Average commit message length: ~64 characters.

## Workflows

### Feature Development and Integration
**Trigger:** When implementing or updating a feature that affects multiple layers (client, server, shared, tests).
**Command:** `/feature-workflow`

1. Edit or add implementation files in `src/client`, `src/server`, and `src/shared`.
   - Example: Update `src/client/game/game_logic.ts` and `src/server/world/world_state.ts`.
2. Update protocol or shared data definitions if needed.
   - Example: Modify `src/shared/protocol.ts` to add a new message type.
3. Update or add relevant test files in `test/`.
   - Example: Add `test/game_logic.test.ts`.
4. Update related UI components if necessary.
   - Example: Edit `src/client/ui/score_display.tsx` to reflect new logic.

#### Example
```typescript
// src/shared/protocol.ts
export interface NewFeatureMessage {
  type: 'NEW_FEATURE';
  payload: string;
}
```
```typescript
// test/game_logic.test.ts
import { calculateScore } from '../src/shared/score_utils';
import { describe, it, expect } from 'vitest';

describe('calculateScore', () => {
  it('returns correct score', () => {
    expect(calculateScore(2, 3)).toBe(5);
  });
});
```

---

### Merge Main and Resolve Conflicts
**Trigger:** When bringing a feature/fix branch up to date with `main`, especially before a release or after significant changes.
**Command:** `/merge-main`

1. Merge remote-tracking branch `origin/main` into your branch.
2. Resolve any merge conflicts in code, tests, or assets.
   - Example: Fix conflicts in `src/shared/protocol.ts` and `public/assets/sprites/player.png`.
3. Integrate new or updated assets as needed.
   - Example: Add new images to `public/assets/`.
4. Update documentation and plans/specs if needed.
   - Example: Edit `docs/superpowers/specs/new_feature.md`.
5. Update or add migration and meta files if database/schema changes are involved.
   - Example: Add `migrations/20240601_add_users.sql`.
6. Update tests to match new code or data.
   - Example: Edit `test/user_management.test.ts`.

#### Example
```bash
git fetch origin
git merge origin/main
# Resolve conflicts in your editor, then:
git add .
git commit
```

## Testing Patterns

- **Framework:** [vitest](https://vitest.dev/)
- **Test File Pattern:** `*.test.ts` and `*.test.tsx`
- **Location:** All test files are under the `test/` directory.
- **Example:**
  ```typescript
  // test/example.test.ts
  import { add } from '../src/shared/math_utils';
  import { describe, it, expect } from 'vitest';

  describe('add', () => {
    it('adds two numbers', () => {
      expect(add(1, 2)).toBe(3);
    });
  });
  ```

## Commands

| Command            | Purpose                                                      |
|--------------------|--------------------------------------------------------------|
| /feature-workflow  | Guide for implementing or updating a cross-layer feature     |
| /merge-main        | Steps for merging main branch and resolving conflicts        |
```