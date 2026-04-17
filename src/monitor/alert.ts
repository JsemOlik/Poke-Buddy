import { EmbedBuilder, Colors } from "discord.js";
import type { ProductRow } from "./db.ts";

const storeDisplayNames: Record<string, string> = {
  hrananetu: "HranaNetu.cz",
  cardstore: "CardStore.cz",
  cdmc: "CDMC.cz",
};

const storeColors: Record<string, number> = {
  hrananetu: 0x4b0082, // dark purple
  cardstore: 0xffd700, // gold
  cdmc:      0xe74c3c, // red
};

export function buildStockAlert(
  product: ProductRow,
  price?: string,
  stockAmount?: string,
): EmbedBuilder {
  const storeName = storeDisplayNames[product.store] ?? product.store;
  const color = storeColors[product.store] ?? Colors.Green;

  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: "Store", value: storeName, inline: true },
    { name: "Price", value: price ?? "—", inline: true },
  ];

  if (stockAmount) {
    fields.push({ name: "In Stock", value: stockAmount, inline: true });
  }

  fields.push({ name: "Link", value: `[View Product](${product.url})`, inline: false });

  return new EmbedBuilder()
    .setColor(color)
    .setTitle("Back in Stock!")
    .setDescription(`**${product.label}**`)
    .setURL(product.url)
    .addFields(...fields)
    .setTimestamp()
    .setFooter({ text: `Monitor ID: ${product.id}` });
}
