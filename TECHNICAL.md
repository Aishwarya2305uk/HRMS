# HRMS — Technical Reference

This is the exact-contract reference: request/response shapes, field types,
validation rules, and the algorithms behind them. It complements the other
three docs rather than replacing them:

- [HRMS_v1_Requirements.md](HRMS_v1_Requirements.md) — the **what** (product spec).
- [DESIGN.md](DESIGN.md) — the **why** (architecture, decisions, feature history).
- [README.md](README.md) — the **how to run it** (setup, env vars, deploy).
- **This file** — the **exact contract**: every endpoint's request/response
  shape, every model's fields, and the algorithms that compute derived state
  (worked seconds, leave balances, audience resolution, org hierarchy).

If this file and the model/route source disagree, the source wins — fix this
file to match, the same rule DESIGN.md applies to itself.

## Table of contents

1. [Tech stack](#tech-stack)
2. [Repository layout](#repository-layout)
3. [Runtime model](#runtime-model)
4. [Authentication & session lifecycle](#authentication--session-lifecycle)
5. [Data models](#data-models)
6. [Core algorithms](#core-algorithms)
7. [API reference](#api-reference)
8. [Error-handling conventions](#error-handling-conventions)
9. [Frontend architecture](#frontend-architecture)
10. [Environment variables](#environment-variables)
11. [Scripts & local development](#scripts--local-development)
12. [Deployment](#deployment)
13. [Tooling & quality gates](#tooling--quality-gates)

---

## Tech stack

| Layer     | Choice                                   | Notes |
| --------- | ----------------------------------------- | ----- |
| Frontend  | React 19 + Vite 8                         | No UI framework — hand-rolled CSS per page/component, no Tailwind/MUI/etc. |
| Routing   | react-router-dom 7                        | 4 routes total (see [App shell & routing](#app-shell--routing)) |
| Backend   | Express 5                                 | ONE long-running server (`npm run server`) — no serverless functions |
| Database  | Supabase Postgres via `pg`                | One database (`postgres`), 9 tables |
| Auth      | jsonwebtoken + bcryptjs                   | Stateless JWT bearer tokens; no session store |
| Bot check | Cloudflare Turnstile                      | Optional — both sides no-op when unconfigured |
| Lint      | oxlint                                    | No test suite currently exists in the repo |

All exact versions are in [package.json](package.json).

---

## Repository layout

```
server/
  index.js            # long-running server entry (npm run server)
  db.js                # cached pg pool + tx() helper + one-time bootstrap calls
  store.js              # row->JSON mappers (snake_case -> camelCase) + shared user helpers
  app.js                # createApp() — the shared Express app (routes, body parsing, error handler)
  env.js                # loads + exports every env var (.env.local, then .env)
  bootstrapAdmin.js    # creates the one seed admin account
  config.js            # LEAVE_TYPES, FULL_WORKDAY_HOURS — single source of truth for business constants
  seed.js               # one-off "connect once, bootstrap, exit" script
  jobs/finalize.js      # standalone end-of-day finalizer runner (for real cron schedulers)
  middleware/auth.js   # requireAuth, requireRole
  routes/               # auth, attendance, leaves, employees, announcements, teams, cron
  services/
    attendance.js       # 8h verdict, finalization, analytics summarization/bucketing
    geoip.js             # check-in origin: client IP + fail-soft IP→city/country lookup
    hierarchy.js         # ancestorChain(), descendantIds() — the two org-tree walks
  utils/time.js          # UTC day-key helpers shared by attendance + leave calendar

src/
  main.jsx              # app bootstrap: ErrorBoundary > Router > ToastProvider > AuthProvider
  App.jsx                # routes: "/" (Login), "/signup", "/reset-password", "/dashboard/:section?/:id?", "/admin/dashboard/:section?/:id?"
  pages/
    Login.jsx            # public sign-in page (brand panel + LoginForm)
    SignUp.jsx           # invite-only registration (completes an admin-created account)
    Portal.jsx            # the ONE role-aware dashboard shell (~620 lines) — see "Portal.jsx shell pattern"
  context/
    AuthContext.jsx      # session state: login/logout/refreshUser, session restore, 401 handling
    ToastContext.jsx     # global toast notifications
  lib/
    api.js                # apiFetch() — fetch wrapper, timeout, ApiError, 401 broadcast
    hrms.js               # typed per-resource helpers (attendance/leaves/employees/announcements/teams)
    format.js             # display formatters (elapsed time, hours, dates, relative time)
    haptics.js            # Vibration API wrapper, no-ops where unsupported
    useAsyncData.js       # {data,error,loading,reload,setData} hook used throughout Portal.jsx
    useSessionState.js    # useState that survives a refresh (sessionStorage, per tab + user) — drafts, open dialogs, filters
  components/            # ~28 components — see "Component inventory" below
    dashboard/            # Sidebar, TopBar
    notifications/        # NotificationsPanel, ComposeAnnouncementForm
```

---

## Runtime model

The Express app is built exactly once by `createApp()` in
[server/app.js](server/app.js) and served by ONE entry point:

- **`server/index.js`** — a long-running Node process (`npm run server`).
  Calls `connectDB()` once, then `app.listen(PORT)`. This is the whole
  backend, in dev and in production (Render). There is no serverless
  function — the previous Vercel `/api` function was removed so every
  request, everywhere, hits the same single server.

Because one process serves everyone, writes are immediately visible to all
users:

- **Every action writes straight to Postgres** — routes `insert`/`update`
  on the request itself (no queues, no write-behind), and multi-step writes
  (e.g. leave approval's deduct-then-flip) run inside a `tx()` transaction,
  so readers can never observe a half-applied action.
- **Reference-data cache (`server/cache.js`)** — leave types, employment
  types, and app settings are served through a small read-through cache;
  every mutating route invalidates its key immediately, and since the single
  server owns the only cache, the very next read — from any user — is
  fresh. The 30s TTL is only a backstop in case a future write path forgets
  to invalidate. Supabase is always the source of truth — per-user rows,
  authorization checks, and write-path validation reads are never cached.
- **DB pool (`server/db.js`)** — one shared pg Pool (`max: 10`) for the
  process, cached on `globalThis` so watch-mode module re-evaluation can't
  open a second pool. The bootstrap calls run exactly once per process
  (later connectDB() calls await the same promise).

---

## Authentication & session lifecycle

**Login (`POST /api/auth/login`):**
1. The CAPTCHA (Cloudflare Turnstile) is checked *before* touching the
   database — a failed challenge never costs a bcrypt comparison or reveals
   whether the email exists. `verifyCaptcha()` returns `true` unconditionally
   if `TURNSTILE_SECRET_KEY` isn't set (fail-open when unconfigured); once
   configured, it fails **closed** — a missing token, a Cloudflare "not
   verified" response, or even a network error calling Cloudflare all reject
   the login.
2. The user is looked up by lowercased/trimmed email; `bcrypt.compare`
   checks the password. **Wrong email and wrong password return the exact
   same message** (`Invalid email or password.`) — no user enumeration.
3. On success: a JWT is signed with payload `{ sub: user._id, role: user.role }`,
   expiring per `JWT_EXPIRES_IN` (default `7d`), and returned alongside the
   user's safe JSON shape.

**Every subsequent request** carries `Authorization: Bearer <token>`.
`requireAuth` (server/middleware/auth.js) verifies the JWT, loads the user
fresh from the DB (so a deleted/disabled user is rejected even with a
still-valid token), and attaches it as `req.user`. `requireRole(...roles)`
composes after it to gate admin/manager-only routes. **Every protected
route re-checks the role server-side** — there is no route that trusts the
frontend's own routing.

Passwords are hashed with `bcrypt`, cost factor `10`
(`hashPassword` in `server/store.js`), and `passwordHash` is never included
in any JSON shape sent to the client.

**On the frontend:** the token lives in `localStorage` under `hrms.token`
(`src/lib/api.js`). `AuthContext` restores a session on mount by calling
`GET /api/auth/me` if a token is present. Any `401` response anywhere in the
app dispatches a `hrms:session-expired` window event; `AuthContext` listens
once and signs the user out with a "your session expired" notice — so a
dead token is handled in exactly one place, not by every screen guessing
independently.

---

## Data models

Source of truth: `server/schema.js` (the DDL the server applies itself on a
fresh database) plus `server/store.js` for the row->JSON shapes. All tables
live in the `public` schema; every table has RLS enabled with no policies
for the Supabase API roles, so the auto-generated Supabase Data API can't
read anything. The Express server connects as the role in `DATABASE_URL`
(the table owner), which is exempt from RLS.

### `users`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | String | required |
| `email` | String | required, unique, lowercased, indexed |
| `passwordHash` | String | bcrypt, cost 10 — never serialized to the client |
| `role` | `employee \| manager \| admin` | default `employee` |
| `designation`, `department` | String | free text |
| `joiningDate` | Date | |
| `managerId` | uuid ref `users`, nullable | **the single field that builds the org tree** |
| `photoUrl` | String, ≤ ~1.4M chars | compressed JPEG/PNG/WebP/GIF data URL; low-sensitivity, shown broadly |
| `dob`, `address`, `phone`, `education`, `aadharNumber` | mixed | PII — only ever returned via `toProfileJSON()` to an authorized viewer |
| `leaveBalances` | Mixed (`{ [leaveTypeKey]: remainingDays }`) | seeded from `config.js` quotas; deducted only on approval |

Helpers in `server/store.js`: `hashPassword`/`comparePassword` (bcrypt),
`ensureLeaveBalances()` (fills gaps for any newly-added leave type),
`safeUserJSON()` (public shape — id/name/email/role/designation/department/
joiningDate/photoUrl/managerId/leaveBalances/leaveBalance-total/
leaveQuotaTotal), `profileUserJSON()` (adds dob/address/phone/education/
aadharNumber on top of `safeUserJSON()`).

### `work_sessions` — one per user per calendar day

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | uuid ref `users`, indexed | |
| `date` | String `YYYY-MM-DD` | unique together with `userId` |
| `events[]` | `{ type, at }[]` | `type` ∈ `check_in \| pause \| resume \| check_out \| auto_close`. **The event log is the only source of truth** — never a running counter. |
| `status` | `active \| completed \| auto_closed` | |
| `workedSeconds` | Number | finalized total, written once the day closes |
| `dayStatus` | `present \| leave \| null` | 8h-rule verdict, written once the day closes |
| `check_in_ip` | `varchar(64) \| null` | the client IP the day's first check-in arrived on (timer or one-tap), stamped once — later actions never overwrite it |
| `check_in_city` / `check_in_region` / `check_in_country` / `check_in_country_code` | String, default `''` | coarse location that IP resolves to (`services/geoip.js`); all blank when the lookup is disabled, the address is private/loopback, or the provider fails |

**Check-in origin.** Recording the IP is free — it's on the request. Turning it
into a city/country needs a call to a public IP-geolocation service, which is
why `services/geoip.js` is fail-soft end to end: a 2.5s timeout, a one-day
per-IP cache, private ranges skipped outright, warn-once logging, and every
failure path returning blanks. **A check-in must never fail, or visibly slow
down, because a third-party geo API was unreachable.** Configured with
`GEOIP_ENABLED` / `GEOIP_URL` (see `.env.example`); the default provider is
ip-api.com's free tier. IP geolocation is city-level *at best* and simply wrong
behind a VPN or mobile carrier NAT — every surface that shows it says so, since
a location column reads as much harder evidence than it is.

**Why a location can be blank** — two different reasons, deliberately worded
apart in the UI (`checkInOriginLabel()` in `src/lib/format.js` is the single
place that decides the copy, so the card, the roll-call and the admin table
never disagree). `checkInIpScope` is derived on read from the stored IP:

| Scope | Meaning | Shown as |
| --- | --- | --- |
| `local` | loopback/private address — no public location exists to resolve. **The normal case in local dev**, where the browser → Vite → Express hop makes the client IP `::1`. Also on-prem with no proxy in front. | `This device (localhost)` / `Local network` |
| `public` | a real routable address whose lookup was disabled, rate-limited or failed | `Location unavailable` |
| `null` | nothing recorded (a day from before this feature) | `—` |

Calling the `local` case "unknown" would send a developer hunting a bug that
isn't there, which is exactly what it did the first time.

Module-level functions in `server/services/attendance.js`:
`computeWorkedSeconds(events, upto)`
and `isRunning(events)` — see [Core algorithms](#core-algorithms) for the
exact logic. `toLiveJSON(now)` returns the API-facing live
view (see [shared response shapes](#shared-response-shapes)).

### `leaves` — leave AND work-from-home requests share one table

| Field | Type | Notes |
| --- | --- | --- |
| `userId` | uuid ref `users`, indexed | |
| `kind` | `leave \| wfh`, indexed | default `leave` |
| `type` | one of `config.js` → `LEAVE_TYPE_KEYS` (`casual\|sick\|earned`) | required only when `kind === 'leave'`; WFH has no quota-based type |
| `startDate`, `endDate` | Date | inclusive range, stored at UTC midnight |
| `days` | Number, > 0 | working days in the range × per-day fraction — **Sundays are weekly offs**: a request can't start or end on one and one inside the range isn't counted (`utils/time.js` `workingDays`) |
| `reason` | String | |
| `status` | `pending \| approved \| rejected`, indexed | |
| `approverId`, `decidedAt`, `decisionComment` | mixed | set on manager decision |

Balance is deducted **only on approval** of a `kind: 'leave'` row, never at
submit time — a rejected or cancelled request costs nothing. `kind: 'wfh'`
never touches any balance (it's a location change, not time off).
`leaveJSON()` (store.js) is the client-facing shape.

### `announcements`

| Field | Type | Notes |
| --- | --- | --- |
| `title` | String, ≤140 chars | |
| `body` | String, ≤2000 chars | |
| `type` | `announcement \| urgent`, indexed | |
| `authorId` | uuid ref `users` | |
| `audienceScope` | `all \| role \| team \| group` | mutually exclusive — see [audience resolution](#announcement-audience-resolution) |
| `audienceRole` | nullable | set only when scope is `role` |
| `audienceRootId` | uuid ref `users`, nullable | set only when scope is `team` |
| `audienceGroupId` | uuid ref `teams`, nullable | set only when scope is `group` |
| `readBy[]` | uuid ref `users` | appended idempotently; never returned wholesale — routes compute a per-viewer `read` boolean instead |

Indexed on `createdAt: -1` (list views are always newest-first).
`announcementJSON()` (store.js) is the client-facing shape.

### `teams` — a manager's own named sub-groups, for finer-grained targeting

| Field | Type | Notes |
| --- | --- | --- |
| `name` | String, ≤60 chars | |
| `managerId` | uuid ref `users`, indexed | the creating/owning manager |
| `memberIds[]` | uuid ref `users` | validated server-side, on every create/edit, against the manager's own reporting subtree |

A team can never contain someone outside its manager's existing subtree — it
adds no reach beyond the whole-subtree `team`-scope broadcast that already
exists, just a finer-grained subset of it. `teamJSON()` (store.js) is the
client shape; routes that join members add a `members: [{id,name}]` array on
top.

### Single source of truth for business constants (`server/config.js`)

```js
LEAVE_TYPES = [
  { key: 'casual', label: 'Casual Leave', quota: 12 },
  { key: 'sick',   label: 'Sick Leave',   quota: 8  },
  { key: 'earned', label: 'Earned Leave', quota: 15 },
]
TOTAL_ANNUAL_QUOTA = 35   // sum of all quotas
FULL_WORKDAY_HOURS = 8
FULL_WORKDAY_SECONDS = 28800
```

---

## Core algorithms

### Attendance event log → worked seconds

`computeWorkedSeconds(events, upto)` (server/models/WorkSession.js) walks the
ordered event log once, opening a running interval on `check_in`/`resume`
and closing it on `pause`/`check_out`/`auto_close`. A still-open interval at
the end is measured up to `upto` (default: now). Paused time is simply never
inside any interval — it doesn't need special-casing.

Worked example — a day with one break:

| Event | Time (UTC) | Interval |
| --- | --- | --- |
| `check_in` | 09:00:00 | opens interval 1 |
| `pause` | 11:30:00 | closes interval 1 → 2h30m (9000s) |
| `resume` | 12:15:00 | opens interval 2 |
| `check_out` | 17:45:00 | closes interval 2 → 5h30m (19800s) |

Total worked = 9000 + 19800 = **28800s (exactly 8h)** → `verdictFor(28800)`
returns `present` (the rule is `>=`, not `>`).

`isRunning(events)` replays the same log and returns whether the last
open/close transition left an interval open — this (plus `status`) drives
the `timerState` the UI renders (`out | running | paused | done`).

### End-of-day finalization

Rather than depend on a scheduler being configured, finalization happens
**lazily on read**: `finalizeStaleSessions(userId?)`
(server/services/attendance.js) finds every `status: 'active'` session with
`date < today` (scoped to one user, or company-wide when called with no
argument) and closes each one — appending an `auto_close` event at
`endOfDay(session.date)` if the timer was still running, then computing
final `workedSeconds` and the `present`/`leave` verdict. It's called at the
top of every attendance/leave-calendar read handler, so correctness never
depends on a cron tick firing on time. `server/jobs/finalize.js` /
`GET /api/cron/finalize` call the same function for deployments that do have
a real scheduler — belt-and-suspenders, not the only mechanism.

### Leave lifecycle & balances

Balance is checked **twice**: once at submission (against the balance at
that moment) and again at approval time (in case other approvals landed in
between) — `POST /leaves/:id/approve` re-reads the employee's current
balance and rejects the approval if it's no longer sufficient, rather than
trusting the number from when the request was submitted. Balance is only
ever decremented inside that approval handler; rejection and cancellation
never touch it.

### Organization hierarchy walks (`server/services/hierarchy.js`)

Two complementary walks over the same `managerId` self-reference, chosen for
opposite reasons:

- **`ancestorChain(userId)`** — walks *upward* from `userId` to the root,
  returning a `Set` including `userId` itself. Cheap because one user's
  chain to the top is a single path. Used to answer "does a team-scoped
  broadcast rooted at X reach viewer V?" (`ancestorChain(V).has(X)`) and "is
  X within manager M's own downward reach?" (`ancestorChain(X).has(M)`).
- **`descendantIds(managerId)`** — walks *downward*, breadth-first, over the
  whole roster loaded into memory, returning every transitive report
  (excluding `managerId` itself). Used wherever the full downward set is
  actually needed, e.g. validating a Team's `memberIds` or listing
  `GET /teams/candidates`.

Both guard against corrupt-data cycles (a `seen` set breaks the loop rather
than looping forever) even though `PATCH /employees/:id/manager` already
rejects cycles at write time.

### Announcement audience resolution

`matchesAudience(announcement, viewer, viewerAncestorChain)` in
`server/routes/announcements.js` decides whether a given announcement is
addressed to a given viewer:

| `audienceScope` | Reaches | Resolved by |
| --- | --- | --- |
| `all` | everyone | trivially true |
| `role` | everyone with `role === audienceRole` | direct field compare |
| `team` | `audienceRootId` + everyone who transitively reports to them | `ancestorChain(viewer).has(audienceRootId)` |
| `group` | exactly the `Team.memberIds` of `audienceGroupId` | direct membership test |

Authoring (who may *create* an announcement with a given scope) is a
separate, stricter check in `POST /announcements`:

| `audienceScope` | Who may author it |
| --- | --- |
| `all` / `role` | admin only |
| `team` | admin: any root · manager: only themselves as root (their whole downstream org, however deep) |
| `group` | admin: any `Team` · manager: only `Team`s where `managerId` is themselves |

### Presence (`online \| idle \| offline`)

There is no separate presence store — `activityByUser()`
(server/routes/employees.js) derives it from today's `work_sessions` on
every `GET /employees/org-tree` call: `online` = checked in and running,
`idle` = checked in but paused, `offline` = not checked in yet, or already
checked out/auto-closed. Deliberately coarse (a single enum, never worked
hours or check-in times) since org-tree is readable by every role.

---

## API reference

All routes are mounted under `/api` (see `server/app.js`). Every route below
requires `Authorization: Bearer <token>` unless marked **public**. An
unrecognized `/api/*` path returns `404 { error: "That endpoint does not exist." }`.

### Shared response shapes

**`SafeUser`** (`User.toSafeJSON()`) — returned by login, `/auth/me`, the
employees list, and anywhere else a user is embedded:

```jsonc
{
  "id": "65f...", "name": "Priya Shah", "email": "priya@trula.com",
  "role": "employee",                 // employee | manager | admin
  "designation": "Software Engineer", "department": "Engineering",
  "joiningDate": "2025-03-01T00:00:00.000Z",
  "photoUrl": "",                     // data URL or ""
  "managerId": "65e...", // or null
  "leaveBalances": { "casual": 12, "sick": 8, "earned": 15 },
  "leaveBalance": 35,                 // sum across all types
  "leaveQuotaTotal": 35               // sum of annual quotas (config.js)
}
```

**`ProfileUser`** = `SafeUser` + `{ dob, address, phone, education, aadharNumber }`
(`User.toProfileJSON()`). Profile routes additionally attach `managerName`.

**`LiveSession`** (`WorkSession.toLiveJSON()`):

```jsonc
{
  "date": "2026-07-28",
  "timerState": "running",           // out | running | paused | done
  "running": true,
  "workedSeconds": 9042,
  "fullDaySeconds": 28800,
  "status": "active",                // active | completed | auto_closed
  "dayStatus": null,                  // present | leave | null (null until the day closes)
  "checkInAt": "2026-07-28T09:00:00.000Z",
  "checkOutAt": null,

  // Where the day was started from — stamped once, by whichever check-in came
  // first (timer or one-tap). The IP is always recorded; the city/country come
  // from an IP lookup (services/geoip.js) and are blank whenever that lookup is
  // disabled, hits a private address, or fails.
  "checkInIp": "203.0.113.42",
  "checkInIpScope": "public",        // local | public | null — derived on read, see below
  "checkInCity": "Mumbai",
  "checkInCountry": "India",
  "checkInCountryCode": "IN",
  "checkInLocation": "Mumbai, Maharashtra, India"   // ready-to-render, '' when unknown
}
```

**`LeaveDoc`** (`Leave.toJSONSafe()`):

```jsonc
{
  "id": "66a...", "userId": "65f...", "employeeName": "Priya Shah",
  "kind": "leave",                    // leave | wfh
  "type": "casual",                   // null when kind === "wfh"
  "startDate": "2026-08-01T00:00:00.000Z",
  "endDate": "2026-08-02T00:00:00.000Z",
  "days": 2, "reason": "Family event",
  "status": "pending",                // pending | approved | rejected
  "approverId": null, "decidedAt": null, "decisionComment": "",
  "createdAt": "2026-07-28T04:00:00.000Z"
}
```

**`AnnouncementDoc`** (`Announcement.toJSONSafe()`, + route-computed `read`):

```jsonc
{
  "id": "66b...", "title": "Office closed Friday", "body": "...",
  "type": "announcement",             // announcement | urgent
  "authorId": "65e...", "authorName": "Admin",
  "audienceScope": "all",             // all | role | team | group
  "audienceRole": null, "audienceRootId": null, "audienceRootName": null,
  "audienceGroupId": null, "audienceGroupName": null,
  "createdAt": "2026-07-27T10:00:00.000Z",
  "read": false
}
```

**`TeamDoc`** (`Team.toJSONSafe()` + `members` on routes that populate):

```jsonc
{
  "id": "66c...", "name": "Project Alpha", "managerId": "65e...",
  "memberIds": ["65f...", "65g..."], "memberCount": 2,
  "createdAt": "2026-07-20T00:00:00.000Z",
  "members": [{ "id": "65f...", "name": "Priya Shah" }, { "id": "65g...", "name": "Arjun Rao" }]
}
```

**`OrgNode`** (`GET /employees/org-tree`, response is `{ roots: [OrgNode] }`):

```jsonc
{
  "id": "65e...", "name": "Admin", "designation": "", "department": "",
  "role": "admin", "managerId": null, "activity": "offline",
  "reports": [ /* nested OrgNode[] */ ]
}
```

---

### Auth (`server/routes/auth.js`)

#### `POST /api/auth/login` — public
- **Body:** `{ email, password, captchaToken? }`
- **200:** `{ token, user: SafeUser }`
- **400:** missing email/password (`"Email and password are required."`) ·
  failed CAPTCHA (`"CAPTCHA verification failed. Please try again."`)
- **401:** `"Invalid email or password."` (identical for unknown email vs. wrong password)

#### `GET /api/auth/me`
- **200:** `{ user: SafeUser }`

---

### Attendance (`server/routes/attendance.js`)

#### `GET /api/attendance/today`
- **200:** `LiveSession & { onLeave }`, or `{timerState:'out',running:false,workedSeconds:0,dayStatus:null,checkInAt:null,checkOutAt:null,onLeave}` if no session exists yet today. `onLeave` is the approved **full-day** `kind:'leave'` covering today (`{id,type,label,startDate,endDate}`) or `null` — the dashboard greys out both check-in buttons with the reason when it's set (half-day / shorter custom leave doesn't count: part of the day is still worked; WFH never counts).

#### `POST /api/attendance/:action`
- `:action` ∈ `check-in | pause | resume | check-out`
- **200:** updated `LiveSession`
- **404:** unrecognized action (`"Unknown attendance action."`)
- **409:** invalid state transition — `"You have already checked in today."` ·
  `"You need to check in first."` · `"Timer is not running."` (pause while
  paused/not started) · `"Timer is already running."` (resume while running) ·
  on a full-day leave day (`check-in` and `day-checkin` only): `"You're on approved <type> today — check-in isn't available on a leave day."`

#### `GET /api/attendance/history`
- Last 60 sessions for the caller, newest first.
- **200:** `LiveSession[]`

#### `GET /api/attendance/analytics`
- Fixed 90-day rolling window ending today, for the caller only.
- **200:**
  ```jsonc
  {
    "range": { "from": "2026-04-30", "to": "2026-07-28" },
    "summary": {
      "loggedDays": 60, "presentDays": 54, "shortDays": 6,
      "totalWorkedSeconds": 1555200, "avgWorkedSecondsPerDay": 25920,
      "bestDayWorkedSeconds": 36000, "presentRate": 90,
      "currentStreak": 12, "longestStreak": 21,
      "thisMonth": { "presentDays": 18, "totalWorkedSeconds": 466560, "avgWorkedSecondsPerDay": 25920 }
    },
    "daily": [ /* LiveSession[] */ ],
    "weekly": [ { "weekStart": "2026-07-20", "totalWorkedSeconds": 144000, "presentDays": 5, "loggedDays": 5 } ]
  }
  ```
  "Streak" counts consecutive *logged* present days in the list, not
  consecutive calendar dates (v1 has no working-day/weekend calendar
  concept, so a day with no session at all isn't treated as a break).

#### `GET /api/attendance/daily?date=YYYY-MM-DD` — manager + admin
The daily check-in roll-call rendered at the foot of the check-in card
(`TeamCheckins.jsx`). Defaults to today if `date` is missing/malformed.

**Scope is decided from `req.user.role` alone** — the request carries no scope
parameter, so a manager has nothing to tamper with:

| Role | Sees |
| --- | --- |
| `admin` | every `status:'active'` user in the company |
| `manager` | only their own reporting subtree (`descendantIds`) — direct *and* indirect reports |
| anything else | 403 |

The caller is always excluded (their own status is the card this panel hangs
under), as are `status:'invited'` accounts, which can't have attendance yet.
Rows include people who have **not** checked in — that's the point of a
roll-call — sorted as an arrival log: earliest check-in first, then everyone
still missing, alphabetically. Profile photos are deliberately not selected
(inline data URLs, up to ~1.4MB each; the panel shows initials).

- **200:**
  ```jsonc
  {
    "date": "2026-08-16",
    "scope": "team",                    // team | company — titles the panel
    "summary": { "total": 12, "checkedIn": 9, "onLeave": 1, "absent": 2 },
    "rows": [ /* LiveSession & {
                   employeeId, employeeName, department, designation,
                   checkedIn: boolean,
                   onLeave: {id,type,label,startDate,endDate} | null
                 } */ ]
  }
  ```
- **403:** `"You do not have access to this resource."`

#### `GET /api/attendance/all?month=YYYY-MM` — admin only
- Defaults to the current month if `month` is missing/malformed.
- **200:** `(LiveSession & { employeeId, employeeName, department })[]` — the
  `LiveSession` part carries the check-in origin fields, which the admin
  All-attendance table shows as a "From" column under a single-day lens.
- **403:** `"Admins only."`

---

### Leaves (`server/routes/leaves.js`)

#### `GET /api/leaves/config`
- **200:** `{ types: [{ key, label, quota }] }`

#### `POST /api/leaves` — apply for leave
- **Body:** `{ type, startDate, endDate, reason? }` (dates as `YYYY-MM-DD`)
- **201:** `LeaveDoc`
- **400:** invalid `type` (`"Please choose a valid leave type."`) · malformed/
  missing dates (`"Start and end dates are required."`) · `end < start`
  (`"End date cannot be before the start date."`) · insufficient balance
  (`"Insufficient {Label} balance — you have {n} day(s) left but requested {m}."`)

#### `POST /api/leaves/wfh` — request work from home
- **Body:** `{ startDate, endDate, reason }` — **reason is required** (no quota to fall back on)
- **201:** `LeaveDoc` (`kind: "wfh"`, `type: null`)
- **400:** empty reason (`"Please add a reason for working from home."`) ·
  reason > 500 chars (`"Reason must be under 500 characters."`) · same date validation as above

#### `GET /api/leaves/mine`
- Both `kind`s mixed, newest first. **200:** `LeaveDoc[]`

#### `DELETE /api/leaves/:id` — cancel your own pending request
- **200:** `{ id }`
- **400:** invalid id (`"Invalid leave id."`)
- **403:** not yours (`"You can only cancel your own leave requests."`)
- **404:** `"Leave request not found."`
- **409:** not pending (`"Only pending leave requests can be cancelled."`)

#### `GET /api/leaves/pending` — manager/admin only
- Pending leaves **from direct reports only**, oldest first.
- **200:** `LeaveDoc[]` · **403:** `"Only managers can view approvals."`

#### `POST /api/leaves/:id/approve` — must be the requester's direct manager
- Re-checks balance at approval time for `kind: "leave"`; deducts on success. Skipped entirely for `kind: "wfh"`.
- **200:** `LeaveDoc`
- **400:** balance no longer sufficient (`"Cannot approve — employee only has {n} day(s) of that leave left."`)
- **403:** `"You can only act on leaves of your direct reports."`
- **404:** `"Leave not found."` · **409:** `"This leave has already been decided."`

#### `POST /api/leaves/:id/reject`
- **Body:** `{ comment? }` · same ownership guard as approve · no balance change.
- **200:** `LeaveDoc`

#### `GET /api/leaves/all` — admin only
- Every leave/WFH request company-wide, newest first.
- **200:** `LeaveDoc[]` · **403:** `"Admins only."`

#### `GET /api/leaves/calendar?month=YYYY-MM`
- Company-wide availability for the month, folded into one map:
  - every **approved** `kind:"leave"` request overlapping the month
    (company-wide — `reason`/`decisionComment` only included on entries
    belonging to the viewer);
  - the viewer's own pending/rejected `kind:"leave"` requests;
  - the viewer's own attendance auto-leave days (`dayStatus: "leave"`).
  - `kind: "wfh"` is deliberately excluded entirely — it isn't an absence.
- **200:**
  ```jsonc
  {
    "month": "2026-07",
    "days": {
      "2026-07-15": [
        { "id": "66a...", "name": "Priya Shah", "type": "casual", "self": false,
          "kind": "leave", "status": "approved", "startDate": "2026-07-15",
          "endDate": "2026-07-16", "days": 2, "createdAt": "..." }
      ]
    }
  }
  ```

---

### Employees (`server/routes/employees.js`)

#### `GET /api/employees/org-tree` — any role
- **200:** `{ roots: [OrgNode] }`

#### `GET /api/employees/:id/profile` — self or admin only
- **200:** `ProfileUser & { managerName }`
- **400:** invalid id · **403:** `"You do not have access to this resource."`
- **404:** `"Employee not found."`

#### `PATCH /api/employees/:id/profile` — self or admin only
- **Body (all optional):** `{ dob, address, phone, education, aadharNumber, photoUrl }`
  — role/manager/email are **not** editable here.
- **200:** `ProfileUser & { managerName }`
- **400:** `"Enter a valid date of birth."` · `"Address must be under 300 characters."` ·
  `"Enter a valid phone number."` (regex `^[0-9+\-\s()]{7,20}$`) ·
  `"Education must be under 500 characters."` ·
  `"Aadhar number must be exactly 12 digits."` ·
  `"That image is too large. Please use one under ~1MB."` (~1.4M-char data URL cap) ·
  `"Unsupported image format."` (must be `data:image/(png|jpe?g|webp|gif);base64,...`)

*(everything below requires `role: admin`)*

#### `GET /api/employees` — admin only
- Every user, with `managerName` populated, oldest-created first.
- **200:** `(SafeUser & { managerName })[]`

#### `POST /api/employees` — admin only, adds a new employee
- **Body:** `{ name, email, password, role?, designation?, department?, joiningDate?, managerId? }`
- **201:** `SafeUser & { managerName: null }`
- **400:** `"Name, email and password are required."` · `"Invalid role."` ·
  `"Selected manager does not exist."`
- **409:** `"An account with that email already exists."`

#### `PATCH /api/employees/:id/manager` — admin only
- **Body:** `{ managerId }` (`null` clears it, moving the employee to the root)
- **200:** `SafeUser`
- **400:** `"An employee cannot manage themselves."` ·
  `"Selected manager does not exist."` ·
  `"That change would create a reporting loop."` (cycle guard)
- **404:** `"Employee not found."`

---

### Announcements (`server/routes/announcements.js`)

#### `GET /api/announcements`
- Everything addressed to the viewer (any scope match), newest first, capped at 100.
- **200:** `AnnouncementDoc[]` (each with `read`)

#### `POST /api/announcements/read-all`
- Marks every currently-visible announcement read for the caller.
- **200:** `{ ok: true }`

*(everything below requires `role: admin` or `manager`)*

#### `GET /api/announcements/audience-options`
- Data for the composer's "Send to" picker.
- **200:**
  ```jsonc
  {
    "canTargetAll": false, "canTargetRole": false,   // true only for admin
    "teams": [ { "id": "65e...", "label": "My team", "size": 4 } ],
    "groups": [ { "id": "66c...", "name": "Project Alpha", "size": 2 } ]
  }
  ```
  `teams` sizes are the **full transitive subtree**, not direct reports.

#### `GET /api/announcements/sent`
- Admin sees every announcement ever posted; manager sees only ones they authored.
- **200:** `AnnouncementDoc[]`

#### `POST /api/announcements` — compose
- **Body:** `{ title, body, type?, audienceScope, audienceRole?, audienceRootId?, audienceGroupId? }`
- **201:** `AnnouncementDoc & { authorName, read: true }`
- **400:** `` `Title is required (max 140 characters).` `` ·
  `` `Message is required (max 2000 characters).` `` ·
  `"Invalid message type."` · `"Choose who this is for."` ·
  `"Choose a valid role to target."` · `"Choose a valid team to target."` ·
  `"Selected team no longer exists."`
- **403:** `"Only admins can broadcast company-wide or by role."` ·
  `"You can only broadcast to your own team."` ·
  `"You can only broadcast to teams you created."`

#### `DELETE /api/announcements/:id`
- Admin can remove any; manager only their own.
- **200:** `{ id }` · **404:** `"Announcement not found."`
- **403:** `"You can only remove announcements you posted."`

---

### Teams (`server/routes/teams.js`, `role: admin` or `manager` only)

#### `GET /api/teams/candidates`
- Everyone in the caller's own transitive reporting subtree.
- **200:** `[{ id, name, designation, department }]`

#### `GET /api/teams/mine`
- The caller's own teams, name-sorted, members populated.
- **200:** `TeamDoc[]`

#### `POST /api/teams` — create
- **Body:** `{ name, memberIds: [id] }`
- **201:** `TeamDoc`
- **400:** `` `Give the team a name (max 60 characters).` `` ·
  `"Pick at least one team member."` · `"Invalid member id."` ·
  `"You can only add people who report to you (directly or through their manager)."`

#### `PATCH /api/teams/:id` — rename and/or replace membership
- **Body (either/both optional):** `{ name?, memberIds? }`
- **200:** `TeamDoc`
- **403:** `"You can only manage teams you created."` (only the creating manager may edit)

#### `DELETE /api/teams/:id`
- Same ownership guard as `PATCH`. **200:** `{ id }`

---

### Cron (`server/routes/cron.js`)

#### `GET /api/cron/finalize`
- If `CRON_SECRET` is set, requires `Authorization: Bearer <CRON_SECRET>`
  (**401** `"Unauthorized."` otherwise). **If `CRON_SECRET` is unset, this
  endpoint has no authentication at all** — same "warn and skip" posture as
  the rest of the app's optional secrets, but worth knowing since it's a
  public URL if you don't set the secret.
- **200:** `{ ok: true, closed: <number of sessions auto-closed> }`

### Health

#### `GET /api/health` — public, no auth
- **200:** `{ ok: true }`

---

## Error-handling conventions

**Server side** (`server/app.js` catch-all error handler): every thrown
error becomes `{ error: "<message>" }` with a status code. For `status < 500`
where the route deliberately set `err.expose !== false` and provided a
message, that message is sent as-is (these are the user-facing 4xx strings
quoted throughout the API reference above). Anything else — including any
unexpected 500 — is replaced with a generic
`"Something went wrong. Please try again."`, and the real error (with stack)
is only ever `console.error`'d server-side. This is deliberate: DB/stack
internals must never leak to the client (OWASP: improper error handling /
information disclosure). The same discipline applies to the 404 handler —
the unmatched method/path is logged server-side but never echoed back in
the response body.

**Client side** (`src/lib/api.js`): `apiFetch()` wraps every call in a
15-second timeout (`AbortController`) and converts every failure into an
`ApiError { message, status, retryable }`. `humanize(status, serverMessage)`
decides the message: the server's own copy wins for a deliberate 4xx (it was
written for users); any `5xx` always gets the client's own generic copy,
never the server's; unhandled statuses fall back to a per-status default
(400/422, 401, 403, 404, 409, 429). A `401` additionally dispatches
`SESSION_EXPIRED_EVENT` once, so `AuthContext` can sign the user out
globally instead of every call site handling it separately.

---

## Frontend architecture

### App shell & routing

`src/main.jsx` composes providers outside-in:
`ErrorBoundary > BrowserRouter > ToastProvider > AuthProvider >
(OfflineBanner, App, Toaster)`. `ErrorBoundary` is outermost so a render
crash anywhere still shows a recoverable screen instead of a blank page.

`App.jsx` has exactly three routes: `/` (public `Login`),
`/dashboard/:section?/:id?` (`Portal`, roles `employee`/`manager`),
`/admin/dashboard/:section?/:id?` (`Portal`, role `admin`), plus a catch-all
redirecting to `/`. **The same `Portal` component renders for every role** —
see "Portal.jsx shell pattern" below. **The open section lives in the path**
(`/admin/dashboard/leaves`, `/dashboard/profile/<id>` for an admin viewing
someone else's profile) rather than in component state, so a page refresh,
the browser's Back/Forward, a bookmark and the post-login redirect all land
on the same page; a section the role can't open falls back to the dashboard
and the URL is tidied to match.

`ProtectedRoute` gates by auth state and (optionally) role. It waits for
`AuthContext`'s `loading` flag before redirecting, so a page refresh on a
protected route doesn't bounce to login before the session-restore check
finishes. An authenticated user hitting a route their role can't use is
redirected to their own home, not to login. **This is UI-level convenience
only** — every actual data request is independently re-checked server-side.

### State & context layer

- **`AuthContext`** — `user`, `role`, `isAuthenticated`, `loading`, `notice`
  (explains *why* the user landed back on login), `login`/`logout`/
  `refreshUser`. Restores the session via `GET /auth/me` on mount if a token
  exists; listens for the global session-expired event (see above).
- **`ToastContext`** — `success`/`error`/`info`, max 3 visible at once,
  auto-dismiss timing varies by tone (errors linger longer: 6s vs. 3.5s for
  success), a toast carrying an `action` stays until manually dismissed.

### API client layer

`src/lib/api.js` exports the single `apiFetch(path, {method,body,auth,signal})`
used by everything; `src/lib/hrms.js` wraps it into typed per-resource
helpers (`attendance.*`, `leaves.*`, `employees.*`, `announcements.*`,
`teams.*`) so components read as `attendance.action('check-in')` rather than
constructing URLs inline.

`src/lib/useAsyncData.js` is the loading pattern used throughout: returns
`{ data, error, loading, reload, setData }` from a fetcher function, guards
against a slow earlier response overwriting a newer one (a `runId` ref), and
accepts `enabled` to defer fetching until a section is actually opened
(lazy per-tab loading in `Portal.jsx`).

`src/lib/useSessionState.js` is a drop-in `useState` whose value survives a
page refresh: sessionStorage-backed (per tab, gone when the tab closes) and
namespaced by the signed-in user's id. It holds everything "half done" that a
reload shouldn't wipe — the Apply Leave / WFH dialogs (open flag + fields),
the add-employee form, an announcement being composed, a profile mid-edit
(keyed per person), leave-policy / other-settings edits, an open reject or
cancel reason box — plus view state such as list filters and the month being
browsed. Each form clears its own draft on submit or deliberate cancel;
`clearSessionState()` wipes the lot on sign-out.

### Portal.jsx shell pattern

`Portal.jsx` is the one dashboard shell for all three roles. Two tables
drive everything role-specific:

- **`NAV_ITEMS`** — every possible sidebar section (label, icon, which live
  count feeds its badge), independent of role.
- **`ROLE_SECTIONS`** — which of those sections each role actually gets, in
  sidebar order. `canAccess(role, key)` and `navFor(role, badges)` both read
  from this one table.

Data loading splits into "shared, loaded up front" (leave config, own
leaves, attendance history, pending approvals if a manager, announcements)
and "lazy, per-section" (org tree, people list, all-leaves, all-attendance,
analytics, sent announcements, profile) — each lazy query's `enabled` flag
is `active === '<tab-key>'`, so opening a tab is what triggers its first
fetch.

Mutations update local state optimistically via each query's `setData`
rather than a full refetch (e.g. approving a leave filters it out of
`pendingQ` immediately and pushes a toast), and only `reload()` a
cross-cutting view if it happens to already be loaded (e.g. approving a leave
reloads the admin `allLeaves` list only if that tab has been opened this
session).

### Component inventory

One line each — see the file itself for props/behavior detail.

| Area | Component | Purpose |
| --- | --- | --- |
| Shell | `dashboard/Sidebar.jsx` | Role-filtered nav, collapse toggle, account entry point |
| Shell | `dashboard/TopBar.jsx` | Page title, search box (where applicable), notification bell, user menu |
| Attendance | `AttendanceCard.jsx` | The Zoho-style check-in timer widget (see below); shows the viewer's own check-in origin, and hosts `TeamCheckins` for manager/admin |
| Attendance | `TeamCheckins.jsx` | Daily check-in roll-call at the foot of the check-in card — manager sees their reports, admin the whole company (scope enforced server-side) |
| Attendance | `AttendanceHistory.jsx` | Own attendance table (date/in/out/hours/status) |
| Attendance | `AttendanceAnalytics.jsx` | KPI summary + weekly bar chart + 90-day heatmap (hand-rolled SVG, no chart library) |
| Attendance | `AllAttendance.jsx` | Admin-only: company-wide attendance for a month; adds a "From" (IP + city/country) column under a single-day lens |
| Leaves | `LeaveBalanceCard.jsx` | Remaining balance per type + total ring |
| Leaves | `RecentLeaves.jsx` | Own recent leave applications with status |
| Leaves | `ApplyLeaveModal.jsx` | Leave application form (type/dates/reason) |
| Leaves | `WfhRequests.jsx` / `ApplyWfhModal.jsx` | Own WFH requests list / request form |
| Leaves | `Approvals.jsx` | Manager's pending-approval queue, approve/reject actions |
| Leaves | `AllLeaves.jsx` | Admin-only: every leave company-wide |
| Leaves | `LeaveCalendar.jsx` | Monthly view: own leaves + company-wide "who's out" (self-fetches `leaves.calendar`) |
| Org/People | `OrgTree.jsx` | Nested reporting-structure tree, expand/search |
| Org/People | `PeopleAdmin.jsx` | Admin-only: employee roster, add-employee flow, reassign manager |
| Org/People | `Profile.jsx` | Personal profile view/edit (own, or any employee's if admin) |
| Org/People | `Avatar.jsx` | Photo-or-initials avatar, used wherever a user is shown |
| Org/People | `TeamsManager.jsx` | Manager/admin: create/edit/delete named project teams |
| Announcements | `notifications/NotificationsPanel.jsx` | Right-side drawer: urgent + announcements + pending work |
| Announcements | `notifications/ComposeAnnouncementForm.jsx` | Compose form, audience picker |
| Announcements | `AllAnnouncements.jsx` | Dedicated management page (compose + sent list) |
| Auth | `LoginForm.jsx` | Sign-in form, optional reCAPTCHA gating |
| Auth | `Recaptcha.jsx` | Google reCAPTCHA v2 explicit-render wrapper (see below) |
| Auth | `ProtectedRoute.jsx` | Route guard (see "App shell & routing" above) |
| Shared/UX | `Icon.jsx` | SVG icon set used throughout |
| Shared/UX | `Modal.jsx` | Generic modal shell |
| Shared/UX | `Toaster.jsx` | Renders `ToastContext`'s toasts |
| Shared/UX | `States.jsx` | `SkeletonCard`, `ErrorState`, `InlineError` — shared loading/error UI |
| Shared/UX | `ErrorBoundary.jsx` | Top-level render-crash guard |
| Shared/UX | `OfflineBanner.jsx` | Shows when `navigator.onLine` goes false |
| Shared/UX | `Menu.jsx` | Generic dropdown/account menu |

Two components worth calling out specifically:

- **`AttendanceCard.jsx`** — the elapsed time shown is a *local* ticking
  display layered on top of the last server sync (`sync` ref: wall-clock
  time + `workedSeconds` at that moment); reloading the page re-reads truth
  from `GET /attendance/today` rather than trusting any client-held counter.
  A ref (not a dependency) holds the latest `onChange` callback specifically
  to avoid an infinite fetch loop from the parent re-rendering every tick.
- **`Turnstile.jsx`** — Cloudflare Turnstile widget (replaced Google
  reCAPTCHA, whose verification kept failing on the live deployment).
  Renders nothing when `VITE_TURNSTILE_SITE_KEY` isn't set at build time
  (mirrors the backend's matching skip). Uses the `render=explicit` +
  `onload=<callback>` pattern rather than calling `turnstile.render` right
  after the script's own `load` event, so the widget only renders once the
  API is fully ready. Exposes an imperative `reset()` via `ref` because a
  completed token is single-use — a failed login must reset the widget
  before the user can complete it again.

Styling is plain CSS per page/component (`Portal.css`, `Auth.css`,
`EmployeeDashboard.css`, etc.) — no Tailwind, no CSS-in-JS, no component
library, matching the "no heavy frameworks" performance goal from the
requirements doc.

---

## Environment variables

Loaded by `server/env.js` from `.env.local` first, then `.env` (dotenv never
overrides an already-set var, so `.env.local` effectively takes priority).
See [.env.example](.env.example) for the template.

| Variable | Required | Default | Effect if unset |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | — | `connectDB()` throws on first use |
| `JWT_SECRET` | recommended | `'dev-only-insecure-secret-change-me'` | tokens are signed with a well-known dev secret |
| `JWT_EXPIRES_IN` | – | `7d` | — |
| `PORT` | – | `4000` | only used by the standalone server (`server/index.js`) |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | ✅ (for bootstrap) | — | no admin account is ever created; app has no way in |
| `ADMIN_NAME` | – | `'Administrator'` | — |
| `CRON_SECRET` | – | — | `/api/cron/finalize` accepts requests from anyone |
| `TURNSTILE_SECRET_KEY` | – | — | login skips CAPTCHA verification server-side entirely |
| `VITE_TURNSTILE_SITE_KEY` | – | — | the widget never renders client-side (build-time var) |

Notes:
- `ADMIN_PASSWORD` must be ≥ 8 characters and `ADMIN_EMAIL` must pass a
  basic email regex, or `bootstrapAdmin()` logs an error and skips creation
  (checked every connect, not just once).
- Changing `ADMIN_EMAIL`/`ADMIN_PASSWORD` after the admin already exists
  does **not** reset it — the bootstrap only ever fires when no matching
  account exists yet.
- `VITE_TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are independent
  toggles that happen to mirror each other — set both to turn CAPTCHA on,
  or leave both blank to skip it everywhere. The Turnstile widget must list
  every hostname it runs on (localhost AND the deployed domain) in the
  Cloudflare dashboard, or verification fails only in the missing
  environment.

---

## Scripts & local development

From [package.json](package.json):

| Script | Runs | Notes |
| --- | --- | --- |
| `npm run dev` | `vite` | frontend only, port 5173 |
| `npm run server` | `node server/index.js` | backend only, against `DATABASE_URL`, port `PORT` (default 4000) |
| `npm run dev:all` | `concurrently ... server + dev` | both, against a real `DATABASE_URL` |
| `npm run seed` | `server/seed.js` | connects once (triggering bootstrap), then exits — for pointing at a brand-new DB |
| `npm run finalize` | `server/jobs/finalize.js` | one-off end-of-day finalizer run |
| `npm run build` | `vite build` | production frontend bundle → `dist/` |
| `npm run lint` | `oxlint` | see [Tooling & quality gates](#tooling--quality-gates) |
| `npm run preview` | `vite preview` | serves the built `dist/` locally |

In dev, Vite proxies `/api/*` to `http://localhost:4000`
([vite.config.js](vite.config.js)) — the frontend never needs to know the
API's real port. `dev-memory.js` reads `API_PORT` (not `PORT`) specifically
so a `PORT` env var meant for the web server can never accidentally steal
the API's port and break that proxy.

---

## Deployment

Two pieces, cleanly split — a static frontend and ONE long-running backend
(the serverless function that used to live at `api/[...path].js` has been
removed):

- **Backend — Render** ([render.yaml](render.yaml)): a `web` service running
  `npm run server`. This single process serves every user, so a write from
  one person is immediately visible to everyone else (see "Runtime model").
  The database schema migrates itself on boot (`ensureSchema`).
- **Frontend — Vercel** ([vercel.json](vercel.json)): the static Vite build,
  plus two rewrites — `/api/*` proxies to the Render backend, everything
  else falls back to `/index.html` for the SPA:

```jsonc
{
  "rewrites": [
    { "source": "/api/(.*)", "destination": "https://hrms-api-zc24.onrender.com/api/$1" },
    { "source": "/((?!api/).*)", "destination": "/index.html" }
  ]
}
```

There is no cron registered anywhere. The lazy on-read finalization
(`finalizeStaleSessions`, called from every attendance/leave read handler)
keeps attendance data correct without one; an external scheduler can still
hit `GET /api/cron/finalize` (with `CRON_SECRET`) for punctual midnight
closes.

---

## Tooling & quality gates

- **Linting:** [oxlint](https://oxc.rs/) via `npm run lint`
  ([.oxlintrc.json](.oxlintrc.json)). Plugins: `react`, `oxc`. Notable rules:
  `react/rules-of-hooks` as an **error**, `react/only-export-components` as a
  **warning** (constant exports allowed).
- **Testing:** there is currently no automated test suite (unit,
  integration, or end-to-end) in this repository — `npm run lint` is the
  only automated check that runs today.
- **TypeScript:** none — this is a plain JS/JSX codebase. `@types/react` and
  `@types/react-dom` are present only for editor intellisense.
