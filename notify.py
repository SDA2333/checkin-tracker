#!/usr/bin/env python3
"""签到清单 - 续期到期提醒，通过 OpenClaw 推送 QQ。
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
from pathlib import Path

DB_PATH = os.environ.get("CHECKIN_DB", "/opt/checkin/data/checkin.db")
STATE_PATH = Path(os.environ.get("CHECKIN_NOTIFY_STATE", "/var/lib/checkin-notify/state.json"))
# QQ 推送目标，形如 user:<openid> 或 group:<group_openid>。从环境变量读取，避免硬编码隐私。
TARGET = os.environ.get("CHECKIN_QQ_TARGET", "")
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


def fetch_renewals():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    rows = con.execute(
        "SELECT id, name, cycle_days, last_renewed, remind_before_days, note "
        "FROM renewals WHERE archived = 0"
    ).fetchall()
    con.close()
    return rows


def compute(rows, today_d):
    """返回需要提醒的项目列表，每项含 days_left 与紧迫度。"""
    alerts = []
    for r in rows:
        try:
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


def send_qq(message):
    cmd = [
        OPENCLAW, "message", "send",
        "--channel", "qqbot",
        "--account", "default",
        "--target", TARGET,
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
    if not TARGET:
        print("未配置 CHECKIN_QQ_TARGET，跳过推送", file=sys.stderr)
        return 0
    today_d = today()
    today_key = today_d.isoformat()
    rows = fetch_renewals()
    alerts = compute(rows, today_d)

    state = load_state()
    last_notified = state.get("last_notified", {})  # {renewal_id: "YYYY-MM-DD"}

    # 过滤掉今天已提醒过的项
    pending = [a for a in alerts if last_notified.get(str(a["id"])) != today_key]

    if not pending:
        print(f"{today_key}: 无需提醒（命中 {len(alerts)} 项，均已于今日提醒过）")
        return 0

    parts = ["📅 续期提醒", ""]
    parts.extend(urgency_line(a) for a in pending)
    parts.append("")
    parts.append(f"共 {len(pending)} 项需要关注 · {today_key}")
    parts.append("👉 续期后请到清单点「今天已续期」")
    message = "\n".join(parts)

    try:
        send_qq(message)
    except subprocess.CalledProcessError as e:
        print(f"发送失败（已重试）: {e.stderr or e}", file=sys.stderr)
        return 1
    except subprocess.TimeoutExpired:
        print("发送超时（已重试）", file=sys.stderr)
        return 1

    # 记录今天已提醒
    for a in pending:
        last_notified[str(a["id"])] = today_key
    state["last_notified"] = last_notified
    state["last_run_at"] = dt.datetime.now().isoformat(timespec="seconds")
    save_state(state)

    print(f"{today_key}: 已推送 {len(pending)} 项")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
