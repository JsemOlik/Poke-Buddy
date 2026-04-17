import { parse } from "node-html-parser";
import type { StockScraper, ScrapeResult } from "./base.ts";
import { ensureChromium } from "../browser.ts";
import { openPage } from "../cdp.ts";

const OUT_OF_STOCK_PHRASES = ["není skladem", "nedostupné", "vyprodáno"];

export const alzaScraper: StockScraper = {
  storeName: "alza",
  hostPattern: /alza\.cz$/,

  async scrape(url: string): Promise<ScrapeResult> {
    console.log(`[alza] Scraping ${url}`);
    await ensureChromium();
    const page = await openPage();

    try {
      console.log(`[alza] Navigating...`);
      await page.goto(url, 20_000);
      console.log(`[alza] Page loaded, waiting for availability element`);

      try {
        await page.waitForSelector('button[data-testid*="availabilityText"]', 15_000);
      } catch {
        console.log(`[alza] Availability selector timed out, parsing raw content`);
      }

      const html = await page.content();
      const root = parse(html);

      const label = root.querySelector("h1")?.text.trim() ?? url;

      const availBtn = root.querySelector('button[data-testid*="availabilityText"]');
      const availText = availBtn?.text.trim().toLowerCase() ?? "";
      const inStock =
        availText.length > 0 &&
        availText.includes("skladem") &&
        !OUT_OF_STOCK_PHRASES.some((p) => availText.includes(p));

      const rawAvail = availBtn?.text.trim() ?? "";
      const stockAmount = rawAvail.replace(/^skladem\s*/i, "").trim() || undefined;

      const priceText = root.querySelector(".ads-pb__price-value")?.text.trim();
      const price = priceText ? `${priceText} Kč` : undefined;

      console.log(`[alza] Done — inStock=${inStock}, label="${label}"`);
      return { inStock, label, price, stockAmount };
    } finally {
      await page.close();
    }
  },
};
