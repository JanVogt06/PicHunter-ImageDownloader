# PicHunter 📸

Downloads all photos of a fupa.net match as a single ZIP archive. Paste the
match link, get a folder named after the fixture with the photos numbered
inside it — no logos, no page furniture, just the match photos at the highest
resolution fupa.net serves.

**Live:** https://janvogt06.github.io/PicHunter-ImageDownloader/

## What it does

1. You paste a match link such as
   `https://www.fupa.net/match/vfb-oberweimar-m1-sv-schott-jena-m2-260711`.
2. PicHunter reads the match, finds every photo gallery attached to it and
   collects the photos.
3. It packs them into `Heimmannschaft - Gastmannschaft.zip`:

```
VfB Oberweimar - SV SCHOTT Jena II.zip
└── VfB Oberweimar - SV SCHOTT Jena II/
    ├── VfB Oberweimar - SV SCHOTT Jena II - 001.jpg
    ├── VfB Oberweimar - SV SCHOTT Jena II - 002.jpg
    └── …
```

Matches without photos are reported as such instead of producing an empty
archive. Direct gallery links (`https://www.fupa.net/photos/…`) work as well.
If a match carries several galleries, all photos land in the same folder with
continuous numbering.

Photos are downloaded at `1920xauto` — 1920 pixels wide with the original
aspect ratio preserved. That is the largest variant fupa.net offers; the
photographers' original files are not publicly available.

## Why a CORS proxy is required

GitHub Pages only serves files, so all the work happens in the visitor's
browser. Browsers enforce the same-origin policy: JavaScript may only read a
cross-origin response if that origin allows it via `Access-Control-Allow-Origin`.

- `image.fupa.net` sends `Access-Control-Allow-Origin: *`, so **the photos
  themselves are fetched directly** by the browser.
- `api.fupa.net` sends `Access-Control-Allow-Origin: https://www.fupa.net` — an
  allow list with a single entry. The browser refuses to hand those responses to
  a page served from anywhere else.

A tiny proxy solves this: it is a server, so the same-origin policy does not
apply to it, and it returns the JSON with the header the browser wants to see.
Only three small JSON requests per match go through the proxy (roughly 20 KB);
the megabytes of photo data do not.

## Setup

### 1. Deploy the Worker

The proxy lives in [`worker/worker.js`](worker/worker.js). It is locked down: it
forwards `GET` requests only, only to `https://api.fupa.net/`, and only for the
origins listed in `ALLOWED_ORIGINS`.

Adjust `ALLOWED_ORIGINS` if your site is not on
`https://janvogt06.github.io`, then deploy either way:

**Cloudflare dashboard** — Workers & Pages → Create → Worker → paste the
contents of `worker/worker.js` → Deploy.

**Wrangler CLI**

```bash
cd worker && npx wrangler deploy
```

Cloudflare's free plan covers 100,000 requests per day, which is around 33,000
matches.

### 2. Point the frontend at it

Put the Worker URL into [`site/js/config.js`](site/js/config.js):

```js
const CONFIG = {
  corsProxies: [
    'https://fupa-proxy.dein-name.workers.dev/?url={url}',
  ],
  // …
};
```

The `{url}` placeholder is replaced with the URL-encoded API address. Several
entries may be listed; they are tried in order until one answers.

### 3. Enable GitHub Pages

In the repository settings under *Pages*, set the source to **GitHub Actions**.
Every push to `master` then publishes the `site/` folder through
[`.github/workflows/pages.yml`](.github/workflows/pages.yml).

## Local development

The Worker allows `localhost` and `127.0.0.1` on any port, so a local server is
enough:

```bash
cd site && python3 -m http.server 8000
```

Opening the files via `file://` does not work — the browser sends `Origin: null`,
which the Worker rejects.

## Layout

| Path | Purpose |
| --- | --- |
| `site/index.html` | Page markup |
| `site/css/styles.css` | Styling, light and dark |
| `site/js/config.js` | Proxy URL, image variant, parallel downloads |
| `site/js/fupa.js` | fupa.net API client and link parsing |
| `site/js/zip.js` | Dependency-free store-only ZIP writer |
| `site/js/app.js` | Interface logic |
| `worker/worker.js` | Cloudflare Worker CORS proxy |

No build step, no dependencies, no CDN.

## Note on rights

The photos belong to the respective photographers and are protected by
copyright. fupa.net states that use and re-uploads require written consent.
PicHunter only makes downloading easier; obtaining permission is up to you.

## License

MIT — see [LICENSE](LICENSE).
