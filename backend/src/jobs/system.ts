import { reconcileMaterials } from '../modules/knowledge/knowledge.service';
import { closeAbandonedAnswers } from '../modules/tutor/tutor.service';
import { STALE_STREAM_MS } from '../modules/tutor/orchestrator';
import { recoverStaleJobs } from './queue';
import { registerJobHandler } from './registry';

/** `system.reconcile`: scheduled every minute (deduplicated across workers by an idempotency key). */
export function registerSystemJobs() {
  registerJobHandler('system.reconcile', async () => {
    const recovered = await recoverStaleJobs();
    const { requeued } = await reconcileMaterials();
    const interruptedAnswers = await closeAbandonedAnswers(STALE_STREAM_MS * 2);
    return { recoveredJobs: recovered, requeuedMaterials: requeued, interruptedAnswers };
  });
}
