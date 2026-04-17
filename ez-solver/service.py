"""
Cloudflare Turnstile Solver Service
------------------------------------
Listens on http://0.0.0.0:8191 (or PORT env var).

POST /solve
  Body (JSON): {"sitekey": "...", "siteurl": "https://example.com"}
  Response:    {"token": "...", "elapsed": 4.23}
               {"error": "..."} on failure


made by ismoiloff
"""


import os
import platform
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer
from socketserver import ThreadingMixIn
from typing import Optional
import json

import asyncio as _asyncio
import nodriver as uc
from solver import solve, _find_chrome, _get_profile_dir


PORT = int(os.environ.get("PORT", 8191))
# On Linux (Docker), Chrome requires --no-sandbox when running as root
EXTRA_CHROME_ARGS = ["--no-sandbox", "--disable-dev-shm-usage"] if platform.system() == "Linux" else []
MAX_WORKERS = int(os.environ.get("MAX_WORKERS", 4))

_worker_sem = threading.Semaphore(MAX_WORKERS)
_active_count = 0
_queued_count = 0
_count_lock = threading.Lock()

# --- Persistent browser for /fetch ---
# One Chrome window stays open; each request opens a new tab, scrapes, and
# closes it. An asyncio Lock serialises tabs so only one runs at a time.
_fetch_loop = _asyncio.new_event_loop()
_fetch_browser: Optional[uc.Browser] = None
_fetch_lock: Optional[_asyncio.Lock] = None


def _run_fetch_loop(loop: _asyncio.AbstractEventLoop) -> None:
    _asyncio.set_event_loop(loop)
    loop.run_forever()


threading.Thread(target=_run_fetch_loop, args=(_fetch_loop,), daemon=True).start()


async def _fetch_url(url: str, wait: float) -> str:
    global _fetch_browser, _fetch_lock

    # Lock must be created on the fetch loop's thread
    if _fetch_lock is None:
        _fetch_lock = _asyncio.Lock()

    async with _fetch_lock:
        # (Re)start browser if needed
        if _fetch_browser is None:
            print("[fetch] Starting persistent Chrome browser")
            _fetch_browser = await uc.start(
                browser_executable_path=_find_chrome(),
                headless=False,
                user_data_dir=_get_profile_dir(),
                browser_args=EXTRA_CHROME_ARGS,
            )

        try:
            page = await _fetch_browser.get(url, new_tab=True)
            try:
                for _ in range(int(wait / 0.5)):
                    content = await page.get_content()
                    if "availabilityText" in content or "ads-pb__price" in content or "buyBox-price" in content:
                        await _asyncio.sleep(3)
                        return await page.get_content()
                    await _asyncio.sleep(0.5)
                return await page.get_content()
            finally:
                await page.close()
        except Exception:
            # Browser may have crashed — reset so the next call restarts it
            _fetch_browser = None
            raise


class ThreadedHTTPServer(ThreadingMixIn, HTTPServer):
    """Handle each request in its own thread so solves don't block each other."""
    daemon_threads = True


def _ensure_display() -> Optional[subprocess.Popen]:
    """On Linux headless servers, start a virtual display so Chrome can run."""
    if platform.system() != "Linux":
        return None
    if os.environ.get("DISPLAY"):
        return None
    xvfb = subprocess.Popen(
        ["Xvfb", ":99", "-screen", "0", "1280x900x24"],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    os.environ["DISPLAY"] = ":99"
    time.sleep(0.5)
    print("[service] started Xvfb on :99")
    return xvfb


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):  # suppress default access log noise
        print(f"[service] {self.address_string()} - {fmt % args}")

    def send_json(self, code: int, data: dict):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path not in ("/solve", "/fetch"):
            self.send_json(404, {"error": "not found — use POST /solve or POST /fetch"})
            return

        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)

        try:
            payload = json.loads(raw)
        except json.JSONDecodeError:
            self.send_json(400, {"error": "invalid JSON"})
            return

        sitekey = payload.get("sitekey", "").strip()
        siteurl = payload.get("siteurl", "").strip()
        timeout = int(payload.get("timeout", 45))

        if self.path == "/fetch":
            url = payload.get("url", "").strip()
            if not url:
                self.send_json(400, {"error": "url is required"})
                return
            wait = float(payload.get("wait", 6))

            try:
                future = _asyncio.run_coroutine_threadsafe(
                    _fetch_url(url, wait), _fetch_loop
                )
                html = future.result(timeout=120)
                self.send_json(200, {"html": html})
            except Exception as exc:
                self.send_json(500, {"error": str(exc)})
            return

        if not sitekey or not siteurl:
            self.send_json(400, {"error": "sitekey and siteurl are required"})
            return

        global _active_count, _queued_count

        with _count_lock:
            _queued_count += 1
        print(f"[service] queued — sitekey={sitekey!r} url={siteurl!r} "
              f"(active={_active_count}/{MAX_WORKERS} queued={_queued_count})")

        # Block until a worker slot is free — other threads keep running
        _worker_sem.acquire()

        with _count_lock:
            _queued_count -= 1
            _active_count += 1

        t0 = time.time()
        try:
            print(f"[service] solving sitekey={sitekey!r} url={siteurl!r} "
                  f"(active={_active_count}/{MAX_WORKERS})")
            token = solve(sitekey, siteurl, timeout=timeout)
            elapsed = round(time.time() - t0, 2)
            print(f"[service] solved in {elapsed}s  token={token[:20]}...")
            self.send_json(200, {"token": token, "elapsed": elapsed})
        except Exception as exc:
            elapsed = round(time.time() - t0, 2)
            print(f"[service] error after {elapsed}s: {exc}")
            self.send_json(500, {"error": str(exc)})
        finally:
            with _count_lock:
                _active_count -= 1
            _worker_sem.release()

    def do_GET(self):
        if self.path == "/health":
            with _count_lock:
                self.send_json(200, {
                    "status": "ok",
                    "workers": MAX_WORKERS,
                    "active": _active_count,
                    "queued": _queued_count,
                })
        else:
            self.send_json(404, {"error": "use POST /solve"})


if __name__ == "__main__":
    xvfb_proc = _ensure_display()
    server = ThreadedHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"[service] Turnstile solver service running on http://0.0.0.0:{PORT}")
    print(f"[service] worker pool: {MAX_WORKERS} concurrent Chrome instances "
          f"(set MAX_WORKERS env var to change)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[service] shutting down")
        server.server_close()
        if xvfb_proc:
            xvfb_proc.terminate()
