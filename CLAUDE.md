# Claude Code instructions for station-bot

## Commits
- Never include `Co-Authored-By` trailers or any AI attribution in commit messages.
- Before committing any code, always run `npm run quality` locally and confirm it passes.
- Before committing, perform an objective self-review of all changed code from the perspective of a senior principal engineer: check for SOLID principles, single responsibility, clean abstractions, naming clarity, test coverage, and any code smells or over-engineering. Surface any concerns before the code is committed.
- When changing or removing a feature, grep the test file for tests that reference the old behaviour (option names, response strings, function signatures) and remove or update them before running the quality gate. Stale tests referencing removed code are a common source of preventable failures.
- When writing or updating tests that mock external modules (e.g. `jest.unstable_mockModule`), verify that every named export present in the real module is included in the mock object — missing exports cause ESM validation errors at runtime.
- When writing discord.js interaction test stubs: ensure `reply` mutates `interaction.replied = true` and `deferReply` mutates `interaction.deferred = true`, matching real interaction state. Use `createNominationInteraction()` where it exists rather than building inline objects from scratch.

## Workflow
- All changes go through: issue → feature branch → PR. No direct commits to main.
- When starting work on a new issue, assign it to `GitAddRemote` if possible.
- Branch naming: use a prefix matching the change type — `feature/ISSUE-{n}`, `bug/ISSUE-{n}`, `chore/ISSUE-{n}`, `release/v{x.y.z}`
- PR title format: `<type>: ISSUE-{n} — description` (Conventional Commits style — e.g. `feature`, `bug`, `chore`, `fix`, `release`)
- PRs close issues via "Closes #n" in body
- All PRs are squash-merged into main
- Quality gate before every PR: `npm run quality`
- When addressing code review comments: reply to the comment explaining what was done, then resolve it.

## Security
- Never commit `.env` files, credentials, private keys, or the `certs/` directory — all are `.gitignore`d
- If a secret is accidentally committed: rotate it immediately, then scrub the history (BFG or `git filter-repo`) and force-push
- SSL/TLS certs are generated via `scripts/gen-certs.sh` — never commit the output
- Dependency security patches get their own `chore/ISSUE-{n}` branch and PR; run `npm audit` before raising one
- `npm audit --audit-level=high` is part of the `quality` gate — high and critical severity findings are hard blockers

## Database
- Migration tool: `node-pg-migrate` — migrations live in `./migrations/`
- Scaffold a new migration: `npm run migrate:create -- <name>`
- Apply migrations: `npm run migrate:up` (requires `DATABASE_URL`)
- Roll back one step: `npm run migrate:down` — use with care in production
- Never run destructive SQL (`DROP`, `TRUNCATE`, `DELETE` without `WHERE`) without an explicit backup or user confirmation
- Every PR that changes the schema must include the corresponding migration file

## Release Process
1. Cut a `release/v{x.y.z}` branch from `main`
2. Bump the version in `package.json` to `x.y.z` — this is the canonical source of truth and what the Docker publish workflow validates against
3. Run `npm install --package-lock-only` to sync `package-lock.json` — commit both files together
4. Verify: `grep '"version"' package.json` must show the new version before committing
5. Run `npm run quality` — must pass before opening the PR
6. Open a PR titled `release: v{x.y.z}`; body must state the diff is version-bump-only and list included PRs by number for changelog context — do NOT describe features as if they are in the diff
7. Squash-merge into `main`
8. Tag the merge commit on `main`: `git tag v{x.y.z} && git push origin v{x.y.z}` — never tag the release branch itself
9. Create a GitHub Release from that tag with human-readable release notes
10. Build and push the Docker image tagged both `:v{x.y.z}` and `:latest`

## Testing
- **Unit tests** (filename: `*.test.ts`) — the bulk of the test suite; cover utilities, pure logic, policies, services, and repositories using mocks.
- **Integration tests** (filename: `*.integration.test.ts`) — supplemental only; reserved for critical system communication checks (e.g. verifying real DB queries execute correctly, external service contracts). Require a live Postgres instance (`DATABASE_URL` must be set). Do not duplicate what a unit test already covers.
- Every PR must include unit tests for changed/new logic and integration tests where a critical system boundary is introduced or modified.
- Tests live in a `__tests__/` directory co-located with the module they cover.

## Issues
Every GitHub issue you create must follow this format without exception:

- **User Story** — `As a <role>, I want <capability> so that <outcome>.` Use Tech Story instead when there is no direct user-facing benefit (e.g. refactors, chores, infra).
- **Tech Story** — For non-user-facing work: describe the current state, what is wrong or missing, and what the correct state should be. Include file paths and line numbers where the problem lives.
- **Technical Elaboration** — List every file expected to change (new or existing), with a bullet-point breakdown of the specific changes in each file. Include relevant code snippets showing current code and/or the expected shape of the change. For migrations, show the scaffold command and the column definition. For new files, describe exports and their signatures.
- **Definition of Done** — A checklist of verifiable completion criteria. Every item must be independently checkable. Always include: behaviour correct, tests written and passing, `npm run quality` passes.
- **Dependencies** — List any issues that must be merged before this one, any issues that this one blocks, and any issues that touch the same files (coordination notes). If none, write "None."
- **Labels** — Apply the most appropriate label from the repo's label set (`bug`, `enhancement`, `documentation`, `good first issue`, etc.) when creating the issue.

Issues that are too large to implement in a single focused PR must be split. A good split follows a natural seam (e.g. infrastructure then feature, or config then logic) so each part can be merged and verified independently.

## Incidents / Production Bugs
- Production bugs get a `bug/ISSUE-{n}` branch — never hotfix directly to main

## Pre-PR Self-Review Checklist
Before opening a PR, verify:
- [ ] `npm run quality` passes
- [ ] No hardcoded secrets, tokens, or environment-specific values
- [ ] Migration included if schema changed
- [ ] `docker-compose` config tested if infra changed
- [ ] For releases: version bumped in `package.json` AND `package-lock.json` updated via `npm install --package-lock-only` — confirm with `grep '"version"' package.json`
- [ ] Documentation is consistent with the final implementation: inline comments, PR title/body/test-plan, and any referenced GitHub issues all reflect what was actually built — not an earlier draft or superseded approach
- [ ] When touching discord.js command handlers: do test stubs faithfully replicate real interaction state mutations (`replied`, `deferred`)? Is `fetchReply: true` set when `awaitMessageComponent` is needed on the response?
- [ ] When replacing a feature: grepped test file for old option names, response strings, and function signatures — none remain?
- [ ] All mocked modules include every named export from the real module?
