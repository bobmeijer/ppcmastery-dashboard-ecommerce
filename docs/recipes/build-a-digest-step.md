# Build a digest step

## When to use it

You want meeting notes and email threads on the Communication page, with an action board, without pasting them in by hand. The repo includes the page, the tables and an import script. The step that writes the digests is yours to build, with the note taker and LLM you use.

## Files to change

| File | Why |
|---|---|
| `dashboard.config.ts` | `modules.communications: true`. `brand.accountManager` and `brand.client` decide who counts as whose action |
| Your digest step, outside this repo or in `scripts/` | Reads your notes and writes the JSON file |
| `scripts/import-communications.mjs` | Loads the JSON. Normally no change needed |

## Steps

1. **Collect the source text.** Meeting notes from your note taker, email threads from your mailbox.

2. **Ask your LLM for a digest per meeting or thread,** in the JSON format below. For example:

   ```text
   Summarise this meeting for the client. Return JSON in the format described in
   docs/recipes/build-a-digest-step.md. Use short bullets. List decisions separately.
   List actions with an owner and a due date when one was agreed. Do not include
   anything about budgets for other clients, private remarks or raw email text.
   ```

3. **Review the file.** Raw email text should never reach this table. The client may read whatever is shown here.

4. **Check it without writing anything:**

   ```bash
   npm run communications:import -- digests.json --dry-run
   ```

5. **Import it:**

   ```bash
   npm run communications:import -- digests.json
   ```

   It needs `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, from your environment or `.env.local`. It writes to the real database, so it does not work on the demo.

6. **Approve emails.** A new email item is stored hidden, with `hidden_by` set to `awaiting approval`. An admin sees it greyed out on the Communication page and clicks Show. Meeting items are visible at once.

### File format

The file is a JSON list of items. Each item can carry its own `actions`.

```json
[
  {
    "id": "meeting:2026-10-06-progress",
    "kind": "meeting",
    "title": "Monthly progress review",
    "date": "2026-10-06",
    "time": "10:00 - 10:45",
    "participants": ["Admin", "Sam"],
    "summary_md": "- **Search** is stable.\n- Shopping brought in most of the extra revenue.\n- Next progress meeting: 3 November 2026 at 10:00.",
    "decisions": ["Move part of the brand budget to Shopping for four weeks."],
    "detail_md": "# Monthly progress review\n\n## Results\n- Both accounts are close to target.",
    "labels": ["shop"],
    "actions": [
      { "id": "meeting:2026-10-06-progress#1", "title": "Send the product list for the promotion", "owner": "Demo Group", "due": "2026-10-13", "label": "shop" },
      { "id": "meeting:2026-10-06-progress#2", "title": "Report back on the budget test", "owner": "Admin" }
    ]
  },
  {
    "id": "email:thread-example",
    "kind": "email",
    "title": "Feed update",
    "date": "2026-10-02",
    "participants": ["Admin", "Alex"],
    "summary_md": "Size and colour were missing from the feed. Both are back.",
    "message_count": 4,
    "labels": ["shop"]
  }
]
```

Item fields:

| Field | Required | Default | Notes |
|---|---|---|---|
| `id` | yes | | Stable and unique, at most 200 characters. Rerunning with the same ID updates the item. A habit that works: `meeting:<note name>`, `email:<thread id>` |
| `kind` | yes | | `meeting` or `email` |
| `date` | yes | | `YYYY-MM-DD`. Meeting date, or the last message |
| `title` | no | empty | |
| `time` | no | empty | Free text such as `08:33 - 09:21`. Use empty for email |
| `participants` | no | none | List of names |
| `summary_md` | no | empty | Markdown: `#` headings, `-` bullets, `**bold**`, `*italic*` |
| `decisions` | no | none | List of short sentences |
| `detail_md` | no | null | The full note. Shown as a fold-out |
| `message_count` | no | 1 | For email threads |
| `labels` | no | none | Account labels from `dashboard.config.ts`. Shown as tags |
| `actions` | no | none | List of actions, see below |

Action fields:

| Field | Required | Default | Notes |
|---|---|---|---|
| `id` | yes | | Unique across the whole table, at most 200 characters |
| `title` | yes | | |
| `owner` | no | `Admin` | See below |
| `due` | no | null | `YYYY-MM-DD` |
| `label` | no | null | An account label. Null shows the action for every account |

### Behaviour worth knowing

- **Items are not filtered by account.** Every timeline item shows for every account. `labels` are tags. Only actions are filtered, through `label`.
- **Owners are matched by name.** The counts on the board treat an owner equal to `brand.accountManager` as yours, and an owner whose first word equals the first word of `brand.client` as the client's.
- **A rerun keeps the status of actions.** `open`, `done` and `dropped` are not overwritten. An item's own `hidden` flag is also kept.
- **A changed email is hidden again** until an admin shows it. A rerun with the same content leaves it alone.
- **An action ID is tied to its first item.** If another item uses the same ID, that row is not changed. The script refuses duplicates within one file.
- **The next meeting is read from the text.** `nextMeeting` looks in meeting items for "next ... 3 November 2026", optionally followed by "at 10:00", and it wants English month names.
- **The script checks the whole file first.** Any problem means nothing is written. Each item after that is its own transaction, so a failed item is reported and the others still go in.

## Check it worked

- The dry run reports the expected number of items and actions.
- The Communication page shows the items, with emails greyed out for an admin.
- A `client` login does not see the hidden emails, or their actions.
- Mark an action done, import the same file again, and check it stays done.
