import fs from "fs";
import { Client, GatewayIntentBits } from "discord.js";

const TOKEN = process.env.DISCORD_BOT_TOKEN;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !GUILD_ID) process.exit(1);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const dataFile = "./names.json";
let names = fs.existsSync(dataFile) ? JSON.parse(fs.readFileSync(dataFile, "utf8")) : {};

client.once("ready", async () => {
  const guild = await client.guilds.fetch(GUILD_ID);
  await guild.members.fetch();

  guild.members.cache.forEach(member => {
    if (!names[member.id]) {
      const parts = member.displayName.split(" | ");
      if (parts.length > 1) names[member.id] = parts[1].trim();
    }
  });

  fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));
  console.log("🎉 Миграция завершена!");
  process.exit(0);
});

client.login(TOKEN);
