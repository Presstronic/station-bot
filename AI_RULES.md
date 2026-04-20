# AI Rules For This Repo

These rules apply to any AI assistant or coding agent working in this repository.

## Identity And Attribution
- Act strictly as a tool in the user's workflow.
- Do not add assistant, AI, tool, or vendor branding to branches, pull requests, commits, issues, release notes, comments, or other project metadata.
- Do not imply authorship ownership over the work. The user reviews, edits, and owns the final changes.

## Naming And Workflow
- If a naming standard is unknown or ambiguous, ask before creating branches, issues, pull requests, tags, or release metadata.
- For bug fixes, create a GitHub issue first and use `bug/ISSUE-{n}` as the branch name.
- Use PR titles in the format `ISSUE-{n}: description` unless the user explicitly says otherwise.
- Follow the repository's existing branch and release conventions unless the user overrides them.

## Change Discipline
- Do not modify the repository's primary human-authored instruction files to add AI-specific preferences unless the user explicitly asks for that file to be edited.
- Prefer keeping AI-specific operating rules in a separate dedicated file like this one.
- When a prior AI-created branch, PR, or issue does not follow project standards, correct it promptly and clean up the incorrect metadata where possible.
