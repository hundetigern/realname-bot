import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs";
import express from "express";

// === Веб-сервер для Render / Replit ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web server is online on port ${PORT}`));

// === Переменные окружения ===
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Не заданы DISCORD_BOT_TOKEN, CLIENT_ID или GUILD_ID");
  process.exit(1);
}

// === Инициализация клиента ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

const dataFile = "./names.json";
let names = fs.existsSync(dataFile)
  ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
  : {};

// === Регистрация команды /setrealname ===
const commands = [
  new SlashCommandBuilder()
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя для себя или другого пользователя (только VIP)")
    .addStringOption(option =>
      option.setName("name")
            .setDescription("Реальное имя (может быть из нескольких слов)")
            .setRequired(true)
    )
    .addUserOption(option =>
      option.setName("target")
            .setDescription("Пользователь, чьё имя вы хотите изменить")
            .setRequired(false)
    )
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("⏳ Регистрирую команду /setrealname ...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Команда зарегистрирована!");
  } catch (err) {
    console.error("Ошибка регистрации команды:", err);
  }
})();

// === Обработка команды /setrealname ===
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName === "setrealname") {
    const name = interaction.options.getString("name");
    const target = interaction.options.getUser("target") || interaction.user;

    // Проверка на VIP
    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({
          content: "❌ У вас нет права изменять имя других пользователей!",
          ephemeral: true,
        });
      }
    }

    // Сохраняем имя
    names[target.id] = name;
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

    // Меняем ник
    await interaction.guild.members.fetch();
    const memberTarget = interaction.guild.members.cache.get(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    const newNick = `${baseNick} | ${name}`;
    try {
      await memberTarget.setNickname(newNick);
      await interaction.reply({
        content: `✅ Реальное имя для ${target.username} установлено: **${name}**`,
        ephemeral: true,
      });
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "❌ Не удалось изменить ник. Проверьте права бота.",
        ephemeral: true,
      });
    }
  }
});

// === Автоматическое восстановление ника ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const id = newMember.id;
  if (!names[id]) return;
  const realName = names[id];
  const baseNick = newMember.displayName.split(" | ")[0];
  const expected = `${baseNick} | ${realName}`;
  if (newMember.nickname !== expected) {
    try {
      await newMember.setNickname(expected);
      console.log(`🔁 Ник обновлён для ${newMember.user.username} → ${expected}`);
    } catch {
      console.log(`⚠️ Не удалось обновить ник для ${newMember.user.username}`);
    }
  }
});

// === Запуск ===
client.once("ready", () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
});

client.login(TOKEN);
