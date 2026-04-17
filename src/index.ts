import { Client, Collection, Events, GatewayIntentBits } from "discord.js";
import type { Command } from "./types.ts";
import * as ping from "./commands/ping.ts";
import * as monitor from "./commands/monitor.ts";
import * as help from "./commands/help.ts";
import { startPoller, stopPoller } from "./monitor/poller.ts";
import { closeBrowser } from "./monitor/browser.ts";
import { startApiServer } from "./api/server.ts";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("Missing DISCORD_TOKEN in .env");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = new Collection<string, Command>();

for (const cmd of [ping, monitor, help]) {
  commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startPoller(c);
  startApiServer(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    } else if (interaction.isModalSubmit()) {
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
    }
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

process.once("SIGINT", async () => {
  stopPoller();
  await closeBrowser();
  client.destroy();
  process.exit(0);
});

await client.login(token);
