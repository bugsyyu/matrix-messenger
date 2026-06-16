# Deploying Matrix Messenger

You have two real paths. Pick by what you need:

| Path | What you get | What you don't get |
|---|---|---|
| **GitHub Pages** (free, 1 min) | the visual client at `https://<user>.github.io/<repo>/` — single-player + agent SDK reachable as static files | no live multiplayer (Pages can't host a WebSocket); peers see "OFFLINE" badge |
| **Fly.io** (≈$0/mo idle, 5 min) | full stack — client + multiplayer relay + `/ontology` at `https://<app>.fly.dev/` | needs a Fly account & CLI install |

For a real product launch you usually want **both**: Pages for the screenshot‑clickable demo URL, Fly for the live world. The client already supports `?ws=wss://your-relay.fly.dev/ws` so the Pages build can talk to a Fly backend.

---

## Path A — GitHub Pages (frontend only)

A `.github/workflows/pages.yml` is already in the repo. It:

1. checks out the code,
2. `npm ci && VITE_BASE=/<repo>/ npm run build`,
3. copies `dist/index.html` → `dist/404.html` (so deep links still load the SPA),
4. uploads to GitHub Pages.

Steps for a brand‑new repo:

```bash
# from inside the project
gh repo create matrix-messenger --public --source=. --remote=origin --push

# enable Pages with Actions as the source
gh api -X PUT "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/pages" \
  -F build_type=workflow -F 'source[branch]=main' -F 'source[path]=/' 2>/dev/null || \
gh api -X POST "repos/$(gh repo view --json nameWithOwner -q .nameWithOwner)/pages" \
  -F build_type=workflow

# kick the deploy
git push -u origin main      # already happened via --push, this is for next time
gh run watch                 # wait for green
gh browse --no-browser       # prints the repo URL; pages URL is <user>.github.io/<repo>/
```

After the workflow turns green, the URL is:

```
https://<your-github-user>.github.io/matrix-messenger/
```

The terminal in the demo will print `[net] no relay reachable — running in OFFLINE mode`; everything else (planet, walking, quest pickups, slash commands, agent SDK) works.

---

## Path B — Fly.io (full stack with multiplayer)

```bash
# 1. install flyctl
curl -L https://fly.io/install.sh | sh
export PATH="$HOME/.fly/bin:$PATH"

# 2. sign in (opens a browser; use --interactive on a headless box)
fly auth signup                # or `fly auth login` if you have an account
# headless? use a personal access token from https://fly.io/user/personal_access_tokens
# fly auth token              <-- shows yours later
# export FLY_API_TOKEN=...     <-- on CI

# 3. launch — fly.toml is already in the repo
fly launch --copy-config --no-deploy --yes
# pick a unique app name; Fly will edit fly.toml's `app =` line

# 4. ship it
fly deploy

# 5. take a peek
fly status
fly open                      # opens https://<app>.fly.dev/
fly logs                      # follow
```

`fly.toml` ships with `auto_stop_machines = "stop"`, so an idle world hibernates and costs nothing. First request after sleep wakes it in ~1 s.

### Wire the two together

If you deploy both: edit your Pages URL to add the Fly relay:

```
https://<user>.github.io/matrix-messenger/?ws=wss://<app>.fly.dev/ws
```

The client picks `ws` up from the query string and uses it instead of same‑origin. Share *that* URL.

---

## Path C — your own box / Docker host

```bash
docker build -t matrix-messenger .
docker run -d -p 3005:3005 --restart unless-stopped --name mm matrix-messenger

# behind a reverse proxy that does TLS and upgrades ws:
# nginx:
#   proxy_pass http://localhost:3005;
#   proxy_set_header Upgrade $http_upgrade;
#   proxy_set_header Connection "upgrade";
#   proxy_read_timeout 86400;
```

That's it — `/`, `/ws`, `/ontology`, `/agent-sdk.js` all on the same origin.

---

## Health checks after any deploy

```bash
BASE=https://your-host
curl -fsS  "$BASE/healthz"                 # {"ok":true,...}
curl -fsS  "$BASE/ontology" | head -c 200  # JSON-LD with @context
curl -fsS  "$BASE/agent-sdk.js" | head -c 200
# multiplayer:
node -e "import('ws').then(({default:W})=>{const w=new W(process.argv[1].replace('http','ws')+'/ws');w.on('open',()=>{w.send(JSON.stringify({r:['matrix','smoke']}));setTimeout(()=>{console.log('OK');w.close();process.exit(0)},800)});w.on('message',(m)=>console.log(String(m)));w.on('error',e=>{console.error('FAIL',e.message);process.exit(1)})})" "$BASE"
```

A passing smoke run prints `{"id":"...."}` then `{"r":"matrix/smoke"}` then `OK`.
