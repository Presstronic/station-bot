# Release Notes

Create one permanent Markdown file in this directory for every production release and patch.

Important workflow rule:
- Do not create a new release-notes file on feature branches or issue branches.
- Create the release-notes file only on the `release/v...` branch for that specific release.
- Merge that file back into `main` as part of the release PR.

Naming convention:
- `vX.Y.Z.md`
- `vX.Y.Z-beta.md`
- `vX.Y.Z-beta.N.md`

Required sections for each release file:

1. `Title`
- Example: `# Station Bot v0.3.3-beta`

2. `Release Date`
- Use the production release date.

3. `Summary`
- Brief professional summary of the main release themes.

4. `Main Changes`
- Short bullets describing the most important user-facing or operator-facing changes.

5. `Issues Addressed`
- List every issue included in the release.
- Include the GitHub issue number and a brief plain-English summary of what changed.

6. `People Involved`
- List the human contributors involved in the release work.
- Do not list AI tools as people.

7. `Notes`
- Optional rollout notes, known follow-ups, or operator reminders.

Supporting files in this directory:
- [release-checklist.md](./release-checklist.md) — operational release checklist
- [_template.md](./_template.md) — starter template for each release note

Suggested starter template:

```md
# Station Bot vX.Y.Z

## Release Date

YYYY-MM-DD

## Summary

Brief professional summary of the release.

## Main Changes

- Change 1
- Change 2
- Change 3

## Issues Addressed

- `#123` Brief summary of the issue and delivered outcome.
- `#124` Brief summary of the issue and delivered outcome.

## People Involved

- Person A
- Person B

## Notes

- Optional note
```
