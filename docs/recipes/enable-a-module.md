# Enable a module

## When to use it

You want an optional part of the dashboard on your real data. In the demo everything is already on, whatever the switches say.

## Files to change

| File | Why |
|---|---|
| `dashboard.config.ts` | Set the key under `modules` to `true`. Account settings for some modules |
| `.env.local` and your host's environment settings | Keys for some modules. You edit these yourself |

## Steps

1. Set the switch in `dashboard.config.ts`. `npm run doctor` reads it.

2. Do what the module needs:

| Key | What it needs |
|---|---|
| `qualityScore` | Nothing extra. To hide the page for one account, add `hiddenPages: ['/quality-score']` to it |
| `changeHistory` | Nothing extra. It has no page yet. The data feeds the AI's `change_history` tool. Google keeps 30 days |
| `communications` | Run `npm run communications:import`. See `build-a-digest-step.md` |
| `ai` | `ANTHROPIC_API_KEY`. See below |
| `microsoftAds` | The `MSADS_*` variables and account IDs. See below |
| `feedStatus` | A Merchant ID and a token with the right scope. See below |
| `auctionInsights` | A service account and a Drive folder. See below |

3. Load the history where it applies:

   ```bash
   npm run backfill -- --from YYYY-MM-DD --datasets quality
   npm run backfill -- --from YYYY-MM-DD --source microsoft
   ```

### AI analysis and chat

- Add `ANTHROPIC_API_KEY`. With a key that is not tied to a workspace, also set `ANTHROPIC_WORKSPACE_ID`.
- Spending stops at `MONTHLY_CAP_USD` in `src/lib/claudeLoop.ts`, which is 55 USD. Change it to suit you.
- Report data goes to the API. Check that this fits your client agreements.
- Optional: put your own way of analysing accounts in `context/methodology.md`. The file is gitignored.
- Optional: the "ask the account manager" button mails you through Resend, with `RESEND_API_KEY`, `ESCALATION_MAIL_FROM` and `ESCALATION_MAIL_TO`. Without them the question is still flagged in `chat_messages`.

### Microsoft Ads

1. Add `MSADS_CLIENT_ID`, `MSADS_CLIENT_SECRET` and `MSADS_DEVELOPER_TOKEN`.
2. Run `npm run msads:auth`. It stores the token and lists the customer and account IDs.
3. Store the IDs. `npm run accounts:add` does not set them:

   ```sql
   update accounts set msads_account_id = 'YOUR_ACCOUNT_ID', msads_customer_id = 'YOUR_CUSTOMER_ID' where label = 'shop';
   ```

Microsoft replaces its refresh token on every use. The latest one is kept in `oauth_tokens`, and `MSADS_REFRESH_TOKEN` only seeds it.

### Feed status

1. Add the Merchant ID by rerunning `accounts:add` with `--merchant XXXXXXXXX`. Pass all your other options again, because omitted ones are reset. An account without a Merchant ID syncs the Google Ads side only.
2. Get a token with the content scope, and store it as `MERCHANT_REFRESH_TOKEN`. `npm run google:auth` asks only for the Google Ads scope, so its token cannot read Merchant Center. Add `https://www.googleapis.com/auth/content` to `SCOPE` in `scripts/google-auth.mjs` and rerun it, or make a separate token.

### Auction insights

1. In Google Ads Report Editor, schedule a report (campaign by day by competitor) to write a Google Sheet into a Drive folder.
2. Create a Google service account, and share the folder with its email as a viewer.
3. Set `GOOGLE_SHEETS_SERVICE_ACCOUNT_B64` to the base64 of its key.
4. Set `auctionFolderId` for that account in `dashboard.server.ts`. Optional: `auctionWatchlist`.
5. For history, export a CSV and run `node scripts/import-auction.mjs --account shop --file export.csv` while the app runs.

## Check it worked

- `npm run doctor` passes. It checks the keys for `ai`, `microsoftAds` and `auctionInsights`. It does not check `feedStatus`.
- The page appears in the sidebar and has data. `changeHistory` has no page, so check the Status page for the `changes` dataset.
- Calling the module's cron returns data. `{ "skipped": true, "reason": "module disabled" }` means the switch is off in the deployed build.
- The Status page shows a recent run.
