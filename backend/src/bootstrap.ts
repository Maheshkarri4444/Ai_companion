import { registerSystemJobs } from './jobs/system';
import { registerEvaluationJobs } from './modules/evaluation/evaluation.jobs';
import { registerKnowledgeJobs } from './modules/knowledge/pipeline';
import { registerCoreContextProviders } from './modules/learning-context/providers';
import { registerQuizContextProviders } from './modules/quiz/providers';
import { registerQuizJobs } from './modules/quiz/quiz.jobs';
import { registerQuizTutorTools } from './modules/quiz/tools';
import { registerCoreTutorTools } from './modules/tutor/tools';
import { registerTutorJobs } from './modules/tutor/tutor.jobs';
import { registerWorkflows } from './modules/workflows';

let registered = false;

/**
 * Registers every extension point once per process: job handlers, event workflows, context providers and
 * Tutor tools. Both roles need it — the API enqueues and dispatches events, the worker runs the handlers.
 */
export function registerModules() {
  if (registered) return;
  registered = true;
  registerKnowledgeJobs();
  registerTutorJobs();
  registerQuizJobs();
  registerEvaluationJobs();
  registerSystemJobs();
  registerWorkflows();
  registerCoreContextProviders();
  registerQuizContextProviders();
  registerCoreTutorTools();
  registerQuizTutorTools();
}
