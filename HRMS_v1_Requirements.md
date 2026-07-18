# HRMS — Version 1 Requirements Document

**Project:** HRMS (Human Resource Management System)
**Version:** 1.0 (MVP)
**Prepared for:** Development Intern
**Date:** 17 July 2026

---

## 1. Purpose & Overview

We are building the first version of an internal HRMS. Version 1 is deliberately small and focused. The goal is a **fast, smooth, reliable** web application that handles three core things:

1. **Attendance** — employees log in and log out, and the system records the timings.
2. **Leave management** — employees apply for leave, their immediate manager approves or rejects it, and the result reflects on the employee's dashboard.
3. **Organization visibility** — everyone can see the company's reporting structure as a tree, and everyone can see leave information on a calendar.

Nothing beyond this is in scope for v1. Do not add extra features (meetings, payroll, performance reviews, notifications via email, etc.) — those come later.

---

## 2. User Roles

There are exactly **three roles** in v1, with a strict hierarchy. Role-based access must be enforced on the backend (not just hidden in the UI).

### 2.1 Employee
- Can log in / log out (attendance timings recorded automatically).
- Can apply for leave.
- Can see the status of their leave applications (Pending / Approved / Rejected) on their own dashboard.
- Can see their **remaining leave balance**.
- Can view the **organization tree** (accessible from the sidebar).
- Can view the **leave calendar** (their own leaves marked by date, plus company-wide leave view — see section 4.5).
- **Cannot** see the Manager or Admin dashboards, and cannot approve anything.

### 2.2 Manager
- Everything an Employee can do (managers are also employees — they have their own attendance, leaves, and leave balance).
- Has a **separate Manager dashboard**.
- Can see leave applications submitted by their **direct reports only**, and can **Approve** or **Reject** each one.
- Once a manager approves/rejects a leave, the status must immediately update on that employee's dashboard.
- A manager **cannot** act on leaves of employees who don't report to them.

### 2.3 Admin
- Has a **separate Admin dashboard**.
- Can **add new employees** to the system. While adding an employee, the Admin must assign:
  - Name, email, password (or an invite/default password), role (Employee / Manager / Admin), department/designation (simple text field is fine for v1), joining date, and **their immediate manager**.
- The manager assignment is what builds the organization tree — as soon as an employee is added with a manager, the tree should update automatically for everyone.
- Admin can also edit an employee's manager (to fix mistakes / restructures).
- Admin can view all leaves across the company.

---

## 3. Authentication & Attendance (Check-in Timer — Zoho People style)

### 3.1 Authentication
- Standard email + password login. Sessions should be secure (JWT or session cookies — see tech notes).
- **Important:** logging into the application does **not** record attendance. Attendance is tracked separately through the check-in timer described below.

### 3.2 Attendance Timer Card
Attendance works like Zoho People's check-in widget — a small **timer card** shown on the dashboard, placed on the left side just after the sidebar.

**The card contains:**
- A live timer display in `HH : MM : SS` format (shows `00 : 00 : 00` before check-in).
- The user's current status (e.g., "In" / "Out" / "Paused").
- One primary action button that changes with state (see flow below).

**Daily flow:**
1. **Check-in ("Start your day"):** when the employee is ready to start work, they press **Check-in**. The timer starts running from that moment.
2. **Pause / Resume:** the employee can **pause** the timer anytime (breaks, lunch, stepping away) and **resume** it when back. Paused time is **not** counted as work time. Multiple pause/resume cycles in a day are allowed.
3. **Check-out ("End your day"):** at the end of the day, the employee presses **Check-out**. The system then calculates the **total worked time for that day** = sum of all running intervals (excluding paused time).
4. **End-of-day auto-finalization:** if an employee forgets to check out, the system automatically closes the timer at end of day (e.g., at midnight) and records whatever time was accumulated — e.g., "only 5 hours recorded today."

**8-hour rule:**
- A full working day is **8 hours** (keep this configurable in one place — a constant/config value, not hard-coded everywhere).
- At the end of the day, if the total recorded time is **less than 8 hours**, that day is automatically **marked as leave** for the employee (and reflected on their dashboard, attendance history, and the leave calendar).
- If total recorded time is ≥ 8 hours, the day is marked **Present**.

**Attendance history:**
- Each user can see their own attendance history: a simple table with date, check-in time, check-out time, total hours worked, and the day's status (Present / Leave).

