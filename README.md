# AI Study Companion

An AI-powered learning workspace: learners organise study into **Spaces** and **Projects**, add PDF material, learn with a grounded
AI Tutor, take adaptive quizzes and get evidence-based guidance on what to do next. An **Admin console** gives operators visibility into
users, learning activity, AI usage and system health.

> **Status — Phase 1 (Foundation) complete.** Authentication, the learner workspace (Spaces, Projects, PDF upload) and the admin console
> are built and tested. Document processing, the AI Tutor, quizzes, mastery and recommendations follow in later phases.
> The full design and build plan live in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, Radix primitives |
| Backend | Node.js 22, Express 5, TypeScript, Zod, Mongoose 9, pino |
| Data | MongoDB Atlas (documents + GridFS for PDFs; Vector Search planned) |
| AI | Google Gemini behind a provider interface (from Phase 2/3) |
| Auth | Email + password (bcrypt), JWT in an httpOnly SameSite cookie, role-based access (learner / admin) |
| Tests | Vitest + Supertest + in-memory MongoDB |

The browser only talks to the Next.js origin; `/api/*` is reverse-proxied to the Express API, so the session cookie is first-party and
never readable by JavaScript.

## Repository layout

```
├── backend/     Express API (src/modules/<domain>: routes · service · schemas), tests/
├── frontend/    Next.js app (src/app: (auth) · (learner) · admin), src/components, src/lib
└── docs/        ARCHITECTURE.md — architecture, data model, API, decisions, build status
```

## Prerequisites

- Node.js **22.9+** and npm
- A MongoDB Atlas cluster (or any MongoDB 7+ replica set) whose network access allows your machine

## Setup

```bash
npm run install:all
```

Create the environment files from the templates and fill in real values (they are gitignored; never commit them):

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env.local
```

In `backend/.env` set at least `MONGODB_URI`, `JWT_SECRET` (32+ random characters), `ADMIN_EMAIL` and `ADMIN_PASSWORD`.
Quote any value that contains `#`, e.g. `ADMIN_PASSWORD="abc#123"`. Generate a secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

## Run (development)

```bash
npm run dev
```

- Web app: http://localhost:3000
- API: http://localhost:4000 (health: `/api/health`)

On first start the API creates the admin account from `ADMIN_EMAIL` / `ADMIN_PASSWORD`. Sign in with it to land in the admin console
(`/admin`); register a normal account at `/register` to use the learner workspace. To reset the admin password from `.env`:

```bash
npm run seed:admin
```

## Test, type-check, build

```bash
npm test
```

```bash
npm run typecheck
```

```bash
npm run lint
```

```bash
npm run build
```

Backend tests run against an in-memory MongoDB (the first run downloads a MongoDB binary) and never touch your Atlas data.

## What Phase 1 includes

**Learner workspace**: registration and sign-in · home dashboard (continue learning, recent projects, activity, recommended next step)
· Spaces with colour/icon customisation · Space dashboards · Projects with a learning goal · drag-and-drop PDF upload with progress,
duplicate detection and background-processing status · in-browser PDF viewing · rename/delete with cascading cleanup.

**Admin console**: platform KPIs and 14-day activity chart · users with their learning footprint and full journey view · platform-wide
Spaces, Projects and materials tables with filters · activity explorer (user, Space, Project, type, time period) · audit-logged PDF
viewing · live system health (API, database, storage, AI provider configuration).

**Security**: bcrypt password hashing, httpOnly session cookies with server-side revocation, CSRF guard, per-user data isolation
(foreign resources return 404), strict upload validation, rate limits, and admin-only APIs.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): system design for every phase, data model, API reference, security, testing, deployment,
  build status and decision log.
