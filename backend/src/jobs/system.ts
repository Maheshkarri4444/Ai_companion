import { reconcileMaterials } from '../modules/knowledge/knowledge.service';
import { recoverStaleJobs } from './queue';
import { registerJobHandler } from './registry';

/** `system.reconcile`: scheduled every minute (deduplicated across workers by an idempotency key). */
export function registerSystemJobs() {
  registerJobHandler('system.reconcile', async () => {
    const recovered = await recoverStaleJobs();
    const { requeued } = await reconcileMaterials();
    return { recoveredJobs: recovered, requeuedMaterials: requeued };
  });
}
