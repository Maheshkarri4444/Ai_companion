# Development Prompts

The actual prompts materially used with AI development tools while building AI Study Companion, organised by area (PRD §20.6).
Which tools were used, and how, is described in [AI_USAGE.md](AI_USAGE.md#part-a--ai-used-to-build-the-product).

> **Before pasting a prompt, redact any secret it contains** (API keys, database connection strings, passwords, admin credentials).
> Replace it with a placeholder such as `<GEMINI_API_KEY>` or `<MONGODB_URI>`. The repository must never contain real credentials.

**Format for each entry**

```text
### <short title>
- Tool: <e.g. Claude Code (desktop, local session) / Claude Code (cloud session)>
- Phase / date: <e.g. Phase 3 — 2026-09-25>
- Prompt:
  > <the prompt, verbatim>
- Outcome: <what it produced or changed — one or two lines>
```

---

## 1. Architecture

<!-- System design, phase plan, stack choices, data model, API design, event-driven workflows. -->

## 2. Frontend

<!-- Next.js pages and layouts, learner and admin panels, design direction (blue AI theme), components, charts, 404, UX changes. -->

## 3. Backend

<!-- Express API, authentication and roles, Spaces / Projects / materials, job queue and worker, quiz engine, growth, recommendations, analytics, admin APIs. -->

## 4. Database

<!-- MongoDB / Atlas schemas, indexes, aggregations, GridFS, vector search, local database for testing. -->

## 5. AI

<!-- Tutor "Zoya", grounded answers and citations, unsupported questions, learning context, quiz generation and grading, recommendations, evaluation. -->

## 6. Debugging

<!-- Bugs found and fixed with AI help (e.g. source preview text, Atlas network access, flaky quiz fixture, chart rendering). -->

## 7. Testing

<!-- Automated tests, live AI evaluation, browser end-to-end testing, verifying the cloud-session work. -->

## 8. Documentation

<!-- ARCHITECTURE.md, README app tour with screenshots, submission documents. -->

## 9. Deployment (optional)

<!-- Vercel, Render, MongoDB Atlas configuration. -->
