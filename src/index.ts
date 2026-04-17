import { Client, Collection, Events, GatewayIntentBits } from "discord.js";
import type { Command } from "./types.ts";
import * as ping from "./commands/ping.ts";
import * as monitor from "./commands/monitor.ts";
import { startPoller, stopPoller } from "./monitor/poller.ts";
import { closeBrowser } from "./monitor/browser.ts";

const token = process.env.DISCORD_TOKEN;
if (!token) throw new Error("Missing DISCORD_TOKEN in .env");

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const commands = new Collection<string, Command>();

for (const cmd of [ping, monitor]) {
  commands.set(cmd.data.name, cmd);
}

client.once(Events.ClientReady, (c) => {
  console.log(`Logged in as ${c.user.tag}`);
  startPoller(c);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const command = commands.get(interaction.commandName);
  if (!command) return;

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(error);
    const msg = { content: "An error occurred while executing this command.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg);
    } else {
      await interaction.reply(msg);
    }
  }
});

process.once("SIGINT", () => {
  stopPoller();
  void closeBrowser();
  client.destroy();
  process.exit(0);
});

await client.login(token);
