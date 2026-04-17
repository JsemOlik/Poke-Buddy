import { chromium } from "playwright";
import type { Subprocess } from "bun";
import { join } from "path";

const CDP_PORT = 9222;
// Persist profile so cf_clearance and other cookies survive across restarts.
// On first run with CHROMIUM_VISIBLE=1 the user solves any CAPTCHAs; the
// cookie (~30 day lifetime) is saved here and reused in subsequent headless runs.
const PROFILE_DIR = join(import.meta.dir, "../../../chromium-data");
const HEADLESS = process.env.CHROMIUM_VISIBLE !== "1";

let _proc: Subprocess | null = null;
let _ensurePromise: Promise<void> | null = null;

async function waitForCDP(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      if (res.ok) return;
    } catch {}
    await Bun.sleep(200);
  }
  throw new Error("Chromium CDP endpoint did not start within 6s");
}

async function spawnChromium(): Promise<void> {
  // Already running?
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
    if (res.ok) return;
  } catch {}

  const execPath = chromium.executablePath();
  console.log(`[browser] Spawning Chromium on port ${CDP_PORT}`);

  // Use Bun.spawn — chromium.launch() hangs in Bun because Playwright's
  // Node.js child_process stderr reading is incompatible with Bun's emulation.
  _proc?.kill();
  const args = [
    execPath,
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-blink-features=AutomationControlled",
  ];
  if (HEADLESS) args.splice(1, 0, "--headless=new");

  _proc = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });

  await waitForCDP();
  console.log(`[browser] CDP ready on port ${CDP_PORT}`);
}

export async function ensureChromium(): Promise<void> {
  if (!_ensurePromise) {
    _ensurePromise = spawnChromium().finally(() => { _ensurePromise = null; });
  }
  return _ensurePromise;
}

export async function closeBrowser(): Promise<void> {
  _proc?.kill();
  _proc = null;
}
