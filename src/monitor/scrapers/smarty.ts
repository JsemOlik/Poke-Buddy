import { parse } from "node-html-parser";
import type { StockScraper, ScrapeResult } from "./base.ts";

const SOLVER_URL = process.env.SOLVER_URL ?? "http://127.0.0.1:8191";

export const smartyScraper: StockScraper = {
  storeName: "smarty",
  hostPattern: /smarty\.cz$/,

  async scrape(url: string): Promise<ScrapeResult> {
    console.log(`[smarty] Fetching via solver service: ${url}`);

    let html: string;
    try {
      const res = await fetch(`${SOLVER_URL}/fetch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, wait: 15 }),
      });
      const data = await res.json() as { html?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? res.statusText);
      html = data.html!;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("ECONNREFUSED") || msg.includes("Connection refused")) {
        throw new Error("Smarty requires the EzSolver service — run `python ez-solver/service.py` in a separate terminal first.");
      }
      throw err;
    }

    const root = parse(html);
    const label = root.querySelector("h1")?.text.trim() ?? url;

    // Schema.org availability is the most reliable indicator
    const availHref = root.querySelector('link[itemprop="availability"]')?.getAttribute("href") ?? "";
    const inStock = availHref.toLowerCase().includes("instock");

    // Quantity lives in the <b> inside the green stock span
    const stockAmount = root.querySelector(".toStoreInfo .color-green b")?.text.trim() || undefined;

    // Final price is in .buyBox-price (not the crossed-out discount price)
    const priceText = root.querySelector(".buyBox-price")?.text.trim().replace(/\s+/g, " ");
    const price = priceText || undefined;

    // First active gallery slide
    const imageUrl = root.querySelector(".gallery-item.tns-slide-active img")?.getAttribute("src") ?? undefined;

    console.log(`[smarty] Done — inStock=${inStock}, label="${label}"`);
    return { inStock, label, price, stockAmount, imageUrl };
  },
};
