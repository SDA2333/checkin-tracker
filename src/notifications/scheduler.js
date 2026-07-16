// 定时任务调度器
import cron from 'node-cron';
import { checkAndNotify } from './checker.js';
import { businessTimeZone } from '../dates.js';

let schedulerTask = null;

/**
 * 启动定时调度器
 * 默认每天业务时区 09:00 检查续期提醒
 */
export function startScheduler() {
  if (schedulerTask) {
    console.log('[scheduler] 调度器已在运行中');
    return;
  }

  const timezone = businessTimeZone();
  // 每天 09:00（业务时区）
  schedulerTask = cron.schedule(
    '0 9 * * *',
    async () => {
      console.log('[scheduler] 开始检查续期提醒');
      try {
        await checkAndNotify();
      } catch (err) {
        console.error('[scheduler] 检查失败:', err.message);
      }
    },
    {
      timezone,
      name: 'renewal-reminders',
      noOverlap: true,
    }
  );

  console.log(`[scheduler] 续期提醒调度器已启动 (每天 09:00 · ${timezone})`);
}

/**
 * 停止定时调度器
 */
export function stopScheduler() {
  if (schedulerTask) {
    schedulerTask.destroy();
    schedulerTask = null;
    console.log('[scheduler] 续期提醒调度器已停止');
  }
}

/**
 * 获取调度器状态
 */
export function getSchedulerStatus() {
  const timezone = businessTimeZone();
  return {
    running: schedulerTask !== null,
    schedule: `每天 09:00 (${timezone})`,
    timezone,
  };
}
