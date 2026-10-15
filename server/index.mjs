import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { openDatabase, readPlan, replacePlan } from './db.mjs';
import { checkRegistrationGuard, issueChallenge, loginRateLimit, rateLimit } from './guard.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dbPath = path.join(root, 'data', 'cutoff.sqlite');
const db = openDatabase(dbPath);
const app = express();
const port = Number(process.env.PORT || 3333);

app.use(express.json({ limit: '8mb' }));
app.use('/api', rateLimit({ windowMs: 60_000, max: 300, name: 'api' }));

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 32);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, username: row.username ?? null };
}

function userFromRequest(req) {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return null;
  const session = db
    .prepare(
      `SELECT users.id, users.name, users.email, users.username
       FROM sessions
       JOIN users ON users.id = sessions.user_id
       WHERE sessions.token = ? AND sessions.expires_at > ?`,
    )
    .get(token, new Date().toISOString());
  return session ? { token, user: publicUser(session) } : null;
}

function requireUser(req, res) {
  const session = userFromRequest(req);
  if (!session) {
    res.status(401).json({ error: 'Sign in required.' });
    return null;
  }
  return session;
}

function isSnapshot(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      Array.isArray(value.incomeStreams) &&
      Array.isArray(value.liabilities) &&
      Array.isArray(value.paycheckCycles),
  );
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, database: dbPath });
});

app.get('/api/auth/challenge', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, name: 'challenge' }), (_req, res) => {
  res.json(issueChallenge());
});

app.post('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 5, name: 'register' }), (req, res) => {
  const guardError = checkRegistrationGuard(req.body);
  if (guardError) return res.status(400).json({ error: guardError });

  const name = String(req.body?.name ?? '').trim();
  const username = normalizeUsername(req.body?.username);
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (name.length < 2) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(username)) {
    return res.status(400).json({ error: 'Username must be 3–24 characters and use letters, numbers, or underscores.' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (password.length < 6) return res.status(400).json({ error: 'Use at least 6 characters for the password.' });

  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existingEmail) return res.status(409).json({ error: 'That email is already registered.' });
  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUsername) return res.status(409).json({ error: 'That username is already taken.' });

  const emptyPlan = {
    version: 1,
    incomeStreams: [],
    liabilities: [],
    paycheckCycles: [],
    notificationsEnabled: false,
    bankSavings: [],
    receivables: [],
  };

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
  const create = db.transaction(() => {
    db.prepare('INSERT INTO users (id, name, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      user.id,
      user.name,
      user.email,
      user.username,
      user.password_hash,
      user.created_at,
    );
    db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, user.id, expires);
    replacePlan(db, user.id, emptyPlan);
  });
  create();
  res.status(201).json({ token, user: publicUser(user) });
});

app.post('/api/auth/login', loginRateLimit, (req, res) => {
  const login = String(req.body?.login ?? req.body?.email ?? '').trim();
  const password = String(req.body?.password ?? '');
  const row = login.includes('@')
    ? db.prepare('SELECT id, name, email, username, password_hash FROM users WHERE email = ?').get(login.toLowerCase())
    : db.prepare('SELECT id, name, email, username, password_hash FROM users WHERE username = ?').get(login.toLowerCase());
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Username, email, or password is incorrect.' });
  }
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, row.id, expires);
  res.json({ token, user: publicUser(row) });
});

app.get('/api/auth/me', (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  res.json({ user: session.user });
});

app.post('/api/auth/logout', (req, res) => {
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.json({ ok: true });
});

app.get('/api/plan', (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  const snapshot = readPlan(db, session.user.id);
  if (!snapshot) return res.status(404).json({ error: 'No plan is saved for this account.' });
  res.json(snapshot);
});

app.put('/api/plan', (req, res) => {
  const session = requireUser(req, res);
  if (!session) return;
  if (!isSnapshot(req.body)) return res.status(400).json({ error: 'That plan file is missing income, liabilities, or cutoffs.' });
  try {
    replacePlan(db, session.user.id, req.body);
  } catch (error) {
    if (error?.code === 'STALE_PLAN') return res.status(409).json({ error: 'A newer plan was already saved.' });
    throw error;
  }
  res.json({ ok: true });
});

function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase();
}

app.listen(port, '127.0.0.1', () => {
  console.log(`CashBii API listening on http://127.0.0.1:${port}`);
  console.log(`SQLite database: ${dbPath}`);
});
