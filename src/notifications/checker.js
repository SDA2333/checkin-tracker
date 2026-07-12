// 续期检查逻辑
import db from '../db.js';
import { addDays, daysBetween, isoToday } from '../dates.js';
import { sendBark } from './bark.js';
import { getSettings, logNotification, getNotifiedToday } from './history.js';

const OVERDUE_GRACE_DAYS = 2; // 过期后再提醒几天
let activeCheck = null;

/**
 * 计算单个续期项的提醒信息
 */
function computeAlert(renewal, today) {
  const due = renewal.current_period_end || addDays(renewal.last_renewed, renewal.cycle_days);
  const daysLeft = daysBetween(today, due);

  // 不在提醒窗口内
  if (daysLeft > renewal.remind_before_days) return null;

  // 过期超过宽限期，停止提醒
  if (daysLeft < -OVERDUE_GRACE_DAYS) return null;

  return {
    id: renewal.id,
    name: renewal.name,
    note: renewal.note || '',
    due,
    daysLeft,
  };
}

/**
 * 生成紧迫度文本
 */
function urgencyLine(alert) {
  const { daysLeft, name, note, due } = alert;
  const noteText = note ? `（${note}）` : '';

  if (daysLeft < 0) {
    return `🔴 已过期 ${-daysLeft} 天！${name}${noteText}  到期日 ${due}`;
  }
  if (daysLeft === 0) {
    return `🟠 今天到期！${name}${noteText}  到期日 ${due}`;
  }
  if (daysLeft === 1) {
    return `🟠 明天到期 ${name}${noteText}  到期日 ${due}`;
  }
  return `🟡 还剩 ${daysLeft} 天 ${name}${noteText}  到期日 ${due}`;
}

/**
 * 构建推送消息
 */
function buildMessage(alerts, today) {
  const lines = alerts.map(urgencyLine);
  const body = [
    ...lines,
    '',
    `共 ${alerts.length} 项需要关注 · ${today}`,
    '👉 缴费后请到清单点「已缴费，顺延」',
  ].join('\n');

  return body;
}

/**
 * 检查并推送续期提醒
 * @returns {Promise<Object>} 推送结果
 */
async function runCheckAndNotify() {
  const today = isoToday();

  // 获取所有未归档的续期项
  const renewals = db
    .prepare(
      `SELECT id, name, note, cycle_days, last_renewed, current_period_end, remind_before_days
       FROM renewals
       WHERE archived = 0`
    )
    .all();

  // 计算需要提醒的项目
  const alerts = renewals.map((r) => computeAlert(r, today)).filter((a) => a !== null);

  // 按紧迫度排序（剩余天数越小越靠前）
  alerts.sort((a, b) => a.daysLeft - b.daysLeft);

  // 过滤今天已提醒的项目
  const notifiedToday = getNotifiedToday(today);
  const pending = alerts.filter((a) => !notifiedToday.has(a.id));

  if (pending.length === 0) {
    const msg =
      alerts.length > 0
        ? `${today}: 无需提醒（命中 ${alerts.length} 项，均已于今日提醒过）`
        : `${today}: 无需提醒（无到期/临期项目）`;
    console.log(msg);
    return { success: true, message: msg, alerts: [], pending: [] };
  }

  // 获取推送配置
  const config = getSettings();

  if (!config.urls || config.urls.length === 0) {
    const msg = '未配置 Bark URL，跳过推送';
    console.log(msg);
    return { success: false, message: msg, alerts, pending };
  }

  // 构建推送消息
  const body = buildMessage(pending, today);
  const summary = pending.map((a) => `#${a.id}:${a.name}(${a.daysLeft}d,${a.due})`).join(', ');

  console.log(`${today}: 准备推送 ${pending.length} 项：${summary}`);

  try {
    const results = await sendBark(config, config.title, body);

    const successCount = results.filter((r) => r.success).length;
    console.log(`${today}: Bark 已发送到 ${successCount}/${results.length} 个设备`);

    // 记录推送日志
    logNotification({
      date: today,
      items: pending,
      status: 'success',
      results,
    });

    return {
      success: true,
      message: `已推送 ${pending.length} 项到 ${successCount} 个设备`,
      alerts,
      pending,
      results,
    };
  } catch (err) {
    console.error(`${today}: 推送失败: ${err.message}`);

    // 记录失败日志
    logNotification({
      date: today,
      items: pending,
      status: 'failed',
      error: err.message,
    });

    return {
      success: false,
      message: `推送失败: ${err.message}`,
      alerts,
      pending,
      error: err.message,
    };
  }
}

export function checkAndNotify() {
  if (activeCheck) return activeCheck;
  activeCheck = runCheckAndNotify().finally(() => {
    activeCheck = null;
  });
  return activeCheck;
}
