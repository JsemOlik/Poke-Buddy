import type { Client } from "discord.js";
import {
  listProducts,
  listProductsByGuild,
  addProduct,
  removeProduct,
  getProduct,
} from "../monitor/db.ts";
import { getScraperForUrl, getStoreNameForUrl } from "../monitor/scrapers/index.ts";

const API_KEY = process.env.API_SECRET_KEY ?? "";
const CORS_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:3000";

const corsHeaders = {
  "Access-Control-Allow-Origin": CORS_ORIGIN,
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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
  const port = parseInt(process.env.API_PORT ?? "4000", 10);

  Bun.serve({
    port,
    async fetch(req) {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
      if (!checkAuth(req)) return json({ error: "Unauthorized" }, 401);

      const url = new URL(req.url);
      const path = url.pathname;

      // GET /api/guilds — all guilds the bot is actually present in
      if (req.method === "GET" && path === "/api/guilds") {
        const guilds = client.guilds.cache.map((g) => g.id);
        return json({ guilds });
      }

      // GET /api/monitors?guild=<id>
      if (req.method === "GET" && path === "/api/monitors") {
        const guildId = url.searchParams.get("guild") ?? "";
        const monitors = guildId ? listProductsByGuild(guildId) : listProducts();
        return json({ monitors });
      }

      // POST /api/monitors  { url, guildId, addedBy? }
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
          const product = addProduct(parsed.href, storeName, label, addedBy, guildId);
          return json({ monitor: product }, 201);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes("UNIQUE constraint")) return json({ error: "URL already monitored" }, 409);
          return json({ error: msg }, 500);
        }
      }

      // DELETE /api/monitors/:id
      const deleteMatch = path.match(/^\/api\/monitors\/(\d+)$/);
      if (req.method === "DELETE" && deleteMatch) {
        const id = parseInt(deleteMatch[1], 10);
        if (!getProduct(id)) return json({ error: "Not found" }, 404);
        removeProduct(id);
        return json({ success: true });
      }

      return json({ error: "Not found" }, 404);
    },
  });

  console.log(`[api] HTTP API listening on port ${port}`);
}
