# AI Study Companion

An AI-powered learning workspace: learners organise study into **Spaces** and **Projects**, add PDF material, learn with a grounded
AI Tutor, take adaptive quizzes and get evidence-based guidance on what to do next. An **Admin console** gives operators visibility into
users, learning activity, AI usage and system health.

> **Status — Phases 1–3 complete.** Authentication, the learner workspace, background document processing and the complete AI layer —
> **Zoya, the grounded AI tutor**, persistent learning context, AI observability and evaluation — are built and tested (139 backend tests;
> live regression suite 18/18 on Gemini). Adaptive quizzes, mastery, growth and recommendations follow next.
> The full design, decisions and build status live in **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**.

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4, TanStack Query, Radix primitives |
| Backend | Node.js 22, Express 5, TypeScript, Zod, Mongoose 9, pino |
| Data | MongoDB Atlas (documents, GridFS for PDFs, Atlas Vector Search + text index; durable job queue) |
| AI | Google Gemini (generation, structured output, tool calling, embeddings, PDF OCR) behind a provider-neutral gateway |
| Auth | Email + password (bcrypt), JWT in an httpOnly SameSite cookie, role-based access (learner / admin) |
| Tests | Vitest + Supertest + in-memory MongoDB |

The browser only talks to the Next.js origin; `/api/*` is reverse-proxied to the Express API, so the session cookie is first-party and
never readable by JavaScript.

## Repository layout

```
├── backend/     Express API + background worker (src/ai · src/jobs · src/modules/<domain>), tests/, evals/ (live AI regression suite)
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

In `backend/.env` set at least `MONGODB_URI`, `JWT_SECRET` (32+ random characters), `ADMIN_EMAIL`, `ADMIN_PASSWORD` and `GEMINI_API_KEY`
(the AI settings — model chains, evidence thresholds, judge sampling — have working defaults, documented in `.env.example` and ARCHITECTURE §30).
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
- The background worker runs inside the API process by default (`APP_ROLE=all`); set `APP_ROLE=api` / `worker` to run them separately.

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

Backend tests run against an in-memory MongoDB (the first run downloads a MongoDB binary) and a scriptable mock AI provider — no network,
no Atlas data, no model costs.

### Live AI regression suite

Runs the real document pipeline and the real Tutor against curated material and questions (in an isolated in-memory database, using your
`GEMINI_API_KEY`), then reports grounded accuracy, citation correctness, unsupported-question handling, injection resistance, retrieval
hit@k/MRR, latency and cost:

```bash
npm --prefix backend run eval:tutor -- --judge --baseline
```

`--baseline` exits with code 1 when a metric regresses more than 5 points against `backend/evals/tutor/baseline.json`; `--record` also stores the
run so it appears in **Admin → AI evaluation**; `--write-baseline` accepts the current run as the new baseline.

## What's built

**Learner workspace**: registration and sign-in · home dashboard (continue learning, recent projects, activity, recommended next step)
· Spaces with colour/icon customisation · Space dashboards · Projects with a learning goal · drag-and-drop PDF upload with progress and
duplicate detection · rename/delete with cascading cleanup.

**Background knowledge pipeline**: every upload is processed asynchronously — text extraction, OCR for scanned pages, page-aware chunking,
embeddings, concept extraction and a summary — with live stage/progress in the UI, automatic retries that resume from the last completed
stage, clear failure reasons and a retry button. Each Project gets a concept map with page references.

**Zoya, the AI tutor** (Project → AI Tutor):
- Answers **only from the learner's materials**, streaming token by token, with inline citation chips and a
  "Source: Machine Learning Notes — Page 2" list; clicking a source opens the page with the passage highlighted and a link to the PDF page.
- **Unsupported questions**: when the materials don't contain the answer, Zoya says so (what the materials *do* cover, the closest passage) instead
  of guessing — and offers a clearly labelled general-knowledge answer on request.
- Follow-ups understood in context ("and what if it's too small?"), one-click *Simpler · Example · Test me · Summarize · Revision plan*,
  follow-up suggestions, conversation history with AI titles, Stop, retry, 👍/👎 feedback.
- Remembers what matters about the learner across sessions (goals, preferences, difficulties) — visible and deletable under "What Zoya remembers".
- Uses controlled, validated, Project-scoped tools (search materials, read a page, list concepts, check learning state, save a learning note).
- Resilient: model fallback chains with circuit breakers, restart on another model if one fails mid-answer, keyword retrieval if embeddings are down,
  and cited passages if every model is unavailable.

**Admin console**: platform KPIs and activity chart · users with their learning journey and **AI usage** · Spaces, Projects, materials and
activity explorers · audit-logged PDF viewing · **AI usage** (calls, errors, fallbacks, p50/p95 latency, tokens and cost by feature/model/time,
per-call traces with retrieval evidence and the request waterfall) · **AI evaluation** (rule checks on every answer, sampled LLM judge,
learner feedback, scores by prompt version, offline regression runs) · **Background jobs** (queue, workers, failures, audited retry) ·
live **system health** (API, database, storage, AI gateway, worker, retrieval).

**Security**: bcrypt password hashing, httpOnly session cookies with server-side revocation, CSRF guard, per-user and per-Project data isolation
(including retrieval, memory and AI tools), prompt-injection defences (material treated as data, delimiter escaping, flagged passages),
validated AI output, rate limits, and admin-only APIs.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): system design for every phase, data model, API reference, the AI layer and Tutor pipeline
  (§12–§15), learning context (§20), observability and evaluation results (§23–§24), security, testing, deployment, build status and decision log.
