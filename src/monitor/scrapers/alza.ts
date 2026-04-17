import { parse } from "node-html-parser";
import type { StockScraper, ScrapeResult } from "./base.ts";
import { getBrowser } from "../browser.ts";

const OUT_OF_STOCK_PHRASES = ["není skladem", "nedostupné", "vyprodáno"];

export const alzaScraper: StockScraper = {
  storeName: "alza",
  hostPattern: /alza\.cz$/,

  async scrape(url: string): Promise<ScrapeResult> {
    console.log(`[alza] Launching browser for ${url}`);
    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["image", "font", "media", "stylesheet"].includes(type)) {
          route.abort();
        } else {
          route.continue();
        }
      });

      console.log(`[alza] goto ${url}`);
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20_000 });
      console.log(`[alza] page loaded, waiting for availability element`);

      // Non-fatal: if element doesn't appear in time, parse whatever content we have
      try {
        await page.waitForSelector('button[data-testid*="availabilityText"]', { timeout: 8_000 });
      } catch {
        console.log(`[alza] availability selector timed out, parsing raw content`);
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

      console.log(`[alza] done — inStock=${inStock}, label="${label}"`);
      return { inStock, label, price, stockAmount };
    } finally {
      await page.close();
    }
  },
};
