# Magic Dash

Magic Dash tracks Brisbane and major Magic: The Gathering events, personal decks, match results, and metagame snapshots.

## Run locally

Open `index.html` in a browser. The app is a single static file with no build step. Scryfall card lookup and links to external sources require an internet connection.

## Source and data

- `index.html` is the app source. The initial commit imports Magic_Dash.html from Library version 5, including the latest Deck Tracker changes.
- Decks and match logs live in browser storage. They are separate from the Git repository.
- The midnight Brisbane scan updates the Library copy. Its results can be carried into Git by updating the embedded `brisbane-scheduled-scan` data when needed.
