/**
 * Explicitly create or reset the admin account from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME.
 * Unlike the startup bootstrap, this resets the password and revokes the admin's existing sessions.
 *
 *   npm run seed:admin
 */
import bcrypt from 'bcryptjs';
import { config } from '../config/env';
import { connectDatabase, disconnectDatabase } from '../lib/db';
import { User } from '../models/user.model';

async function run() {
  if (!config.ADMIN_EMAIL || !config.ADMIN_PASSWORD) {
    console.error('Set ADMIN_EMAIL and ADMIN_PASSWORD in backend/.env first.');
    process.exit(1);
  }
  await connectDatabase(config.MONGODB_URI, config.MONGODB_DB_NAME);
  const email = config.ADMIN_EMAIL.toLowerCase();
  const passwordHash = await bcrypt.hash(config.ADMIN_PASSWORD, config.BCRYPT_ROUNDS);
  const result = await User.findOneAndUpdate(
    { email },
    {
      $set: { passwordHash, role: 'admin', status: 'active' },
      $setOnInsert: { name: config.ADMIN_NAME, email },
      $inc: { tokenVersion: 1 },
    },
    { upsert: true, returnDocument: 'after' },
  ).lean();
  console.log(`Admin ready: ${result?.email} (sessions revoked, password reset from env)`);
  await disconnectDatabase();
}

run().catch(async (err) => {
  console.error(err);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
