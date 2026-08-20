# PicHunter 📸

Downloads all photos of a fupa.net match as a single ZIP archive. Paste the
match link, get a folder named after the fixture with the photos numbered
inside it — no logos, no page furniture, just the match photos at the highest
resolution fupa.net serves.

Self-hosted: one container, no accounts, no third-party services, no build step.

## Quick start

```bash
docker compose up -d --build
```

Then open http://localhost:8080. On other machines in the same network use the
host's address, for example `http://192.168.1.20:8080`.

The port can be changed without touching the Compose file:

```bash
PICHUNTER_PORT=9000 docker compose up -d
```

To keep the site reachable only from the host itself, change the port mapping in
`docker-compose.yml` to `"127.0.0.1:${PICHUNTER_PORT:-8080}:80"`.

Nothing in this project opens a port on the internet. As long as your router
does not forward one, the instance is reachable inside your network only.

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

## How it works

The container runs nginx, which does two things:

- serves the static page from `site/`
- reverse-proxies `/fupa/…` to `https://api.fupa.net/…`

That second part is what makes the whole thing work. Browsers only let
JavaScript read a cross-origin response if the other origin allows it via
`Access-Control-Allow-Origin`, and `api.fupa.net` allows exactly one origin:
`https://www.fupa.net`. Routing the API through the same nginx that serves the
page means the browser never makes a cross-origin request in the first place —
no CORS involved, nothing to configure.

The photos themselves are a different story: `image.fupa.net` sends
`Access-Control-Allow-Origin: *`, so the browser fetches them **directly**. Only
three small JSON requests per match pass through nginx; the megabytes of photo
data do not.

The proxy accepts only the three paths the app actually needs
(`v1/matches/<slug>`, `v2/matches/<slug>/stream`, `v1/galleries/<id>`) and
nothing else, so it cannot be repurposed as a general fupa.net relay.

## Development without Docker

Any static server works, but the API calls need the `/fupa/` route, so run nginx
and rebuild after a change:

```bash
docker compose up -d --build
```

Opening `site/index.html` via `file://` shows the page but every search fails —
there is no proxy behind `/fupa/` then.

## Layout

| Path | Purpose |
| --- | --- |
| `site/index.html` | Page markup |
| `site/css/styles.css` | Styling, light and dark |
| `site/js/config.js` | API route, image variant, parallel downloads |
| `site/js/fupa.js` | fupa.net API client and link parsing |
| `site/js/zip.js` | Dependency-free store-only ZIP writer |
| `site/js/app.js` | Interface logic |
| `docker/default.conf` | nginx: static site plus the API proxy |
| `Dockerfile` | nginx image with the site baked in |
| `docker-compose.yml` | Service, port and health check |

No JavaScript dependencies, no CDN, no build tooling.

## Note on rights

The photos belong to the respective photographers and are protected by
copyright. fupa.net states that use and re-uploads require written consent.
PicHunter only makes downloading easier; obtaining permission is up to you.

## License

MIT — see [LICENSE](LICENSE).
