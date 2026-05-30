# Release Checklist

Use this checklist when cutting a production release until the release process is expanded further.

This checklist is written for the current solo-maintainer workflow:
- one human may perform the release end to end
- the same human may be both release owner and go/no-go approver
- AI tools may assist with drafting, validation, and notes, but they are not release owners or approvers

## Ownership

- Release owner:
  - The human responsible for preparing, validating, tagging, and verifying the release.
- Go / no-go approver:
  - For now, this may be the same human as the release owner.
- Rule:
  - A production release should not be cut without an explicit human go/no-go decision.

## Scope Confirmation

- Confirm the target milestone is correct.
- Confirm in-scope issues are complete or intentionally removed from scope.
- Confirm required PRs are merged to `main`.
- Confirm there are no known blockers you are unwilling to ship.
- Confirm any deferred work is documented clearly in the release notes or milestone cleanup.

## Pre-Release Validation

From `main`:

```bash
git checkout main
git fetch origin main
git pull --ff-only origin main
npm run lint
npm run typecheck
npm test -- --runInBand
```

- Confirm local validation passes before creating the release branch.
- If validation fails, do not proceed.

## Release Branch

- Create `release/vX.Y.Z...` from `main`.
- Update `package.json` version.
- Refresh `package-lock.json` with:

```bash
npm install --package-lock-only
```

- Re-run validation on the release branch:

```bash
npm run lint
npm run typecheck
npm test -- --runInBand
```

## Release Notes

- Create the release notes file only on the release branch.
- Place it in `docs/releases/`.
- Use the template in [./_template.md](./_template.md).
- The release notes must include:
  - release title
  - release date
  - professional summary
  - main changes
  - all issues addressed with a brief summary of each
  - human people involved
  - rollout notes or known follow-ups when relevant

## Release PR

- Commit the release changes.
- Push the release branch.
- Open a PR titled:
  - `release: vX.Y.Z...`
- Confirm the PR contains:
  - version bump files
  - release notes file
  - no unrelated code changes unless explicitly intended

## CI Expectations

Normal PR CI is handled by:
- `.github/workflows/build-and-test.yaml`

That workflow covers:
- `npm ci`
- `npm run lint`
- `npm run typecheck`
- `npm test -- --runInBand`

- Do not merge the release PR while required CI is failing.

## Merge And Tag

- Merge the release PR into `main`.
- Sync local `main` to the merged release commit.
- Verify `package.json` version one final time:

```bash
node -p "require('./package.json').version"
```

- Create and push the tag:

```bash
git tag vX.Y.Z...
git push origin vX.Y.Z...
```

## Release Automation Expectations

Tag-triggered release automation is handled by:
- `.github/workflows/release.yml`

It is expected to:
- validate the tag against `package.json`
- run `npm run quality`
- build and push the production Docker image
- deploy production
- create the GitHub Release entry

## Migration Risk Check

Before tagging, explicitly confirm:
- whether the release contains database migrations
- whether those migrations are additive or destructive
- whether rollback is straightforward or risky
- whether any manual migration notes belong in the release notes

If a release contains a risky migration, do not proceed casually. Make the rollback implications explicit first.

## Backup Verification

The release workflow already performs a pre-deploy database backup.

Human checklist item:
- Verify the release workflow completed the backup step successfully before considering the release complete.

## Production Smoke Test

After deployment, perform a short smoke test:
- bot container is running
- startup completed cleanly
- bot responds in Discord
- slash commands respond
- DB-backed features initialize successfully
- no obvious startup schema/config errors appear in logs

Recommended smoke-test commands and checks:
- `/healthcheck`
- one representative verification/admin command
- one representative DB-backed feature command

## Post-Release Observation Window

- Observe the release for a short period after deployment.
- Recommended minimum:
  - 15 to 30 minutes of log and behavior monitoring

Check for:
- repeated startup failures
- elevated warning/error logs
- command failures
- migration-related issues
- Discord permission/config regressions

## Rollback Plan

Have the rollback target identified before release.

Minimum rollback information to capture:
- last known good production tag
- whether the new release included schema changes
- whether rollback is safe without manual DB intervention

Minimum rollback procedure:
1. Identify the last known good release tag.
2. Confirm whether DB migrations from the bad release are backward-compatible.
3. Re-deploy the prior known good image/tag.
4. Re-verify production health.
5. If rollback is blocked by schema incompatibility, stop and handle DB recovery deliberately.

Important:
- Do not assume application rollback automatically implies database rollback.
- Add release-specific rollback notes to the release notes when needed.

## Completion Criteria

A release is only considered complete when all of the following are true:
- release PR merged
- release tag pushed
- release workflow passed
- production deploy succeeded
- GitHub Release entry created
- smoke test passed
- observation window completed without unacceptable issues

## Hotfix Rule

For urgent production fixes:
- branch from the latest `main`
- cut a new patch release branch
- follow the same release checklist
- do not bypass release notes, validation, or tagging discipline unless there is a true incident-level reason
