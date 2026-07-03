// 设置相关 API
import { Router } from 'express';
import { getSettings, updateSettings, getNotificationHistory } from '../notifications/history.js';
import { sendBark } from '../notifications/bark.js';
import { checkAndNotify } from '../notifications/checker.js';
import { getSchedulerStatus } from '../notifications/scheduler.js';

const router = Router();

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

    // 验证 Bark URLs
    if (updates.urls) {
      if (!Array.isArray(updates.urls)) {
        return res.status(400).json({ error: 'urls 必须是数组' });
      }
      // 过滤空字符串
      updates.urls = updates.urls.filter((url) => url && url.trim());
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
    const limit = parseInt(req.query.limit) || 30;
    const history = getNotificationHistory(limit);
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
