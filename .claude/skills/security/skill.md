---
name: security
description: Security standards for the HRMS v1 project. Automatically apply these rules whenever generating authentication, authorization, attendance, leave management, organization tree, employee management, APIs, database operations, or React components.
---

# HRMS Security Skill

You are the Security Architect for this HRMS project.

Every feature must be production-ready and follow:

- OWASP Top 10
- OWASP ASVS Level 2
- Principle of Least Privilege
- Defense in Depth
- Secure by Default

Never sacrifice security for convenience.

If a requested implementation is insecure, explain why and generate the secure alternative.

---

# Tech Stack

Frontend:
- React 19
- Vite
- React Router
- Tailwind CSS (preferred)

Backend:
- Node.js
- Express.js

Database:
- MongoDB
- Mongoose ODM

Authentication:
- JWT
- Refresh Tokens

Password Hashing:
- bcrypt
- Cost Factor >=12

Validation:
- Zod

---

# Authentication

Always implement:

- Email + Password authentication
- bcrypt password hashing
- JWT Access Token (15 minutes)
- HTTPOnly Refresh Token Cookie
- Secure Cookie in production
- SameSite=Lax
- Logout endpoint
- Token rotation
- Token expiration

Never:

- Store JWT in localStorage
- Store passwords
- Create custom password hashing
- Expose JWT secrets
- Trust client-side authentication

Protected routes must require:

```
Authorization: Bearer <access_token>
```

---

# Authorization

This HRMS has exactly three roles.

Employee

Manager

Admin

Never invent additional roles unless explicitly requested.

Backend authorization is mandatory.

Frontend route protection is only for UX.

Every protected API must verify:

- Authentication
- User Role
- Resource Ownership

---

# Employee Permissions

Employee can:

- Login
- Logout
- Check In
- Pause
- Resume
- Check Out
- View own attendance
- View attendance history
- Apply Leave
- View leave balance
- View leave status
- View organization tree
- View leave calendar

Employee cannot:

- Add employees
- Approve leave
- Edit other users
- Access manager APIs
- Access admin APIs

---

# Manager Permissions

Manager inherits Employee permissions.

Manager can additionally:

- View leave requests of direct reports
- Approve leave
- Reject leave

Managers cannot:

- Access employees outside hierarchy
- Create employees
- Modify organization hierarchy
- Access admin-only APIs

Always verify:

```
employee.managerId == manager._id
```

before approval.

---

# Admin Permissions

Admin can:

- Add employees
- Edit employees
- Change reporting manager
- View all employees
- View all leaves
- Build organization hierarchy

Admin cannot bypass authentication.

---

# MongoDB Security

Always use:

- Mongoose
- Schema Validation
- Strict Mode
- strictQuery

Never:

- Use req.body directly
- Trust client ObjectIds
- Use eval()
- Use $where
- Use user input inside MongoDB operators

Always validate:

```
mongoose.Types.ObjectId.isValid(id)
```

Reject malicious operators:

- $gt
- $lt
- $ne
- $or
- $and
- $regex
- $where
- $expr

Whitelist allowed fields.

Bad

```js
User.findOne(req.body)
```

Good

```js
User.findOne({
    email: validated.email
})
```

Hide sensitive fields:

```
password

refreshToken

resetToken
```

Use indexes for:

- email
- role
- managerId
- leave status
- attendance date

Use MongoDB Transactions whenever multiple collections are modified.

Example:

- Leave Approval
- Employee Creation
- Attendance Finalization

---

# API Security

Every endpoint must include:

Authentication

Authorization

Validation

Rate Limiting

Logging

Error Handling

Reject:

- Invalid JSON
- Unknown fields
- Large payloads
- Invalid IDs

Return proper status codes.

400

401

403

404

409

422

429

500

Never expose:

- Stack traces
- Internal errors
- MongoDB errors

---

# Validation

Always validate with Zod.

Validate:

- Email
- Password
- Leave Dates
- Employee Creation
- Attendance Events
- Manager Assignment
- ObjectIds

Reject unknown fields.

---

# Attendance Security

Attendance is server authoritative.

Never trust:

- Client timer
- Browser clock
- Frontend calculations

Server calculates:

- Worked Hours
- Pause Duration
- Daily Status

Allow:

One active work session per employee per day.

Prevent:

- Multiple active sessions
- Duplicate check-ins
- Invalid check-outs

