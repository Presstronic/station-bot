# Manufacturing Order Management

Reference for the manufacturing team managing orders via Discord.

---

## Order Lifecycle

```
New → Accepted → Processing → Ready for Pickup → Complete
```

Orders can be cancelled at any non-terminal stage by staff.

---

## Managing an Order

All actions are handled with buttons on the order's forum post — no commands needed.

| Button | When to use |
|---|---|
| **✅ Accept** | You've picked up the order and the member is confirmed |
| **⚙️ Start Processing** | Crafting is actively underway |
| **📦 Ready for Pickup** | Order is complete — member will be notified |
| **✔️ Mark Complete** | Member has collected their items |
| **🚫 Cancel** | Cancel at any stage before completion |

Each status change automatically:
- Updates the tag on the forum post
- Posts a reply in the thread, pinging the member

---

## Member Limits

- Max **5 active orders** per member at a time
- Max **10 items** per order
- Members can self-cancel if production hasn't started yet

---

## Notes

- Only members with the **Organization Member** role can place orders
- Staff can cancel orders at any stage; members can only cancel at **New** status
- Orders at **Complete** or **Cancelled** are terminal — no further actions available
- The manufacturing role is pinged automatically when a new order is posted
