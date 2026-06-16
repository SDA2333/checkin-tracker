// 服务入口：静态资源 + 登录 + 受保护的 API
import express from 'express';
import cookieParser from 'cookie-parser';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  requireAuth,
  isAuthed,
  checkPassword,
  makeToken,
  cookieName,
  authDisabled,
} from './src/auth.js';
import sitesRouter from './src/routes/sites.js';
import checkinsRouter from './src/routes/checkins.js';
import renewalsRouter from './src/routes/renewals.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(__dirname, 'public');
const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.json());
app.use(cookieParser());

// ---- 登录相关（无需鉴权）----
app.post('/api/login', (req, res) => {
  if (authDisabled) return res.json({ ok: true });
  if (!checkPassword((req.body || {}).password))
    return res.status(401).json({ error: '密码错误' });
  res.cookie(cookieName, makeToken(), {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 30 * 86400 * 1000,
  });
  res.json({ ok: true });
});

app.post('/api/logout', (req, res) => {
  res.clearCookie(cookieName);
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  res.json({ authed: isAuthed(req), authDisabled });
});

// 登录页本身不鉴权
app.get(['/login.html', '/login'], (req, res) => res.sendFile(join(PUBLIC, 'login.html')));

// ---- 受保护的 API ----
app.use('/api/sites', requireAuth, sitesRouter);
app.use('/api/checkins', requireAuth, checkinsRouter);
app.use('/api/renewals', requireAuth, renewalsRouter);

// ---- 受保护的前端页面与静态资源 ----
app.use(requireAuth, express.static(PUBLIC));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`签到清单已启动: http://0.0.0.0:${PORT}  (鉴权: ${authDisabled ? '关闭' : '开启'})`);
});
