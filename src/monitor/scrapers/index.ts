import type { StockScraper } from "./base.ts";
import { hrananetuScraper } from "./hrananetu.ts";
import { cardstoreScraper } from "./cardstore.ts";
import { cdmcScraper } from "./cdmc.ts";
import { xzoneScraper } from "./xzone.ts";

const registry: StockScraper[] = [hrananetuScraper, cardstoreScraper, cdmcScraper, xzoneScraper];

export function getScraperForUrl(url: string): StockScraper | null {
  try {
    const hostname = new URL(url).hostname;
    return registry.find((s) => s.hostPattern.test(hostname)) ?? null;
  } catch {
    return null;
  }
}

export function getStoreNameForUrl(url: string): string | null {
  return getScraperForUrl(url)?.storeName ?? null;
}
