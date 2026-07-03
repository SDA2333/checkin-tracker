#!/usr/bin/env python3
"""签到清单 - 续期到期提醒，支持 Bark 推送，保留 OpenClaw QQ 兜底。
由 systemd timer 每天定时触发。逻辑：
- 读取所有未归档续期项，算出剩余天数
- 剩余天数 <= 该项的 remind_before_days 即纳入提醒（含已过期）
- 已过期最多再提醒 OVERDUE_GRACE_DAYS 天，之后停止
- 按紧迫度分级排序，汇总成一条消息推送
- 同一项同一天只提醒一次（state 文件去重）
"""
import datetime as dt
import json
import os
import sqlite3
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

NOTIFY_TZ = os.environ.get("CHECKIN_TZ", "Asia/Hong_Kong")
if NOTIFY_TZ:
    os.environ["TZ"] = NOTIFY_TZ
    if hasattr(time, "tzset"):
        time.tzset()

DB_PATH = os.environ.get("CHECKIN_DB", "/opt/checkin/data/checkin.db")
STATE_PATH = Path(os.environ.get("CHECKIN_NOTIFY_STATE", "/var/lib/checkin-notify/state.json"))

# Bark 推荐配置 CHECKIN_BARK_URL=https://api.day.app/<key>；多设备可用 CHECKIN_BARK_URLS 逗号分隔。
BARK_URLS_RAW = os.environ.get("CHECKIN_BARK_URLS", "")
BARK_URL = os.environ.get("CHECKIN_BARK_URL", "").rstrip("/")
BARK_KEYS_RAW = os.environ.get("CHECKIN_BARK_KEYS", "")
BARK_KEY = os.environ.get("CHECKIN_BARK_KEY", "")
BARK_ENDPOINT = os.environ.get("CHECKIN_BARK_ENDPOINT", "https://api.day.app").rstrip("/")
BARK_TITLE = os.environ.get("CHECKIN_BARK_TITLE", "签到清单续期提醒")
BARK_SUBTITLE = os.environ.get("CHECKIN_BARK_SUBTITLE", "")
BARK_GROUP = os.environ.get("CHECKIN_BARK_GROUP", "签到清单")
BARK_LEVEL = os.environ.get("CHECKIN_BARK_LEVEL", "timeSensitive")
BARK_JUMP_URL = os.environ.get("CHECKIN_BARK_JUMP_URL", "")
BARK_ICON = os.environ.get("CHECKIN_BARK_ICON", "")
BARK_TIMEOUT = int(os.environ.get("CHECKIN_BARK_TIMEOUT", "20"))

# QQ 推送目标，形如 user:<openid> 或 group:<group_openid>。Bark 未配置时才使用。
QQ_TARGET = os.environ.get("CHECKIN_QQ_TARGET", "")
OPENCLAW = os.environ.get("OPENCLAW_BIN", "/usr/bin/openclaw")
SEND_TIMEOUT = 70           # openclaw 发送超时（秒）
SEND_RETRIES = 3            # QQ 接口偶发失败，重试次数
SEND_RETRY_WAIT = 8         # 重试间隔（秒）
OVERDUE_GRACE_DAYS = 2      # 过期后再提醒几天


def today():
    return dt.date.today()


def parse_date(s):
    return dt.datetime.strptime(s, "%Y-%m-%d").date()


def load_state():
    if not STATE_PATH.exists():
        return {}
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_state(state):
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(tmp, STATE_PATH)


def now_iso():
    return dt.datetime.now().isoformat(timespec="seconds")


def fetch_renewals():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    columns = {r["name"] for r in con.execute("PRAGMA table_info(renewals)").fetchall()}
    select_cols = ["id", "name", "cycle_days", "last_renewed", "remind_before_days", "note"]
    if "current_period_end" in columns:
        select_cols.append("current_period_end")
    rows = con.execute(
        f"SELECT {', '.join(select_cols)} FROM renewals WHERE archived = 0"
    ).fetchall()
    con.close()
    return rows


def row_get(row, key, default=None):
    try:
        return row[key]
    except (IndexError, KeyError):
        return default


def compute(rows, today_d):
    """返回需要提醒的项目列表，每项含 days_left 与紧迫度。"""
    alerts = []
    for r in rows:
        try:
            current_period_end = row_get(r, "current_period_end")
            if current_period_end:
                due = parse_date(current_period_end)
            else:
                due = parse_date(r["last_renewed"]) + dt.timedelta(days=int(r["cycle_days"]))
        except Exception:
            continue
        days_left = (due - today_d).days
        remind_before = int(r["remind_before_days"])

        # 是否在提醒窗口内：临近(<=remind_before) 或 过期未超过宽限期
        if days_left < 0:
            if -days_left > OVERDUE_GRACE_DAYS:
                continue  # 过期太久，停止提醒
        elif days_left > remind_before:
            continue       # 还没到提醒窗口

        alerts.append({
            "id": r["id"],
            "name": r["name"],
            "note": r["note"] or "",
            "due": due.isoformat(),
            "days_left": days_left,
        })

    # 按紧迫度排序：剩余天数越小（越紧急/过期越久）越靠前
    alerts.sort(key=lambda a: a["days_left"])
    return alerts


def urgency_line(a):
    d = a["days_left"]
    name = a["name"]
    due = a["due"]
    note = f"（{a['note']}）" if a["note"] else ""
    if d < 0:
        return f"🔴 已过期 {-d} 天！{name}{note}  到期日 {due}"
    if d == 0:
        return f"🟠 今天到期！{name}{note}  到期日 {due}"
    if d == 1:
        return f"🟠 明天到期 {name}{note}  到期日 {due}"
    return f"🟡 还剩 {d} 天 {name}{note}  到期日 {due}"


