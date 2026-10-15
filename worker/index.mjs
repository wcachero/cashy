import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createCaptcha } from '../server/captcha.mjs';

const buckets = new Map();
const MAX_SNAPSHOT_BYTES = 90_000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The API request failed.';
        return json({ error: message }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  const path = url.pathname;
  if (request.method === 'GET' && path === '/api/health') {
    return json({ ok: true, database: 'd1:cashy' });
  }
  if (request.method === 'GET' && path === '/api/auth/challenge') {
    const limited = rateLimit(request, 'challenge', 15 * 60 * 1000, 30);
    if (limited) return limited;
    return json(await issueChallenge(env));
  }
  if (request.method === 'POST' && path === '/api/auth/register') {
    const limited = rateLimit(request, 'register', 60 * 60 * 1000, 5);
    if (limited) return limited;
    return register(request, env);
  }
  if (request.method === 'POST' && path === '/api/auth/login') {
    return login(request, env);
  }
  if (request.method === 'GET' && path === '/api/auth/me') {
    const session = await userFromRequest(request, env);
    if (!session) return json({ error: 'Sign in required.' }, 401);
    return json({ user: session.user });
  }
  if (request.method === 'POST' && path === '/api/auth/logout') {
    const token = bearer(request);
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return json({ ok: true });
  }
  if (request.method === 'GET' && path === '/api/plan') {
    const session = await userFromRequest(request, env);
    if (!session) return json({ error: 'Sign in required.' }, 401);
    const row = await env.DB.prepare('SELECT snapshot_json FROM plans WHERE user_id = ?').bind(session.user.id).first();
    if (!row) return json({ error: 'No plan is saved for this account.' }, 404);
    return json(JSON.parse(row.snapshot_json));
  }
  if (request.method === 'PUT' && path === '/api/plan') {
    const session = await userFromRequest(request, env);
    if (!session) return json({ error: 'Sign in required.' }, 401);
    const snapshot = await readJson(request);
    if (!isSnapshot(snapshot)) return json({ error: 'That plan file is missing income, liabilities, or cutoffs.' }, 400);
    const encoded = JSON.stringify(snapshot);
    if (encoded.length > MAX_SNAPSHOT_BYTES) {
      return json({ error: 'This plan is too large for the free D1 database.' }, 413);
    }
    await env.DB.prepare(
      `INSERT INTO plans (user_id, snapshot_json, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET snapshot_json = excluded.snapshot_json, updated_at = excluded.updated_at`,
    )
      .bind(session.user.id, encoded, new Date().toISOString())
      .run();
    return json({ ok: true });
  }
  return json({ error: 'That API route does not exist.' }, 404);
}

async function register(request, env) {
  const body = await readJson(request);
  const guardError = await checkRegistrationGuard(env, body);
  if (guardError) return json({ error: guardError }, 400);

  const name = String(body?.name ?? '').trim();
  const username = normalizeUsername(body?.username);
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  if (name.length < 2) return json({ error: 'Enter your name.' }, 400);
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) {
    return json({ error: 'Username must be 3–24 characters and use letters, numbers, or underscores.' }, 400);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400);
  if (password.length < 6) return json({ error: 'Use at least 6 characters for the password.' }, 400);

  const existingEmail = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existingEmail) return json({ error: 'That email is already registered.' }, 409);
  const existingUsername = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existingUsername) return json({ error: 'That username is already taken.' }, 409);

  const user = {
    id: randomBytes(16).toString('hex'),
    name,
    username,
    email,
    password_hash: hashPassword(password),
    created_at: new Date().toISOString(),
  };
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const emptyPlan = {
    version: 1,
    incomeStreams: [],
    liabilities: [],
    paycheckCycles: [],
    notificationsEnabled: false,
    bankSavings: [],
    receivables: [],
  };
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, name, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      user.id,
      user.name,
      user.email,
      user.username,
      user.password_hash,
      user.created_at,
    ),
    env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, user.id, expires),
    env.DB.prepare('INSERT INTO plans (user_id, snapshot_json, updated_at) VALUES (?, ?, ?)').bind(
      user.id,
      JSON.stringify(emptyPlan),
      user.created_at,
    ),
  ]);
  return json({ token, user: publicUser(user) }, 201);
}

