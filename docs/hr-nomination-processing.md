# HR / Recruitment: Processing Nominations

This guide covers the day-to-day nomination review and processing workflow for HR and recruitment staff.

---

## The nomination lifecycle

When a member nominates someone, the nomination moves through the following states:

| State | What it means |
|---|---|
| `new` | Just submitted, not yet checked |
| `checked` | An org check ran but couldn't give a clear answer — needs manual review |
| `qualified` | Checked and confirmed **not** in another org — good to reach out |
| `disqualified_in_org` | Checked and found to be in another org — probably not a fit |
| `processed` | You've actioned it — done |

> **`unknown` org check status** means the system couldn't determine org membership (RSI was unreachable, timed out, etc.). These nominations stay visible until you manually action them or re-run the org check.

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
- A nomination with `checked` or `unknown` org status doesn't mean the player is disqualified — it means the system couldn't confirm. You can re-run the org check or review manually.
- All process actions are logged. See your admin for audit log access.
