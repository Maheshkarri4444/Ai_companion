# Future Improvements

What I would build next with more development time (PRD §20.9), roughly in priority order. Each item addresses a limitation from
[KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) or extends the learning loop.

## 1. Close the evaluation loop

- **Offline regression suites for quiz generation, grading and recommendations**, built like the Tutor suite: curated material, expected answer keys, graded reference answers with expected scores, and learner states with the expected next action. Each gets a baseline gate.
- **CI pipeline**: run the tests, type-check, lint and build on every push, and the AI suites nightly or when a prompt or model changes, failing on regressions.
- **Human review queue in the admin console**: failed or reported items (answers, questions, gradings, recommendations) go to a review list, and reviewed items become new regression cases.
- **Prompt experiments**: A/B prompt versions on a traffic share, compared on judge scores, learner feedback and follow rates, which are already recorded per prompt version.

## 2. Better learning experience

- **Spaced-repetition schedule**: turn mastery decay into a daily "due today" review queue with reminders.
- **Study plans**: from the Project goal and current mastery, generate a week-by-week plan whose steps link to material pages, Tutor topics and quizzes, and adapt it as mastery changes.
- **More assessment formats**: flashcards, fill-in-the-gap, "explain it back" voice answers, and worked problems with step-level feedback for maths and code.
- **Richer Tutor answers**: diagrams, images and tables from the PDFs cited alongside text, plus inline mini-checks during explanations.
- **Learner-controlled preferences**: explanation style, pace and language (the `preferences` field is already reserved).

## 3. Stronger AI foundations

- **Calibrated item difficulty**: learn item difficulty from responses (IRT calibration) and keep a validated question cache per concept, so questions can be reused cheaply and difficulty targeting becomes more accurate.
- **Re-ranking and better chunking**: a cross-encoder re-ranker, layout-aware chunking (tables, multi-column), and figure/table extraction.
- **More document types**: Word, PowerPoint, web pages, YouTube transcripts and images; OCR without the 40-page cap using a batched background OCR job.
- **Model routing by difficulty and budget**: cheaper models for simple questions and stronger ones for hard reasoning, with per-user and platform cost budgets.
- **Multilingual support**: prompts, UI and evaluation in other languages.

## 4. Platform and security

- **Account lifecycle**: email verification, password reset, "sign out everywhere" (server-side session list), 2FA, and optional SSO.
- **Privacy controls**: export and delete my data, a consent step before admins open learner files, and per-Project data retention settings.
- **Collaboration**: shared Spaces for study groups or teachers, with roles, shared materials and class-level analytics.

## 5. Scale and operations

- **Separate worker service** and a real queue (Redis/BullMQ or a cloud queue), with autoscaling.
- **Daily roll-ups** for analytics and growth, cached dashboards, and time zones per user.
- **Object storage** (S3/R2) with direct, signed browser uploads instead of proxying files through the web tier.
- **Shared rate-limit store**, structured alerting (error rates, AI failure rates, queue age), and dashboards in a monitoring tool alongside the admin console.

## 6. Product surfaces

- **Notifications**: email or push when a long document finishes processing, when reviews are due, or with a weekly progress summary.
- **Mobile experience**: a PWA or native app with offline flashcards.
- **Dark mode, an accessibility audit and internationalisation.**
