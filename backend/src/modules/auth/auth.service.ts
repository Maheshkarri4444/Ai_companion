import bcrypt from 'bcryptjs';
import { config } from '../../config/env';
import { AppError, isDuplicateKeyError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { User, type IUser } from '../../models/user.model';
import { recordEvent } from '../activity/activity.service';

// Compared against when the email is unknown, so response time does not reveal whether an account exists.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('timing-equaliser-not-a-real-password', config.BCRYPT_ROUNDS));

const invalidCredentials = () => new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');

export async function registerUser(input: { name: string; email: string; password: string }): Promise<IUser> {
  if (await User.exists({ email: input.email })) {
    throw AppError.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
  }
  const passwordHash = await bcrypt.hash(input.password, config.BCRYPT_ROUNDS);
  const now = new Date();
  let user;
  try {
    // Role is never taken from client input: self-registration always creates a learner.
    user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash,
      role: 'user',
      lastLoginAt: now,
      lastActiveAt: now,
    });
  } catch (err) {
    if (isDuplicateKeyError(err)) throw AppError.conflict('EMAIL_TAKEN', 'An account with this email already exists.');
    throw err;
  }
  await recordEvent({ type: 'user.registered', ownerId: user._id, actorId: user._id, metadata: { name: user.name } });
  return user.toObject();
}

export async function loginWithPassword(email: string, password: string): Promise<IUser> {
  const user = await User.findOne({ email }).select('+passwordHash').lean();
  if (!user) {
    await bcrypt.compare(password, await getDummyHash());
    throw invalidCredentials();
  }
  if (!(await bcrypt.compare(password, user.passwordHash))) throw invalidCredentials();
  if (user.status !== 'active') {
    throw AppError.forbidden('This account has been disabled. Please contact an administrator.', 'ACCOUNT_DISABLED');
  }

  const now = new Date();
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: now, lastActiveAt: now } });
  await recordEvent({ type: 'user.logged_in', ownerId: user._id, actorId: user._id });
  return { ...user, lastLoginAt: now, lastActiveAt: now };
}

export async function getUserById(userId: string): Promise<IUser> {
  const user = await User.findById(userId).lean();
  if (!user) throw AppError.unauthorized();
  return user;
}

/**
 * Creates the configured admin account on first boot (idempotent; never overwrites an existing account —
 * `npm run seed:admin` is the explicit way to reset it).
 */
export async function ensureAdminUser(): Promise<void> {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    logger.warn('ADMIN_EMAIL / ADMIN_PASSWORD not set: no admin account bootstrapped');
    return;
  }
  const email = config.ADMIN_EMAIL.toLowerCase();
  const existing = await User.findOne({ email }, { role: 1 }).lean();
  if (existing) {
    if (existing.role !== 'admin') logger.warn({ email }, 'ADMIN_EMAIL belongs to a non-admin account; run `npm run seed:admin` to promote it');
    return;
  }
  try {
    await User.create({
      name: config.ADMIN_NAME,
      email,
      passwordHash: await bcrypt.hash(config.ADMIN_PASSWORD, config.BCRYPT_ROUNDS),
      role: 'admin',
    });
    logger.info({ email }, 'Admin account created');
  } catch (err) {
    if (!isDuplicateKeyError(err)) throw err; // another instance created it concurrently
  }
}
