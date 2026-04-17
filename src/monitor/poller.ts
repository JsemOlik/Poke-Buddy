import type { Client, TextChannel } from "discord.js";
import { listProducts, setInStock, getConfig, type ProductRow } from "./db.ts";
import { getScraperForUrl } from "./scrapers/index.ts";
import { buildStockAlert } from "./alert.ts";

const SLOW_STORES = new Set(["alza", "smarty"]);
const SLOW_INTERVAL_MS = 120_000; // 2 min
const FAST_INTERVAL_MS = 30_000;  // 30 sec

let pollHandle: ReturnType<typeof setInterval> | null = null;
let running = false;

export function startPoller(client: Client): void {
  const intervalMs = parseInt(getConfig("poll_interval_ms") ?? "30000", 10);
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

async function runPollCycle(client: Client): Promise<void> {
  if (running) return;
  running = true;
  try {
    const products = listProducts();
    if (products.length === 0) return;
    console.log(`[monitor] Poll cycle — ${products.length} product(s)`);
    await Promise.allSettled(products.map((p) => checkProduct(client, p)));
  } finally {
    running = false;
  }
}

// Called by the poller — respects per-store intervals.
// Called with force=true after a manual add to skip the interval guard.
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

    setInStock(product.id, result.inStock);

    if (!wasInStock && result.inStock) {
      console.log(`[monitor] Stock alert: ${product.label}`);
      await sendAlert(client, product, result.price, result.stockAmount, result.imageUrl);
    }
  } catch (err) {
    console.error(`[monitor] Failed to check ${product.url}:`, err);
  }
}

export async function checkProductNow(client: Client, product: ProductRow): Promise<void> {
  await checkProduct(client, product, true);
}

async function sendAlert(client: Client, product: ProductRow, price?: string, stockAmount?: string, imageUrl?: string): Promise<void> {
  const channelId =
    (product.guild_id ? getConfig(`alert_channel_id:${product.guild_id}`) : null) ??
    getConfig("alert_channel_id") ??
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
