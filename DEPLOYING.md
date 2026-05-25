# Deploying ShelfLife

Target: a Linux host running Docker, behind the shared Caddy in the
[`infra` repo](https://github.com/houlette/infra). ShelfLife runs as a
single API container that joins an external `web` Docker network; the
shared Caddy reverse-proxies to it by container name and serves the
prebuilt SPA from a bind mount.

---

## Prerequisites

- Docker + Docker Compose on the server
- The `infra` repo deployed at `~/infra/` and Caddy running
- The `web` Docker network created: `docker network create web`
- A DNS A record pointing `shelflife.<domain>` at the server
- Node 20+ on your local machine (to build the frontend)

The `infra` repo handles TLS termination and routing for every app on
the host. ShelfLife doesn't expose any host ports.

---

## 1. Configure environment

On the server, create `/etc/shelflife.env`:

```env
SHELFLIFE_SECRET_KEY=<random 32+ character string>
SHELFLIFE_BOOTSTRAP_EMAIL=you@example.com
SHELFLIFE_BOOTSTRAP_PASSWORD=<your admin password>
ANTHROPIC_API_KEY=<your Anthropic key, or leave blank>
```

Generate a strong secret key:

```bash
openssl rand -base64 32
```

Keep this file out of version control. Docker Compose reads it on
startup via `--env-file`.

---

## 2. Clone the repo and build the frontend

```bash
# On the server
git clone https://github.com/houlette/ShelfLife ~/ShelfLife
cd ~/ShelfLife/frontend
npm ci
npm run build      # produces frontend/dist/
```

The shared Caddy mounts `~/ShelfLife/frontend/dist/` as `/srv/shelflife`
and serves it for non-`/api/*` requests. The mount is declared in
[`infra/docker-compose.yml`](https://github.com/houlette/infra/blob/main/docker-compose.yml);
if you're deploying ShelfLife for the first time, add the mount and the
matching `conf.d/shelflife.caddy` file in the infra repo.

---

## 3. Bring up the API container

```bash
cd ~/ShelfLife
docker compose --env-file /etc/shelflife.env up -d --build
```

The container:
- Has a fixed name: `shelflife-api`
- Joins the external `web` Docker network — no host ports exposed
- Stores the SQLite database at `/data/shelflife/shelflife.db` (host path)
- Auto-restarts unless explicitly stopped

The shared Caddy reverse-proxies `shelflife.<domain>/api/*` to
`shelflife-api:8000` over the `web` network.

**First boot:** if no users exist yet, the API uses
`SHELFLIFE_BOOTSTRAP_EMAIL` and `SHELFLIFE_BOOTSTRAP_PASSWORD` to create
an admin account and prints a first invite code:

```bash
docker compose logs api | grep "Invite code"
```

Save the code — you'll use it to invite the first user, or generate
more from the Admin panel.

---

## 4. Verify

```bash
curl https://shelflife.<domain>/api/health
# → {"status": "ok", "time": ...}
```

Open `https://shelflife.<domain>/` in a browser — you should see the
login page.

---

## 5. Invite users

Log in as the admin, go to **★ Admin** in the sidebar, click
**Generate invite link**, and share the code. Codes are single-use.
Recipients register at `/login` using the Register tab.

---

## Updating

```bash
# Build the frontend locally and push to the server
cd ~/Documents/Projects/ShelfLife/frontend
npm run build
rsync -av dist/ ryan@birdwatcher.ryanhoulette.com:/home/ryan/ShelfLife/frontend/dist/

# Rebuild and restart the API on the server
ssh ryan@birdwatcher.ryanhoulette.com \
  "cd ~/ShelfLife && git pull && docker compose --env-file /etc/shelflife.env up -d --build"
```

Database migrations run automatically on startup — no manual steps.

Caddy picks up the new frontend files immediately (it serves from the
bind mount), so the SPA update is live as soon as the rsync finishes.

---

## Backup

The whole database is a single SQLite file:

```bash
# Cold copy
cp /data/shelflife/shelflife.db /data/shelflife/shelflife.db.bak

# Live-safe (no container stop required)
sqlite3 /data/shelflife/shelflife.db ".backup /data/shelflife/shelflife.db.bak"
```

---

## Troubleshooting

**502 Bad Gateway from Caddy** — usually one of:
- `shelflife-api` container isn't running: `docker ps | grep shelflife`
- The container isn't on the `web` network: `docker network inspect web | grep shelflife-api`
- The infra repo's `conf.d/shelflife.caddy` is pointing at the wrong name
- Caddy hasn't reloaded after a conf change: `docker exec infra-caddy caddy reload --config /etc/caddy/Caddyfile`

**Frontend shows blank or 404s on /api routes** — frontend bundle hasn't
been rsynced, or it was rebuilt without an `npm run build`. The mounted
directory must contain `index.html` and `assets/`.

**TLS cert errors** — managed by the infra Caddy. Check `cd ~/infra && docker compose logs caddy`.
