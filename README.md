# AI Study Companion

An AI-powered learning workspace: learners organise study into **Spaces** and **Projects**, add PDF material, learn with a grounded
AI Tutor, take adaptive quizzes and get evidence-based guidance on what to do next. An **Admin console** gives operators visibility into
users, learning activity, AI usage and system health.

> **Status — Phases 1–5 complete (v0.5.0).** Authentication, the learner workspace, background document processing, the complete AI layer —
> **Zoya, the grounded AI tutor**, persistent learning context, AI observability and evaluation — the **adaptive quiz with concept mastery**,
> and **growth analysis, recommendations and analytics** for learners and admins are built (195 backend tests; live Tutor regression suite 18/18
> on Gemini). Deployment and final hardening follow in Phase 6. The full design, decisions and build status live in
> **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** (version 1.4).

## App tour

Screenshots come from a local demo database with sample learners and real Gemini responses — click any image to open it full size.

### Learner panel

| Panel | Preview |
|---|---|
| **Sign in / Register** — Email + password accounts. Learners land in their workspace, admins in the admin console. | <a href="docs/screenshots/login.jpg"><img src="docs/screenshots/login.jpg" width="400" alt="Sign in"></a> |
| **Home** — Answers *where was I, how am I doing, what next?*: the recommended next action (one click starts it), continue learning, recent Projects, overall progress and areas requiring attention. | <a href="docs/screenshots/home.jpg"><img src="docs/screenshots/home.jpg" width="400" alt="Home dashboard"></a> |
| **Spaces** — Broad learning areas (a skill, a certification, an interest) with their own colour and icon. | <a href="docs/screenshots/spaces.jpg"><img src="docs/screenshots/spaces.jpg" width="400" alt="Spaces"></a> |
| **Space dashboard** — The Space's Projects with their mastery, plus overall progress, areas requiring attention and recent activity. | <a href="docs/screenshots/space.jpg"><img src="docs/screenshots/space.jpg" width="400" alt="Space dashboard"></a> |
| **Project › Overview** — The learning path (Materials → Tutor → Quiz → Growth → Analytics), what to do next, key concepts with mastery and learning progress. | <a href="docs/screenshots/project-overview.jpg"><img src="docs/screenshots/project-overview.jpg" width="400" alt="Project overview"></a> |
| **Project › Materials** — Drag-and-drop PDF upload. Text, OCR, chunks, embeddings and concepts are processed in the background with live progress and retry. | <a href="docs/screenshots/materials.jpg"><img src="docs/screenshots/materials.jpg" width="400" alt="Materials"></a> |
| **Project › AI Tutor (Zoya)** — Streaming answers grounded in your PDFs with page citations. Zoya says when your notes don't cover a question and remembers what matters about you. | <a href="docs/screenshots/tutor.jpg"><img src="docs/screenshots/tutor.jpg" width="400" alt="AI Tutor"></a> |
| **Project › Quiz** — Start an adaptive, focused or review quiz written from your material; see concept mastery with one-click practice and past quizzes. | <a href="docs/screenshots/quiz-home.jpg"><img src="docs/screenshots/quiz-home.jpg" width="400" alt="Quiz home"></a> |
| **Quiz › Question & feedback** — Multiple-choice or written answers; instant feedback with the explanation, the source page and your mastery change. | <a href="docs/screenshots/quiz-feedback.jpg"><img src="docs/screenshots/quiz-feedback.jpg" width="400" alt="Quiz question with feedback"></a> |
| **Quiz › Results** — Score, mastery before → after per concept, strengths, type of thinking and every answer to review. | <a href="docs/screenshots/quiz-results.jpg"><img src="docs/screenshots/quiz-results.jpg" width="400" alt="Quiz results"></a> |
| **Project › Growth** — How your mastery changed over 7, 30 or 90 days, with insights and *What to do next* recommendations. | <a href="docs/screenshots/growth.jpg"><img src="docs/screenshots/growth.jpg" width="400" alt="Growth analysis"></a> |
| **Growth › Concepts** — Concepts grouped as requiring attention, improving or stable, with the change, trend and reason; each has *Practise* and *Ask Zoya*. | <a href="docs/screenshots/growth-concepts.jpg"><img src="docs/screenshots/growth-concepts.jpg" width="400" alt="Growth by concept"></a> |
| **Project › Analytics** — Learning activity, quiz performance by type, difficulty and level, mastery distribution, concept trends and AI activity. | <a href="docs/screenshots/project-analytics.jpg"><img src="docs/screenshots/project-analytics.jpg" width="400" alt="Project analytics"></a> |
| **Analytics** — Your learning across every Space and Project: mastery, streaks, activity, scores and progress per Space and Project. | <a href="docs/screenshots/analytics.jpg"><img src="docs/screenshots/analytics.jpg" width="400" alt="Global analytics"></a> |

