```markdown
# lindocara Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `lindocara` TypeScript codebase. It covers file organization, import/export styles, commit message practices, and how to write and run tests using Vitest. The repository does not use a specific framework, focusing on clean, modular TypeScript code.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `userProfile.ts`, `dataFetcher.ts`

### Import Style
- Use **relative imports** for modules within the codebase.
  - Example:
    ```typescript
    import { fetchData } from './dataFetcher'
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // In userProfile.ts
    export function getUserProfile(id: string) { ... }
    ```

### Commit Messages
- **Freeform** commit messages, sometimes with prefixes.
- Average length: ~46 characters.
  - Example: `fix: correct typo in userProfile function`

## Workflows

_No automated workflows detected in this repository._

## Testing Patterns

- **Testing Framework:** [Vitest](https://vitest.dev/)
- **Test File Pattern:** Files end with `.test.ts`
  - Example: `userProfile.test.ts`
- **Test Example:**
    ```typescript
    import { describe, it, expect } from 'vitest'
    import { getUserProfile } from './userProfile'

    describe('getUserProfile', () => {
      it('returns user data for valid id', () => {
        expect(getUserProfile('123')).toEqual({ id: '123', name: 'Alice' })
      })
    })
    ```
- **Running Tests:**
    - Use the Vitest CLI:
      ```
      npx vitest
      ```

## Commands
| Command     | Purpose                                      |
|-------------|----------------------------------------------|
| /run-tests  | Run all Vitest tests in the repository       |
| /lint       | Lint the codebase (if linter is configured)  |
| /commit     | Make a new commit following conventions      |
```