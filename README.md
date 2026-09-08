# SoleMate Kick — Telegram Ops Bot

A button-driven Telegram bot for managing **Inventory**, **Orders**, **Deliveries**,
and **Marketing spend**, backed entirely by a Google Sheet. Built for a small team where most people
using it are non-technical — almost everything is tap, not type.

---

## 1. Why Node.js instead of Google Apps Script

Both were considered. Here's the actual tradeoff:

| | **Google Apps Script** | **Node.js (this project)** |
|---|---|---|
| Sheets access | Native, zero setup | Needs Google OAuth credentials + `googleapis` |
| Hosting | Free, built into Google | Free tier on Vercel/similar |
| Telegram webhooks | Works, but the editor/versioning is clunky and debugging is painful | Real files, real git history, real local testing |
| Code you can grow | Limited (no npm packages, awkward multi-file structure, 6-min execution cap) | Full npm ecosystem, proper modules — easy to add a web dashboard, reports, etc. later |
| Local development | Hard — you're mostly editing in the browser | `npm run dev`, breakpoints, VS Code as normal |

Apps Script is genuinely fine for a *very* simple bot. But you said you want
something you can maintain and extend in VS Code, with clean structure — that
points to Node.js. The one thing Apps Script gives you for free (Sheets
access with no credentials) is a minor setup cost here (Section 3) and not a
recurring one.

We deploy Node.js as **serverless functions** (Vercel), not a traditional
always-on server — see Section 6. That gets you the "no server to babysit"
property Apps Script normally offers, while keeping real code.

---

## 2. Project structure

```
solemate-kick-bot/
├── api/
│   └── webhook.js          # Production entry point (Vercel serverless function)
├── scripts/
│   ├── dev-polling.js       # Local dev entry point (long-polling, no public URL needed)
│   ├── setupSheet.js        # One-time: creates sheet tabs + headers
│   └── setWebhook.js        # One-time (per deploy): points Telegram at your webhook
├── src/
│   ├── bot.js               # Composition root: wires auth, sessions, scenes, menu
│   ├── config.js            # Reads & validates environment variables
│   ├── keyboards.js         # All reply/inline keyboards in one place
│   ├── google/
│   │   └── sheetsClient.js  # Low-level Sheets API (get/append/update rows)
│   ├── repos/                # Domain data access — one file per sheet tab
│   │   ├── inventoryRepo.js
│   │   ├── ordersRepo.js
│   │   ├── deliveriesRepo.js
│   │   └── sessionRepo.js    # Persistent session store (see Section 5)
│   ├── flows/                 # Multi-step conversation wizards
│   │   ├── common.js          # Shared "Cancel" + error handling for every wizard step
│   │   ├── inventoryFlow.js   # Add New Item / Restock Existing
│   │   ├── orderFlow.js       # New Order
│   │   └── deliveryFlow.js    # Log Delivery
│   ├── middleware/
│   │   └── auth.js            # Staff-only whitelist check
│   └── utils/
│       ├── ids.js              # ORD-/INV-/DLV- ID generation
│       ├── phone.js            # Phone number normalization/validation
│       ├── links.js            # wa.me and sms: link builders
│       └── format.js           # Money formatting, message templates
├── .env.example
├── vercel.json
└── package.json
```

**How to read this if you're extending it later:** `flows/` is "what the
conversation looks like," `repos/` is "what gets read/written," `google/` is
"how we talk to Sheets at all." Adding a new feature almost always means:
add a repo function (if needed) → add/extend a flow → wire a button in
`bot.js` or `keyboards.js`. You should rarely need to touch `sheetsClient.js`.

---

## 3. Setting up Google Sheets access

The textbook way to give a bot Sheets access is a **service account** (a
robot identity with its own downloadable key). Google has been rolling out
an org-wide security default (`iam.disableServiceAccountKeyCreation`) that
blocks that download entirely on many accounts — including plain personal
Gmail accounts that never opted into any "organization." If you hit
*"Service account key creation is disabled"*, this is why, and there's no
quick opt-out for a solo developer.

So instead, this project authenticates via **OAuth2 as your own Google
account** — the same style of "Sign in with Google" flow you've clicked
through on other apps. You do a one-time browser login granting the bot
permission to edit Sheets, and it's not affected by that org policy at all.
Bonus: since it's *your* account, you don't need to separately "share" the
Sheet with anything — you already own it.

