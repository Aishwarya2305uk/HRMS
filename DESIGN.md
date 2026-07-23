# HRMS — Design Document

This is the living design record for the HRMS project. It captures **why the
system is built the way it is** — architecture, data model, roles, and key
decisions — as a companion to [HRMS_v1_Requirements.md](HRMS_v1_Requirements.md)
(the "what") and [README.md](README.md) (the "how to run it").

**How to use this file:** when a new feature is added, don't rewrite this
document — append to it. Each feature gets its own dated entry under
[Feature Log](#feature-log) describing what changed and why, and the relevant
sections above it (data model, API surface, roles) get updated in place so
this file always reflects current behavior. Superseded decisions should be
struck through or noted as replaced, not deleted — keep the history visible.

---

## 1. Goals & Non-Goals

**Goals (v1):** fast, simple, reliable attendance tracking, leave management,
and org visibility for a small internal user base. Backend-enforced RBAC.
Deploys as a single Vercel project with no separate backend to host.

**Non-goals (v1):** meetings/calendar events, notifications (email/push),
payroll/performance reviews, public holidays, editing approved leaves, native
mobile apps. See [HRMS_v1_Requirements.md §7](HRMS_v1_Requirements.md) for the
full out-of-scope list — do not casually add these without updating that doc.

> **2026-07-24 clarification:** "notifications (email/push)" above refers
> specifically to messages sent *outside* the app. An in-app notifications
> drawer (announcements, urgent messages, pending work — see the Feature Log)
> was added and is a different thing: nothing leaves the app, no email/push
> provider is involved. Email/push themselves remain out of scope.

---

## 2. Architecture Overview

```
┌─────────────────────────┐        ┌──────────────────────────────┐
│  React 19 + Vite (SPA)  │  HTTP  │  Express 5 API                │
│  src/                   │◄──────►│  server/                      │
│  - Portal.jsx (shell)   │  JWT   │  - routes/ (auth, attendance,  │
│  - role-aware sections  │ Bearer │    leaves, employees, cron)    │
└─────────────────────────┘        │  - middleware/auth.js (RBAC)   │
                                    │  - services/ (attendance calc) │
                                    │  - models/ (Mongoose)          │
                                    └───────────────┬────────────────┘
                                                     │
                                            ┌────────▼────────┐
                                            │   MongoDB Atlas  │
                                            └──────────────────┘
```

- **One codebase, one deploy.** Locally, `server/index.js` runs a long-lived
  Express server. On Vercel, the same Express app is wrapped by
  `api/[...path].js` as a single serverless function — every `/api/*` request
  is routed through it. `server/app.js` builds the shared Express app so both
  entry points stay in sync; `smartJson` handles body parsing differences
  between the two runtimes.
- **Frontend is a single SPA**, not per-role apps. `src/pages/Portal.jsx` is
  the dashboard shell; sections (approvals queue, add-employee, all-leaves)
  are conditionally rendered based on the logged-in user's role, but the real
  gate is always the backend route.
- **Auth is JWT-based**, `Authorization: Bearer <token>`. `server/middleware/auth.js`
  exposes `requireAuth` and `requireRole(...)` — every protected route must
  compose these; there is no route that infers role from the frontend alone.
- **The one bootstrap account.** The app never ships seed data. On first
  connection to an empty database, `server/bootstrapAdmin.js` creates exactly
  one admin from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars. Every other user
  (employees, managers, more admins) is created by that admin via
  `POST /api/employees`.

---

## 3. Roles & Access Model

Three roles, strict hierarchy, enforced server-side in `middleware/auth.js`
(never trust frontend routing alone — see
[HRMS_v1_Requirements.md §2](HRMS_v1_Requirements.md)):

| Role     | Can do                                                                                     |
| -------- | -------------------------------------------------------------------------------------------- |
| Employee | Own attendance timer, own leave applications + balance, org tree, leave calendar.             |
| Manager  | Everything Employee can, **plus** approve/reject leaves for **direct reports only** (`managerId` match is checked server-side per request, not just "is a manager"), **plus** broadcast an announcement/urgent message to their own downstream team (see §4 `announcements`). |
| Admin    | Everything above, **plus** add employees, edit any employee's `managerId`, view all leaves company-wide, **plus** broadcast to everyone, to a specific role, or to any team in the company. |

Adding a new role or permission: extend the `role` enum in
`server/models/User.js`, add/adjust `requireRole(...)` calls in the affected
routes, and update this table.

---

## 4. Data Model (MongoDB / Mongoose)

Source of truth: `server/models/*.js`. Summarized here for quick reference —
if these drift, trust the model files and fix this section.

### `users`
- `name`, `email` (unique), `passwordHash` (bcrypt, never sent to client)
- `role`: `employee | manager | admin`
- `designation`, `department` (free text)
- `joiningDate`
- `managerId` → self-reference (`User`), `null` for the top of the tree —
  **this single field is what builds the org tree**, nothing else.
- `leaveBalances`: `{ [leaveTypeKey]: remainingDays }`, seeded from
  `server/config.js` quotas, deducted only on leave approval.

### `work_sessions` (one per user per calendar day)
- `userId`, `date` (`YYYY-MM-DD`, unique with `userId`)
- `events[]`: ordered log of `{ type: check_in|pause|resume|check_out|auto_close, at }`
  — **this event log is the source of truth**, never a running counter. Worked
  time and running/paused state are always *derived* from it
  (`computeWorkedSeconds`, `isRunning` in `WorkSession.js`), which is what
  makes the timer refresh-proof and re-login-proof (client never trusts its
  own clock).
- `status`: `active | completed | auto_closed`
- `workedSeconds`, `dayStatus` (`present | leave`, decided by the 8h rule in
  `server/config.js` → `FULL_WORKDAY_SECONDS`, applied in
  `server/services/attendance.js`), written once the day closes.

### `leaves`
- `userId`, `type` (one of `server/config.js` → `LEAVE_TYPES` keys)
- `startDate`, `endDate` (inclusive), `days` (inclusive calendar-day count —
  v1 counts weekends, see requirements §5), `reason`
- `status`: `pending | approved | rejected`
- `approverId`, `decidedAt`, `decisionComment` — set on manager decision.
  **Balance is deducted only on approval**, never at submit time, so a
  rejected leave costs nothing.

### `announcements`
- `title`, `body`, `type` (`announcement | urgent`), `authorId`
- `audienceScope`: `all | role | team`
  - `all` — everyone (admin only)
  - `role` — everyone with `audienceRole` (admin only)
  - `team` — `audienceRootId` plus everyone who **transitively** reports to
    them. Admin can root this at any user; a manager can only root it at
    **themselves** (their whole downstream org, however deep). Resolved by
    walking `managerId` — see `server/services/hierarchy.js` — never trusted
    from the client.
- `readBy`: user ids who've seen it (`$addToSet`, never returned wholesale —
  the API exposes a per-viewer `read` boolean instead).