async function login(request, env) {
  const body = await readJson(request);
  const loginValue = String(body?.login ?? body?.email ?? '').trim();
  const limited = rateLimit(request, `login:${loginValue.toLowerCase()}`, 15 * 60 * 1000, 8);
  if (limited) return limited;
  const password = String(body?.password ?? '');
  const row = loginValue.includes('@')
    ? await env.DB.prepare('SELECT id, name, email, username, password_hash FROM users WHERE email = ?').bind(loginValue.toLowerCase()).first()
    : await env.DB.prepare('SELECT id, name, email, username, password_hash FROM users WHERE username = ?').bind(loginValue.toLowerCase()).first();
  if (!row || !verifyPassword(password, row.password_hash)) {
    return json({ error: 'Username, email, or password is incorrect.' }, 401);
  }
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  await env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').bind(token, row.id, expires).run();
  return json({ token, user: publicUser(row) });
}

async function userFromRequest(request, env) {
  const token = bearer(request);
  if (!token) return null;
  const session = await env.DB.prepare(
    `SELECT users.id, users.name, users.email, users.username
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.token = ? AND sessions.expires_at > ?`,
  )
    .bind(token, new Date().toISOString())
    .first();
  return session ? { token, user: publicUser(session) } : null;
}

async function issueChallenge(env) {
  await env.DB.prepare('DELETE FROM used_challenges WHERE expires_at <= ?').bind(new Date().toISOString()).run();
  const captcha = createCaptcha();
  const payload = {
    id: randomBytes(12).toString('hex'),
    issuedAt: Date.now(),
    answerHash: hashAnswer(captcha.code),
  };
  return { token: sign(env, payload), image: captcha.image };
}

async function checkRegistrationGuard(env, body) {
  if (!env.CAPTCHA_SECRET) return 'Captcha is not configured.';
  const honeypot = String(body?.website ?? '').trim();
  if (honeypot) return 'Registration could not be completed.';
  const token = String(body?.challengeToken ?? '');
  const answer = String(body?.challengeAnswer ?? '').trim();
  const payload = readChallenge(env, token);
  if (!payload) return 'The captcha expired. Load a new image.';
  const age = Date.now() - payload.issuedAt;
  if (age < 1500) return 'Wait a moment, then submit the captcha again.';
  if (age > 10 * 60 * 1000) return 'The captcha expired. Load a new image.';
  if (!answer) return 'Type the characters shown in the image.';
  if (!sameHash(hashAnswer(answer), payload.answerHash)) return 'Those characters do not match the image.';
  const used = await env.DB.prepare('SELECT id FROM used_challenges WHERE id = ?').bind(payload.id).first();
  if (used) return 'The captcha expired. Load a new image.';
  await env.DB.prepare('INSERT INTO used_challenges (id, expires_at) VALUES (?, ?)').bind(payload.id, new Date(Date.now() + 10 * 60 * 1000).toISOString()).run();
  return '';
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return `sha256:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [kind, salt, hash] = String(stored).split(':');
  if (kind !== 'sha256' || !salt || !hash) return false;
  const actual = createHash('sha256').update(`${salt}:${password}`).digest('hex');
  return sameHash(actual, hash);
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, username: row.username ?? null };
}

function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

function isSnapshot(value) {
  return Boolean(value && typeof value === 'object' && Array.isArray(value.incomeStreams) && Array.isArray(value.liabilities) && Array.isArray(value.paycheckCycles));
}

function bearer(request) {
  const header = request.headers.get('authorization') || '';
  return header.startsWith('Bearer ') ? header.slice(7) : '';
}

async function readJson(request) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 8_000_000) throw new Error('That request is too large.');
  return request.json();
}

function sign(env, payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', env.CAPTCHA_SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function readChallenge(env, token) {
  const [body, mac] = String(token).split('.');
  if (!body || !mac || !env.CAPTCHA_SECRET) return null;
  const expected = createHmac('sha256', env.CAPTCHA_SECRET).update(body).digest('base64url');
  if (!sameHash(mac, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload?.id || !Number.isFinite(payload.issuedAt) || typeof payload.answerHash !== 'string') return null;
    return payload;
  } catch {
    return null;
  }
}

function hashAnswer(value) {
  return createHash('sha256').update(String(value).trim().toUpperCase()).digest('hex');
}

function sameHash(actual, expected) {
  const left = Buffer.from(String(actual));
  const right = Buffer.from(String(expected));
  return left.length === right.length && timingSafeEqual(left, right);
}

function rateLimit(request, name, windowMs, max) {
  const now = Date.now();
  const key = `${name}:${request.headers.get('cf-connecting-ip') || 'local'}`;
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= max) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    return json({ error: 'Too many requests. Wait a moment and try again.' }, 429, { 'Retry-After': String(retryAfter) });
  }
  recent.push(now);
  buckets.set(key, recent);
  return null;
}

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...corsHeaders(), ...extra },
  });
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, content-type',
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
  };
}
