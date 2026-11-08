# Magic Dash

Magic Dash tracks Brisbane and major Magic: The Gathering events, personal decks, match results, metagame snapshots, and Australian singles.

## Run locally

Open `index.html` in a browser. The frontend has no build step. Scryfall card lookup and links to external sources require an internet connection. The Buy Cards tab can save a local watchlist and open store searches before the scanner is connected.

## Source and data

- `index.html` and `buy-cards.js` are the GitHub Pages frontend.
- Decks and match logs live in browser storage. They are separate from the Git repository.
- The midnight Brisbane scan updates the Library copy. Its results can be carried into Git by updating the embedded `brisbane-scheduled-scan` data when needed.

## Deploy the scanner

The scanner is a separate Cloudflare Worker. In the Cloudflare dashboard, go to **Workers & Pages**, create a Worker using **Import a repository**, and select **Magic-Dash**. Use branch `main`, root directory `scanner`, and deploy command `npx wrangler deploy`. Wrangler creates the `DASH_DATA` namespace on first deploy. The GitHub Pages site stays at its existing URL. A nightly run with multiple watched cards can exceed the Workers Free limits.

Under the Worker's **Settings → Variables and Secrets**, add a secret named `WATCH_KEY`. For command-line setup, run the following from `scanner/` with Node.js and npm installed:

```sh
npx wrangler login
npx wrangler deploy
npx wrangler secret put WATCH_KEY
```

Generate a random key of at least 24 characters. In Buy Cards, open **Live scanner settings**, enter the deployed Worker HTTPS URL and the key, and choose **Connect scanner**. The same key on both devices opens the same private watchlist. Store the key in a password manager. Set `DASH_ORIGINS` before deploying if you host the frontend on another origin.

Optional eBay results require production Browse API access and the Worker secrets `EBAY_CLIENT_ID` and `EBAY_CLIENT_SECRET`. The public repo and browser need neither eBay secret.

- The cron starts daily at midnight Brisbane time (`0 14 * * *` UTC). The existing Brisbane event automation runs separately.
- Live prices check in-stock AUD variants on the configured Shopify stores and listings on MTG Mate. Each Shopify store lookup checks up to three matching products and lists each in-stock variant. Stock counts appear when the seller publishes them. Store coverage shows failed or partial checks. MTG Singles, Trade Magic and The Games Cube have direct store or search links. eBay results are fixed-price offers filtered for Australia. Listed prices exclude shipping.
- Up to 10 watched cards share one private watchlist. The first successful check at each store establishes a baseline. Subsequent checks show previously unseen listing IDs from checked sources.
- The nightly Deck Tracker feed reads MTGGoldfish reference share, verified 180-day MTGDecks win rates, the official MTGO results index and selected large paper events from MTGDecks. Other time windows and Highlander use existing snapshots. The feed keeps the last verified data when an upstream site is unavailable or its layout changes.
