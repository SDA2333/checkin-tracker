// Bark 推送封装
/**
 * 发送 Bark 推送通知
 * @param {Object} config - 推送配置
 * @param {string[]} config.urls - Bark URL 列表
 * @param {string} config.group - 通知分组
 * @param {string} config.level - 优先级 (active | timeSensitive | passive)
 * @param {string} config.icon - 图标 URL
 * @param {string} config.jumpUrl - 点击跳转 URL
 * @param {string} title - 推送标题
 * @param {string} body - 推送内容
 * @returns {Promise<Array>} 推送结果列表
 */
export async function sendBark(config, title, body) {
  const { urls, group, level, icon, jumpUrl } = config;

  if (!urls || urls.length === 0) {
    throw new Error('未配置 Bark URL');
  }

  const payload = {
    title,
    body,
    group: group || '签到清单',
    level: level || 'timeSensitive',
  };

  if (icon) payload.icon = icon;
  if (jumpUrl) payload.url = jumpUrl;

  const results = [];

  for (const url of urls) {
    let timeoutId;
    try {
      const controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), 20000);

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await res.text();
      let result = {};
      try {
        result = JSON.parse(text);
      } catch {
        // Bark 返回可能不是标准 JSON
      }

      if (!res.ok || (result.code && result.code !== 200)) {
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
      }

      // Bark URL 通常包含设备密钥，不写入响应或历史日志。
      results.push({ success: true, response: result });
    } catch (err) {
      const message = err?.name === 'AbortError' ? '请求超时' : String(err?.message || err).slice(0, 500);
      results.push({ success: false, error: message });
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  }

  const successCount = results.filter((r) => r.success).length;
  if (successCount === 0) {
    throw new Error('所有设备推送均失败: ' + results.map((r) => r.error).join('; '));
  }

  return results;
}
