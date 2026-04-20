import { parse } from "node-html-parser";
import type { StockScraper, ScrapeResult } from "./base.ts";
const SOLVER_URL = process.env.SOLVER_URL ?? "http://127.0.0.1:8191";
const OUT_OF_STOCK_PHRASES = ["není skladem", "nedostupné", "vyprodáno"];

export const alzaScraper: StockScraper = {
  storeName: "alza",
  hostPattern: /alza\.cz$/,

  async scrape(url: string): Promise<ScrapeResult> {
    console.log(`[alza] Fetching via solver service: ${url}`);

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
        throw new Error("Alza requires the EzSolver service — run `python ez-solver/service.py` in a separate terminal first.");
      }
      throw err;
    }

    const root = parse(html);
    const label = root.querySelector("h1")?.text.trim() ?? url;

    const availBtn = root.querySelector('button[data-testid*="availabilityText"]');
    const availText = availBtn?.text.trim().toLowerCase() ?? "";

    // "Předp. cena" header means the price is a pre-order/forecast price → not yet released
    const isPreorderPrice = !!root.querySelector(".ads-pb--preorder, .ads-pb__header");
    const preorderLabel = root.querySelector(".ads-pb__header")?.text.trim().toLowerCase() ?? "";
    const hasPreorderPriceHeader = isPreorderPrice && preorderLabel.includes("předp");

    let stock: ScrapeResult["stock"];
    if (availText.includes("skladem") && !OUT_OF_STOCK_PHRASES.some((p) => availText.includes(p))) {
      stock = "in-stock";
    } else if (hasPreorderPriceHeader) {
      stock = "pre-order";
    } else {
      stock = "not-in-stock";
    }

    const rawAvail = availBtn?.text.trim() ?? "";
    const stockAmount = rawAvail.replace(/^skladem\s*/i, "").trim() || undefined;

    const priceText = root.querySelector(".ads-pb__price-value")?.text.trim();
    const price = priceText ? `${priceText} Kč` : undefined;

    const rawSrc = root.querySelector(".swiper-zoom-container img")?.getAttribute("src");
    // Use 500×500 variant — large enough for Discord, small enough to load fast
    const imageUrl = rawSrc
      ? rawSrc.replace(/([?&]width=)\d+/, "$1500").replace(/([?&]height=)\d+/, "$1500")
      : undefined;

    console.log(`[alza] Done — stock=${stock}, label="${label}", preorderPrice=${hasPreorderPriceHeader}`);
    return { stock, label, price, stockAmount, imageUrl };
  },
};
