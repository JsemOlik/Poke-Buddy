import type { Client, TextChannel } from "discord.js";
import { listProducts, setInStock, getConfig, type ProductRow } from "./db.ts";
import { getScraperForUrl } from "./scrapers/index.ts";
import { buildStockAlert } from "./alert.ts";

// Alza and Smarty route through EzSolver (real Chromium), which is much slower
// than a plain fetch — poll them less frequently to avoid overloading the solver.
const SLOW_STORES = new Set(["alza", "smarty"]);
const SLOW_INTERVAL_MS = 120_000; // 2 min
const FAST_INTERVAL_MS = 30_000;  // 30 sec

let pollHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

// Kick off an immediate check and then repeat on the configured interval.
export async function startPoller(client: Client): Promise<void> {
  const intervalMs = parseInt((await getConfig("poll_interval_ms")) ?? "30000", 10);
  void runPollCycle(client);
  pollHandle = setInterval(() => void runPollCycle(client), intervalMs);
  console.log(`[monitor] Poller started (interval: ${intervalMs / 1000}s)`);
}

export function stopPoller(): void {
  if (pollHandle !== null) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
}

// Checks all products concurrently. The `running` flag prevents a slow cycle
// from stacking on top of itself if the interval fires before it finishes.
async function runPollCycle(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const products = await listProducts();
    if (products.length === 0) return;
    console.log(`[monitor] Poll cycle — ${products.length} product(s)`);
    await Promise.allSettled(products.map((p) => checkProduct(client, p)));
  } finally {
    running = false;
  }
}

// Scrapes one product and fires an alert if it just came back into stock.
// Per-store rate limiting is applied here unless `force` is true (e.g. /monitor check).
async function checkProduct(client: Client, product: ProductRow, force = false): Promise<void> {
  if (!force) {
    const intervalMs = SLOW_STORES.has(product.store) ? SLOW_INTERVAL_MS : FAST_INTERVAL_MS;
    if (product.last_checked !== null && Date.now() - product.last_checked < intervalMs) return;
  }

  const scraper = getScraperForUrl(product.url);
  if (!scraper) return;

  try {
    const result = await scraper.scrape(product.url);
    const wasInStock = product.in_stock === 1;

    await setInStock(product.id, result.inStock);

    // Only alert on a transition from out-of-stock → in-stock, not on every check.
    if (!wasInStock && result.inStock) {
      console.log(`[monitor] Stock alert: ${product.label}`);
      await sendAlert(client, product, result.price, result.stockAmount, result.imageUrl);
    }
  } catch (err) {
    console.error(`[monitor] Failed to check ${product.url}:`, err);
  }
}

// Bypasses the rate-limit check — used by the /monitor check slash command.
export async function checkProductNow(client: Client, product: ProductRow): Promise<void> {
  await checkProduct(client, product, true);
}

// Looks up the configured alert channel for the product's guild and sends the embed.
async function sendAlert(
  client: Client,
  product: ProductRow,
  price?: string,
  stockAmount?: string,
  imageUrl?: string,
): Promise<void> {
  // Per-guild channel takes priority; fall back to the legacy global setting.
  const channelId =
    (product.guild_id ? await getConfig(`alert_channel_id:${product.guild_id}`) : null) ??
    (await getConfig("alert_channel_id")) ??
    "";
  if (!channelId) return;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const { embed, row } = buildStockAlert(product, price, stockAmount, imageUrl);
    await (channel as TextChannel).send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error(`[monitor] Failed to send alert:`, err);
  }
}
