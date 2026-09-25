import type { Types } from 'mongoose';
import { getContext } from '../../lib/context';
import { isDuplicateKeyError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { toObjectId } from '../../lib/validation';
import { ActivityEvent, type ActivityType, type IActivityEvent } from '../../models/activityEvent.model';
import { toActivityDto } from '../serializers';

type Id = string | Types.ObjectId;
const toId = (value: Id) => (typeof value === 'string' ? toObjectId(value) : value);
const asId = (value: Id | null | undefined) => (value == null ? null : toId(value));

export interface RecordEventInput {
  type: ActivityType;
  ownerId: Id;
  /** Defaults to the authenticated caller (or the owner when outside a request). */
  actorId?: Id | null;
  spaceId?: Id | null;
  projectId?: Id | null;
  materialId?: Id | null;
  metadata?: Record<string, unknown>;
  /** Idempotency key: a second event with the same key is silently ignored. */
  eventKey?: string;
}

type Subscriber = (event: IActivityEvent) => Promise<void>;
const subscribers = new Map<ActivityType, Subscriber[]>();

/**
 * Event → workflow wiring (docs/ARCHITECTURE.md §11): subscribers typically enqueue idempotent jobs, so a
 * duplicate event can never start duplicate work.
 */
export function onActivity(type: ActivityType, subscriber: Subscriber) {
  subscribers.set(type, [...(subscribers.get(type) ?? []), subscriber]);
}

/**
 * Appends to the activity log, then dispatches subscribers. Best-effort by design: a failure to record
 * history must never fail the user's action — durable workflows are repaired by the reconciler instead.
 */
export async function recordEvent(input: RecordEventInput): Promise<void> {
  let event: IActivityEvent;
  try {
    const created = await ActivityEvent.create({
      type: input.type,
      ownerId: toId(input.ownerId),
      actorId: toId(input.actorId ?? getContext()?.userId ?? input.ownerId),
      spaceId: asId(input.spaceId),
      projectId: asId(input.projectId),
      materialId: asId(input.materialId),
      metadata: input.metadata ?? {},
      ...(input.eventKey ? { eventKey: input.eventKey } : {}),
    });
    event = created.toObject();
  } catch (err) {
    if (isDuplicateKeyError(err)) return;
    logger.error({ err, type: input.type }, 'Failed to record activity event');
    return;
  }
  for (const subscriber of subscribers.get(input.type) ?? []) {
    await subscriber(event).catch((err) => logger.error({ err, type: input.type }, 'Activity subscriber failed'));
  }
}

/** Account-level events are noise in a learner's timeline; admins still see them. */
const LEARNER_HIDDEN_TYPES: ActivityType[] = ['user.logged_in'];

export async function listUserActivity(
  ownerId: string,
  filters: { spaceId?: string; projectId?: string; type?: ActivityType; limit?: number } = {},
) {
  const query: Record<string, unknown> = { ownerId: toObjectId(ownerId) };
  if (filters.spaceId) query.spaceId = toObjectId(filters.spaceId);
  if (filters.projectId) query.projectId = toObjectId(filters.projectId);
  query.type = filters.type ?? { $nin: LEARNER_HIDDEN_TYPES };

  const events = await ActivityEvent.find(query)
    .sort({ createdAt: -1 })
    .limit(filters.limit ?? 20)
    .lean();
  return events.map(toActivityDto);
}
