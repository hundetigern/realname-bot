import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs";
import express from "express";
import { Octokit } from "@octokit/rest";

// === Веб-сервер для Render / UptimeRobot ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Web server is online on port ${PORT}`));

// === Переменные окружения ===
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN; // Personal Access Token
const GITHUB_REPO = "hundetigern/realname-bot"; // твой репозиторий
const GITHUB_FILE_PATH = "data/names.json";

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !GITHUB_TOKEN) {
  console.error("❌ Не заданы токены или ID");
  process.exit(1);
}

// === Инициализация клиента Discord ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

// === Работа с names.json ===
const localDataFile = "./data/names.json";
let names = fs.existsSync(localDataFile)
  ? JSON.parse(fs.readFileSync(localDataFile, "utf8"))
  : {};

// === Octokit для GitHub ===
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// === Функция автосейва на GitHub ===
async function saveToGitHub() {
  try {
    const content = fs.readFileSync(localDataFile, "utf8");
    const { data: fileData } = await octokit.repos.getContent({
      owner: "hundetigern",
      repo: "realname-bot",
      path: GITHUB_FILE_PATH,
    });

    await octokit.repos.createOrUpdateFileContents({
      owner: "hundetigern",
      repo: "realname-bot",
      path: GITHUB_FILE_PATH,
      message: "Автосейв реальных имён",
      content: Buffer.from(content).toString("base64"),
      sha: fileData.sha,
    });

    console.log("✅ names.json успешно обновлён на GitHub");
  } catch (err) {
    console.error("⚠️ Ошибка автосейва на GitHub:", err.message);
  }
}

// Автосейв каждые 5 минут
setInterval(saveToGitHub, 5 * 60 * 1000);

// === Регистрация команд ===
const commands = [
  new SlashCommandBuilder()
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя для себя или другого пользователя (только VIP)")
    .addStringOption(option =>
      option.setName("name")
            .setDescription("Реальное имя (любое количество слов)")
            .setRequired(true)
    )
    .addUserOption(option =>
      option.setName("target")
            .setDescription("Пользователь, чьё имя вы хотите изменить")
            .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя пользователя (только VIP)")
    .addUserOption(option =>
      option.setName("target")
            .setDescription("Пользователь, чьё имя удалить")
            .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверка работоспособности бота")
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

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
  if (!interaction.isChatInputCommand()) return;

  const name = interaction.options.getString("name");
  const targetUser = interaction.options.getUser("target") || interaction.user;

  if (interaction.commandName === "setrealname") {
    // Проверка VIP для чужого имени
    if (targetUser.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ У вас нет права изменять имя других!", ephemeral: true });
      }
    }

    names[targetUser.id] = name;
    fs.writeFileSync(localDataFile, JSON.stringify(names, null, 2));

    const memberTarget = await interaction.guild.members.fetch(targetUser.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    const newNick = `${baseNick} | ${name}`;
    try {
      await memberTarget.setNickname(newNick);
      await interaction.reply({ content: `✅ Реальное имя для ${targetUser.username} установлено: **${name}**`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }

  } else if (interaction.commandName === "removerealname") {
    if (targetUser.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ У вас нет права удалять имя других!", ephemeral: true });
      }
    }

    if (!names[targetUser.id]) {
      return interaction.reply({ content: "❌ Реальное имя у этого пользователя не установлено.", ephemeral: true });
    }

    delete names[targetUser.id];
    fs.writeFileSync(localDataFile, JSON.stringify(names, null, 2));

    const memberTarget = await interaction.guild.members.fetch(targetUser.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    try {
      await memberTarget.setNickname(baseNick);
      await interaction.reply({ content: `✅ Реальное имя для ${targetUser.username} удалено`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }

  } else if (interaction.commandName === "ping") {
    await interaction.reply({ content: "🏓 Понг! Бот жив и готов работать 😎", ephemeral: true });
  }
});

// === Автообновление ников при ручной смене ===
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
client.once("clientReady", () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
});

client.login(TOKEN);
