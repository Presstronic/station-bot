# HR / Recruitment: Processing Nominations

This guide covers the day-to-day nomination review and processing workflow for HR and recruitment staff.

---

## The nomination lifecycle

When a member nominates someone, the nomination moves through the following states:

| State | What it means |
|---|---|
| `new` | Just submitted, not yet checked |
| `checked` | Org check ran but returned an inconclusive result — **Needs Re-check** before you can act on it |
| `qualified` | Checked and confirmed **not** in another org — good to reach out |
| `disqualified_in_org` | Checked and found to be in another org — probably not a fit |
| `processed` | You've actioned it — done |

> **`checked` / Needs Re-check** means the org check ran but couldn't produce a definitive answer (e.g. RSI returned an unrecognised page layout, the request timed out, or the result was ambiguous). The nomination is still visible and unprocessed. Run `/nomination-refresh rsi-handle: <handle>` to queue a fresh check, then review again once the status updates.
>
> In the `/nomination-review` summary this state is grouped with other technical failures under **Needs Attention**.

---

## Reviewing nominations

```
/nomination-review
```

Shows up to 25 unprocessed nominations by default with a summary breakdown. Only you can see the result.

**Optional filters:**

| Option | What it does |
|---|---|
| `status` | Filter by lifecycle state (`new`, `checked`, `qualified`, `disqualified_in_org`) |
| `sort` | `newest` (default), `oldest`, or `nomination_count_desc` (most-nominated first) |
| `limit` | How many to show — 1 to 100, defaults to 25 |

**Examples:**

Show only qualified nominations, most-nominated first:
```
/nomination-review status: qualified sort: nomination_count_desc
```

Show everything, up to 100:
```
/nomination-review limit: 100
```

If the list is too long for a message, the bot will attach it as a text file automatically.

---

## Refreshing org check status

The bot automatically checks org membership after nominations come in, but if you want to force a fresh check:

```
/nomination-refresh
```

This queues an org check job for **all** unprocessed nominations.

To refresh a single player:
```
/nomination-refresh rsi-handle: Glup_Shiddo
```

The bot will reply with a job ID. Use that to check progress:

```
/nomination-job-status
```

This shows the latest job by default. To check a specific job:
```
/nomination-job-status job-id: 42
```

---

## Processing nominations

Once you've reviewed and acted on a nomination (reached out, decided to pass, etc.), mark it as processed to clear it from the queue.

**Process a single nomination:**
```
/nomination-process rsi-handle: Glup_Shiddo
```

**Process all unprocessed nominations at once** (use with care):
```
/nomination-process confirm-all: true
```

> Processed nominations are removed from the review queue but remain in the database for audit purposes.

---

## Tips

- Start with `/nomination-review status: qualified sort: nomination_count_desc` to see your best candidates first — qualified and most-nominated.
- A nomination showing **Needs Attention** in the summary doesn't mean the player is disqualified — it means the system couldn't confirm their org status. Run `/nomination-refresh` to queue a fresh check or filter by `status: checked` to review these individually.
- All process actions are logged. See your admin for audit log access.
