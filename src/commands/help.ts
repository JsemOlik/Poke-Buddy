import { ChatInputCommandInteraction, SlashCommandBuilder, EmbedBuilder, Colors } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("List all available commands");

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle("Poke-Buddy — Commands")
    .addFields(
      {
        name: "/monitor add",
        value: "Opens a form to start monitoring a product URL. Supports HraNaNetu.cz, CardStore.cz, CDMC.cz, Xzone.cz, Alza.cz, and Smarty.cz.",
        inline: false,
      },
      {
        name: "/monitor remove",
        value: "Shows a dropdown of all active monitors. Select one to stop monitoring it.",
        inline: false,
      },
      {
        name: "/monitor list",
        value: "Shows all monitored products with their current stock status. Navigate pages with ◀ ▶ and add new monitors with ➕ Add.",
        inline: false,
      },
      {
        name: "/monitor setchannel #channel",
        value: "Sets the channel where stock alert notifications will be posted when a product comes back in stock.",
        inline: false,
      },
      {
        name: "/help",
        value: "Shows this message.",
        inline: false,
      },
    );

  await interaction.reply({ embeds: [embed] });
}
