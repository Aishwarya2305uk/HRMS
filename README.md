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

Fastest path — no database setup needed (in-memory MongoDB, seeded demo users):

```bash
npm install
npm run dev:all:mem     # API on :4000 + Vite on :5173
```

Open http://localhost:5173. Demo logins (also shown on the sign-in screens):

| Role     | Email                | Password     | Portal            |
| -------- | -------------------- | ------------ | ----------------- |
| Employee | employee@trula.com   | employee123  | `/`               |
| Manager  | manager@trula.com    | manager123   | `/`               |
| Admin    | admin@trula.com      | admin123     | `/admin`          |

### With a real MongoDB

Set `MONGODB_URL` (and `JWT_SECRET`) in `.env.local`, then:

```bash
npm run seed            # one-time: create demo users + reporting tree
npm run dev:all         # API + Vite against the real DB
```

`node server/jobs/finalize.js` runs the end-of-day attendance finalizer (also
applied lazily on read, so it's optional on serverless).

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
