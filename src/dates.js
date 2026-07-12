// 纯日期（YYYY-MM-DD）运算，使用 UTC 避免时区误差。
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function businessTimeZone() {
  const configured = process.env.CHECKIN_TZ || process.env.APP_TIMEZONE || 'Asia/Hong_Kong';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: configured }).format();
    return configured;
  } catch {
    console.warn(`[dates] 无效时区 ${configured}，回退到 Asia/Hong_Kong`);
    return 'Asia/Hong_Kong';
  }
}

export function isValidDate(s) {
  const value = String(s);
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}

function parse(s) {
  if (!isValidDate(s)) throw new RangeError(`无效日期: ${s}`);
  const [y, m, d] = String(s).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

// 在 dateStr 基础上加 n 天（可为负），返回 YYYY-MM-DD
export function addDays(dateStr, n) {
  const t = parse(dateStr) + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

// toStr - fromStr 的天数差（正数表示 toStr 在未来）
export function daysBetween(fromStr, toStr) {
  return Math.round((parse(toStr) - parse(fromStr)) / 86400000);
}

// 指定业务时区的当天。默认与定时提醒共用 CHECKIN_TZ。
export function isoToday(timeZone = businessTimeZone(), now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
