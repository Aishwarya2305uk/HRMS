# Orbit by Trula.ai — v1

A fast, lean Human Resource Management System covering attendance, leave
management, and organization visibility. Built to the spec in
[HRMS_v1_Requirements.md](HRMS_v1_Requirements.md).

**Stack:** React 19 + Vite (frontend) · Express 5 (API) · Supabase Postgres
(`pg`) · JWT auth with backend-enforced RBAC.

## Features

- **Attendance timer (Zoho-style)** — check in, pause/resume for breaks, check
  out. Elapsed time is computed on the **server** from an event log, so the
  timer survives refresh and re-login. A full day is 8h; days under that
  auto-finalize as *Leave*, days at/over as *Present*. Forgotten check-outs are
  auto-closed at end of day. Each employee also gets their own **attendance
  analytics** — present-day KPIs, a weekly hours trend chart, and a 90-day
  heatmap, all derived server-side from the same event log.
- **Leave management** — apply (with balance + date validation), manager
  approval queue for **direct reports only**, balance deducted on approval,
  per-type balances (Casual/Sick/Earned) from a single config.
- **Organization tree** — the whole reporting structure, built from the
  `managerId` self-reference, visible to every role.
- **Leave calendar** — the user's own leaves plus a company-wide "who's on
  leave" view, including attendance auto-leave days.
- **Role-aware dashboards** — one portal, sections unlocked by role
  (Employee / Manager / Admin). Admins can add employees and reassign managers.

## Running locally

Copy the env template and fill in real values:

```bash
cp .env.example .env.local
```

At minimum set `DATABASE_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, and
`ADMIN_PASSWORD` — that admin account is the **only** one the app ever
creates on its own. It self-provisions the first time the app connects to an
empty database, no separate seed step required. Sign in with it at `/admin`
and add every real employee and manager from the People screen — that's also
what wires up the org tree.

```bash
npm install
npm run dev:all         # API on :4000 + Vite on :5173, against DATABASE_URL
```

Open http://localhost:5173 (staff) or http://localhost:5173/admin.

`node server/jobs/finalize.js` runs the end-of-day attendance finalizer (also
applied lazily on read, so no scheduler is required for correctness).

## Deploying (frontend + backend, no serverless)

Two pieces: the React build served statically (Vercel) and ONE long-running
Express server (Render) that every user talks to — so an action saved by one
person is immediately visible to everyone.

1. **Backend on Render** — point a Blueprint at this repo;
   [render.yaml](render.yaml) creates the `hrms-api` web service running
   `npm run server`. Fill in the env vars when prompted:

   | Variable         | Required | Notes                                                |
   | ---------------- | -------- | ----------------------------------------------------- |
   | `DATABASE_URL`   | ✅       | Supabase Postgres connection string (session pooler)  |
   | `JWT_SECRET`     | ✅       | long random string (32+ chars — enforced in production) |
   | `JWT_EXPIRES_IN` | –        | defaults to `7d`                                      |
   | `ADMIN_EMAIL`    | ✅       | creates the one initial admin account                 |
   | `ADMIN_PASSWORD` | ✅       | at least 8 characters                                  |
   | `ADMIN_NAME`     | –        | defaults to "Administrator"                            |
   | `CORS_ORIGINS`   | rec.     | your frontend origin(s), comma-separated              |
   | `CRON_SECRET`    | –        | if set, protects the finalizer cron endpoint           |
   | `TURNSTILE_SECRET_KEY` | –  | Cloudflare Turnstile secret (CAPTCHA off if unset)     |

   Supabase's connection pooler accepts connections from anywhere by default —
   no IP allowlist step needed.
2. **Frontend on Vercel** — import the repo; [vercel.json](vercel.json)
   proxies `/api/*` to the Render URL and rewrites everything else to the SPA.
   Set `VITE_TURNSTILE_SITE_KEY` in Vercel env if using the CAPTCHA.
3. **First boot provisions itself.** The server's first database connection
   creates the schema (and migrates existing databases), then the
   `ADMIN_EMAIL` / `ADMIN_PASSWORD` admin (see `server/bootstrapAdmin.js`) —
   nothing to run by hand. Sign in and add real people from the People
   screen; everyone else joins through their invite link. The env vars only
   matter for that first creation; changing `ADMIN_PASSWORD` afterwards does
   **not** reset the account — change the password from inside the app.

**End-of-day finalizer:** attendance finalizes lazily whenever data is read,
so no scheduler is required. For punctual midnight closes, point any free
scheduler (GitHub Actions, cron-job.org) at `GET /api/cron/finalize` with
`Authorization: Bearer $CRON_SECRET`.

## Layout

```
server/
  config.js            # leave types/quotas + 8h workday (single source of truth)
  models/              # User, WorkSession (event-log timer), Leave
  routes/              # auth, attendance, leaves, employees
  services/            # attendance finalizer (8h rule)
  middleware/auth.js   # requireAuth + requireRole (backend RBAC)
src/
  pages/Portal.jsx     # role-aware dashboard shell
  components/          # AttendanceCard, Approvals, OrgTree, LeaveCalendar, …
  lib/hrms.js          # typed API helpers
```

## API (all under `/api`, JWT via `Authorization: Bearer`)

- `POST /auth/login`, `GET /auth/me`
- `GET /attendance/today` · `POST /attendance/{check-in|pause|resume|check-out}` · `GET /attendance/history` · `GET /attendance/analytics`
- `POST /leaves` · `GET /leaves/mine` · `GET /leaves/pending` · `POST /leaves/:id/{approve|reject}` · `GET /leaves/all` · `GET /leaves/calendar?month=YYYY-MM`
- `GET /employees/org-tree` (all roles) · `GET|POST /employees` · `PATCH /employees/:id/manager` (admin)

Every protected route verifies role server-side — an employee cannot reach
manager/admin data by calling the API directly.

See [TECHNICAL.md](TECHNICAL.md) for the full request/response contract of
every endpoint, data model field reference, and the algorithms behind them.