Unknown URLs show a branded **404 page** with a way back to the workspace.

### Admin panel

| Panel | Preview |
|---|---|
| **Overview** — Platform KPIs (learners, activity, content, storage), a 14-day activity chart, top activity types, newest learners and latest activity. | <a href="docs/screenshots/admin-overview.jpg"><img src="docs/screenshots/admin-overview.jpg" width="400" alt="Admin overview"></a> |
| **Users** — Every account with its role, Spaces, Projects, materials, storage and last activity; searchable. | <a href="docs/screenshots/admin-users.jpg"><img src="docs/screenshots/admin-users.jpg" width="400" alt="Users"></a> |
| **Users › Learner detail** — One learner's journey: profile, AI usage, assessments & mastery, Spaces → Projects → materials and activity. | <a href="docs/screenshots/admin-user-detail.jpg"><img src="docs/screenshots/admin-user-detail.jpg" width="400" alt="Learner detail"></a> |
| **Learner detail › Growth & recommendations** — Streaks, 7-day concept trends per Project with what needs attention, and how the learner responds to recommendations. | <a href="docs/screenshots/admin-user-growth.jpg"><img src="docs/screenshots/admin-user-growth.jpg" width="400" alt="Learner growth and recommendations"></a> |
| **Spaces** — Every Space with its owner, Projects, materials and last activity; search and filter by user. | <a href="docs/screenshots/admin-spaces.jpg"><img src="docs/screenshots/admin-spaces.jpg" width="400" alt="Admin spaces"></a> |
| **Projects** — Every Project with its goal, Space, owner and materials; search and filter by user or Space. | <a href="docs/screenshots/admin-projects.jpg"><img src="docs/screenshots/admin-projects.jpg" width="400" alt="Admin projects"></a> |
| **Materials** — Every uploaded PDF with its Project, owner and processing status; filter by user or status and open a PDF to debug (audit-logged). | <a href="docs/screenshots/admin-materials.jpg"><img src="docs/screenshots/admin-materials.jpg" width="400" alt="Admin materials"></a> |
| **Activity** — Platform-wide learning events, filterable by user, Space, Project, activity type and time period. | <a href="docs/screenshots/admin-activity.jpg"><img src="docs/screenshots/admin-activity.jpg" width="400" alt="Activity"></a> |
| **Engagement** — Daily / weekly / monthly active learners, stickiness, 7-day retention, sign-ups, feature adoption and the most active learners. | <a href="docs/screenshots/admin-engagement.jpg"><img src="docs/screenshots/admin-engagement.jpg" width="400" alt="Engagement"></a> |
| **Learning analytics** — Quiz completion, accuracy by type and difficulty, mastery distribution, hardest concepts, recommendation follow rate and Tutor grounding. | <a href="docs/screenshots/admin-learning.jpg"><img src="docs/screenshots/admin-learning.jpg" width="400" alt="Learning analytics"></a> |
| **System health** — Live status of the API, database, file storage, AI gateway (model chains, errors, cost), workers and retrieval. | <a href="docs/screenshots/admin-system.jpg"><img src="docs/screenshots/admin-system.jpg" width="400" alt="System health"></a> |
| **AI usage** — Every model call traced: calls, errors, fallbacks, latency, tokens and cost by feature and model, with per-call traces. | <a href="docs/screenshots/admin-ai-usage.jpg"><img src="docs/screenshots/admin-ai-usage.jpg" width="400" alt="AI usage"></a> |
| **AI evaluation** — Quality of Zoya's answers (rule checks, LLM judge, learner feedback, offline suite), plus quiz and recommendation quality. | <a href="docs/screenshots/admin-ai-evaluation.jpg"><img src="docs/screenshots/admin-ai-evaluation.jpg" width="400" alt="AI evaluation"></a> |
| **Background jobs** — The durable job queue: waiting, running and failed jobs, durations per type, live workers and audited retry. | <a href="docs/screenshots/admin-jobs.jpg"><img src="docs/screenshots/admin-jobs.jpg" width="400" alt="Background jobs"></a> |

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

Backend tests run against an in-memory MongoDB (the first run downloads a MongoDB binary from `fastdl.mongodb.org`, so that host must be
reachable) and a scriptable mock AI provider — no Atlas data, no model costs.

### Live AI regression suite

Runs the real document pipeline and the real Tutor against curated material and questions (in an isolated in-memory database, using your
`GEMINI_API_KEY`), then reports grounded accuracy, citation correctness, unsupported-question handling, injection resistance, retrieval
hit@k/MRR, latency and cost:

```bash
npm --prefix backend run eval:tutor -- --judge --baseline
```

