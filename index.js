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

// === Работа с файлами имен ===
const dataFile = "./names.json";
let names = fs.existsSync(dataFile)
  ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
  : {};

// === Команды бота ===
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
    ),
  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя у себя или у другого пользователя (только VIP)")
    .addUserOption(option =>
      option.setName("target")
            .setDescription("Пользователь, у которого удалить имя")
            .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверка работы бота")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

// === Регистрация команд ===
(async () => {
  try {
    console.log("⏳ Регистрирую команды...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Команды зарегистрированы!");
  } catch (err) {
    console.error("Ошибка регистрации команд:", err);
  }
})();

// === Обработка команд ===
client.on("interactionCreate", async interaction => {
  try {
    if (!interaction.isChatInputCommand()) return;

    const command = interaction.commandName;

    if (command === "ping") {
      return interaction.reply({ content: "🏓 Pong!", ephemeral: true });
    }

    if (command === "setrealname") {
      const name = interaction.options.getString("name");
      const target = interaction.options.getUser("target") || interaction.user;

      if (target.id !== interaction.user.id) {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
          return interaction.reply({ content: "❌ У вас нет права изменять имя других пользователей!", ephemeral: true });
        }
      }

      names[target.id] = name;
      fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

      await interaction.guild.members.fetch();
      const memberTarget = interaction.guild.members.cache.get(target.id);
      const baseNick = memberTarget.displayName.split(" | ")[0];
      const newNick = `${baseNick} | ${name}`;

      try {
        await memberTarget.setNickname(newNick);
        await interaction.reply({ content: `✅ Реальное имя для ${target.username} установлено: **${name}**`, ephemeral: true });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
      }
    }

    if (command === "removerealname") {
      const target = interaction.options.getUser("target") || interaction.user;

      if (target.id !== interaction.user.id) {
        const member = await interaction.guild.members.fetch(interaction.user.id);
        if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
          return interaction.reply({ content: "❌ У вас нет права удалять имя других пользователей!", ephemeral: true });
        }
      }

      if (!names[target.id]) {
        return interaction.reply({ content: "❌ Реальное имя у этого пользователя не установлено.", ephemeral: true });
      }

      delete names[target.id];
      fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

      await interaction.guild.members.fetch();
      const memberTarget = interaction.guild.members.cache.get(target.id);
      const baseNick = memberTarget.displayName.split(" | ")[0];

      try {
        await memberTarget.setNickname(baseNick);
        await interaction.reply({ content: `✅ Реальное имя для ${target.username} удалено`, ephemeral: true });
      } catch (err) {
        console.error(err);
        await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
      }
    }
  } catch (err) {
    console.error("Ошибка при обработке команды:", err);
    if (interaction && interaction.reply) {
      await interaction.reply({ content: "❌ Произошла ошибка при обработке команды.", ephemeral: true });
    }
  }
});

// === Автообновление ников ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  try {
    const id = newMember.id;
    if (!names[id]) return;
    const realName = names[id];
    const baseNick = newMember.displayName.split(" | ")[0];
    const expected = `${baseNick} | ${realName}`;
    if (newMember.nickname !== expected) {
      await newMember.setNickname(expected);
      console.log(`🔁 Ник обновлён для ${newMember.user.username} → ${expected}`);
    }
  } catch (err) {
    console.error("⚠️ Не удалось обновить ник при событии guildMemberUpdate:", err);
  }
});

// === Логирование ошибок подключения ===
client.on("error", console.error);
client.on("shardError", console.error);

client.once("ready", () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
  console.log("✅ Подключение к Discord успешно!");
});

client.login(TOKEN);
