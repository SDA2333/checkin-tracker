#!/usr/bin/env python3
"""DMIT stock watcher.

Polls the public stock page and sends Bark notifications when selected
products become available. No third-party dependencies are required.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import html
import json
import os
import re
import signal
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


WATCH_URL = os.environ.get("DMIT_STOCK_URL", "https://stock.dmitea.com/")
STATE_PATH = Path(os.environ.get("DMIT_STOCK_STATE", "/var/lib/dmit-stock-watch/state.json"))
INTERVAL_SECONDS = int(os.environ.get("DMIT_STOCK_INTERVAL_SECONDS", "30"))
TIMEOUT_SECONDS = int(os.environ.get("DMIT_STOCK_TIMEOUT_SECONDS", "20"))
REQUEST_USER_AGENT = os.environ.get(
    "DMIT_STOCK_USER_AGENT",
    "dmit-stock-watch/1.0 (+https://stock.dmitea.com/)",
)

TARGET_PIDS = [
    pid.strip()
    for pid in os.environ.get(
        "DMIT_STOCK_PIDS",
        "df8e9586,df8b9586,df8c9586",
    ).split(",")
    if pid.strip()
]

BARK_URLS_RAW = os.environ.get("DMIT_STOCK_BARK_URLS") or os.environ.get("CHECKIN_BARK_URLS", "")
BARK_URL = (os.environ.get("DMIT_STOCK_BARK_URL") or os.environ.get("CHECKIN_BARK_URL", "")).rstrip("/")
BARK_KEYS_RAW = os.environ.get("DMIT_STOCK_BARK_KEYS", "")
BARK_KEY = os.environ.get("DMIT_STOCK_BARK_KEY", "")
BARK_ENDPOINT = os.environ.get("DMIT_STOCK_BARK_ENDPOINT", "https://api.day.app").rstrip("/")
BARK_TITLE = os.environ.get("DMIT_STOCK_BARK_TITLE", "DMIT 有货提醒")
BARK_GROUP = os.environ.get("DMIT_STOCK_BARK_GROUP", "DMIT库存")
BARK_LEVEL = os.environ.get("DMIT_STOCK_BARK_LEVEL", "timeSensitive")
BARK_ICON = os.environ.get("DMIT_STOCK_BARK_ICON") or os.environ.get("CHECKIN_BARK_ICON", "")
BARK_TIMEOUT = int(os.environ.get("DMIT_STOCK_BARK_TIMEOUT", "20"))

STATUS_IN_STOCK = "in_stock"
STATUS_OUT_OF_STOCK = "out_of_stock"
STATUS_UNKNOWN = "unknown"

TR_RE = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.I | re.S)
NAME_RE = re.compile(r'<div\b[^>]*class="[^"]*\bproduct-name\b[^"]*"[^>]*>(.*?)</div>', re.I | re.S)
TIME_INFO_RE = re.compile(r'<div\b[^>]*class="[^"]*\btime-info\b[^"]*"[^>]*>(.*?)</div>', re.I | re.S)
LINK_RE = re.compile(r'<a\b[^>]*href="([^"]+)"[^>]*class="[^"]*\bpurchase-btn\b[^"]*"[^>]*>', re.I | re.S)
PID_RE = re.compile(r"PID:\s*([A-Za-z0-9]+)", re.I)

stop_requested = False


def log(message: str) -> None:
    now = dt.datetime.now(dt.timezone.utc).astimezone().isoformat(timespec="seconds")
    print(f"{now} {message}", flush=True)


def split_env_list(value: str) -> list[str]:
    return [part.strip() for part in value.replace("\n", ",").split(",") if part.strip()]


def bark_urls() -> list[str]:
    urls: list[str] = []
    urls.extend(url.rstrip("/") for url in split_env_list(BARK_URLS_RAW))
    if BARK_URL:
        urls.append(BARK_URL)

    keys = split_env_list(BARK_KEYS_RAW)
    if BARK_KEY:
        keys.append(BARK_KEY)
    urls.extend(f"{BARK_ENDPOINT}/{key}" for key in keys)

    result: list[str] = []
    seen: set[str] = set()
    for url in urls:
        if url not in seen:
            seen.add(url)
            result.append(url)
    return result


def url_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()[:16]


def strip_tags(value: str) -> str:
    value = re.sub(r"<script\b.*?</script>", "", value, flags=re.I | re.S)
    value = re.sub(r"<[^>]+>", " ", value)
    value = html.unescape(value)
    return re.sub(r"\s+", " ", value).strip()


def load_state() -> dict:
    try:
        return json.loads(STATE_PATH.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {"items": {}}
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"State file is not valid JSON: {STATE_PATH}: {exc}") from exc


def save_state(state: dict) -> None:
    STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    tmp = STATE_PATH.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    os.chmod(tmp, 0o640)
    os.replace(tmp, STATE_PATH)


def fetch_page() -> str:
    request = urllib.request.Request(WATCH_URL, headers={"User-Agent": REQUEST_USER_AGENT})
    with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
        charset = response.headers.get_content_charset() or "utf-8"
        return response.read().decode(charset, errors="replace")


def parse_items(page: str) -> dict[str, dict]:
    items: dict[str, dict] = {}
    for match in TR_RE.finditer(page):
        row = match.group(1)
        pid_match = PID_RE.search(strip_tags(row))
        if not pid_match:
            continue
        pid = pid_match.group(1)

        name_match = NAME_RE.search(row)
        name = strip_tags(name_match.group(1)) if name_match else pid

        if "status-in-stock" in row or "✅ 有货" in row:
            status = STATUS_IN_STOCK
        elif "status-out-of-stock" in row or "❌ 无货" in row:
            status = STATUS_OUT_OF_STOCK
        else:
            status = STATUS_UNKNOWN

        time_values = [strip_tags(value) for value in TIME_INFO_RE.findall(row)]
        checked_at = next((value for value in time_values if not value.lower().startswith("pid:")), "")

        link_match = LINK_RE.search(row)
        purchase_url = html.unescape(link_match.group(1)) if link_match else WATCH_URL

        items[pid] = {
            "pid": pid,
            "name": name,
            "status": status,
            "checked_at": checked_at,
            "purchase_url": purchase_url,
        }
    return items


def build_message(items: list[dict]) -> tuple[str, str]:
    if len(items) == 1:
        item = items[0]
        body = "\n".join(
            [
                f"✅ {item['name']}",
                f"PID: {item['pid']}",
                f"页面检查时间: {item.get('checked_at') or '未知'}",
                "",
                f"购买链接: {item.get('purchase_url') or WATCH_URL}",
            ]
        )
        return BARK_TITLE, body

    lines = ["以下产品有货：", ""]
    for item in items:
        lines.extend(
            [
                f"✅ {item['name']}",
                f"PID: {item['pid']}",
                f"页面检查时间: {item.get('checked_at') or '未知'}",
                f"购买链接: {item.get('purchase_url') or WATCH_URL}",
                "",
            ]
        )
    return BARK_TITLE, "\n".join(lines).rstrip()


def send_bark(url: str, title: str, body: str, jump_url: str) -> None:
    payload = {
        "title": title,
        "body": body,
        "group": BARK_GROUP,
    }
    if BARK_LEVEL:
        payload["level"] = BARK_LEVEL
    if BARK_ICON:
        payload["icon"] = BARK_ICON
    if jump_url:
        payload["url"] = jump_url

    data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=BARK_TIMEOUT) as response:
        text = response.read().decode("utf-8", errors="replace")
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"HTTP {response.status}: {text}")
        try:
            result = json.loads(text)
        except json.JSONDecodeError:
            result = {}
        if result.get("code") not in (None, 200):
            raise RuntimeError(f"Bark returned unexpected response: {text}")


def notify_items(items: list[dict], already_notified: set[str]) -> tuple[set[str], list[str]]:
    urls = bark_urls()
    if not urls:
        raise RuntimeError("No Bark URL configured")

    title, body = build_message(items)
    jump_url = items[0].get("purchase_url") if len(items) == 1 else WATCH_URL
    sent_ids = set(already_notified)
    errors: list[str] = []

    for url in urls:
        current_id = url_id(url)
        if current_id in sent_ids:
            continue
        try:
            send_bark(url, title, body, jump_url or WATCH_URL)
            sent_ids.add(current_id)
        except Exception as exc:  # noqa: BLE001 - log and retry failed devices next loop
            errors.append(f"{current_id}: {exc}")

    return sent_ids, errors


def reconcile_state(state: dict, current_items: dict[str, dict]) -> tuple[list[dict], dict]:
    state.setdefault("items", {})
    now = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    available_to_notify: list[dict] = []

    for pid in TARGET_PIDS:
        current = current_items.get(pid)
        item_state = state["items"].setdefault(pid, {})
        if not current:
            item_state["last_status"] = STATUS_UNKNOWN
            item_state["last_seen_at"] = now
            item_state["last_error"] = "target PID not found on page"
            continue

        previous_status = item_state.get("last_status")
        current_status = current["status"]
        item_state.update(
            {
                "name": current["name"],
                "last_status": current_status,
                "last_checked_at": current.get("checked_at", ""),
                "purchase_url": current.get("purchase_url", ""),
                "last_seen_at": now,
            }
        )
        item_state.pop("last_error", None)

        if current_status != STATUS_IN_STOCK:
            item_state["notified_url_ids"] = []
            continue

        notified_ids = set(item_state.get("notified_url_ids", []))
        if previous_status != STATUS_IN_STOCK or notified_ids != {url_id(url) for url in bark_urls()}:
            available_to_notify.append(current)

    state["last_check_at"] = now
    return available_to_notify, state


def check_once(no_notify: bool = False) -> int:
    state = load_state()
    page = fetch_page()
    parsed = parse_items(page)
    available, state = reconcile_state(state, parsed)

    summary = []
    for pid in TARGET_PIDS:
        item = parsed.get(pid)
        if item:
            summary.append(f"{pid}={item['status']}")
        else:
            summary.append(f"{pid}=missing")
    log("checked " + ", ".join(summary))

    if available and not no_notify:
        notified_by_pid: dict[str, set[str]] = {}
        for item in available:
            item_state = state["items"].setdefault(item["pid"], {})
            notified_by_pid[item["pid"]] = set(item_state.get("notified_url_ids", []))

        # Send one combined notification for every newly available product.
        common_notified = set.intersection(*notified_by_pid.values()) if notified_by_pid else set()
        sent_ids, errors = notify_items(available, common_notified)

        notified_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        for item in available:
            item_state = state["items"].setdefault(item["pid"], {})
            item_state["notified_url_ids"] = sorted(sent_ids)
            if sent_ids:
                item_state["last_notified_at"] = notified_at
            if errors:
                item_state["last_notify_error"] = "; ".join(errors)
            else:
                item_state.pop("last_notify_error", None)
        if errors:
            save_state(state)
            raise RuntimeError("Bark notification failed: " + "; ".join(errors))
        log(f"notified {len(available)} available item(s)")
    elif available and no_notify:
        log(f"dry-run: {len(available)} available item(s), notification suppressed")

    save_state(state)
    return 0


def handle_signal(signum, frame) -> None:  # noqa: ANN001
    del signum, frame
    global stop_requested
    stop_requested = True


def run_loop() -> int:
    signal.signal(signal.SIGTERM, handle_signal)
    signal.signal(signal.SIGINT, handle_signal)

    log(f"watching {WATCH_URL}; interval={INTERVAL_SECONDS}s; pids={','.join(TARGET_PIDS)}")
    while not stop_requested:
        try:
            check_once(no_notify=False)
        except (urllib.error.URLError, TimeoutError, RuntimeError, OSError) as exc:
            log(f"check failed: {exc}")
        for _ in range(INTERVAL_SECONDS):
            if stop_requested:
                break
            time.sleep(1)

    log("stopped")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch selected DMIT products and push Bark alerts.")
    parser.add_argument("--once", action="store_true", help="Run one check and exit.")
    parser.add_argument("--no-notify", action="store_true", help="Suppress notifications for this run.")
    args = parser.parse_args()

    if not TARGET_PIDS:
        print("DMIT_STOCK_PIDS is empty", file=sys.stderr)
        return 2
    if not bark_urls() and not args.no_notify:
        print("No Bark URL configured", file=sys.stderr)
        return 2

    if args.once:
        return check_once(no_notify=args.no_notify)
    return run_loop()


if __name__ == "__main__":
    raise SystemExit(main())
