```markdown
# lindocara Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `lindocara` TypeScript codebase. It covers file organization, import/export styles, commit practices, and testing patterns. By following these guidelines, contributors can maintain consistency and readability throughout the project.

## Coding Conventions

### File Naming
- **Style:** Snake case  
  **Example:**  
  ```plaintext
  user_profile.ts
  data_loader.ts
  ```

### Import Style
- **Relative imports** are used for referencing local modules.  
  **Example:**  
  ```typescript
  import { fetchData } from './data_loader';
  ```

### Export Style
- **Named exports** are preferred.  
  **Example:**  
  ```typescript
  // In user_profile.ts
  export function getUserProfile(id: string) { ... }
  ```

### Commit Patterns
- **Type:** Freeform messages, no enforced prefixes.
- **Average length:** ~63 characters.
- **Example:**  
  ```
  Add new user profile loader and update fetch logic
  ```

## Workflows

### Adding a New Module
**Trigger:** When creating a new feature or utility module  
**Command:** `/add-module`

1. Create a new file using snake_case naming (e.g., `feature_name.ts`).
2. Implement your logic using named exports.
3. Use relative imports for any dependencies.
4. Add or update corresponding test files (`feature_name.test.ts`).
5. Commit with a clear, descriptive message.

### Importing and Exporting Functions
**Trigger:** When sharing code between files  
**Command:** `/import-export`

1. Use named exports in your module:
   ```typescript
   export function calculateSum(a: number, b: number) { ... }
   ```
2. Import using relative paths:
   ```typescript
   import { calculateSum } from './math_utils';
   ```

### Writing Tests
**Trigger:** When adding or updating functionality  
**Command:** `/write-test`

1. Create a test file with the `.test.` pattern (e.g., `feature_name.test.ts`).
2. Write tests for each exported function.
3. Use the project's preferred (unknown) testing framework.
4. Run tests to ensure correctness.

## Testing Patterns

- **File Pattern:** Test files are named with `.test.` in the filename (e.g., `user_profile.test.ts`).
- **Framework:** Not explicitly specified; use the project's existing setup.
- **Example:**
  ```typescript
  import { getUserProfile } from './user_profile';

  test('should fetch user profile by ID', () => {
    // test logic here
  });
  ```

## Commands
| Command         | Purpose                                         |
|-----------------|-------------------------------------------------|
| /add-module     | Scaffold a new module following conventions     |
| /import-export  | Example for importing and exporting functions   |
| /write-test     | Guide for writing and placing test files        |
```
