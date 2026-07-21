# Trula HRMS — v1

A fast, lean Human Resource Management System covering attendance, leave
management, and organization visibility. Built to the spec in
[HRMS_v1_Requirements.md](HRMS_v1_Requirements.md).

**Stack:** React 19 + Vite (frontend) · Express 5 (API) · MongoDB / Mongoose ·
JWT auth with backend-enforced RBAC.

## Features

- **Attendance timer (Zoho-style)** — check in, pause/resume for breaks, check
  out. Elapsed time is computed on the **server** from an event log, so the
  timer survives refresh and re-login. A full day is 8h; days under that
  auto-finalize as *Leave*, days at/over as *Present*. Forgotten check-outs are
  auto-closed at end of day.
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

At minimum set `MONGODB_URL`, `JWT_SECRET`, `ADMIN_EMAIL`, and
`ADMIN_PASSWORD` — that admin account is the **only** one the app ever
creates on its own. It self-provisions the first time the app connects to an
empty database, no separate seed step required. Sign in with it at `/admin`
and add every real employee and manager from the People screen — that's also
what wires up the org tree.

```bash
npm install
npm run dev:all         # API on :4000 + Vite on :5173, against MONGODB_URL
```

Open http://localhost:5173 (staff) or http://localhost:5173/admin.

### Without a database yet

`npm run dev:all:mem` runs the same app against a throwaway in-memory
MongoDB (data is wiped on exit) — handy for trying the app before you have a
real cluster. It uses the same `ADMIN_EMAIL` / `ADMIN_PASSWORD` bootstrap, so
those still need to be set.

`node server/jobs/finalize.js` runs the end-of-day attendance finalizer (also
applied lazily on read, so it's optional on serverless).

## Deploying to Vercel (frontend + API together — no separate backend)

The whole app deploys as one Vercel project: the React build is served
statically and the Express API runs as a single serverless function
(`api/[...path].js` catches every `/api/*` request). No other backend to host.

1. **Push to GitHub and import the repo in Vercel.** The build settings come
   from [vercel.json](vercel.json) (build → `dist`, API function, SPA rewrites).
2. **Add environment variables** (Project → Settings → Environment Variables):

   | Variable         | Required | Notes                                                |
   | ---------------- | -------- | ----------------------------------------------------- |
   | `MONGODB_URL`    | ✅       | MongoDB Atlas connection string                       |
   | `JWT_SECRET`     | ✅       | long random string                                    |
   | `JWT_EXPIRES_IN` | –        | defaults to `7d`                                      |
   | `ADMIN_EMAIL`    | ✅       | creates the one initial admin account                 |
   | `ADMIN_PASSWORD` | ✅       | at least 8 characters                                  |
   | `ADMIN_NAME`     | –        | defaults to "Administrator"                            |
   | `CRON_SECRET`    | –        | if set, protects the daily finalizer cron endpoint     |

   In Atlas, allow Vercel's egress by adding `0.0.0.0/0` to the IP access list
   (or Vercel's ranges).
3. **First deploy provisions itself.** The very first request that connects
   to the database creates the `ADMIN_EMAIL` / `ADMIN_PASSWORD` admin
   automatically (see `server/bootstrapAdmin.js`) — nothing to run by hand.
   Sign in at `/admin` and add real people from the admin console. The env
   vars only matter for that first creation; changing `ADMIN_PASSWORD`
   afterwards does **not** reset the account — change the password from
   inside the app instead.

**End-of-day finalizer on Vercel:** [vercel.json](vercel.json) registers a daily
cron (`00:05 UTC`) hitting `/api/cron/finalize`. Attendance is *also* finalized
lazily whenever data is read, so the app stays correct even between cron runs.

> The API is designed to run both ways from the same code: a long-running
> Express server locally and a serverless function on Vercel. Body parsing
> adapts automatically (see `smartJson` in `server/app.js`) so POSTs work in
> both environments.

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
- `GET /attendance/today` · `POST /attendance/{check-in|pause|resume|check-out}` · `GET /attendance/history`
- `POST /leaves` · `GET /leaves/mine` · `GET /leaves/pending` · `POST /leaves/:id/{approve|reject}` · `GET /leaves/all` · `GET /leaves/calendar?month=YYYY-MM`
- `GET /employees/org-tree` (all roles) · `GET|POST /employees` · `PATCH /employees/:id/manager` (admin)

Every protected route verifies role server-side — an employee cannot reach
manager/admin data by calling the API directly.
