import type { Client } from "discord.js";
import { ChannelType } from "discord.js";
import {
  listProducts,
  listProductsByGuild,
  addProduct,
  removeProduct,
  getProduct,
  getConfig,
  setConfig,
} from "../monitor/db.ts";
import { getScraperForUrl, getStoreNameForUrl } from "../monitor/scrapers/index.ts";
import { checkProductNow } from "../monitor/poller.ts";

const API_KEY = process.env.API_SECRET_KEY ?? "";
const CORS_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const corsHeaders = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: corsHeaders });
}

function checkAuth(req: Request): boolean {
  if (!API_KEY) return false;
  return req.headers.get("X-API-Key") === API_KEY;
}

export function startApiServer(client: Client): void {
  const port = parseInt(process.env.API_PORT ?? "4040", 10);

  Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
      if (!checkAuth(req)) return json({ error: "Unauthorized" }, 401);

      const url = new URL(req.url);
      const path = url.pathname;

      // GET /api/guilds — all guilds the bot is in
      if (req.method === "GET" && path === "/api/guilds") {
        const guilds = client.guilds.cache.map((g) => g.id);
        return json({ guilds });
      }

      // GET /api/guilds/:id — guild name + icon
      const guildMatch = path.match(/^\/api\/guilds\/(\d+)$/);
      if (req.method === "GET" && guildMatch) {
        const guild = client.guilds.cache.get(guildMatch[1]!);
        if (!guild) return json({ error: "Guild not found" }, 404);
        return json({ id: guild.id, name: guild.name, icon: guild.icon });
      }

      // GET /api/guilds/:id/channels — text channels for the guild
      const channelsMatch = path.match(/^\/api\/guilds\/(\d+)\/channels$/);
      if (req.method === "GET" && channelsMatch) {
        const guild = client.guilds.cache.get(channelsMatch[1]!);
        if (!guild) return json({ error: "Guild not found" }, 404);
        const channels = guild.channels.cache
          .filter((c) => c.type === ChannelType.GuildText)
          .map((c) => ({ id: c.id, name: c.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        return json({ channels });
      }

      // GET /api/monitors?guild=<id>
      if (req.method === "GET" && path === "/api/monitors") {
        const guildId = url.searchParams.get("guild") ?? "";
        const monitors = guildId ? await listProductsByGuild(guildId) : await listProducts();
        return json({ monitors });
      }

      // POST /api/monitors — { url, guildId, addedBy? }
      if (req.method === "POST" && path === "/api/monitors") {
        let body: { url?: string; guildId?: string; addedBy?: string };
        try { body = await req.json() as typeof body; } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const rawUrl = (body.url ?? "").trim();
        const guildId = (body.guildId ?? "").trim();
        const addedBy = (body.addedBy ?? "web-dashboard").trim();

        let parsed: URL;
        try { parsed = new URL(rawUrl); } catch {
          return json({ error: "Invalid URL" }, 400);
        }

        const storeName = getStoreNameForUrl(parsed.href);
        if (!storeName) return json({ error: "Unsupported store" }, 400);

        const fallbackLabel =
          parsed.pathname.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? rawUrl;

        let label = fallbackLabel;
        try {
          const result = await getScraperForUrl(parsed.href)!.scrape(parsed.href);
          label = result.label ?? fallbackLabel;
        } catch { /* non-fatal — poller will get it */ }

        try {
          const product = await addProduct(parsed.href, storeName, label, addedBy, guildId);
          void checkProductNow(client, product);
          return json({ monitor: product }, 201);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("UNIQUE constraint")) return json({ error: "URL already monitored" }, 409);
          return json({ error: msg }, 500);
        }
      }

      // DELETE /api/monitors/:id?guild=<guildId>
      const deleteMatch = path.match(/^\/api\/monitors\/(\d+)$/);
      if (req.method === "DELETE" && deleteMatch) {
        const id = parseInt(deleteMatch[1]!, 10);
        const delGuildId = url.searchParams.get("guild") ?? "";
        const product = await getProduct(id);
        if (!product) return json({ error: "Not found" }, 404);
        if (delGuildId && product.guild_id !== delGuildId) return json({ error: "Not found" }, 404);
        await removeProduct(id);
        return json({ success: true });
      }

      // GET /api/config?guild=<id>
      if (req.method === "GET" && path === "/api/config") {
        const guildId = url.searchParams.get("guild") ?? "";
        const alertChannelId =
          (guildId ? await getConfig(`alert_channel_id:${guildId}`) : null) ??
          (await getConfig("alert_channel_id")) ??
          "";
        return json({ alert_channel_id: alertChannelId });
      }

      // PUT /api/config — { key, value, guildId? }
      if (req.method === "PUT" && path === "/api/config") {
        let body: { key?: string; value?: string; guildId?: string };
        try { body = await req.json() as typeof body; } catch {
          return json({ error: "Invalid JSON" }, 400);
        }
        const key = (body.key ?? "").trim();
        const value = (body.value ?? "").trim();
        const guildId = (body.guildId ?? "").trim();
        if (!key) return json({ error: "key is required" }, 400);
        await setConfig(guildId ? `${key}:${guildId}` : key, value);
        return json({ success: true });
      }

      return json({ error: "Not found" }, 404);
    },
  });

  console.log(`[api] HTTP API listening on port ${port}`);
}
