# Claude Code instructions for station-bot

## Commits
- Never include `Co-Authored-By` trailers or any AI attribution in commit messages.

## Workflow
- All changes go through: issue → feature branch → PR. No direct commits to main.
- Branch naming: use a prefix matching the change type — `feature/ISSUE-{n}`, `bug/ISSUE-{n}`, `chore/ISSUE-{n}`, `release/v{x.y.z}`
- PR title format: `<type>: ISSUE-{n} — description` (Conventional Commits style — e.g. `feature`, `bug`, `chore`, `fix`, `release`)
- PRs close issues via "Closes #n" in body
- Quality gate before every PR: `npm run quality`
