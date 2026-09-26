# Known Limitations

This page lists the important limitations of the current prototype (PRD §20.8). Where a mitigation or upgrade path exists, it is included.
Many of these are deliberate simplifications recorded in the decision log ([ARCHITECTURE.md §32](ARCHITECTURE.md#32-key-decisions-simplifications--future-work)).

## AI

- **Free-tier model availability.** Gemini free-tier models regularly return 503 ("high demand") or 429 errors. The gateway falls back through a model chain and parks failing models, so answers usually still arrive. Under sustained load, though, latency rises (Tutor p95 ≈ 9 s in the regression suite), some quiz questions take longer to prepare, and background work retries later.
- **Model names are time-sensitive.** The defaults (`gemini-3.6-flash` and others) were verified on 2026-09-25 for this key. Models get renamed or retired, so the chains are environment variables, but they need maintenance.
- **Mastery is a heuristic estimate, not a calibrated measurement.** It uses an Elo/IRT-style update. Item difficulty is the difficulty the generator was asked for, not one calibrated from response data, so scores are useful for ranking weak and strong concepts rather than as exact percentages.
- **Grading is AI-assisted.** Written answers are graded against AI-written rubrics. Quote verification and a server-computed score reduce gaming, but a correct paraphrase can still be under-credited. Learners can report unfair grading.
- **The LLM judge is sampled and model-based.** It covers 30 % of Tutor answers and 20 % of questions, plus failures and reports. The judge can share blind spots with the model it judges.
- **Recommendation phrasing is limited.** The model may only rephrase facts, and any unsupported number falls back to the template. Wording can therefore be plain, and a new kind of advice needs a new rule.
- **English only.** Prompts, UI and evaluation are in English; other languages were not tested.

## Retrieval

- **Needs Atlas Vector Search for scale.** The index is created automatically at API start. Without it (a local MongoDB, or while the index is still building), retrieval falls back to in-process cosine similarity over at most **5,000 chunks per Project**, and then to keyword search.
- **Fixed evidence thresholds.** Grounding decisions use cosine thresholds (0.72 strong, 0.58 minimum) calibrated for `gemini-embedding-2` on a small suite. A different embedding model or very different material may need recalibration: `npm run eval:tutor` is the tool for that.
- **No re-ranking model.** Retrieval is a hybrid of vector and text search fused with RRF. A cross-encoder re-ranker would improve precision on long documents.

## Documents

- **PDF only**, up to 20 MB and **300 pages**. Word, PowerPoint, web pages and images are not supported.
- **Limited OCR.** Scanned pages are OCR'd by the light Gemini model, at most **40 OCR pages per PDF**; beyond that, scanned pages stay unsearchable.
- **Text only.** Tables, formulas and figures are extracted as plain text; diagrams and images are not described or searchable. Complex layouts (multi-column pages, footnotes) can produce imperfect chunks.
- **Imperfect injection detection.** Material is always treated as data and suspicious passages are flagged, but the detector is heuristic, not a classifier.

## Assessment and learning analytics

- **Days are UTC.** Streaks and daily charts use UTC calendar days; a learner far from UTC sees days split at their local offset.
- **Growth reflects quiz evidence only.** Tutor usage influences which questions are selected, but only graded quiz answers change mastery.
- **No question bank.** Every question is generated on demand (one is pre-generated ahead). This keeps adaptivity high but costs one model call per question.

## Background processing

- **The worker runs inside the API process** by default (`APP_ROLE=all`). On a sleeping host (for example Render's free plan), background jobs pause until the service wakes. The durable queue then resumes them, but processing, grading retries and recommendation phrasing can be delayed.
- **The job queue is MongoDB-based** (polling about every second). Correct and idempotent, but not built for high throughput; Redis/BullMQ or a cloud queue would be the scale path.
- **No push notifications.** Learners see job results when they reopen or refresh a page (materials poll while processing); there is no email or push.

## Scaling and performance

- **Analytics and growth are computed on request** from windowed aggregations, with no cache or daily roll-ups. This is fine at prototype scale, but large histories would need materialised metrics.
- **Rate limits are in memory, per instance.** Several API instances would each allow the full limit; a shared store (Redis) is needed to scale out.
- **Admin filter dropdowns list the first 100 options** (users, Spaces, Projects).
- **One region.** Latency depends on where the frontend (Vercel), API (Render), database (Atlas) and Gemini sit. The deployed readiness check reported about 230 ms from the API to the database.

## Security and privacy

- **No email verification, password reset or 2FA**, and no profile or password editing in the UI (the `preferences` field is reserved). Resetting the admin password uses `npm run seed:admin`.
- **Registration reveals whether an email exists** (409), for clearer learner UX. Login itself does not reveal it.
- **The demo admin login is public.** It is shown in the README and on the sign-in page so reviewers can open the admin console, which means anyone can see learner data on the demo deployment. The admin API is read-only except job retries. Rotate the password after the review.
- **Admins can open learners' PDFs** to debug processing. Every view is written to the audit log, but there is no separate consent step.
- **Sessions are 7-day JWTs in an httpOnly cookie.** Logout clears the cookie, but a copied token stays valid until it expires. Exceptions: disabling the account, or bumping its token version (currently only the `seed:admin` reset does this), rejects it immediately. There is no server-side session list or "sign out everywhere".
- **Learner content is sent to Google Gemini.** Materials, questions and answers are processed by the model provider, subject to the provider's data terms.

## Cost

- **Every Tutor answer, quiz question and written-answer grade costs a model call**, plus background calls for summaries, memory, concepts, OCR, recommendations and sampled judging.
- **Costs are bounded but not budgeted.** Rate limits, a concurrency cap, the zero-cost "not in your materials" path, the light tier for side tasks and recommendation state hashing keep costs down. There is no per-user budget or monthly cap; costs are observable per feature, model and learner under **Admin → AI usage**.

## UI and UX

- **Desktop-first.** Screens are responsive and were checked at phone width, but there is no dedicated mobile app or offline mode.
- **No dark mode, no internationalisation, and no full accessibility audit** (keyboard shortcuts, labelled charts and table views for charts are in place).
- **No real-time updates.** Some views update on polling rather than live pushes, for example the jobs page and material processing.

## Deployment and operations

- **Rewrite limits.** Uploads and Tutor streams pass through the Vercel → Render rewrite, so the hosts' request-size, duration and cold-start limits apply. Uploads close to the 20 MB limit and very long streams have not been measured on the deployed instance.
- **`BACKEND_URL` is baked in at build time.** Changing the API address requires a frontend redeploy.
- **No CI pipeline yet.** Tests, type-check, lint and the AI regression suite are run manually before changes; they are not run by a hosted CI.

## Testing

- **Automated tests use a mock AI provider.** Real-model behaviour is checked by the offline Tutor suite and by manual end-to-end runs. Quiz generation and grading and recommendations have online rule checks and a judge, but **no offline regression suite** like the Tutor's yet.
- **No automated frontend tests.** Frontend quality relies on type-check, lint, production builds and browser runs.
