import { parse } from "node-html-parser";
import type { StockScraper, ScrapeResult } from "./base.ts";
import { getBrowser } from "../browser.ts";

function extractProductId(url: string): string | null {
  const match = new URL(url).pathname.match(/4p(\d+)/i);
  return match?.[1] ?? null;
}

function labelFromUrl(url: string): string {
  const slug = new URL(url).pathname.split("/").filter(Boolean).pop() ?? url;
  return slug
    .replace(/--4p\d+$/i, "")
    .replace(/-4p\d+$/i, "")
    .replace(/-+/g, " ")
    .trim();
}

export const smartyScraper: StockScraper = {
  storeName: "smarty",
  hostPattern: /smarty\.cz$/,

  async scrape(url: string): Promise<ScrapeResult> {
    const productId = extractProductId(url);
    if (!productId) throw new Error(`Cannot extract product ID from Smarty URL: ${url}`);

    const stockUrl =
      `https://www.smarty.cz/Products/Product/StoreInfoItems` +
      `?productId=${productId}&productImeiId=null&query=&latitude=null` +
      `&longitude=null&inStock=false&buyoutCategoryId=null&discountPromo=&onlyShops=false`;

    const browser = await getBrowser();
    const page = await browser.newPage();

    try {
      // Block images, fonts and stylesheets — we only need the HTML text
      await page.route("**/*.{png,jpg,jpeg,gif,svg,webp,css,woff,woff2,ttf,otf}", (route) =>
        route.abort()
      );

      await page.goto(stockUrl, { referer: url, waitUntil: "domcontentloaded" });

      const html = await page.content();
      const root = parse(html);

      // Strip "není skladem" so remaining "skladem" hits are genuine in-stock entries
      const cleaned = root.text.toLowerCase().replace(/není\s+skladem/g, "");
      const inStock = cleaned.includes("skladem");

      return { inStock, label: labelFromUrl(url) };
    } finally {
      await page.close();
    }
  },
};
