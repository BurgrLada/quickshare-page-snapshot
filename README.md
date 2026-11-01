# QuickShare Page Snapshot

Chrome/Brave extension: one click saves the page as you see it, including pages behind a login, into a single HTML file, uploads it to your own Cloudflare Worker and copies a link. No JavaScript is kept. Built on [SingleFile](https://github.com/gildas-lormeau/single-file-core).

## Setup

Requires a Cloudflare account with R2 enabled.

```bash
pnpm install
pnpm exec wrangler login
pnpm exec wrangler r2 bucket create quickshare
openssl rand -hex 32        # your upload token
pnpm exec wrangler secret put UPLOAD_TOKEN --config worker/wrangler.toml
pnpm run worker:deploy
pnpm run build
```

Open `chrome://extensions` (or `brave://extensions`), enable Developer mode, choose **Load unpacked** and pick `extension/`. In the extension options enter the Worker URL and the token. Shortcut: `Alt+Shift+S`.

Keep Site access in the extension details on **On all sites**. With "On click" the page is captured, but images and styles from other domains cannot be fetched and go missing.

## Custom domain

In Cloudflare: Workers & Pages → the Worker → Settings → Domains & Routes → Add → Custom Domain. The domain must be an active zone in Cloudflare. It is deliberately not in `wrangler.toml`, so forks stay generic.

## Secrets

Nothing secret lives in this repo. `UPLOAD_TOKEN` is a Cloudflare secret, `wrangler login` keeps its credentials in your home directory, and the extension stores the token in `chrome.storage.local`. For local `wrangler dev`, use `worker/.dev.vars`, which is gitignored.

## Privacy

Anyone with a link can read the snapshot. Links are 128-bit random and pages are served with `noindex`, a sandbox CSP and no referrer. Scripts, hidden inputs, password values and CSRF meta tags are stripped, but everything visible on the page, such as your name or email, stays in the snapshot.

Delete a snapshot:

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" https://your-worker/<id>
```

To expire snapshots automatically, add a lifecycle rule to the bucket:

```bash
pnpm exec wrangler r2 bucket lifecycle add quickshare expire-90-days --prefix "" --expire-days 90 --force
```

## Development

`pnpm test` builds the extension and runs an end-to-end test against local `wrangler dev`.

## License

AGPL-3.0-or-later, inherited from SingleFile.
