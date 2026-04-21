import { Client, Collection, Events, GatewayIntentBits } from "discord.js";
import type { Command } from "./types.ts";
import * as ping from "./commands/ping.ts";
// import * as monitor from "./commands/monitor.ts";
// import * as help from "./commands/help.ts";
import { startPoller, stopPoller } from "./monitor/poller.ts";
import { closeBrowser } from "./monitor/browser.ts";
import { startApiServer } from "./api/server.ts";
import { initDb } from "./monitor/db.ts";
import { startPresenceRotation } from "./presence.ts";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("Missing DISCORD_TOKEN in .env");

// Guilds intent is the minimum needed for slash commands and channel access.
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// Register all slash commands in a keyed collection for O(1) dispatch.
const commands = new Collection<string, Command>();

for (const cmd of [ping /*, monitor, help */]) {
  commands.set(cmd.data.name, cmd);
}

// Once the bot is connected and ready, start all background services.
client.once(Events.ClientReady, async (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startPresenceRotation(c);   // rotating Discord status
  // monitor.initMonitor(c);     // gives the monitor command access to the client
  await startPoller(c);       // begins the product stock-check loop
  startApiServer(c);          // starts the REST API used by the web dashboard
});

// Route every Discord interaction to the correct handler.
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    } /* else if (interaction.isModalSubmit()) {
      if (interaction.customId.startsWith("monitor:")) {
        await monitor.handleModalSubmit(interaction);
      }
    } else if (interaction.isButton()) {
      if (interaction.customId.startsWith("monitor:")) {
        await monitor.handleButton(interaction);
      }
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId.startsWith("monitor:")) {
        await monitor.handleSelectMenu(interaction);
      }
    } */
  } catch (error) {
    console.error(error);
    const msg = { content: "An error occurred.", ephemeral: true };
    if ("replied" in interaction && "deferred" in interaction) {
      const i = interaction as { replied: boolean; deferred: boolean; followUp: (m: object) => Promise<unknown>; reply: (m: object) => Promise<unknown> };
      if (i.replied || i.deferred) await i.followUp(msg);
      else await i.reply(msg);
    }
  }
});

// Clean up the poller, browser process, and Discord connection on Ctrl+C.
process.once("SIGINT", async () => {
  stopPoller();
  await closeBrowser();
  client.destroy();
  process.exit(0);
});

await initDb();
await client.login(token);
