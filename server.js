// 服务入口：静态资源 + 登录 + 受保护的 API
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
// 走 HTTPS（反向代理/Cloudflare）时设为 true：Cookie 仅在加密连接下发送
const SECURE_COOKIE = String(process.env.SECURE_COOKIE || '').toLowerCase() === 'true';
// 反向代理后面时设为代理层数（如 1），让限速能识别真实客户端 IP
const TRUST_PROXY = process.env.TRUST_PROXY;

const app = express();
if (TRUST_PROXY) app.set('trust proxy', Number(TRUST_PROXY) || 1);

// 安全响应头（允许内联脚本/样式，因登录页用了内联脚本、卡片用了内联样式）
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
      },
    },
  })
);

app.use(express.json({ limit: '64kb' })); // 限制请求体大小，防滥用
app.use(cookieParser());

// 登录限速：5 分钟内最多 10 次尝试，防暴力破解
const loginLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: '尝试次数过多，请 5 分钟后再试' },
});

// ---- 登录相关（无需鉴权）----
app.post('/api/login', loginLimiter, (req, res) => {
  if (authDisabled) return res.json({ ok: true });
  if (!checkPassword((req.body || {}).password))
    return res.status(401).json({ error: '密码错误' });
  res.cookie(cookieName, makeToken(), {
    httpOnly: true,
    sameSite: 'lax',
    secure: SECURE_COOKIE,
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
