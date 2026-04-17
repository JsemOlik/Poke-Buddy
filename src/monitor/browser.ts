import { chromium, type Browser } from "playwright";

let _browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!_browser?.isConnected()) {
    _browser = await chromium.launch({ headless: true });
  }
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  await _browser?.close();
  _browser = null;
}
