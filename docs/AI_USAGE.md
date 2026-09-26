# AI Usage

This project involves AI in two different roles, documented separately:

- **[Part A — AI used to build the product](#part-a--ai-used-to-build-the-product)**: coding assistants and development agents used while designing, writing, debugging, testing and documenting the code.
- **[Part B — AI used by the product](#part-b--ai-used-by-the-product)**: the models the running application calls for learners and administrators, such as the Tutor, quiz generation, grading, recommendations, document understanding and evaluation.

The prompts used with the development tools are collected in [DEVELOPMENT_PROMPTS.md](DEVELOPMENT_PROMPTS.md).

---

## Part A — AI used to build the product

### Tools

| Tool | Where it was used | What it did |
|---|---|---|
| **Claude Code** (Anthropic), local sessions in the Claude desktop app | Phases 1–3 and 5, plus submission docs | Architecture design ([ARCHITECTURE.md](ARCHITECTURE.md)), backend and frontend implementation, tests, debugging, UI design, live AI checks, browser end-to-end testing, screenshots, documentation |
| **Claude Code**, cloud session | Phase 4: adaptive quiz and mastery, merged as PR #1 | Implemented the quiz engine, grading and the mastery model; afterwards reviewed and verified locally (183 tests green after one test-fixture fix) |
| _Add any other AI tools you used, for example to read the PRD, draft wording or design visuals_ | | |

### How the work was organised

The build followed six phases defined up front in [ARCHITECTURE.md §31](ARCHITECTURE.md#31-build-plan--status). Every phase followed the same loop:

1. **Plan**: the architecture document was written or updated first (data model, API, decisions).
2. **Implement**: the code was written against that plan, reusing extension points (job handlers, context providers, tools, judges) instead of rewriting earlier layers.
3. **Verify**: type-check, lint, automated tests, a production build, then a manual or agent-driven browser run against real services.
4. **Review**: the developer reviewed and tested each phase before the next one started.

### What AI helped with, by area

| Area | Examples |
|---|---|
| Architecture | System design and module boundaries, data model and indexes, API design, the event-to-workflow model, and the decision log (D1–D35) |
| Backend | Express API, authentication and data isolation, the durable job queue and worker, the PDF pipeline, the AI gateway, the Tutor orchestration, the quiz engine, growth, recommendations and analytics |
| Frontend | Next.js pages for the learner and admin panels, the shared UI kit, chart components (data-visualisation guidance plus accessibility checks), streaming chat UI |
| Database | MongoDB schemas, compound and partial unique indexes, aggregation pipelines, idempotency keys, Atlas Vector Search setup with an in-process fallback |
| AI features | Prompt design with a version on every prompt, structured-output schemas, validation rules, the evidence gate, citation handling, the judges, recommendation phrasing guards |
| Debugging | Found and fixed with AI help: Gemini rejecting `maxItems` on object arrays (400 error); Next.js silently truncating uploads over 10 MB when `proxy.ts` exists; a small-talk shortcut that could bypass the evidence gate; a flaky quiz test fixture; invisible single-day points on charts; a circular AI rationale ("48 % because it is below 50 %") |
| Testing | Vitest + Supertest suites with an in-memory MongoDB and a scriptable mock AI provider (195 tests); the live Tutor regression suite; browser end-to-end runs |
| Documentation | README (including the screenshot tour), architecture document, and these submission documents |

### Human responsibility

- **Product decisions**: phase order, stack choices, the Tutor persona **Zoya**, the blue "professional AI" design direction, and email + password login.
- **Review and testing**: every phase was reviewed between steps.
- **Deployment**: Vercel, Render and MongoDB Atlas configuration.
- **Demo and submission.**
- **Secrets**: API keys and credentials were only ever placed in local, git-ignored `.env` files and host dashboards. AI tools were instructed never to print or commit them.

---

## Part B — AI used by the product

### Provider and gateway

The application uses **Google Gemini** through the `@google/genai` SDK. Every call goes through one **AI gateway** (`backend/src/ai/gateway.ts`) behind a provider-neutral `AIProvider` interface. The gateway handles:

- **Resilience**: tiered model chains with automatic fallback, a circuit breaker per model, timeouts, and a global concurrency cap.
- **Output handling**: structured output validated with zod, with one repair round-trip.
- **Accounting**: token and cost tracking, and one `ai_calls` record per call (feature, model, attempts, latency, tokens, cost, prompt version, trace id), visible under **Admin → AI usage**.

### Models

All model names are configurable through environment variables; the defaults are below.

| Tier | Default model → fallbacks | Used for |
|---|---|---|
| Primary | `gemini-3.6-flash` → `gemini-3.7-flash` → `gemini-3-flash-preview` → `gemini-3.5-flash-lite` | Tutor answers, quiz question generation, written-answer grading, LLM judges |
| Light | `gemini-3.5-flash-lite` → `gemini-3.1-flash-lite` → `gemini-3-flash-preview` | Intent and query rewriting, conversation summaries and titles, learner-memory extraction, OCR, concept extraction, mistake patterns, recommendation phrasing |
| Embeddings | `gemini-embedding-2` (768 dimensions, L2-normalised) | Document chunks, search queries, learner memory |

### Where AI runs in the product

| Feature (`ai_calls.feature`) | Prompt version | Tier | Runs | What it does | Guardrails |
|---|---|---|---|---|---|
| `material.ocr` | `ocr.v1` | light | background (`material.process`) | Reads scanned PDF pages (Gemini PDF vision) | Only pages with too little extractable text; max 40 OCR pages per PDF |
| `material.concepts` | `concepts.v1` | light | background | Extracts the key concepts with descriptions, importance and source pages (map-reduce over page groups) | zod schema; page numbers outside the document are dropped; concepts merged by slug |
| `embed.document` · `embed.query` · `embed.memory` | — | embedding | background / request | Vectors for retrieval and for learner-memory deduplication and recall | Batched; query cache; falls back to keyword search if embeddings fail |
| `tutor.intent` | `understand.v1` | light | request | Classifies the question and rewrites follow-ups into standalone queries | Heuristics first; the model is only called when needed and can never skip the evidence gate |
| `tutor.answer` | `tutor.v2` | primary | request, streamed (SSE) | **Zoya's answer**, grounded in retrieved passages with `[S1]` citations; may call Project-scoped tools | Evidence gate before any model call; invalid citations removed; rule checks on every answer; restart on another model mid-stream; extractive fallback |
| `tutor.summarize` · `tutor.title` | `summary.v1` | light | background | Rolling conversation summary and title | Never overwrites a title the learner set |
| `tutor.memory` | `memory.v1` | light | background | Extracts what matters about the learner (goals, preferences, difficulties) | Highly selective; no sensitive data; Project-scoped; learner can view and delete |
| `quiz.generate` | `quiz.generate.v1` | primary | request + pre-generation job | Writes a question for the concept and difficulty chosen by the (deterministic) adaptive engine, from that concept's passages | Rule validation; one regeneration with the issues as feedback; answer key never sent before answering |
| `quiz.grade` | `quiz.grade.v1` | primary | request, then background retry | Grades a written answer against a rubric of key points, quoting the learner's words as evidence | The score is **computed by the server** from per-point verdicts; quotes are verified against the answer; grade-steering is flagged |
| `insight.generate` | `insight.pattern.v1` | light | background | Describes a repeated-mistake pattern for the learning context | Rule-based wording if the model fails |
| `recommend.generate` | `recommend.v2` | light | background | Rephrases rule-chosen recommendations in natural language | Facts are passed as data; any number not in the facts → the template text is kept; rule checks re-run on the phrased text |
| `eval.judge` | `judge.tutor.v1` · `judge.quiz.v1` | primary | background, sampled | LLM judge for Tutor answers and quiz questions | Sampled (30 % / 20 %) plus every rule failure, 👎 or reported question |

### Where AI is deliberately *not* used

Decisions that must be explainable, testable and cheap are deterministic code:

- retrieval ranking and the "is there enough evidence?" threshold;
- the "not in your materials" reply, which costs nothing and has zero fabrication risk;
- **which question comes next** (adaptive selection) and **mastery estimation**;
- **growth classification** and **which recommendation to make**;
- analytics, multiple-choice grading, and the final score of written answers.

The model writes language; the application makes decisions. See D16, D17, D24, D25 and D31 in [ARCHITECTURE.md §32](ARCHITECTURE.md#32-key-decisions-simplifications--future-work).

### Safety and control

| Risk | Control |
|---|---|
| Prompt injection from materials or learners | Untrusted text is wrapped in delimited data blocks with tag-like sequences neutralised; the system rules forbid following embedded instructions; suspicious chunks are flagged; covered by live suite cases |
| The model changing application state | Tools are allow-listed and argument-validated, and scoped to the learner's Project on the server. Model output is validated before it is saved. Zoya can *offer* a quiz but never start one |
| Hallucinated sources or numbers | Citation ids must exist; fabricated ones are removed and flagged. Recommendation numbers must appear in the facts |
| Cross-learner leakage | Retrieval, memory, tools and prompts are always filtered by owner and Project; there are isolation tests |
| Cost blow-up | Rate limits (Tutor 20 messages/min, quiz 40 requests/min), a global concurrency cap, the zero-cost insufficient-evidence path, the light tier for auxiliary work, sampled judging, and a `stateHash` so recommendations aren't regenerated without a state change |
| Privacy | `ai_calls` previews are truncated and expire after 90 days; deleting a Project deletes its learning data and scrubs the text previews of its AI calls |

Quality of the runtime AI is measured continuously; see [EVALUATION.md](EVALUATION.md).
