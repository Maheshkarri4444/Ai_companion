import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { User } from '../src/models/user.model';
import { app, registerLearner, useTestDatabase, XRW } from './helpers';

useTestDatabase();

const sessionCookie = (res: request.Response) =>
  ([] as string[]).concat(res.headers['set-cookie'] ?? []).find((c) => c.startsWith('asc_session='));

describe('registration', () => {
  it('creates a learner and starts an httpOnly, SameSite=Lax session', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set(XRW)
      .send({ name: 'Ada Lovelace', email: 'Ada@Example.com ', password: 'Password123' });

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Ada Lovelace', email: 'ada@example.com', role: 'user' });
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const cookie = sessionCookie(res);
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
  });

  it('stores a bcrypt hash, never the password', async () => {
    const { credentials } = await registerLearner();
    const stored = await User.findOne({ email: credentials.email }).select('+passwordHash').lean();
    expect(stored?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(stored?.passwordHash).not.toContain(credentials.password);
  });

  it('ignores a client-supplied role (no self-promotion to admin)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .set(XRW)
      .send({ name: 'Mallory', email: 'mallory@example.com', password: 'Password123', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });

  it('rejects a duplicate email case-insensitively', async () => {
    await registerLearner({ email: 'dup@example.com' });
    const res = await request(app)
      .post('/api/auth/register')
      .set(XRW)
      .send({ name: 'Other', email: 'DUP@example.com', password: 'Password123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  it.each([
    ['too short', 'Pass1'],
    ['no digit', 'PasswordOnly'],
    ['no letter', '1234567890'],
    ['over 72 bytes', `A1${'x'.repeat(80)}`],
  ])('rejects a weak password (%s)', async (_label, password) => {
    const res = await request(app)
      .post('/api/auth/register')
      .set(XRW)
      .send({ name: 'Weak', email: 'weak@example.com', password });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details[0].path).toBe('password');
  });
});

describe('login and session', () => {
  it('logs in with valid credentials', async () => {
    const { credentials } = await registerLearner();
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/login').set(XRW).send({ email: credentials.email, password: credentials.password });
    expect(res.status).toBe(200);
    expect(sessionCookie(res)).toBeDefined();

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(credentials.email);
    expect(me.body.user.lastLoginAt).toBeTruthy();
  });

  it('returns the same generic error for a wrong password and an unknown email', async () => {
    const { credentials } = await registerLearner();
    const wrong = await request(app).post('/api/auth/login').set(XRW).send({ email: credentials.email, password: 'Nope12345' });
    const unknown = await request(app).post('/api/auth/login').set(XRW).send({ email: 'ghost@example.com', password: 'Nope12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
  });

  it('requires a session for /me and rejects tampered tokens', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    const tampered = await request(app).get('/api/auth/me').set('Cookie', 'asc_session=eyJhbGciOiJIUzI1NiJ9.e30.forged');
    expect(tampered.status).toBe(401);
  });

  it('logout clears the session cookie', async () => {
    const { agent } = await registerLearner();
    const res = await agent.post('/api/auth/logout').set(XRW);
    expect(res.status).toBe(204);
    expect(sessionCookie(res)).toMatch(/Expires=Thu, 01 Jan 1970/);
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('revokes existing sessions when tokenVersion changes', async () => {
    const { agent, user } = await registerLearner();
    expect((await agent.get('/api/auth/me')).status).toBe(200);
    await User.updateOne({ _id: user.id }, { $inc: { tokenVersion: 1 } });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
  });

  it('blocks disabled accounts immediately and at login', async () => {
    const { agent, user, credentials } = await registerLearner();
    await User.updateOne({ _id: user.id }, { $set: { status: 'disabled' } });
    expect((await agent.get('/api/auth/me')).status).toBe(401);
    const login = await request(app).post('/api/auth/login').set(XRW).send({ email: credentials.email, password: credentials.password });
    expect(login.status).toBe(403);
    expect(login.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('CSRF guard', () => {
  it('rejects state-changing requests without X-Requested-With', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'a@b.co', password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_REJECTED');
  });

  it('does not require the header for safe methods', async () => {
    expect((await request(app).get('/api/health')).status).toBe(200);
  });
});