`--baseline` exits with code 1 when a metric regresses more than 5 points against `backend/evals/tutor/baseline.json`; `--record` also stores the
run so it appears in **Admin → AI evaluation**; `--write-baseline` accepts the current run as the new baseline.

## Deploy (Phase 6)

- **Frontend → Vercel**: set the project's Root Directory to `frontend`. [`frontend/vercel.json`](frontend/vercel.json) pins the Next.js build and adds
  security headers; set `BACKEND_URL` to the API's public origin (read at build time for the `/api` rewrite).
- **API + worker → Render** (or any Node 22 host): `npm ci && npm run build`, start with `npm start`, health check `/api/health`, env from
  `backend/.env.example` with `NODE_ENV=production` and `COOKIE_SECURE=true`. Allow the host in MongoDB Atlas network access.

## What's built

**Learner workspace**: registration and sign-in · home dashboard (recommended next action, continue learning, recent projects, overall progress,
areas requiring attention, activity) · Spaces with colour/icon customisation · Space dashboards with progress and attention · Projects with a
learning goal · drag-and-drop PDF upload with progress and duplicate detection · rename/delete with cascading cleanup.

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
- Uses controlled, validated, Project-scoped tools (search materials, read a page, list concepts, check learning state and mastery, save a
  learning note, offer a practice quiz — shown as a *Start quiz* button the learner can choose to press).
- Resilient: model fallback chains with circuit breakers, restart on another model if one fails mid-answer, keyword retrieval if embeddings are down,
  and cited passages if every model is unavailable.

**Adaptive quiz & mastery** (Project → Quiz):
- Adaptive, focused (chosen concepts) or review (mistakes and concepts due) quizzes of 3–15 questions — multiple choice, written answers or a mix.
- Each question is written from the learner's own material, checked by rule validation before it is shown, and cites its source pages.
  The next concept, difficulty and type follow the evidence: weak, uncertain, recently missed or due concepts first, pitched at about a 70 %
  chance of success — and the learner can see *why this question* was chosen.
- Written answers are graded against a rubric of key points with quoted evidence: the feedback says what was understood, what is missing and
  which misconceptions to watch out for, next to a model answer. "I don't know" is a learning moment, not a failure.
- Mastery per concept (with confidence, "not assessed" until there is evidence, gentle decay without practice) updates after every answer and
  appears on the Project overview, the concept map and in Zoya's context; results show mastery before → after, strengths, what needs work
  and the pages to return to.
- Repeated mistakes and post-quiz strengths/weaknesses flow into the persistent learning context that Zoya uses. Everything is idempotent and
  recovers from AI outages (answers are kept and graded in the background).

**Growth, recommendations & analytics**:
- **Growth** classifies every concept as improving, stable or requiring attention (low, falling, recently missed or fading without practice) over
  7 / 30 / 90 days, with the reasons, a progress line and plain-language insights computed from the evidence.
- **Recommendations** answer *what should I do next?*: rules pick the actions from mastery, recent mistakes, repeated-mistake patterns, application
  gaps, spaced review and new material; the AI only rephrases them from the same facts (numbers are checked) and one click performs them — e.g.
  starts a focused quiz on the weak concept after pointing to the pages to review. Regenerated only when the learner's state changes.
- **Analytics** per Project and across all Spaces: activity, streaks, quiz performance by type/difficulty/level, mastery distribution, concept
  trends and AI activity.

**Admin console**: platform KPIs and activity chart · users with their learning journey, **AI usage**, **assessments & mastery** and **growth &
recommendations** · **Engagement** and **Learning analytics** · Spaces, Projects, materials and activity explorers · audit-logged PDF viewing · **AI usage** (calls, errors, fallbacks, p50/p95 latency, tokens and cost by feature/model/time,
per-call traces with retrieval evidence and the request waterfall) · **AI evaluation** (rule checks on every answer, sampled LLM judge,
learner feedback, scores by prompt version, offline regression runs, quiz **assessment quality** — question validity, grading checks,
question judge, learner reports — and **recommendation quality**) · **Background jobs** (queue, workers, failures, audited retry) ·
live **system health** (API, database, storage, AI gateway, worker, retrieval).

**Security**: bcrypt password hashing, httpOnly session cookies with server-side revocation, CSRF guard, per-user and per-Project data isolation
(including retrieval, memory and AI tools), prompt-injection defences (material treated as data, delimiter escaping, flagged passages),
validated AI output, rate limits, and admin-only APIs.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): system design for every phase, data model, API reference, the AI layer and Tutor pipeline
  (§12–§15), the adaptive quiz and mastery model (§16–§17), growth, recommendations and analytics (§18–§21), learning context (§20),
  the admin console (§22), observability and evaluation results (§23–§24), security, testing, deployment, build status and decision log.
