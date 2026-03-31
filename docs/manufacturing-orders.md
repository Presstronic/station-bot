# Manufacturing Orders — Feature Overview
### Station Bot · v0.2.1-beta

---

## What Is This?

With crafting now live in Star Citizen, our manufacturing division needs a way to receive and manage requests from org members. This feature gives every org member a simple, guided way to place a manufacturing order directly inside Discord — and gives the manufacturing team the tools to manage those orders from start to finish, all without leaving the server.

---

## How It Works — The Member Experience

**Placing an Order**

Any org member can place a manufacturing order by typing `/order submit` in Discord. The bot will walk them through a short form, one item at a time, asking for:

- What they want crafted
- How many they need
- Their **top priority stat** for that item — since crafted items can be made with different stat emphases, this tells the manufacturing team what matters most (e.g. ballistic resistance, thermal protection, stamina regen)
- An optional note (e.g. "need these before Saturday ops")

They can add up to 10 items per order. Once they're done adding items, they click **Submit Order** and the bot handles everything else — no copy-pasting, no DMs, no guesswork.

**What Happens Next**

The moment an order is submitted, the bot automatically creates a dedicated post in the `#manufacturing-orders` forum channel. That post contains a clean summary of the order — who submitted it, every item requested, and the current status. The manufacturing team is notified automatically.

**Tracking an Order**

Members don't need to do anything to track their order. They can simply visit `#manufacturing-orders` and find their post. The status tag on the post updates automatically at every stage, so they always know exactly where things stand at a glance.

**Cancelling an Order**

If a member no longer needs their order and it hasn't entered production yet, they can cancel it themselves with a single button click right on their forum post — no command needed, no staff intervention required.

---

## How It Works — The Manufacturing Team Experience

The manufacturing team manages all orders entirely through buttons on the forum post — no commands to type, no order IDs to remember. Each post displays only the actions available for its current status:

| Button | What It Does |
|---|---|
| **✅ Accept** | Acknowledges the order and lets the member know it's been picked up |
| **⚙️ Start Processing** | Marks the order as actively being crafted |
| **📦 Ready for Pickup** | Notifies that the order is complete and ready for the member to collect |
| **✔️ Mark Complete** | Closes the order once the member has collected their items |
| **🚫 Cancel** | Cancels an order at any stage (staff only) |

Every time the manufacturing team advances an order, two things happen automatically:

1. The status tag on the forum post updates to reflect the new stage
2. The bot posts a reply in the forum thread — which pings the member via Discord's built-in notification system, so they're always kept in the loop without the team having to chase anyone down

---

## Order Lifecycle

Every order moves through clearly defined stages:

```
New → Accepted → Processing → Ready for Pickup → Complete
```

Any order in a non-terminal stage can be cancelled by the manufacturing team. Members can cancel their own orders as long as production hasn't started yet.

---

## Guardrails & Fair Use

A few rules are built in to keep the system fair and the queue manageable:

- **Organization members only** — only members with the Organization Member role can place orders
- **5 active orders maximum** — members are capped at 5 open orders at a time to prevent queue abuse
- **10 items per order maximum** — each order can contain up to 10 line items
- **Free service** — there is no charge to org members for manufacturing orders

---

## What This Is Not (Yet)

To get this out quickly, a few things have been intentionally left for a future update:

- **Material tracking** — the manufacturing team manages sourcing internally; the bot does not track raw materials yet
- **Estimated completion times** — staff cannot set an ETA on an order in this version
- **Cancellation reasons** — when an order is cancelled by staff, no formal reason is recorded yet
- **UEX item catalogue** — item names are free-form for now; a future update will let members pick from known Star Citizen crafted items pulled from UEX data

---

## Summary

In short: members place orders through a guided form, manufacturing manages them with simple buttons on each order's forum post, and everyone stays informed automatically through Discord's own notification system — no spreadsheets, no DMs back and forth, no manual status updates.
