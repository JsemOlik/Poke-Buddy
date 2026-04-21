import type { Client } from "discord.js";
import { ActivityType } from "discord.js";
import { listProducts } from "./monitor/db.ts";

const INTERVAL_MS = 30_000;

function formatUptime(ms: number): string {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function startPresenceRotation(client: Client): void {
  const startedAt = Date.now();
  let index = 0;

  async function rotate() {
    const products = await listProducts().catch(() => []);
    const monitorCount = products.length;
    const guildCount = client.guilds.cache.size;
    const uptime = formatUptime(Date.now() - startedAt);

    const slides = [
      { type: ActivityType.Playing,  name: "Pokémon!" },
      { type: ActivityType.Playing,  name: "Pokémon!" },
      // { type: ActivityType.Watching, name: `${monitorCount} product${monitorCount !== 1 ? "s" : ""}` },
    ];

    const slide = slides[index % slides.length]!;
    client.user?.setActivity(slide);
    index++;
  }

  void rotate();
  setInterval(() => void rotate(), INTERVAL_MS);
}
