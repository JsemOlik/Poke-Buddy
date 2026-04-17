import {
  type Client,
  ChatInputCommandInteraction,
  ModalSubmitInteraction,
  ButtonInteraction,
  StringSelectMenuInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  Colors,
  ChannelType,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import type { ProductRow } from "../monitor/db.ts";
import { addProduct, removeProduct, listProducts, setConfig, listProductsByGuild } from "../monitor/db.ts";
import { getScraperForUrl, getStoreNameForUrl } from "../monitor/scrapers/index.ts";
import { checkProductNow } from "../monitor/poller.ts";

let _client: Client | null = null;
export function initMonitor(client: Client): void { _client = client; }

const PAGE_SIZE = 6;

const storeDisplayNames: Record<string, string> = {
  hrananetu: "HraNaNetu.cz",
  cardstore: "CardStore.cz",
  cdmc: "CDMC.cz",
  xzone: "Xzone.cz",
  alza: "Alza.cz",
  smarty: "Smarty.cz",
};

export const data = new SlashCommandBuilder()
  .setName("monitor")
  .setDescription("Manage product stock monitors")
  .addSubcommand((sub) =>
    sub.setName("add").setDescription("Start monitoring a product URL")
  )
  .addSubcommand((sub) =>
    sub.setName("remove").setDescription("Stop monitoring a product")
  )
  .addSubcommand((sub) =>
    sub.setName("list").setDescription("List all monitored products")
  )
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

function buildAddModal(): ModalBuilder {
  return new ModalBuilder()
    .setCustomId("monitor:add:modal")
    .setTitle("Add Product Monitor")
    .addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(
        new TextInputBuilder()
          .setCustomId("monitor:add:url")
          .setLabel("Product URL")
          .setStyle(TextInputStyle.Short)
          .setPlaceholder("https://www.alza.cz/...")
          .setRequired(true),
      ),
    );
}

function buildRemoveMenu(products: ProductRow[]): {
  content: string;
  components: ActionRowBuilder<StringSelectMenuBuilder>[];
} {
  const shown = products.slice(0, 25);
  const overflow = products.length > 25 ? ` (showing first 25 of ${products.length})` : "";
  const selectMenu = new StringSelectMenuBuilder()
    .setCustomId("monitor:remove-cmd")
    .setPlaceholder("Select a monitor to remove...")
    .addOptions(
      shown.map((p) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(p.label.length > 100 ? p.label.slice(0, 97) + "..." : p.label)
          .setDescription(storeDisplayNames[p.store] ?? p.store)
          .setValue(String(p.id)),
      ),
    );
  return {
    content: `Select a monitor to remove${overflow}:`,
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(selectMenu)],
  };
}

