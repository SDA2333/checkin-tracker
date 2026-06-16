// 单人密码登录：登录后下发一个 HMAC 签名的会话 Cookie，无需数据库存会话。
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const PASSWORD = process.env.APP_PASSWORD || '';
export const authDisabled = String(process.env.AUTH_DISABLED || '').toLowerCase() === 'true';
export const cookieName = 'checkin_session';
const TOKEN_TTL_MS = 30 * 86400 * 1000; // 30 天

// 签名密钥：优先环境变量，其次持久化到 data/.secret，避免重启后登录失效
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const path = process.env.SECRET_PATH || './data/.secret';
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  mkdirSync(dirname(path), { recursive: true });
  const s = crypto.randomBytes(32).toString('hex');
  writeFileSync(path, s, { mode: 0o600 });
  return s;
}
const SECRET = loadSecret();

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function makeToken() {
  return sign({ sub: 'owner', exp: Date.now() + TOKEN_TTL_MS });
}

export function checkPassword(input) {
  if (!PASSWORD) return false;
  const a = Buffer.from(String(input));
  const b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function isAuthed(req) {
  if (authDisabled) return true;
  return !!verify(req.cookies?.[cookieName]);
}

// Express 中间件：API 未授权返回 401，页面未授权跳转登录页
export function requireAuth(req, res, next) {
  if (authDisabled) return next();
  if (verify(req.cookies?.[cookieName])) return next();
  const url = req.originalUrl || req.url || '';
  if (url.startsWith('/api/')) return res.status(401).json({ error: 'unauthorized' });
  return res.redirect('/login.html');
}
