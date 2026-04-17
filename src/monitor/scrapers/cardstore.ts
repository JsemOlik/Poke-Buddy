import { parse } from "node-html-parser";
import type { StockScraper, ScrapeResult } from "./base.ts";
import { fetchHtml } from "./base.ts";

// Phrases that unambiguously mean the product cannot be ordered
const OUT_OF_STOCK_PHRASES = ["není skladem", "vyprodáno", "nedostupné"];

export const cardstoreScraper: StockScraper = {
  storeName: "cardstore",
  hostPattern: /cardstore\.cz$/,

  async scrape(url: string): Promise<ScrapeResult> {
    const html = await fetchHtml(url);
    const root = parse(html);

    const label = root.querySelector("h1")?.text.trim() ?? url;

    // Covers all orderable states: "Skladem", "Na cestě - odeslání do X dní",
    // "Brzy naskladníme", etc. Only explicit unavailability phrases = out of stock.
    const availText = root
      .querySelector('[data-testid="labelAvailability"]')
      ?.text.trim().toLowerCase() ?? "";

    const inStock =
      availText.length > 0 &&
      !OUT_OF_STOCK_PHRASES.some((p) => availText.includes(p));

    // "(>5 ks)" → ">5 ks"
    const stockAmount = root
      .querySelector('[data-testid="numberAvailabilityAmount"]')
      ?.text.trim()
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim() || undefined;

    const priceText = root
      .querySelector('[data-testid="productCardPrice"] .price-final-holder')
      ?.text.trim()
      .replace(/\s+/g, " ");

    return { inStock, label, price: priceText, stockAmount };
  },
};
