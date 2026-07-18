```markdown
# lindocara Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill provides a comprehensive guide to the development patterns, coding conventions, and workflows used in the `lindocara` TypeScript codebase. The repository is organized without a specific framework, focusing on modular TypeScript code for both client and server, with strong emphasis on testing, internationalization, and maintainable UI/editor components. The documented workflows streamline feature development, database migrations, UI enhancements, and documentation updates.

## Coding Conventions

**File Naming**
- Use `camelCase` for file and directory names.
  - Example: `mapEditor.tsx`, `adventureEditor.tsx`

**Imports**
- Use relative import paths.
  - Example:
    ```typescript
    import { getUser } from '../shared/user';
    ```

**Exports**
- Prefer named exports.
  - Example:
    ```typescript
    // Good
    export function validateInput(input: string): boolean { ... }

    // Avoid default exports
    // export default function() { ... }
    ```

**Commit Messages**
- Freeform, no strict prefix, average length ~51 characters.

**Internationalization**
- Update language files in `src/shared/i18n/en.ts` and `src/shared/i18n/fr.ts` when adding user-facing text.

## Workflows

### Feature Development with Tests and i18n
**Trigger:** When adding a new feature or major enhancement  
**Command:** `/feature-with-tests-i18n`

1. Implement feature logic in `src/client` or `src/server` as appropriate.
2. Update or create related UI components in `src/client/ui`.
3. Update shared data or protocol in `src/shared`.
4. Update i18n files:
    - `src/shared/i18n/en.ts`
    - `src/shared/i18n/fr.ts`
5. Write or update tests in the `test/` directory.

**Example:**
```typescript
// src/client/game/newFeature.ts
export function newFeatureLogic() { ... }

// src/shared/i18n/en.ts
export const en = {
  ...,
  newFeature: "New Feature",
};
```
```typescript
// test/newFeature.test.ts
import { newFeatureLogic } from '../src/client/game/newFeature';
import { describe, it, expect } from 'vitest';

describe('newFeatureLogic', () => {
  it('should work as expected', () => {
    expect(newFeatureLogic()).toBe(true);
  });
});
```

---

### Database Schema Migration and Validation Update
**Trigger:** When changing or adding a database table/field and updating validation/tests  
**Command:** `/db-migration`

1. Edit the database schema in `src/server/db/schema.ts`.
2. Generate and add migration SQL files in `migrations/*.sql`.
3. Update migration metadata in `migrations/meta/*.json`.
4. Update server logic in `src/server/` to handle schema changes.
5. Update or add tests in `test/`.

**Example:**
```typescript
// src/server/db/schema.ts
export const users = table('users', {
  id: integer().primaryKey(),
  email: text(),
  // Add new field:
  isActive: boolean().default(true),
});
```
```sql
-- migrations/20240601_add_isActive_to_users.sql
ALTER TABLE users ADD COLUMN isActive BOOLEAN DEFAULT TRUE;
```

---

### UI Editor Enhancement with Style Update
**Trigger:** When improving or adding features to editor UI components  
**Command:** `/ui-editor-enhance`

1. Update or create editor UI components in `src/client/ui`.
2. Update related state or logic in `src/client/game` or `src/client/store.ts`.
3. Modify or add styles in `src/client/styles/*.css`.
4. Update or add related tests in `test/ui`.

**Example:**
```typescript
// src/client/ui/MapEditor.tsx
export function MapEditor() {
  // Enhanced editor logic
  return <div className="map-editor">...</div>;
}
```
```css
/* src/client/styles/legacy.css */
.map-editor {
  border: 1px solid #ccc;
  padding: 8px;
}
```
```typescript
// test/ui/map-editor.test.tsx
import { render } from '@testing-library/react';
import { MapEditor } from '../../src/client/ui/MapEditor';

test('renders map editor', () => {
  const { getByText } = render(<MapEditor />);
  expect(getByText(/map/i)).toBeInTheDocument();
});
```

---

### Documentation Update
**Trigger:** When documenting new features, changes, or auditing the codebase  
**Command:** `/docs-update`

1. Edit or add markdown files in `docs/` or the root directory.
2. Update `README.md` or related documentation assets.

**Example:**
```markdown
# Feature X

This document explains the design and usage of Feature X...
```

## Testing Patterns

- **Framework:** [vitest](https://vitest.dev/)
- **Test file pattern:** `*.test.ts` and `test/ui/*.test.tsx`
- **Location:** All tests are placed under the `test/` directory.
- **Example test:**
  ```typescript
  // test/example.test.ts
  import { myFunction } from '../src/shared/myModule';
  import { describe, it, expect } from 'vitest';

  describe('myFunction', () => {
    it('returns true for valid input', () => {
      expect(myFunction('valid')).toBe(true);
    });
  });
  ```

## Commands

| Command                   | Purpose                                                                 |
|---------------------------|-------------------------------------------------------------------------|
| /feature-with-tests-i18n  | Start a new feature with tests and i18n updates                         |
| /db-migration             | Begin a database schema change and update related validation/tests       |
| /ui-editor-enhance        | Enhance or refactor editor UI components and update styles/tests         |
| /docs-update              | Update or add documentation files                                       |
```