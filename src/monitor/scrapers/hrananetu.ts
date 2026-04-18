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

    // Schema.org price meta tags — clean numeric value + currency
    const priceValue = root
      .querySelector('meta[itemprop="price"]')
      ?.getAttribute("content");
    const price = priceValue ? `${priceValue} Kč` : undefined;

    // "(3\nks na skladě)" → "3 ks na skladě" / "(4+\nks v předprodeji)" → "4+ ks v předprodeji"
    const stockAmountRaw = root
      .querySelector("em.c-mu")
      ?.text.trim()
      .replace(/[()]/g, "")
      .replace(/\s+/g, " ")
      .trim() ?? "";
    const stockAmount = stockAmountRaw || undefined;

    // Derive stock status from the quantity label text — same element, different suffix.
    let stock: ScrapeResult["stock"] = "not-in-stock";
    if (stockAmountRaw.includes("v předprodeji")) {
      stock = "pre-order";
    } else if (stockAmountRaw.includes("na skladě")) {
      stock = "in-stock";
    }

    // First active carousel item = main product image
    const imageUrl = root.querySelector("figure.carousel-item.active img")?.getAttribute("src") ?? undefined;

    return { stock, label, price, stockAmount, imageUrl };
  },
};