**Edge cases (keep simple, don't over-engineer):**
- Timer state must survive page refreshes and re-logins — if an employee checked in at 9:00 AM, closes the browser, and comes back at 11:00 AM, the timer should still be running and showing the correct elapsed time (store check-in/pause events on the server; the frontend just displays elapsed time computed from them).
- Only one active work session per employee per day.

---

## 4. Features in Detail

### 4.1 Leave Application (Employee)
- A simple form: leave type (e.g., Casual / Sick / Earned — keep it configurable as a simple list), start date, end date, reason (text).
- Validation: end date ≥ start date; cannot apply if remaining balance is insufficient (show a clear error).
- On submission, the leave goes into **Pending** state and appears in the immediate manager's approval queue.

### 4.2 Leave Approval (Manager)
- The Manager dashboard shows a list of pending leave requests **from their direct reports only**, with employee name, dates, type, reason.
- Manager can Approve or Reject (rejection can optionally include a short comment).
- After approval:
  - Status changes on the employee's dashboard.
  - The employee's **leave balance is deducted**.
  - The leave appears on the **calendar** on the approved dates.
- After rejection: status updates, balance is not deducted.

### 4.3 Dashboards (role-specific)
Each role gets its own dashboard. An employee must never be able to open the manager/admin dashboard (enforce via backend authorization, not just frontend routing).

**Common to all dashboards (Employee, Manager, Admin):**
- The **attendance timer card** (see section 3.2) — positioned on the left, just after the sidebar, with the live timer and Check-in / Pause / Resume / Check-out actions.
- The **leave calendar** (see 4.5).
- The logged-in user's **remaining leave balance**, shown clearly (e.g., "Casual: 6 left, Sick: 4 left").
- Their own recent leave applications with status.

**Manager dashboard additionally:** pending approvals queue for direct reports.

**Admin dashboard additionally:** "Add Employee" flow, list of all employees, and a company-wide view of all leaves.

### 4.4 Organization Tree
- A **tree-like visual structure** of the whole company, built from the "immediate manager" relationships that Admin sets while adding employees.
- Accessible to **all roles** via a link in the **sidebar** ("Organization" / "Org Tree").
- Shows name + designation on each node; clicking/expanding nodes to see reports under a manager.
- The tree must update automatically whenever Admin adds an employee or changes someone's manager.

### 4.5 Leave Calendar
- A monthly calendar view, available to everyone on their dashboard.
- Shows:
  - The logged-in user's own leaves (with dates they applied for and status — approved leaves highlighted).
  - The **company-wide leave view** — i.e., who in the company is on approved leave on which dates (so everyone can see overall team availability). Keep the display simple: names/count of people on leave per date.
- No meetings, events, or holidays in v1 (holidays can be a fast-follow, but do not build it now).

### 4.6 Sidebar Navigation
Every role sees a sidebar with (at minimum): Dashboard, Apply Leave (employee-facing), My Attendance, Organization Tree, and role-specific items (Approvals for managers; Add Employee / All Employees / All Leaves for admin). Only show items the role is allowed to use.

---

## 5. Leave Balance Rules (v1 — keep simple)

- Every employee gets a fixed annual quota per leave type (make these numbers configurable in one place in code/DB, e.g., Casual: 12, Sick: 8, Earned: 15 — Admin doesn't need a UI to change this in v1).
- Balance is deducted **only on approval**, based on the number of days in the leave.
- Weekends: for v1, count calendar days simply; excluding weekends can be v1.1 if time permits.
- Remaining balance must be visible on every user's dashboard.

---

## 6. Technical Notes (brief — the "how" is mostly your call, but stay within this)

Performance matters: the app must feel **fast and smooth** — quick page loads, instant dashboard rendering, no heavy frameworks or unnecessary libraries.

- **Backend:** **Node.js** (Express or NestJS). Node's non-blocking I/O keeps the app responsive; this is our preferred stack.
- **Frontend:** **React** (with Vite for a fast dev/build setup). Keep the bundle lean; use a lightweight UI library or plain CSS/Tailwind.
- **Database:** **PostgreSQL** (preferred) or MySQL. The org tree is just a `manager_id` self-reference on the employees table — no exotic DB needed.
- **Auth:** JWT-based auth with role checks in backend middleware. Every API route must verify the role server-side.
- **API style:** REST is fine for v1.
- **Key tables (rough guide):** `users` (with role + manager_id), `work_sessions` (user_id, date, check_in_time, check_out_time, total_worked_seconds, day_status Present/Leave), `session_events` (session_id, event_type check_in/pause/resume/check_out, timestamp — this event log is what makes pause/resume and refresh-proof timers easy), `leaves` (user_id, type, start_date, end_date, reason, status, approved_by), `leave_balances` (user_id, type, remaining).
- **Timer correctness:** compute elapsed time on the **server** from the stored events — never trust a client-side counter. The frontend timer is display-only. Run a small end-of-day job (cron/scheduled task) to auto-close open sessions, compute total hours, and apply the 8-hour Present/Leave rule.
- Write clean, readable code with a sensible folder structure — another developer will build v2 on top of this.

---

## 7. Explicitly Out of Scope for v1

- Meetings / meeting calendar
- Email or push notifications
- Payroll, payslips, performance reviews
- Password reset flows beyond the basics
- Public holidays on the calendar
- Editing/cancelling an already-approved leave (v1.1)
- Mobile app (the web app should just be responsive)

---

## 8. Acceptance Checklist (definition of done)

1. Admin can add an employee with a manager assigned; the org tree updates and is visible to all roles from the sidebar.
2. Employee can check in from the dashboard timer card, pause/resume during the day, and check out; the total worked time for the day is calculated correctly (excluding paused time) and shown in their attendance history.
3. If an employee forgets to check out, the day auto-finalizes at end of day with the recorded hours; days with less than 8 recorded hours are automatically marked as Leave, and days with 8+ hours are marked Present.
4. The timer survives page refresh and re-login (elapsed time stays correct because it's computed on the server).
5. Employee can apply for leave; it appears as Pending on their dashboard and in their manager's queue.
6. Manager (and only that employee's immediate manager) can approve/reject; the status and leave balance update on the employee's dashboard immediately.
7. Approved leaves appear on the calendar on the correct dates, and the company-wide calendar shows who is on leave.
8. Every dashboard shows the user's remaining leave balance.
9. An Employee cannot access Manager/Admin dashboards or APIs (verified by direct API calls, not just the UI).
10. The app loads fast and navigation feels smooth.
