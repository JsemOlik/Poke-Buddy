import { parse } from "node-html-parser";
import type { StockScraper, ScrapeResult } from "./base.ts";
import { fetchHtml } from "./base.ts";

export const xzoneScraper: StockScraper = {
  storeName: "xzone",
  hostPattern: /xzone\.cz$/,

  async scrape(url: string): Promise<ScrapeResult> {
    const html = await fetchHtml(url);
    const root = parse(html);

    const label = root.querySelector("h1")?.text.trim() ?? url;

    // Schema.org availability: <span itemprop="availability">InStock</span>
    const availText = root
      .querySelector('span[itemprop="availability"]')
      ?.text.trim().toLowerCase() ?? "";
    const inStock = availText === "instock";

    // "Skladem 1 ks" → strip leading "Skladem" → "1 ks"
    const stockText = root
      .querySelector(".dostupnost_holder .green_text.b a")
      ?.text.trim() ?? "";
    const stockAmount = stockText.replace(/^skladem\s*/i, "").trim() || undefined;

    // Price text is already formatted ("1 799"), currency span has "Kč"
    const priceValue = root.querySelector('span[itemprop="price"]')?.text.trim();
    const price = priceValue ? `${priceValue} Kč` : undefined;

    return { inStock, label, price, stockAmount };
  },
};
