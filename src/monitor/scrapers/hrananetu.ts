import { parse } from "node-html-parser";
import type { StockScraper, ScrapeResult } from "./base.ts";
import { fetchHtml } from "./base.ts";

export const hrananetuScraper: StockScraper = {
  storeName: "hrananetu",
  hostPattern: /hrananetu\.cz$/,

  async scrape(url: string): Promise<ScrapeResult> {
    const html = await fetchHtml(url);
    const root = parse(html);

    const label = root.querySelector("h1")?.text.trim() ?? url;

    // Schema.org availability — most reliable signal, unaffected by related products
    const availHref = root
      .querySelector('link[itemprop="availability"]')
      ?.getAttribute("href") ?? "";
    const inStock = availHref.toLowerCase().includes("instock");

    // Schema.org price meta tags — clean numeric value + currency
    const priceValue = root
      .querySelector('meta[itemprop="price"]')
      ?.getAttribute("content");
    const price = priceValue ? `${priceValue} Kč` : undefined;

    // "(3\nks na skladě)" → "3 ks na skladě"
    const stockAmount = root
      .querySelector("em.c-mu")
      ?.text.trim()
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim() || undefined;

    return { inStock, label, price, stockAmount };
  },
};