- No push/email and no separate audit-log collection — matches the rest of
  v1's minimal-infra posture (see §8).

### Single source of truth for business constants
`server/config.js` holds `LEAVE_TYPES` (key/label/annual quota) and
`FULL_WORKDAY_HOURS`. Anything that looks like a magic number belongs here,
not inlined in a route — this is what let leave quotas and the workday length
stay a one-line change instead of a grep-and-replace.

---

## 5. Attendance Timer Design

Modeled on Zoho People's check-in widget
(see [HRMS_v1_Requirements.md §3](HRMS_v1_Requirements.md)). Key design
decision: **the server is the only clock that matters.**

- Frontend (`AttendanceCard.jsx`) polls/derives elapsed time for display only.
- Every state change (check-in, pause, resume, check-out) is an API call that
  appends one event to `work_sessions.events`; nothing is computed or stored
  client-side.
- `computeWorkedSeconds` walks the event log summing `check_in/resume →
  pause/check_out/auto_close` intervals — paused time is simply not inside any
  interval, so it's naturally excluded.
- End-of-day finalization (`server/services/attendance.js`,
  `server/jobs/finalize.js`, `routes/cron.js`) auto-closes any session still
  `active` past its day, applies the 8h rule (`workedSeconds >=
  FULL_WORKDAY_SECONDS` → `present`, else `leave`), and is also re-applied
  lazily on read — so correctness doesn't depend on the Vercel cron firing
  exactly on time.

---

## 6. API Surface

All under `/api`, JWT via `Authorization: Bearer`. Grouped by resource; see
route files for full request/response shapes.