1. **Create the Sheet.** Make a new Google Sheet (any name, e.g. "SoleMate
   Kick Data"). Copy the ID from its URL:
   `https://docs.google.com/spreadsheets/d/`**`THIS_PART`**`/edit`

2. **Create a Google Cloud project** at [console.cloud.google.com](https://console.cloud.google.com)
   (free, no billing required for this usage level). You can reuse a project
   you already created.

3. **Enable the Google Sheets API**: *APIs & Services → Library* → search
   "Google Sheets API" → **Enable**.

4. **Configure the OAuth consent screen** (one-time, per project):
   *APIs & Services → OAuth consent screen*.
   - User type: **External** (this just means "not restricted to a Google
     Workspace domain" — it's still only ever used by you and your staff).
   - Fill in an app name (e.g. "SoleMate Kick Bot") and your email where asked.
   - Scopes: skip/add nothing special — you don't need to add
     `.../auth/spreadsheets` here, the script that requests it later is enough.
   - Test users: add your own Google account's email.
   - **Important:** once created, look for a **Publish App** button on this
     page and click it, moving the app from "Testing" to **"In production."**
     You'll see an "unverified app" warning the first time you log in later —
     that's expected and fine for an app only you and your staff use; without
     this step, your access would silently expire and stop working every 7
     days.

5. **Create an OAuth client ID**: *APIs & Services → Credentials → Create
   Credentials → OAuth client ID*.
   - Application type: **Desktop app**.
   - Name: anything (e.g. `solemate-bot-desktop`).
   - After creating it, copy the **Client ID** and **Client Secret** shown —
     these go into `.env` as `GOOGLE_OAUTH_CLIENT_ID` and
     `GOOGLE_OAUTH_CLIENT_SECRET`.

6. **Run the one-time authorization script** (after filling in `.env` per
   Section 5 below):
   ```bash
   npm run authorize-google
   ```
   This opens a URL for you to visit — log in with the Google account that
   owns the Sheet, approve access, and the script automatically saves
   `GOOGLE_OAUTH_REFRESH_TOKEN` into your `.env` file. You only do this once;
   after that, the bot silently refreshes its own access forever.

If your organization *does* allow service account keys and you'd prefer that
simpler, no-browser-step approach instead, ask and the Sheets auth code can
be swapped back — it's isolated entirely inside `src/google/sheetsClient.js`.

---

## 4. Setting up the Telegram bot

1. Message [@BotFather](https://t.me/BotFather) on Telegram, send `/newbot`,
   follow the prompts. You'll get a **bot token** — this is `BOT_TOKEN`.
2. Message [@userinfobot](https://t.me/userinfobot) to get your own numeric
   Telegram ID. This goes into `ADMIN_CHAT_IDS` — a bootstrap allowlist,
   always treated as the **Owner** role, so you can never lock yourself out.
   Everyone else's access (and their role) lives in the `Users` sheet tab
   instead — see Section 7.1.

---

## 5. Environment variables & local setup

```bash
git clone <this project>
cd solemate-kick-bot
npm install
cp .env.example .env
```

Fill in `.env` using the values from Sections 3 & 4 — see the comments in
[.env.example](.env.example) for exactly what each one is and where it comes
from (leave `GOOGLE_OAUTH_REFRESH_TOKEN` blank for now). **Never commit
`.env`** — it's already in `.gitignore`.

Then run the one-time Google authorization (Section 3, step 6):

```bash
npm run authorize-google
```

Then create the sheet tabs:

```bash
npm run setup-sheet
```

This creates `Inventory`, `Orders`, `Deliveries`, `Marketing`, `Users`, and `Sessions` tabs with
the correct header rows. Re-running it is safe (it won't duplicate tabs).

Run the bot locally:

```bash
npm run dev
```

This uses long-polling (no public URL needed) — open Telegram and message
your bot. `/start` should show the main menu.

### Optional: analytics dashboard tab

```bash
npm run setup-dashboard
```

Adds a `Dashboard` tab (as the first tab in the Sheet) with live KPI
formulas — total revenue, order counts by status, inventory value, low-stock
items — plus a status-breakdown pie chart and a top-sellers bar chart, all
computed straight from `Inventory`/`Orders`/`Deliveries` via Sheets formulas
(`QUERY`, `SUMPRODUCT`, `COUNTIF`). No separate reporting tool: open the
Sheet, it's already there, and it updates itself as the bot writes new rows.
Safe to re-run any time (e.g. after changing the low-stock threshold in the
script) — it clears and rebuilds its own charts rather than duplicating them.

### Optional: post-delivery feedback form

```bash
npm run setup-feedback-form
```

Creates a Google Form (Order ID / Rating / Comments) and wires it into the
bot's "📝 Feedback" menu — see `scripts/setupFeedbackForm.js`'s header
comment for the full explanation, and §5 for the env vars it fills in.
Responses land in a `Feedback` tab in this same Sheet (native Forms
behavior — link it via the form's Responses tab → Sheets icon → *Select
existing spreadsheet* → this one).

Google Forms has no way to make the pre-filled Order ID field read-only —
a customer could edit it before submitting. `apps-script/feedbackValidation.gs`
is a small companion script (paste it into Extensions → Apps Script on this
Sheet — instructions in the file) that flags any response whose Order ID
doesn't match a real order, so staff can spot a tampered/mistyped one
instead of quietly trusting it.

### About the `Sessions` tab

**Don't delete it and don't hand-edit rows in it.** It's not business data —
it's how the bot remembers "which step of the order form is this staff
member on" so that a restart or redeploy never loses their place mid-flow
(see `src/repos/sessionRepo.js` for the full explanation). It's a small,
self-cleaning table: rows just get overwritten as people use the bot.

---

## 6. Deploying (Vercel, no always-on server)

We deploy as a **webhook**: Telegram calls your URL whenever there's a new
message, and the function spins down when idle — you're not paying for or
maintaining a server that runs 24/7.

1. Install the Vercel CLI and log in:
   ```bash
   npm i -g vercel
   vercel login
   ```
2. From the project folder:
   ```bash
   vercel
   ```
   Follow the prompts (link/create a project). This deploys once so you get
   a URL, e.g. `https://solemate-kick-bot.vercel.app`.
3. In the Vercel dashboard for this project, go to *Settings → Environment
   Variables* and add **every** variable from your `.env` file (same names,
   same values). Set `PUBLIC_URL` to the URL from step 2.
4. Redeploy so the env vars take effect:
   ```bash
   vercel --prod
   ```
5. Point Telegram at your webhook:
   ```bash
   npm run set-webhook
   ```
   You should see `✅ Webhook set to: https://.../api/webhook?secret=...`.

Your bot is now live with no server to manage. To go back to local testing
later, run `npm run delete-webhook` first (Telegram only allows one active
mode — webhook *or* polling — at a time), then `npm run dev`.

**Redeploying after code changes:** `vercel --prod` is all you need —
`PUBLIC_URL` doesn't change between deploys, so you don't need to re-run
`set-webhook` unless the URL itself changes (e.g. you rename the project).

---

## 7. Using the bot day-to-day

### 7.1 Roles & access

Who can use which part of the bot is controlled by a **`Users`** sheet tab
(`TelegramID`, `Name`, `Role`, `AddedAt`, `AddedBy`) plus the `ADMIN_CHAT_IDS`
bootstrap allowlist from Section 4. Three roles, defined in
`src/permissions.js`:

| Role | Can use |
|---|---|
| **Owner** | Everything, including 👤 Add User |
| **Staff** | 📦 Inventory, 🛒 New Order, 🚚 Log Delivery, 📊 Dashboard |
| **Marketing** | 📣 Marketing, 📊 Dashboard |

The bot's keyboard only ever shows the buttons a user's role can use — and
the same check runs again when a button is tapped, so a hidden command typed
by hand (or a stale keyboard from before a role change) is turned away, not
silently run.

To grant access to someone new, either:
- **From the bot** (Owner only): tap **👤 Add User**, enter their Telegram ID
  (from [@userinfobot](https://t.me/userinfobot) or their own "access denied"
  message), a name, and a role.
- **Directly in the Sheet**: add a row to the `Users` tab yourself. Takes
  effect within ~30 seconds (see the cache note in `src/repos/usersRepo.js`)
  — no redeploy needed.

Anyone listed in `ADMIN_CHAT_IDS` is always treated as Owner regardless of
the sheet, so editing/deleting the wrong `Users` row can never lock you out.

- **📦 Inventory → ➕ Add New Item**: for a brand/model/size/color combo
  that's never been stocked before. Asks for cost and selling price.
- **📦 Inventory → 🔁 Restock Existing**: pick brand → pick the exact item →
  enter how many more pairs came in. Doesn't touch pricing.
- **🛒 New Order**: pick brand → item → quantity → price (defaults are
  suggested from the item's selling price, but editable per-order for
  discounts/negotiation) → delivery location → customer name → phone →
  confirm. On save, the bot **automatically deducts stock** and gives you a
  tap-to-send WhatsApp link pre-filled with an order confirmation message
  for the customer.
- **🚚 Log Delivery**: pick a pending order → Bus or Taxi → vehicle/plate →
  driver's phone → delivery charge → confirm. On save, it marks the order
  "Out for Delivery" and gives you separate WhatsApp links for the
  **driver** (pickup details), the **customer** (delivery is on its way),
  and a tap-to-send **invoice** (itemized order + delivery details).
- **📣 Marketing**: pick platform (Instagram/Facebook/TikTok) → post date
  (tap Today or type one) → amount spent → optional reach → optional
  engagement → optional notes → confirm. Standalone spend log — no linkage
  to Orders, no promo codes, no campaign ROI.
- **📊 Dashboard**: sends live KPIs (revenue, order counts, inventory value,
  low-stock count, total marketing spend) as text, followed by a pie chart of
  orders-by-status, a bar chart of top-selling items, a pie chart of
  marketing spend by platform, and a bar chart of marketing spend by month —
  rendered as real images via [QuickChart](https://quickchart.io) (free,
  keyless), plus a low-stock list.
  This is separate from (and doesn't require) the Sheets `Dashboard` tab from
  Section on the analytics dashboard tab — that one's for browsing in the
  Sheet itself; this is for a quick check without leaving Telegram.
- **❌ Cancel** works at any point in any flow and returns to the main menu
  without saving anything.

The WhatsApp links don't send anything automatically — tapping one opens
WhatsApp with the text pre-filled, and you (or whoever's handling the order)
hit Send. That's what avoids WhatsApp Business API entirely — no approval
process, no per-message cost, and it works today. (SMS fallback links are
still implemented in `src/utils/links.js`/commented out in the flows —
uncomment them if you want that fallback back.)

---

## 8. Security notes

- **No secrets in code.** `BOT_TOKEN`, the Google OAuth client secret/refresh
  token, and `WEBHOOK_SECRET_PATH` all come from environment variables, set
  only in `.env` (local, git-ignored) and the Vercel dashboard (production).
- **Staff whitelist + roles.** `ADMIN_CHAT_IDS` (Owner, bootstrap) plus the
  `Users` sheet tab (everyone else) are the only "login" — anyone with
  neither gets a polite refusal and nothing else happens. Each role is also
  restricted to its own part of the bot (see Section 7.1); a Marketing user
  can't touch Inventory/Orders/Deliveries, and vice versa. To remove
  someone's access, delete their row from `Users` (or their ID from
  `ADMIN_CHAT_IDS` + redeploy, for a bootstrap Owner).
- **Webhook secret.** The webhook URL requires a `?secret=...` query
  parameter matching `WEBHOOK_SECRET_PATH`, so a stranger who discovers your
  Vercel URL can't inject fake Telegram updates into the bot.
- **OAuth refresh token scope.** The refresh token only grants the
  `.../auth/spreadsheets` scope (read/write Sheets) — it cannot access Gmail,
  Drive files, or anything else in the Google account it belongs to. If it's
  ever compromised, revoke it instantly at
  [myaccount.google.com/permissions](https://myaccount.google.com/permissions)
  (remove the app's access) and re-run `npm run authorize-google` for a new one.
- **Anything pasted into this chat is exposed, not just anything committed
  to git.** Tokens/keys should only ever go into `.env` directly — if one
  gets pasted into a conversation by mistake, rotate/revoke it rather than
  relying on it staying private.

---

## 9. Extending it later

- **More business logic** (e.g. low-stock alerts, daily sales summary): add
  a function to the relevant `repo`, and either a new `bot.hears(...)` in
  `bot.js` for an on-demand command, or a small script you run on a cron
  schedule (Vercel supports [Cron Jobs](https://vercel.com/docs/cron-jobs)
  for free-tier accounts) that calls `bot.telegram.sendMessage(...)` on its own.
- **New flow**: copy the shape of `deliveryFlow.js` (it's the shortest) as a
  template — every step should be wrapped in `step(...)` from
  `flows/common.js` so Cancel and error handling stay automatic.
- **Sheet columns changed?** Only `sheetsClient.js` and the relevant `repo`
  file need to know about column names — flows never reference raw column
  strings directly.
# telegram-bot
