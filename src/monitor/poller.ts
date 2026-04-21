import type { Client, TextChannel } from "discord.js";
import { listProducts, setStock, setReleaseDate, getConfig, type ProductRow } from "./db.ts";
import { getScraperForUrl } from "./scrapers/index.ts";
import { buildStockAlert } from "./alert.ts";
import { createReleaseEvent } from "./events.ts";

const GUILD_ID = process.env.DISCORD_GUILD_ID;

// Alza and Smarty route through EzSolver (real Chromium), which is much slower
// than a plain fetch — poll them less frequently to avoid overloading the solver.
const SLOW_STORES = new Set(["alza", "smarty", "jrc"]);
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

// Scrapes one product and fires an alert on stock status transitions.
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
    const prevStock = product.stock;

    await setStock(product.id, result.stock);

    // Alert on any transition into an orderable state (in-stock or pre-order),
    // but only when the status actually changes — not on every check.
    if (prevStock !== "in-stock" && result.stock === "in-stock") {
      console.log(`[monitor] Stock alert: ${product.label}`);
      await sendAlert(client, product, "in-stock", result.price, result.stockAmount, result.imageUrl);
    } else if (prevStock !== "pre-order" && prevStock !== "in-stock" && result.stock === "pre-order") {
      console.log(`[monitor] Pre-order alert: ${product.label}`);
      await sendAlert(client, product, "pre-order", result.price, result.stockAmount, result.imageUrl);
    } else if (result.stock === "not-released" && result.releaseDate && result.releaseDate !== product.release_date) {
      console.log(`[monitor] Release date alert: ${product.label} — ${result.releaseDate}`);
      await setReleaseDate(product.id, result.releaseDate);
      await sendAlert(client, product, "release-date", result.price, result.stockAmount, result.imageUrl, result.releaseDate);
      if (!GUILD_ID || product.guild_id === GUILD_ID) {
        void createReleaseEvent(client, product, result.releaseDate, result.imageUrl);
      }
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
  alertType: "in-stock" | "pre-order" | "release-date",
  price?: string,
  stockAmount?: string,
  imageUrl?: string,
  releaseDate?: string,
): Promise<void> {
  // Per-guild channel takes priority; fall back to the legacy global setting.
  const channelId =
    (product.guild_id ? await getConfig(`alert_channel_id:${product.guild_id}`) : null) ??
    (await getConfig("alert_channel_id")) ??
    "";
  if (!channelId) return;

  // If a global guild lock is active, skip alerts for other guilds.
  if (GUILD_ID && product.guild_id !== GUILD_ID) {
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased()) return;
    const { embed, row } = buildStockAlert(product, alertType, price, stockAmount, imageUrl, releaseDate);
    await (channel as TextChannel).send({ embeds: [embed], components: [row] });
  } catch (err) {
    console.error(`[monitor] Failed to send alert:`, err);
  }
}
