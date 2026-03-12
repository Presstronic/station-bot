# Claude Code instructions for station-bot

## Commits
- Never include `Co-Authored-By` trailers or any AI attribution in commit messages.

## Workflow
- All changes go through: issue → feature branch → PR. No direct commits to main.
- Branch naming: `feature/ISSUE-{n}`
- PR title format: `feature: ISSUE-{n} — description`
- PRs close issues via "Closes #n" in body
- Quality gate before every PR: `npm run quality`
