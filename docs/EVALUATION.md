# Evaluation Approach

How the quality of the AI behaviour — Tutor answers, retrieval, assessments, mastery and adaptivity, recommendations — was evaluated,
and how regressions are caught when prompts, models or retrieval settings change (PRD §14, §20.7).

## Summary

| Layer | What runs | When | Where results live |
|---|---|---|---|
| **1. Automated tests** (mock AI) | 195 backend tests; the AI is a scriptable `MockAIProvider` (deterministic, no network) | Every change: `npm test` | Test output |
| **2. Online evaluation** (every AI output) | Rule checks on every Tutor answer, generated question, AI grading and recommendation; a **sampled LLM judge**; **learner feedback** (👍/👎, *Report a problem*, follow / dismiss) | Continuously in production | `ai_evaluations` → **Admin → AI evaluation** |
| **3. Offline regression suite** (real model) | Curated material + 18 Tutor cases + 8 retrieval cases through the real pipeline, with a baseline gate | Before changing a prompt, model or threshold: `npm run eval:tutor` | `backend/evals/output/`, `eval_runs` → Admin |
| **4. End-to-end runs** (real model) | Browser-driven runs of the whole learning loop against real services | Every phase | Phase notes in [ARCHITECTURE.md §31](ARCHITECTURE.md#31-build-plan--status) |

Every evaluation record carries the **prompt version** and model. The admin console shows judge scores **by prompt version**,
so a change can be compared with the version before it.

---

## 1. Tutor quality (Zoya)

**What "good" means**:

- the answer is **grounded** in the learner's materials and cites the right page;
- it says clearly when the materials **don't cover** the question;
- it resists **prompt injection** and stays helpful.

**Rule checks — every answer, synchronous, free**

- Citations are valid: no source ids that were never provided (fabricated `[S9]` markers are stripped and flagged).
- Grounded answers are cited; general-knowledge answers are not.
- "Not in your materials" answers are brief.
- No leaked control markers.
- A passage flagged as possible injection is never cited.
- Follow-up suggestions are present.
- Time to first token ≤ 6 s and total ≤ 30 s; the answer is not degraded.

**LLM judge** (`judge.tutor.v1`, primary model): runs on a deterministic 30 % sample, on every rule failure and on every 👎.
It sees the exact evidence Zoya saw and scores:

- groundedness, citation accuracy, relevance and pedagogy (1–5);
- handling of insufficient evidence;
- unsupported claims.

The light model rated nearly everything 5/5 in testing, so the judge runs on the primary model.

**Learner feedback**: 👍 / 👎 with a reason on every answer; a 👎 always triggers the judge.

**Offline regression suite** (`backend/evals/tutor/`): an isolated in-memory database with the **real** Gemini models.

- **Material**: two curated PDFs go through the real processing pipeline. One is ML notes that include an embedded prompt-injection paragraph; the other is an optimisation handout.
- **18 Tutor cases** cover:
  - grounded answers, with the expected cited page;
  - answers spanning both materials;
  - partial coverage;
  - off-topic and adjacent-topic unsupported questions, including mid-conversation;
  - follow-up rewriting, "simpler" and check-understanding;
  - prompt injection from the material and from the learner;
  - small talk and the general-knowledge opt-in.
- **Assertions**: each case checks grounding status, cited page, required and forbidden phrases, and the online rule checks. `--judge` adds judge scores.
- **Gate**: `--baseline` fails (exit 1) when pass rate, grounded accuracy, unsupported handling, injection resistance or retrieval hit@3 drop more than 5 points versus `baseline.json`.

**Results** (Gemini, 2026-09-25, prompt `tutor.v2`, evidence thresholds 0.72 / 0.58):

| Metric | Result |
|---|---|
| Cases passed | **18 / 18** |
| Grounded accuracy · citation correctness | 100 % · 100 % |
| Unsupported-question handling | 100 % |
| Prompt-injection resistance | 100 % |
| Judge: groundedness · citation accuracy | 0.94 · 1.0 |
| Latency: average · p95 (free-tier fallbacks included) | 3.9 s · 9.3 s |
| Cost of the whole suite, including document processing | ≈ $0.034 |

**What the evaluation changed**:

- The first run exposed a Gemini structured-output incompatibility (`maxItems` on object arrays → 400). The model-facing schemas were changed, with size limits now enforced server-side.
- Later runs calibrated the evidence thresholds for `gemini-embedding-2` to 0.72 and 0.58.
- Manual testing found a small-talk shortcut that could bypass the evidence gate; it was closed and is now a regression case.
- The judge was moved from the light to the primary model after it scored everything 5/5.

## 2. Retrieval

- **Metrics**: 8 retrieval cases in the suite measure **hit@1 87.5 %, hit@3 100 %, MRR 0.94**.
- **Sufficiency**: retrieval labels the evidence strong, partial or insufficient. The two thresholds were calibrated on adjacent-topic cases, where an unrelated question can still score about 0.63.
- **Traceability**: every Tutor answer stores its retrieval trace. The admin call explorer shows the standalone query, method (Atlas vector / in-process / keyword), candidate scores, selected chunks and sufficiency, so "why did retrieval return poor context?" can be answered for any real answer.
- **Isolation and degradation**: tests check cross-Project isolation, ranking, and keyword-only degradation when embeddings fail.

## 3. Assessments (quiz generation and grading)

| Evaluator | Subject · when | Checks |
|---|---|---|
| **Rules** (generation, blocking) | every generated question | stem length; not a repeated stem; sources exist; exactly four distinct options A–D; no "all / none of the above"; a valid answer key; the answer not given away in the stem; 2–6 rubric key points plus a model answer. A failing item is regenerated once with the issues as feedback, then another concept is tried |
| **Rules** (generation, warnings) | every generated question | unknown source ids; correct option markedly the longest; missing option rationales; self-rated difficulty or level off target |
| **Rules** (grading) | every AI-graded written answer | feedback present and specific; every key point graded; "covered" evidence actually **quoted** from the answer; computed and holistic scores consistent; misconceptions penalised; grade-steering not rewarded |
| **LLM judge** (`judge.quiz.v1`) | questions with warnings, a 20 % sample, every reported question | answerable from the cited passages, answer key correct, distractor quality, clarity, difficulty and level as targeted; automatic *fail* on multiple correct options, a factual error or key-correct ≤ 2 |
| **Learner reports** | *Report a problem* on a question or on the grading | recorded as a failing evaluation; a reported question always goes to the judge |

**Live check** (Gemini, 2026-09-25):

- Generated multiple-choice and written items passed validation on the first attempt, including a difficulty-4 application item.
- The grader scored the model answer 1.0, a vague answer 0.15 and an answer built on a misconception 0.0.
- An answer that tried to instruct the grader scored 0 and was flagged.

**Structured output reliability**: every AI output is schema-validated with one repair round-trip. Failures are counted per feature in **Admin → AI usage**.

## 4. Mastery and adaptive behaviour

The adaptive engine and the mastery estimator are pure functions, covered by 24 tests in the `quiz-engine` suite:

- **Estimator**: updates sized by the evidence; a hard question answered right counts more than an easy one answered wrong; a learning-rate floor; open-answer weight; bounded decay; "not assessed" and confidence.
- **Selection**: priorities, ability-targeted difficulty, momentum, type quotas, the weakest cognitive level, focus and review modes, seeded reproducibility with explained reasons.
- **Simulated learner**: a learner with fixed true abilities is quizzed by the real selection and estimator. The tests assert that the estimates **converge to the true ability** and that practice **concentrates on the weak concepts**.

Integration tests cover exactly-once mastery updates, background grading, idempotent retries and the reconciler.

## 5. Recommendations

PRD §14 asks for *relevance, actionability and alignment with the learner state*. Recommendations are chosen by rules from evidence and
only phrased by the model, so the evaluation checks both the choice and the wording:

| Check | Severity | What it verifies |
|---|---|---|
| `action_allowed` | fail | the action is on the allow-list (start or resume a quiz, review material, ask Zoya, upload) |
| `ids_in_project` | fail | every referenced concept belongs to the learner's Project |
| `numbers_supported` | fail | every number in the text appears in the stored facts (no invented statistics) |
| `aligned_with_attention` | warn | when something requires attention, the top recommendation addresses it (or finishes a quiz in progress) |
| `specific` | warn | the text names the concept it is about |

These checks run on every recommendation at creation and **again on the AI-phrased text**, because that is what the learner reads.
Before phrasing is saved, a **phrasing guard** checks the schema, the keys, the length caps and that every number is supported; otherwise the template text is kept.
**Learner response** is measured by the follow rate and dismissals.
**Admin → AI evaluation → Recommendation quality** shows the rule pass rate, aligned and actionable rates, the AI-phrased share,
the follow rate and the top failed checks.

Tests cover:

- candidate order (material → first quiz → weakest concept);
- novelty (dismissed never repeated, ignored ones down-weighted);
- stability across reads;
- the phrasing guard rejecting invented numbers;
- the re-evaluation of phrased text;
- the repeated-mistake → targeted-recommendation workflow.

## 6. Growth and analytics

Growth classification, streaks and the analytics aggregations are deterministic. Pure tests cover the attention rules, improving versus stable
and baselines; API tests check growth windows, progress series, factual insights, Project, global, Home and Space analytics, and
admin engagement and learning analytics (admin-only).

## 7. End-to-end verification

Each phase ended with a real run. For Phase 5, a production build ran against MongoDB 8.2 and live Gemini:

- PDF upload and processing;
- Tutor over SSE;
- several adaptive and focused quizzes with AI-graded written answers;
- following recommendations from Home, the Project overview and Growth, each of which started the right focused quiz;
- Growth, Analytics, the Space dashboard, the 404 page and every admin screen.

That run found and fixed display bugs and one weak AI phrasing, which led to prompt `recommend.v2` ([ARCHITECTURE.md §31](ARCHITECTURE.md#31-build-plan--status)).

## How to run

```bash
npm test
```

```bash
npm --prefix backend run eval:tutor -- --judge --baseline
```

`--record` stores the run so it appears under **Admin → AI evaluation**; `--write-baseline` accepts a run as the new baseline; `--only=id,id` runs selected cases.

**Not yet covered** (planned): offline suites for quiz generation and grading and for recommendations, like the Tutor suite, and a CI job that runs the
baseline gate automatically. See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) and [FUTURE_IMPROVEMENTS.md](FUTURE_IMPROVEMENTS.md).
