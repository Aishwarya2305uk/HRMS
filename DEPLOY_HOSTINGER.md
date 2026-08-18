# Deploying Orbit HRMS to Hostinger

A step-by-step runbook for putting **both halves** of this application — the
React frontend and the Express API — on Hostinger, behind one domain with
HTTPS.

- **Audience:** whoever is doing the deploy. Assumes you can use SSH and edit a
  file in `nano`; assumes no prior Linux server administration.
- **Time:** ~60–90 minutes end to end, most of it waiting on DNS.
- **Companion docs:** [README.md](README.md) (local setup),
  [TECHNICAL.md](TECHNICAL.md) (API contracts), [DESIGN.md](DESIGN.md)
  (architecture decisions).

> Commands prefixed with **`[local]`** run on your own machine. Everything else
> runs **on the VPS**, over SSH.

---

## Table of contents

1. [Choose the right Hostinger plan](#1-choose-the-right-hostinger-plan)
2. [What you'll end up with](#2-what-youll-end-up-with)
3. [Before you start](#3-before-you-start)
4. [Create the VPS](#4-create-the-vps)
5. [Secure the server](#5-secure-the-server)
6. [Install Node, Nginx, Certbot](#6-install-node-nginx-certbot)
7. [Get the code onto the server](#7-get-the-code-onto-the-server)
8. [Configure the environment](#8-configure-the-environment)
9. [Build the frontend](#9-build-the-frontend)
10. [Run the API as a service](#10-run-the-api-as-a-service)
11. [Configure Nginx](#11-configure-nginx)
12. [Point the domain and enable HTTPS](#12-point-the-domain-and-enable-https)
13. [Set up Cloudflare Turnstile](#13-set-up-cloudflare-turnstile)
14. [Schedule the nightly finalizer](#14-schedule-the-nightly-finalizer)
15. [Verification checklist](#15-verification-checklist)
16. [Redeploying and rolling back](#16-redeploying-and-rolling-back)
17. [Environment variable reference](#17-environment-variable-reference)
18. [Troubleshooting](#18-troubleshooting)
19. [Ongoing operations](#19-ongoing-operations)

---

## 1. Choose the right Hostinger plan

**Hostinger Web Hosting (Premium / Business / Cloud) cannot run this
application's backend.** Those plans serve static files and PHP; they cannot
keep a long-running Node.js process alive. This API is a single persistent
Express server (`server/index.js` calls `app.listen`), so it needs a real
server.

| Hostinger product | Frontend | Backend | Verdict |
| --- | --- | --- | --- |
| Web Hosting (Premium/Business) | ✅ | ❌ no long-running Node | Not sufficient alone |
| Cloud Hosting | ✅ | ❌ same limitation | Not sufficient alone |
| **VPS (KVM 1 or larger)** | ✅ | ✅ | **Use this** |

**KVM 1 is enough** for this app at small-company scale (one Node process, one
Nginx, no database on the box).

### The database stays on Supabase

Hostinger VPS does not include managed PostgreSQL. Keep using your existing
Supabase project — the app connects over `DATABASE_URL` and nothing needs to
move. Self-hosting Postgres on the VPS would mean owning backups, upgrades and
point-in-time recovery yourself, which is a step backwards from where you are.

---

## 2. What you'll end up with

Both halves live on the one VPS. Nginx serves the compiled React files and
forwards `/api` to Express on localhost:

```
                    ┌──────────────────────── Hostinger VPS ─────────────────────────┐
                    │                                                                │
Browser ── HTTPS ──▶│  Nginx :443                                                    │
                    │    ├── /            →  /var/www/orbit/dist   (static React)    │
                    │    └── /api/        →  http://127.0.0.1:4000 (Express)         │
                    │                              │                                 │
                    └──────────────────────────────┼─────────────────────────────────┘
                                                   │
                                                   ▼
                                        Supabase Postgres (unchanged)
```

Two consequences worth understanding, because later steps depend on them:

- **The browser only ever talks to one origin.** The frontend and API share
  `https://hrms.yourdomain.com`, so CORS never comes into play. This is simpler
  and safer than the current split-origin Vercel → Render arrangement.
- **Port 4000 is never exposed.** Express is reachable only through Nginx. The
  firewall keeps it that way.

---

## 3. Before you start

Have these ready:

- [ ] A Hostinger **VPS** plan (see §1)
- [ ] A domain in your Hostinger account (or one whose DNS you control)
- [ ] Your Supabase `DATABASE_URL` — Supabase dashboard → **Connect** →
      **Session pooler** (port 5432)
- [ ] SMTP credentials for invite and password-reset emails (Hostinger email
      hosting works: `smtp.hostinger.com`)
- [ ] Access to your GitHub repo (a **deploy key** or fine-grained PAT if private)
- [ ] Optionally, a Cloudflare account for the CAPTCHA (see §13)

---

## 4. Create the VPS

In hPanel → **VPS → Create**:

- **OS:** Ubuntu 24.04 LTS — the plain image, *not* an application template
- Set a strong root password
- Note the **IPv4 address**

Connect:

```
ssh root@YOUR_SERVER_IP
```

---

## 5. Secure the server

### 5.1 Create a non-root user

Running the app as root turns a small bug into a full server compromise.

```
adduser orbit
usermod -aG sudo orbit
rsync --archive --chown=orbit:orbit ~/.ssh /home/orbit
```

### 5.2 Enable the firewall

```
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Port 4000 is deliberately **not** opened — Express should only be reachable
through Nginx.

### 5.3 Reconnect as the new user

```
ssh orbit@YOUR_SERVER_IP
```

Stay as `orbit` for the rest of this guide.

---

## 6. Install Node, Nginx, Certbot

`package.json` requires `node >=18.18`. Install the current LTS:

```
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
```

```
sudo apt-get install -y nodejs nginx certbot python3-certbot-nginx git
```

Confirm:

```
node -v && nginx -v
```

---

## 7. Get the code onto the server

```
sudo mkdir -p /var/www/orbit && sudo chown orbit:orbit /var/www/orbit
```

```
git clone https://github.com/trula-ai/Orbit.git /var/www/orbit
```

```
cd /var/www/orbit && npm ci
```

`npm ci` (not `npm install`) installs exactly what `package-lock.json` pins —
what you tested is what runs.

---

## 8. Configure the environment

```
nano /var/www/orbit/.env
```

Paste the following and fill in every blank. See §17 for what each one does.

```ini
NODE_ENV=production
PORT=4000

# Supabase → Connect → Session pooler (port 5432)
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/postgres

# REQUIRED in production: the server refuses to boot if this is under 32 chars
JWT_SECRET=
JWT_EXPIRES_IN=7d

# Bootstraps your first admin, and only while no matching account exists
ADMIN_EMAIL=admin@yourcompany.com
ADMIN_PASSWORD=
ADMIN_NAME=Administrator

# Fails closed: the finalize endpoint refuses to run until this is set
CRON_SECRET=

CORS_ORIGINS=https://hrms.yourdomain.com
APP_URL=https://hrms.yourdomain.com

# Invite + password-reset emails
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=noreply@yourdomain.com
SMTP_PASS=
SMTP_FROM=noreply@yourdomain.com

# Check-in city/country lookup (blank GEOIP_URL uses the ip-api.com default)
GEOIP_ENABLED=true
GEOIP_URL=

# CAPTCHA — both keys must come from the SAME Cloudflare widget. See §13.
VITE_TURNSTILE_SITE_KEY=
TURNSTILE_SECRET_KEY=
```

Generate the two secrets:

```
node -e "console.log('JWT_SECRET='+require('crypto').randomBytes(48).toString('hex'))"
```

```
node -e "console.log('CRON_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
```

Restrict the file — it contains your database password:

```
chmod 600 /var/www/orbit/.env
```

> **No database setup is required.** On its first connection the server creates
> the entire schema itself and bootstraps the single admin account from
> `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Subsequent starts run idempotent catch-up
> migrations.

---

## 9. Build the frontend

```
cd /var/www/orbit && npm run build
```

This produces `/var/www/orbit/dist`.

> ⚠️ **`VITE_TURNSTILE_SITE_KEY` is compiled into the bundle at build time.**
> It is not read at runtime. Changing it later requires re-running
> `npm run build` — restarting the API alone will silently keep the old key.
> This applies to **any** `VITE_`-prefixed variable.

---

## 10. Run the API as a service

systemd is used rather than PM2: it's already installed, it restarts the app on
boot without extra setup, and its logs land in `journalctl` alongside
everything else on the box.

```
sudo nano /etc/systemd/system/orbit-api.service
```

```ini
[Unit]
Description=Orbit HRMS API
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=orbit
WorkingDirectory=/var/www/orbit
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

`server/env.js` loads `/var/www/orbit/.env` itself, so no `EnvironmentFile=`
line is needed.

```
sudo systemctl daemon-reload && sudo systemctl enable --now orbit-api
```

Confirm it started and reached Supabase:

```
systemctl status orbit-api --no-pager && curl -s localhost:4000/api/health
```

Expected: `{"ok":true}`.

Follow the logs at any time:

```
journalctl -u orbit-api -f
```

---

## 11. Configure Nginx

```
sudo nano /etc/nginx/sites-available/orbit
```

```nginx
server {
    listen 80;
    server_name hrms.yourdomain.com;

    root /var/www/orbit/dist;
    index index.html;

    # Document uploads travel as inline data URLs and express.json caps at 6mb,
    # so Nginx must allow at least that or uploads fail as 413 before reaching
    # Node. Photos are ~1.4MB, documents ~4.2MB encoded.
    client_max_body_size 8m;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # React Router owns the URLs: any non-file path must return index.html, or
    # refreshing on /admin/dashboard/people returns a 404.
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Vite fingerprints these filenames, so they can be cached indefinitely.
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
```

### Why the `X-Forwarded-*` headers matter here

These are not boilerplate. `server/app.js` sets `trust proxy 1`, expecting
exactly one proxy hop. Omit these headers and `req.ip` becomes `127.0.0.1` for
every visitor, which breaks three real features:

- **Check-in location** records "This device (localhost)" for everyone instead
  of a city.
- **Activity Logs** show a useless IP column.
- **The login rate limiter** treats all users as one client, so ten failed
  attempts by anyone locks out the entire company for 15 minutes.

Enable the site:

```
sudo ln -s /etc/nginx/sites-available/orbit /etc/nginx/sites-enabled/ && sudo rm -f /etc/nginx/sites-enabled/default && sudo nginx -t && sudo systemctl reload nginx
```

Make sure Nginx can read the build output:

```
sudo chmod o+x /home 2>/dev/null; sudo chmod -R o+rX /var/www/orbit/dist
```

---

## 12. Point the domain and enable HTTPS

### 12.1 DNS

In hPanel → **Domains → DNS Zone**, add an **A record**:

| Type | Name | Points to | TTL |
| --- | --- | --- | --- |
| A | `hrms` (or `@` for the root domain) | your VPS IPv4 | 300 |

Wait until it resolves:

```
dig +short hrms.yourdomain.com
```

### 12.2 Certificate

Only once the command above returns your server's IP:

```
sudo certbot --nginx -d hrms.yourdomain.com
```

Choose the redirect-HTTP-to-HTTPS option. Certbot installs a renewal timer
automatically. Verify it:

```
sudo certbot renew --dry-run
```

---

## 13. Set up Cloudflare Turnstile

This step causes more deployment failures than any other, so read it fully.

The project currently ships Cloudflare's **test keys** — the ones that display a
red *"For testing only"* banner and let everyone through.

### 13.1 Create a real widget

At **dash.cloudflare.com → Turnstile**, create a widget and add **both**
hostnames to it:

- `hrms.yourdomain.com`
- `localhost` (so local development keeps working)

A missing hostname is the classic "works locally, fails on the live site".

### 13.2 Set both keys, from the same widget

| Variable | Value | Where it's used |
| --- | --- | --- |
| `VITE_TURNSTILE_SITE_KEY` | the widget's **site key** | compiled into the frontend bundle |
| `TURNSTILE_SECRET_KEY` | the widget's **secret key** | read at runtime by the API |

> ⚠️ **They must come from the same widget.** A test site key validated against
> a real secret makes Cloudflare return `invalid-input-response`, and **every
> login fails permanently** with no way for users to recover. The server logs
> `Turnstile KEY MISMATCH` when this happens.

### 13.3 Rebuild — the site key is compiled in

```
cd /var/www/orbit && npm run build && sudo systemctl restart orbit-api
```

### 13.4 Or turn CAPTCHA off

Leave **both** variables blank and the app skips the check on both sides.
Setting only one is the broken state.

---

## 14. Schedule the nightly finalizer

```
crontab -e
```

Add:

```
5 0 * * * curl -s -H "Authorization: Bearer YOUR_CRON_SECRET" https://hrms.yourdomain.com/api/cron/finalize >/dev/null
```

This closes any attendance sessions left open from previous days and applies the
8-hour Present/Leave rule company-wide. It is a **backstop, not load-bearing** —
attendance also finalizes lazily whenever the data is read — but it keeps
yesterday's verdicts correct before anyone opens a report.

---

## 15. Verification checklist

```
curl -s https://hrms.yourdomain.com/api/health
```

Then, in a browser. Each item proves a different part of the setup:

| # | Check | Proves |
| --- | --- | --- |
| 1 | Sign in as `ADMIN_EMAIL` | Database connection, admin bootstrap, CAPTCHA key pairing |
| 2 | Hard-refresh on `/admin/dashboard/people` | SPA fallback (`try_files`) |
| 3 | Check in, then open **System Logs → Activity Logs** — it should show a real city, not "This device (localhost)" | `X-Forwarded-For` is reaching Express |
| 4 | Add an employee and confirm the invite email arrives | SMTP settings |
| 5 | Upload a document larger than 1 MB | `client_max_body_size` |
| 6 | **System Logs → Advanced Logs** is filling with rows | Request logging |
| 7 | Reboot the VPS, wait a minute, reload the site | systemd auto-start |

---

## 16. Redeploying and rolling back

### Deploy an update

```
cd /var/www/orbit && git pull && npm ci && npm run build && sudo systemctl restart orbit-api
```

Nginx needs no reload — it serves `dist/` straight from disk. Database schema
changes apply themselves on restart through the idempotent migrations block.

### Roll back

```
cd /var/www/orbit && git log --oneline -5
```

```
git checkout THE_GOOD_SHA && npm ci && npm run build && sudo systemctl restart orbit-api
```

**Rehearse this once before you need it.** A single VPS has no instant
rollback; if a bad build ships, this is the recovery path.

---

## 17. Environment variable reference

Every variable the application reads. Source: `server/env.js` plus the
build-time `VITE_` variable.

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | Set to `production`. Makes a weak `JWT_SECRET` fatal rather than silent. |
| `PORT` | no | Defaults to 4000. Must match the Nginx `proxy_pass`. |
| `DATABASE_URL` | **yes** | Supabase session pooler, port 5432. |
| `JWT_SECRET` | **yes** | ≥32 chars in production or the server refuses to start. |
| `JWT_EXPIRES_IN` | no | Defaults to `7d`. |
| `ADMIN_EMAIL` | yes (first run) | Creates the one seed admin. Ignored once that account exists. |
| `ADMIN_PASSWORD` | yes (first run) | As above. |
| `ADMIN_NAME` | no | Defaults to `Administrator`. |
| `CRON_SECRET` | recommended | Fails closed — `/api/cron/finalize` refuses to run while unset. |
| `CORS_ORIGINS` | recommended | Comma-separated. Blank allows all origins (dev only). |
| `APP_URL` | yes | Public site URL; builds the links inside invite and reset emails. |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` | recommended | Unset means invites aren't emailed; the admin shares links by hand. Port 465 = implicit TLS, 587 = STARTTLS. |
| `SMTP_FROM` | no | Defaults to `SMTP_USER`. |
| `GEOIP_ENABLED` | no | Defaults on. `false` still records the IP, just no city. |
| `GEOIP_URL` | no | Must contain `{ip}`. Blank uses ip-api.com's free tier. |
| `VITE_TURNSTILE_SITE_KEY` | no | **Build-time.** Requires a rebuild to change. |
| `TURNSTILE_SECRET_KEY` | no | Runtime. Must pair with the site key above. |

---

## 18. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `502 Bad Gateway` on every page | API isn't running | `systemctl status orbit-api`, then `journalctl -u orbit-api -n 50` |
| Site loads, all API calls fail | `proxy_pass` port doesn't match `PORT` | Align them, `sudo systemctl reload nginx` |
| Server won't start, logs mention JWT | `JWT_SECRET` missing or under 32 chars | Regenerate it (§8) |
| Server won't start, logs mention the database | Wrong `DATABASE_URL`, or a paused Supabase project | Re-copy the pooler string; un-pause the project |
| 404 when refreshing any deep link | `try_files` missing | Re-check the `location /` block (§11) |
| Every login says CAPTCHA failed | Site key and secret from different widgets | §13. Logs show `Turnstile KEY MISMATCH` |
| Login page shows no CAPTCHA widget, all logins fail | Built without `VITE_TURNSTILE_SITE_KEY` while the secret is set | Set both, then **rebuild** |
| Check-in location always "This device (localhost)" | `X-Forwarded-For` not forwarded | Add the proxy headers (§11) |
| One user's failed logins lock out everyone | Same cause as above | Same fix |
| Document upload fails around 1 MB | `client_max_body_size` too low | Set `8m` (§11) |
| Invite emails never arrive | SMTP unset or wrong port | Check `SMTP_*`; 465 implicit TLS vs 587 STARTTLS |
| Site works, then dies after a reboot | Service not enabled | `sudo systemctl enable orbit-api` |
| Certbot fails | DNS hasn't propagated | `dig +short hrms.yourdomain.com` must return your IP first |

Useful commands:

```
journalctl -u orbit-api -n 100 --no-pager
```

```
sudo tail -n 50 /var/log/nginx/error.log
```

---

## 19. Ongoing operations

Moving off Vercel and Render means taking on work those platforms did for you.
Know what you're accepting:

- **Patching is yours.** Run `sudo apt update && sudo apt upgrade` on a
  schedule, and reboot when the kernel updates.
- **One box is a single point of failure.** No blue/green, no instant rollback
  — see §16.
- **Monitor uptime.** Point a free external monitor at
  `https://hrms.yourdomain.com/api/health`; it returns `{"ok":true}`.
- **Supabase free-tier projects pause after inactivity.** If this becomes the
  production HRMS, budget for the paid tier.
- **Back up `/var/www/orbit/.env`** somewhere safe. It's the only file on the
  box that isn't reproducible from Git.
- **Hostinger VPS snapshots** are worth enabling in hPanel — the cheapest
  possible disaster recovery.

### Files that stop mattering after this migration

`vercel.json` (rewrites `/api` to Render) and `render.yaml` are inert once
Nginx owns the routing. Leave them or delete them, but don't expect them to
affect this deployment.

---

## Appendix: the lower-effort alternative

If you'd rather not run a server at all, keep the existing Vercel + Render
deployment and use Hostinger only for **DNS** — point your domain at Vercel
with a CNAME and set Render as the API origin. You lose the same-origin
simplicity described in §2, but you also stop being responsible for patching,
TLS renewal and uptime.
