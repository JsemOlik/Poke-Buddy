import { REST, Routes } from "discord.js";
import * as ping from "./commands/ping.ts";
// import * as monitor from "./commands/monitor.ts";
// import * as help from "./commands/help.ts";

const commands = [ping /*, monitor, help */].map((cmd) => cmd.data.toJSON());

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId || !guildId) {
  throw new Error("Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID in .env");
}

const rest = new REST().setToken(token);

console.log(`Deploying ${commands.length} slash command(s)...`);

await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });

console.log("Commands deployed successfully.");
