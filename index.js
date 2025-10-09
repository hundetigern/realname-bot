import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs";
import express from "express";
import { Octokit } from "@octokit/rest";

// === Веб-сервер для Render / Replit ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web server is online on port ${PORT}`));

// === Переменные окружения ===
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "hundetigern/realname-bot";
const GITHUB_FILE_PATH = "data/names.json";

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !GITHUB_TOKEN) {
  console.error("❌ Не заданы DISCORD_BOT_TOKEN, CLIENT_ID, GUILD_ID или GITHUB_TOKEN");
  process.exit(1);
}

// === Инициализация клиента ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
});

// === Инициализация GitHub ===
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// === Работа с names.json ===
const dataFile = "./data/names.json";
let names = fs.existsSync(dataFile)
  ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
  : {};

// === Сохранение names.json на GitHub с защитой от конфликтов ===
async function saveNamesToGitHub(retry = 0) {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

    const { data: fileData } = await octokit.repos.getContent({
      owner: GITHUB_REPO.split("/")[0],
      repo: GITHUB_REPO.split("/")[1],
      path: GITHUB_FILE_PATH,
    });

    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_REPO.split("/")[0],
      repo: GITHUB_REPO.split("/")[1],
      path: GITHUB_FILE_PATH,
      message: "Автосейв реальных имён",
      content: Buffer.from(JSON.stringify(names, null, 2)).toString("base64"),
      sha: fileData.sha,
    });

    console.log("✅ names.json успешно обновлён на GitHub");
  } catch (err) {
    if (err.status === 409 && retry < 3) {
      console.warn("⚠️ Конфликт SHA при сохранении. Повтор через 10 сек...");
      setTimeout(() => saveNamesToGitHub(retry + 1), 10000);
    } else if (err.status === 404) {
      await octokit.repos.createOrUpdateFileContents({
        owner: GITHUB_REPO.split("/")[0],
        repo: GITHUB_REPO.split("/")[1],
        path: GITHUB_FILE_PATH,
        message: "Создан names.json",
        content: Buffer.from(JSON.stringify(names, null, 2)).toString("base64"),
      });
      console.log("✅ names.json создан на GitHub");
    } else {
      console.error("❌ Ошибка при сохранении names.json на GitHub:", err.message);
    }
  }
}

// === Автосейв каждые 10 минут ===
setInterval(saveNamesToGitHub, 10 * 60 * 1000);

// === Регистрация команд ===
const commands = [
  new SlashCommandBuilder()
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя для себя или другого пользователя (только VIP)")
    .addStringOption(o => o.setName("name").setDescription("Реальное имя").setRequired(true))
    .addUserOption(o => o.setName("target").setDescription("Кому изменить имя").setRequired(false)),
  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя пользователя")
    .addUserOption(o => o.setName("target").setDescription("Кого удалить").setRequired(false)),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверка работы бота"),
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

  try {
    const target = interaction.options.getUser("target") || interaction.user;

    if (interaction.commandName === "setrealname") {
      const name = interaction.options.getString("name");
      const member = await interaction.guild.members.fetch(interaction.user.id);

      if (target.id !== interaction.user.id && !member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return await interaction.reply({ content: "❌ Нет права изменять чужие имена!", flags: 64 });
      }

      const MAX_NICK_LENGTH = 32;
      const memberTarget = await interaction.guild.members.fetch(target.id);
      const baseNick = memberTarget.displayName.split(" | ")[0];
      const extraLength = 3 + name.length;
      const baseNickTrimmed = baseNick.length + extraLength > MAX_NICK_LENGTH
        ? baseNick.substring(0, MAX_NICK_LENGTH - extraLength)
        : baseNick;
      const newNick = `${baseNickTrimmed} | ${name}`;

      names[target.id] = name;
      fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

      try {
        await memberTarget.setNickname(newNick);
        await interaction.reply({ content: `✅ Реальное имя для ${target.username} установлено: **${name}**`, flags: 64 });
      } catch {
        await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", flags: 64 });
      }
    }

    if (interaction.commandName === "removerealname") {
      if (!names[target.id])
        return await interaction.reply({ content: "❌ Реальное имя у этого пользователя не установлено.", flags: 64 });

      const memberTarget = await interaction.guild.members.fetch(target.id);
      const baseNick = memberTarget.displayName.split(" | ")[0];
      delete names[target.id];
      fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

      try {
        await memberTarget.setNickname(baseNick);
        await interaction.reply({ content: `✅ Реальное имя для ${target.username} удалено`, flags: 64 });
      } catch {
        await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", flags: 64 });
      }
    }

    if (interaction.commandName === "ping") {
      await interaction.reply({ content: "🏓 Понг! Бот жив и работает 😎", flags: 64 });
    }
  } catch (err) {
    console.error("Ошибка при обработке команды:", err);
  }
});

// === Автообновление ника при ручной смене ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const id = newMember.id;
  if (!names[id]) return;

  const realName = names[id];
  const baseNick = newMember.displayName.split(" | ")[0];
  const MAX_NICK_LENGTH = 32;
  const extraLength = 3 + realName.length;
  const baseNickTrimmed = baseNick.length + extraLength > MAX_NICK_LENGTH
    ? baseNick.substring(0, MAX_NICK_LENGTH - extraLength)
    : baseNick;
  const expected = `${baseNickTrimmed} | ${realName}`;

  if (newMember.nickname !== expected) {
    try {
      await newMember.setNickname(expected);
    } catch {}
  }
});

// === Запуск бота ===
client.once("ready", () => console.log(`🤖 Бот запущен как ${client.user.tag}`));
client.login(TOKEN);
