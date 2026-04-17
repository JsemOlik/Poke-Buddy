import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  ChannelType,
  MessageFlags,
} from "discord.js";
import {
  addProduct,
  removeProduct,
  listProducts,
  getProduct,
  setConfig,
} from "../monitor/db.ts";
import { getScraperForUrl, getStoreNameForUrl } from "../monitor/scrapers/index.ts";

export const data = new SlashCommandBuilder()
  .setName("monitor")
  .setDescription("Manage product stock monitors")
  .addSubcommand((sub) =>
    sub
      .setName("add")
      .setDescription("Start monitoring a product URL")
      .addStringOption((opt) =>
        opt.setName("url").setDescription("Product page URL").setRequired(true)
      )
  )
  .addSubcommand((sub) =>
    sub
      .setName("remove")
      .setDescription("Stop monitoring a product")
      .addIntegerOption((opt) =>
        opt
          .setName("id")
          .setDescription("Monitor ID (from /monitor list)")
          .setRequired(true)
      )
  )
  .addSubcommand((sub) => sub.setName("list").setDescription("List all monitored products"))
  .addSubcommand((sub) =>
    sub
      .setName("setchannel")
      .setDescription("Set the channel for stock alerts")
      .addChannelOption((opt) =>
        opt
          .setName("channel")
          .setDescription("Channel to send alerts to")
          .addChannelTypes(ChannelType.GuildText)
          .setRequired(true)
      )
  );

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const sub = interaction.options.getSubcommand();

  if (sub === "add") return handleAdd(interaction);
  if (sub === "remove") return handleRemove(interaction);
  if (sub === "list") return handleList(interaction);
  if (sub === "setchannel") return handleSetChannel(interaction);
}

async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  const url = interaction.options.getString("url", true).trim();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    await interaction.reply({ content: "Invalid URL. Please provide a full product URL including `https://`.", flags: MessageFlags.Ephemeral });
    return;
  }

  const storeName = getStoreNameForUrl(parsed.href);
  if (!storeName) {
    await interaction.reply({
      content: `Unsupported store. Currently supported: **HranaNetu.cz**, **CardStore.cz**, **CDMC.cz**, **Xzone.cz**.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Try to scrape for label/stock on add, but don't block adding if the scrape fails
  const scraper = getScraperForUrl(parsed.href)!;
  let scrapeResult: { inStock: boolean; label: string } | null = null;
  try {
    scrapeResult = await scraper.scrape(parsed.href);
  } catch {
    // scrape failure is non-fatal here; poller will retry on the next cycle
  }

  const fallbackLabel = parsed.pathname.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? parsed.href;
  const label = scrapeResult?.label ?? fallbackLabel;

  try {
    const product = addProduct(parsed.href, storeName, label, interaction.user.id);

    const statusText = scrapeResult
      ? scrapeResult.inStock ? "In Stock" : "Out of Stock"
      : "Unknown (scrape failed — will retry on next poll)";

    const embed = new EmbedBuilder()
      .setColor(Colors.Blue)
      .setTitle("Monitor Added")
      .addFields(
        { name: "Product", value: product.label, inline: false },
        { name: "Store", value: storeName, inline: true },
        { name: "Currently", value: statusText, inline: true },
        { name: "ID", value: String(product.id), inline: true },
      )
      .setURL(product.url);

    await interaction.editReply({ embeds: [embed] });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("UNIQUE constraint")) {
      await interaction.editReply({ content: "That URL is already being monitored." });
    } else {
      await interaction.editReply({ content: `Failed to add monitor: ${msg}` });
    }
  }
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const id = interaction.options.getInteger("id", true);
  const product = getProduct(id);

  if (!product) {
    await interaction.reply({ content: `No monitor found with ID **${id}**.`, flags: MessageFlags.Ephemeral });
    return;
  }

  removeProduct(id);
  await interaction.reply({
    content: `Removed monitor for **${product.label}** (ID: ${id}).`,
    flags: MessageFlags.Ephemeral,
  });
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const products = listProducts();

  if (products.length === 0) {
    await interaction.reply({ content: "No products are being monitored yet. Use `/monitor add` to add one.", flags: MessageFlags.Ephemeral });
    return;
  }

  const storeDisplayNames: Record<string, string> = {
    hrananetu: "HraNaNetu.cz",
    cardstore: "CardStore.cz",
    cdmc: "CDMC.cz",
    xzone: "Xzone.cz",
  };

  const rows = products.map((p) => {
    const store = storeDisplayNames[p.store] ?? p.store;
    const status = p.in_stock ? "✅ In Stock" : "❌ Out of Stock";
    return `**${p.id}.** [${p.label}](${p.url})\n${store} · ${status}`;
  });

  const embed = new EmbedBuilder()
    .setColor(Colors.Blue)
    .setTitle(`Monitored Products (${products.length})`)
    .setDescription(rows.join("\n\n"));

  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

async function handleSetChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);

  setConfig("alert_channel_id", channel.id);

  await interaction.reply({
    content: `Stock alerts will now be sent to <#${channel.id}>.`,
    flags: MessageFlags.Ephemeral,
  });
}
