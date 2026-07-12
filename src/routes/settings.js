// 设置相关 API
import { Router } from 'express';
import { getSettings, updateSettings, getNotificationHistory } from '../notifications/history.js';
import { sendBark } from '../notifications/bark.js';
import { checkAndNotify } from '../notifications/checker.js';
import { getSchedulerStatus } from '../notifications/scheduler.js';

const router = Router();
const LEVELS = new Set(['active', 'timeSensitive', 'passive']);
const ALLOWED_KEYS = new Set(['urls', 'group', 'level', 'icon', 'jumpUrl', 'title']);

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * GET /api/settings - 获取推送配置
 */
router.get('/', (req, res) => {
  try {
    const config = getSettings();
    const status = getSchedulerStatus();
    res.json({ ...config, scheduler: status });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * PUT /api/settings - 更新推送配置
 */
router.put('/', (req, res) => {
  try {
    const updates = req.body;
    if (!updates || typeof updates !== 'object' || Array.isArray(updates)) {
      return res.status(400).json({ error: '请求体必须是配置对象' });
    }
    const unknown = Object.keys(updates).find((key) => !ALLOWED_KEYS.has(key));
    if (unknown) return res.status(400).json({ error: `不支持的配置项: ${unknown}` });

    // 验证 Bark URLs
    if (updates.urls !== undefined) {
      if (!Array.isArray(updates.urls)) {
        return res.status(400).json({ error: 'urls 必须是数组' });
      }
      if (updates.urls.some((url) => typeof url !== 'string')) {
        return res.status(400).json({ error: '每个 Bark URL 都必须是字符串' });
      }
      // 过滤空字符串
      updates.urls = updates.urls.map((url) => url.trim()).filter(Boolean);
      if (updates.urls.length > 10) return res.status(400).json({ error: 'Bark URL 最多配置 10 个' });
      if (updates.urls.some((url) => !isHttpUrl(url)))
        return res.status(400).json({ error: 'Bark URL 必须是有效的 HTTP(S) 地址' });
    }
    for (const key of ['group', 'icon', 'jumpUrl', 'title']) {
      if (updates[key] !== undefined && typeof updates[key] !== 'string')
        return res.status(400).json({ error: `${key} 必须是字符串` });
      if (typeof updates[key] === 'string') updates[key] = updates[key].trim();
      if (updates[key]?.length > 500) return res.status(400).json({ error: `${key} 过长` });
    }
    if (updates.level !== undefined && !LEVELS.has(updates.level))
      return res.status(400).json({ error: 'level 配置无效' });
    for (const key of ['icon', 'jumpUrl']) {
      if (updates[key] && !isHttpUrl(updates[key]))
        return res.status(400).json({ error: `${key} 必须是有效的 HTTP(S) 地址` });
    }

    updateSettings(updates);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/settings/test - 发送测试推送
 */
router.post('/test', async (req, res) => {
  try {
    const config = getSettings();

    if (!config.urls || config.urls.length === 0) {
      return res.status(400).json({ error: '未配置 Bark URL' });
    }

    const now = new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' });
    const testMessage =
      '🔔 这是一条测试消息\n\n' +
      '如果你收到了这条通知，说明 Bark 推送配置成功！\n\n' +
      `测试时间：${now}`;

    const results = await sendBark(config, '签到清单 - 推送测试', testMessage);

    const successCount = results.filter((r) => r.success).length;

    res.json({
      ok: true,
      sent_to: successCount,
      total: results.length,
      results,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/settings/check-now - 立即检查并推送续期提醒
 */
router.post('/check-now', async (req, res) => {
  try {
    const result = await checkAndNotify();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/settings/history - 获取推送历史
 */
router.get('/history', (req, res) => {
  try {
    const parsed = Number.parseInt(req.query.limit, 10);
    const limit = Number.isSafeInteger(parsed) ? Math.min(Math.max(parsed, 1), 100) : 30;
    const history = getNotificationHistory(limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
