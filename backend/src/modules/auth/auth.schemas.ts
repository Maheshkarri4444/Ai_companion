import { z } from 'zod';

const email = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .pipe(z.email('Enter a valid email address'));

/** bcrypt only uses the first 72 bytes of a password, so longer inputs are rejected instead of silently truncated. */
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password must be at most 72 bytes')
  .refine((value) => /[A-Za-z]/.test(value), 'Password must include at least one letter')
  .refine((value) => /\d/.test(value), 'Password must include at least one number');

export const registerBody = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email,
  password,
});

export const loginBody = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Email is required').max(254),
  password: z.string().min(1, 'Password is required').max(200),
});