function buildListPage(
  products: ProductRow[],
  page: number,
): {
  embed: EmbedBuilder;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  const totalPages = Math.max(1, Math.ceil(products.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const slice = products.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const embed = new EmbedBuilder().setColor(Colors.Blue);

  if (products.length === 0) {
    embed
      .setTitle("Monitored Products")
      .setDescription("No monitors yet. Press **➕ Add** to add one.");
  } else {
    const rows = slice.map((p) => {
      const store = storeDisplayNames[p.store] ?? p.store;
      const status = p.in_stock ? "✅" : "❌";
      return `**${p.id}.** ${status} [${p.label}](${p.url})\n↳ ${store}`;
    });
    embed
      .setTitle(`Monitored Products (${products.length})`)
      .setDescription(rows.join("\n\n"));
  }

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  const prevBtn = new ButtonBuilder()
    .setCustomId(`monitor:nav:${safePage - 1}`)
    .setLabel("◀")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(safePage === 0);

  const pageBtn = new ButtonBuilder()
    .setCustomId("monitor:noop")
    .setLabel(`${safePage + 1} / ${totalPages}`)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(true);

  const nextBtn = new ButtonBuilder()
    .setCustomId(`monitor:nav:${safePage + 1}`)
    .setLabel("▶")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(safePage >= totalPages - 1);

  const addBtn = new ButtonBuilder()
    .setCustomId("monitor:add")
    .setLabel("➕ Add")
    .setStyle(ButtonStyle.Primary);

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(prevBtn, pageBtn, nextBtn, addBtn),
  );

  return { embed, components };
}

async function handleAdd(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.showModal(buildAddModal());
}

async function handleRemove(interaction: ChatInputCommandInteraction): Promise<void> {
  const products = listProductsByGuild(interaction.guildId ?? "");
  if (products.length === 0) {
    await interaction.reply({ content: "No monitors to remove.", flags: MessageFlags.Ephemeral });
    return;
  }
  const { content, components } = buildRemoveMenu(products);
  await interaction.reply({ content, components, flags: MessageFlags.Ephemeral });
}

async function handleList(interaction: ChatInputCommandInteraction): Promise<void> {
  const { embed, components } = buildListPage(listProductsByGuild(interaction.guildId ?? ""), 0);
  await interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

async function handleSetChannel(interaction: ChatInputCommandInteraction): Promise<void> {
  const channel = interaction.options.getChannel("channel", true);
  setConfig(`alert_channel_id:${interaction.guildId ?? ""}`, channel.id);
  await interaction.reply({
    content: `Stock alerts will now be sent to <#${channel.id}>.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  if (interaction.customId !== "monitor:add:modal") return;

  const url = interaction.fields.getTextInputValue("monitor:add:url").trim();

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    await interaction.reply({
      content: "Invalid URL. Please provide a full product URL including `https://`.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const storeName = getStoreNameForUrl(parsed.href);
  if (!storeName) {
    await interaction.reply({
      content:
        "Unsupported store. Currently supported: **HraNaNetu.cz**, **CardStore.cz**, **CDMC.cz**, **Xzone.cz**, **Alza.cz**, **Smarty.cz**.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const scraper = getScraperForUrl(parsed.href)!;
  let scrapeResult: { inStock: boolean; label: string } | null = null;
  try {
    scrapeResult = await scraper.scrape(parsed.href);
  } catch {
    // non-fatal — poller will retry
  }

  const fallbackLabel =
    parsed.pathname.split("/").filter(Boolean).pop()?.replace(/-/g, " ") ?? parsed.href;
  const label = scrapeResult?.label ?? fallbackLabel;

  let product: ProductRow;
  try {
    product = addProduct(parsed.href, storeName, label, interaction.user.id, interaction.guildId ?? "");
    if (_client) void checkProductNow(_client, product);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await interaction.editReply({
      content: msg.includes("UNIQUE constraint")
        ? "That URL is already being monitored."
        : `Failed to add monitor: ${msg}`,
    });
    return;
  }

  const { embed, components } = buildListPage(listProductsByGuild(interaction.guildId ?? ""), 0);
  await interaction.editReply({ embeds: [embed], components });
}

export async function handleButton(interaction: ButtonInteraction): Promise<void> {
  const { customId } = interaction;

  if (customId === "monitor:add") {
    await interaction.showModal(buildAddModal());
    return;
  }

  if (customId.startsWith("monitor:nav:")) {
    const page = parseInt(customId.split(":")[2]!, 10);
    const { embed, components } = buildListPage(listProductsByGuild(interaction.guildId ?? ""), page);
    await interaction.update({ embeds: [embed], components });
    return;
  }
}

export async function handleSelectMenu(
  interaction: StringSelectMenuInteraction,
): Promise<void> {
  if (interaction.customId !== "monitor:remove-cmd") return;

  removeProduct(parseInt(interaction.values[0]!, 10));

  const products = listProductsByGuild(interaction.guildId ?? "");
  if (products.length === 0) {
    await interaction.update({ content: "No more monitors.", components: [] });
    return;
  }
  const { content, components } = buildRemoveMenu(products);
  await interaction.update({ content, components });
}
