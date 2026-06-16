// 纯日期（YYYY-MM-DD）运算，使用 UTC 避免时区误差。
function parse(s) {
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

// 服务器本地当天（仅作默认值，客户端通常会传自己的本地日期）
export function isoToday() {
  return new Date().toISOString().slice(0, 10);
}

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