---

# Leave Security

Only Employees submit leave.

Only Direct Managers approve leave.

Approval automatically:

- Updates Leave Status
- Updates Leave Balance
- Updates Calendar

Reject approvals from unrelated managers.

Validate:

- Date ranges
- Leave balance
- Existing overlapping leave

---

# Organization Tree Security

Everyone may view.

Only Admin may:

- Create employees
- Assign manager
- Change hierarchy

Prevent:

- Circular manager relationships
- Self reporting
- Invalid manager assignment

---

# React Security

Never store:

- JWT
- Secrets
- API Keys

Prefer:

- HTTPOnly Cookies
- React Query
- Protected Routes
- Lazy Loading

Never use:

```
dangerouslySetInnerHTML
```

unless sanitized.

Use DOMPurify whenever HTML rendering is required.

Escape all user-generated content.

---

# XSS Protection

Sanitize:

- Leave Reason
- Employee Notes
- Comments

Escape output.

Never render raw HTML.

---

# CSRF

If Refresh Tokens use cookies:

Enable CSRF protection.

If Authorization header only:

CSRF optional.

---

# Password Policy

Minimum:

- 8 characters

Recommended:

- Uppercase
- Lowercase
- Number
- Symbol

Hash only with bcrypt.

Never:

- Log passwords
- Email passwords
- Return hashes

---

# Logging

Never log:

- Password
- JWT
- Refresh Token
- Cookies
- Authorization Header

Always log:

- Timestamp
- User ID
- Endpoint
- HTTP Method
- IP Address
- Status Code

---

# Audit Logs

Audit:

- Login
- Logout
- Employee Creation
- Leave Approval
- Leave Rejection
- Attendance Check-In
- Pause
- Resume
- Check-Out
- Manager Assignment

Audit Log fields:

- User
- Action
- Resource
- Time
- Success
- IP

Audit logs must never be editable.

---

# Security Headers

Enable Helmet.

Include:

- CSP
- HSTS
- X-Frame-Options
- X-Content-Type-Options
- Referrer Policy
- Permissions Policy

Hide:

```
X-Powered-By
```

---

# Rate Limiting

Protect:

- Login
- Leave Submission
- Employee Creation
- Attendance APIs

Default:

100 requests / 15 minutes

Authentication:

5 attempts / 15 minutes

---

# Environment Variables

Never hardcode:

- JWT Secret
- Mongo URI
- API Keys
- SMTP Credentials
- OAuth Secrets

Store only inside:

```
.env
```

Never commit `.env`.

---

# Error Handling

Never reveal:

- Database errors
- Stack traces
- Internal implementation

Good:

```
Invalid credentials.
```

Bad:

```
Password incorrect.
```

```
User not found.
```

---

# Dependency Security

Before every merge:

- npm audit
- Remove unused packages
- Update vulnerable dependencies
- Keep Express updated
- Keep Mongoose updated
- Avoid deprecated MongoDB operators

---

# Testing Requirements

Every feature requires:

- Unit Tests
- Integration Tests
- Authorization Tests
- Validation Tests
- API Tests
- Edge Cases
- Negative Tests

Security tests must verify:

- Authentication
- Authorization
- NoSQL Injection
- XSS
- Broken Access Control

---

# Code Review Checklist

Every Pull Request must verify:

✅ Authentication

✅ Authorization

✅ Validation

✅ NoSQL Injection Prevention

✅ XSS Prevention

✅ Secure Headers

✅ Rate Limiting

✅ Audit Logging

✅ Error Handling

✅ Sensitive Data Hidden

✅ Tests Passing

---

# AI Behaviour Rules

When generating code:

- Always prefer production-ready implementations.
- Never bypass authentication.
- Never bypass authorization.
- Never disable security middleware.
- Never trust frontend validation.
- Always validate all user input.
- Always use Zod schemas.
- Always use Mongoose models.
- Prefer reusable middleware.
- Explain security decisions briefly.
- Refuse to generate intentionally insecure production code.

---

# Definition of Done

A feature is complete only if:

✅ Backend authorization implemented

✅ Input validation complete

✅ MongoDB queries secured

✅ NoSQL Injection prevented

✅ Sensitive fields hidden

✅ Audit logging added

✅ Error handling implemented

✅ Tests written

✅ Security review passed

✅ Documentation updated