def split_env_list(value):
    return [x.strip() for x in value.replace("\n", ",").split(",") if x.strip()]


def bark_urls():
    urls = []
    urls.extend(u.rstrip("/") for u in split_env_list(BARK_URLS_RAW))
    if BARK_URL:
        urls.append(BARK_URL)
    keys = split_env_list(BARK_KEYS_RAW)
    if BARK_KEY:
        keys.append(BARK_KEY)
    urls.extend(f"{BARK_ENDPOINT}/{key}" for key in keys)
    # 保持顺序去重，避免同一设备配了两次。
    seen = set()
    result = []
    for url in urls:
        if url not in seen:
            seen.add(url)
            result.append(url)
    return result


def notification_channel():
    if bark_urls():
        return "bark"
    if QQ_TARGET:
        return "qq"
    return ""


def build_messages(pending, today_key):
    parts = ["📅 续期提醒", ""]
    parts.extend(urgency_line(a) for a in pending)
    parts.append("")
    parts.append(f"共 {len(pending)} 项需要关注 · {today_key}")
    parts.append("👉 缴费后请到清单点「已缴费，顺延」")
    full_message = "\n".join(parts)
    bark_body = "\n".join(parts[2:])
    return full_message, BARK_TITLE, bark_body


def send_bark(title, body):
    payload = {
        "title": title,
        "body": body,
        "group": BARK_GROUP,
    }
    if BARK_SUBTITLE:
        payload["subtitle"] = BARK_SUBTITLE
    if BARK_LEVEL:
        payload["level"] = BARK_LEVEL
    if BARK_JUMP_URL:
        payload["url"] = BARK_JUMP_URL
    if BARK_ICON:
        payload["icon"] = BARK_ICON

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    errors = []
    for url in bark_urls():
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=BARK_TIMEOUT) as resp:
                text = resp.read().decode("utf-8", errors="replace")
                if resp.status < 200 or resp.status >= 300:
                    raise RuntimeError(f"HTTP {resp.status}: {text}")
                try:
                    result = json.loads(text)
                except json.JSONDecodeError:
                    result = {}
                if result.get("code") not in (None, 200):
                    raise RuntimeError(f"返回异常: {text}")
        except Exception as e:
            errors.append(str(e))
    if errors:
        raise RuntimeError("；".join(errors))
    print(f"Bark 已发送到 {len(bark_urls())} 个设备")


def send_qq(message):
    cmd = [
        OPENCLAW, "message", "send",
        "--channel", "qqbot",
        "--account", "default",
        "--target", QQ_TARGET,
        "--message", message,
        "--json",
    ]
    last_err = None
    for attempt in range(1, SEND_RETRIES + 1):
        try:
            subprocess.run(
                cmd, check=True,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                text=True, timeout=SEND_TIMEOUT,
            )
            return
        except (subprocess.CalledProcessError, subprocess.TimeoutExpired) as e:
            last_err = e
            if attempt < SEND_RETRIES:
                print(f"发送第 {attempt} 次失败，{SEND_RETRY_WAIT}s 后重试…", file=sys.stderr)
                time.sleep(SEND_RETRY_WAIT)
    raise last_err


def main():
    channel = notification_channel()
    if not channel:
        print("未配置 CHECKIN_BARK_URL/CHECKIN_BARK_KEY 或 CHECKIN_QQ_TARGET，跳过推送", file=sys.stderr)
        return 0

    today_d = today()
    today_key = today_d.isoformat()
    rows = fetch_renewals()
    alerts = compute(rows, today_d)

    state = load_state()
    last_notified = state.get("last_notified", {})  # {renewal_id: "YYYY-MM-DD"}
    last_attempted = state.get("last_attempted", {})  # {renewal_id: "YYYY-MM-DD"}

    # OpenClaw 偶发超时时可能已经排队，QQ 通道会额外用 attempted 防重复塞队列；
    # Bark 是普通 HTTP 推送，失败后允许当天手动重跑。
    pending = [
        a
        for a in alerts
        if last_notified.get(str(a["id"])) != today_key
        and (channel != "qq" or last_attempted.get(str(a["id"])) != today_key)
    ]

    if not pending:
        if alerts:
            print(f"{today_key}: 无需提醒（命中 {len(alerts)} 项，均已于今日提醒或尝试过）")
        else:
            print(f"{today_key}: 无需提醒（无到期/临期项目）")
        return 0

    message, bark_title, bark_body = build_messages(pending, today_key)

    if channel == "qq":
        for a in pending:
            last_attempted[str(a["id"])] = today_key
        state["last_attempted"] = last_attempted
        state["last_run_at"] = now_iso()
        save_state(state)

    summary = ", ".join(f"#{a['id']}:{a['name']}({a['days_left']}d,{a['due']})" for a in pending)
    print(f"{today_key}: 准备通过 {channel} 推送 {len(pending)} 项：{summary}")

    try:
        if channel == "bark":
            send_bark(bark_title, bark_body)
        else:
            send_qq(message)
    except subprocess.CalledProcessError as e:
        print(f"发送失败（已重试）: {e.stderr or e}", file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired:
        print("发送超时（已重试）", file=sys.stderr)
        return 1
    except (urllib.error.URLError, TimeoutError, RuntimeError) as e:
        print(f"Bark 发送失败: {e}", file=sys.stderr)
        return 1

    # 记录今天已提醒
    for a in pending:
        last_notified[str(a["id"])] = today_key
    state["last_notified"] = last_notified
    state["last_sent_at"] = now_iso()
    save_state(state)

    print(f"{today_key}: 已推送 {len(pending)} 项")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
