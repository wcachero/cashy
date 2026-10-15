import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createCaptcha } from './captcha.mjs';

const secret = randomBytes(32);
const usedChallenges = new Map();
const buckets = new Map();

export function rateLimit({ windowMs, max, name }) {
  return (req, res, next) => {
    const now = Date.now();
    const key = `${name}:${clientKey(req)}`;
    const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (recent.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests. Wait a moment and try again.' });
    }
    recent.push(now);
    buckets.set(key, recent);
    next();
  };
}

export function loginRateLimit(req, res, next) {
  const login = String(req.body?.login ?? req.body?.email ?? '')
    .trim()
    .toLowerCase();
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const key = `login:${clientKey(req)}:${login}`;
  const recent = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (recent.length >= 8) {
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - recent[0])) / 1000));
    res.set('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'Too many sign-in attempts. Wait a moment and try again.' });
  }
  recent.push(now);
  buckets.set(key, recent);
  next();
}

export function issueChallenge() {
  pruneChallenges();
  const captcha = createCaptcha();
  const payload = {
    id: randomBytes(12).toString('hex'),
    issuedAt: Date.now(),
    answerHash: hashAnswer(captcha.code),
  };
  return {
    token: sign(payload),
    image: captcha.image,
  };
}

export function checkRegistrationGuard(body) {
  const honeypot = String(body?.website ?? '').trim();
  if (honeypot) return 'Registration could not be completed.';
  const token = String(body?.challengeToken ?? '');
  const answer = String(body?.challengeAnswer ?? '').trim();
  const payload = readChallenge(token);
  if (!payload) return 'The captcha expired. Load a new image.';
  const age = Date.now() - payload.issuedAt;
  if (age < 1500) return 'Wait a moment, then submit the captcha again.';
  if (age > 10 * 60 * 1000) return 'The captcha expired. Load a new image.';
  if (!answer) return 'Type the characters shown in the image.';
  if (!sameHash(hashAnswer(answer), payload.answerHash)) return 'Those characters do not match the image.';
  if (usedChallenges.has(payload.id)) return 'The captcha expired. Load a new image.';
  usedChallenges.set(payload.id, Date.now() + 10 * 60 * 1000);
  return '';
}

function clientKey(req) {
  return req.ip || req.socket?.remoteAddress || 'local';
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function readChallenge(token) {
  const [body, mac] = String(token).split('.');
  if (!body || !mac) return null;
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  const actual = Buffer.from(mac);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) return null;
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
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function pruneChallenges() {
  const now = Date.now();
  for (const [id, expires] of usedChallenges) {
    if (expires <= now) usedChallenges.delete(id);
  }
}