| Area       | Routes                                                                                   | Guard                         |
| ---------- | ----------------------------------------------------------------------------------------- | ------------------------------ |
| Auth       | `POST /auth/login`, `GET /auth/me`                                                        | public / `requireAuth`         |
| Attendance | `GET /attendance/today`, `POST /attendance/{check-in,pause,resume,check-out}`, `GET /attendance/history` | `requireAuth`            |
| Leaves     | `POST /leaves`, `GET /leaves/mine`, `GET /leaves/pending`, `POST /leaves/:id/{approve,reject}`, `GET /leaves/all`, `GET /leaves/calendar?month=YYYY-MM` | `requireAuth`; pending/approve/reject also check direct-report ownership; `all` is admin-only |
| Employees  | `GET /employees/org-tree`, `GET|POST /employees`, `PATCH /employees/:id/manager`           | org-tree: any role; create/list/manager-edit: admin only |
| Announcements | `GET /announcements`, `POST /announcements/read-all`, `GET /announcements/audience-options`, `POST /announcements`, `DELETE /announcements/:id` | `requireAuth`; audience-options/create/delete require admin or manager, with hierarchy-checked authorization on `team`-scoped targets |
| Cron       | `POST /cron/finalize`                                                                      | optional `CRON_SECRET` header  |

When adding a route: put it in the matching `server/routes/*.js` file, wrap it
in `requireAuth`/`requireRole` as needed, and add a row here.

---

## 7. Frontend Structure

```
src/
  pages/Portal.jsx        # role-aware dashboard shell — the one real "page"
  components/
    AttendanceCard.jsx     # timer widget, left of sidebar per spec
    LeaveCalendar.jsx      # own leaves + company-wide view
    OrgTree.jsx            # reporting structure, built from managerId
    Approvals.jsx          # manager-only: direct reports' pending leaves
    PeopleAdmin.jsx        # admin-only: add employee, edit manager
    AllLeaves.jsx          # admin-only: company-wide leave list
    ApplyLeaveModal.jsx, LeaveBalanceCard.jsx, AttendanceHistory.jsx, ...
    notifications/
      NotificationsPanel.jsx        # right-side drawer: urgent/announcements/pending work
      ComposeAnnouncementForm.jsx   # admin/manager-only composer, swapped into the drawer
  context/AuthContext.jsx  # session/JWT state
  lib/hrms.js              # typed API client helpers (one function per endpoint)
```

Design rule: role-specific components render conditionally in `Portal.jsx`
based on `user.role`, but that's a UX convenience only — every one of them
calls an endpoint that independently re-checks the role server-side.

---

## 8. Key Decisions & Rationale

- **MongoDB over Postgres** (requirements doc suggested Postgres/MySQL): the
  org tree and leave/session shapes are simple documents with no need for
  joins beyond `managerId` population, and Mongoose's schema validation was
  enough structure without the ops overhead of a relational server for a v1
  this size.
- **Single Vercel deployment, no separate backend host:** keeps ops to "push
  to GitHub," per the "fast and smooth" performance goal — no separate
  service to provision, monitor, or keep warm.
- **Event-log timer, not a running counter:** the only way to make the timer
  survive refresh/re-login and stay server-authoritative per requirements
  §3.2's edge cases.
- **Lazy finalization + cron, not cron-only:** a missed or delayed cron tick
  must never leave a day in a wrong state, so the same finalize logic also
  runs inline when attendance data is read.
- **One bootstrap admin, no seed script for real use:** avoids fake/demo data
  ever reaching a real deployment; every real user is deliberately created by
  an admin, which also matches "admin builds the org tree by assigning
  managers" from the requirements.

---

## Feature Log

Append one entry per feature/change, newest first. Each entry: date, what
changed, why, and which sections above were touched.

### 2026-07-24 — In-app notifications drawer
Added a right-side notifications drawer (opened from the top bar's bell,
previously a stub) with three feeds: urgent messages, announcements, and
pending work (the existing approvals queue / own pending leave requests —
no new storage for that part). New `announcements` collection and
`/api/announcements` routes; both admins and managers can compose, targeted
by a hierarchy-aware audience (everyone / a role / a team rooted anywhere an
admin chooses, or a manager's own downstream org). Touched: §1 (non-goal
clarification), §3 (roles table), §4 (new `announcements` subsection), §6
(API surface), §7 (new `notifications/` components).

### 2026-07-22 — Initial design document
Captured the as-built v1 architecture (attendance timer, leave management,
org tree, leave calendar, role-based dashboards) as the baseline design
record. No functional changes — this is documentation only, written against
the codebase at commit `dcf9adb`.
