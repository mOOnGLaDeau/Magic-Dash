# Magic Dash

Magic Dash tracks Brisbane and major Magic: The Gathering events, personal decks, match results, metagame snapshots, and Australian singles.

## Run locally

Open `index.html` in a browser. The frontend has no build step. Scryfall card lookup and links to external sources require an internet connection. Find Cards opens the results for the entered card directly at each store and can save a local watchlist without a scanner connection.

## Source and data

- `index.html` and `buy-cards.js` are the GitHub Pages frontend.
- Guest decks, personal events and match logs live in browser storage. Signed-in users can sync them to their own account when accounts are configured.
- The midnight Brisbane scan updates the Library copy. Its results can be carried into Git by updating the embedded `brisbane-scheduled-scan` data when needed.

## Enable accounts

1. Create a Supabase project and run `accounts/schema.sql` in its SQL editor. It grants authenticated users access only to their own data after email verification.
2. Enable email/password signup and **Confirm email** in Authentication. Set both the Site URL and an allowed redirect URL to `https://moongladeau.github.io/Magic-Dash/`. Add separate explicit redirect URLs for any preview hosts you use.
3. Configure custom SMTP in Supabase Authentication. Supabase's default mail service only sends to project team addresses. Test email confirmation and password recovery before opening signup to other users.
4. Put the project's HTTPS URL and **publishable key** into `account-config.js`, then deploy GitHub Pages. Keep the secret key and SMTP credentials in the provider dashboard.
5. Verify with two test accounts that each can see only its own data. On another device, sign in and check that decks, personal events, competing events, match logs and manual snapshots load.

The **Account** button appears when the project URL and publishable key are configured. **Import this browser’s data** copies missing guest records into the signed-in account. Account edits save locally first and then sync. If another device has already saved over the same revision, the app keeps the unsynced copy available for download and asks the user to reload the account data before continuing.

## Deploy the scanner

The scanner is a separate Cloudflare Worker. In the Cloudflare dashboard, go to **Workers & Pages**, create a Worker using **Import a repository**, and select **Magic-Dash**. Use branch `main`, root directory `scanner`, and deploy command `npx wrangler deploy`. Wrangler creates the `DASH_DATA` namespace on first deploy. The GitHub Pages site stays at its existing URL. A nightly run with multiple watched cards can exceed the Workers Free limits.

Under the Worker's **Settings → Variables and Secrets**, add a secret named `WATCH_KEY`. For command-line setup, run the following from `scanner/` with Node.js and npm installed:

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put WATCH_KEY
```

Generate a random key of at least 24 characters. In Find Cards, open **Live scanner settings**, enter the deployed Worker HTTPS URL and the key, and choose **Connect scanner**. The same key on both devices opens the same private watchlist. Store the key in a password manager. Set `DASH_ORIGINS` before deploying if you host the frontend on another origin.

Optional eBay results require production Browse API access and the Worker secrets `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`. The public repo and browser need neither eBay secret.

- The cron starts daily at midnight Brisbane time (`0 14 * * *` UTC). The existing Brisbane event automation runs separately.
- The watchlist scanner checks in-stock AUD variants on the configured Shopify stores and listings on MTG Mate. Each Shopify store lookup checks up to three matching products. Stock counts appear when the seller publishes them. Scanner results for eBay are fixed-price offers filtered for Australia. Listed prices exclude shipping.
- Up to 10 watched cards share one private watchlist. The first successful check at each store establishes a baseline. Subsequent checks show previously unseen listing IDs from checked sources.
- The nightly Deck Tracker feed reads MTGGoldfish reference share, verified 180-day MTGDecks win rates, the official MTGO results index and selected large paper events from MTGDecks. Other time windows and Highlander use existing snapshots. The feed keeps the last verified data when an upstream site is unavailable or its layout changes.
