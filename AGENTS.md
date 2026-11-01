# Project agent instructions

## Synced reference material

- Treat every file under `sources/` as read-only reference material.
- Do not edit, rename, move, or delete synced project files.
- These files may be replaced the next time a task is created from this ChatGPT project.

## Project instructions

### Validation modes

Choose the smallest validation mode that matches the change.

#### FAST

Use for UI, copy, layout, documentation, or small isolated changes.

- Run targeted tests only.
- Run lint and diff checks when relevant.
- Do not run a full production build unless the change affects build behavior.

#### FEATURE

Use for functional application changes.

- Run the relevant tests.
- Run TypeScript validation.
- Run lint.

#### RELEASE

Use for release preparation, branch normalization, tags, or deployment candidates.

- Run the full test suite.
- Run lint.
- Run TypeScript validation.
- Run the production build.
- Run the diff check.
- Perform a security review when the change affects authentication, authorization, secrets, privacy, or trusted writes.

### Efficiency rules

- Never run `pnpm install` unless dependencies changed, the lockfile requires it, or `node_modules` is unavailable.
- Do not repeatedly audit unrelated parts of the application after small changes.
- Preserve `main` as the latest QA-approved source version.
- Vercel Production always requires explicit, separate approval.
