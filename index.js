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
const GITHUB_REPO = "hundetigern/realname-bot"; // твой репозиторий с кодом
const GITHUB_FILE_PATH = "data/names.json"; // путь к файлу на GitHub

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !GITHUB_TOKEN) {
  console.error("❌ Не заданы DISCORD_BOT_TOKEN, CLIENT_ID, GUILD_ID или GITHUB_TOKEN");
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

// === Инициализация GitHub ===
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// === Работа с names.json ===
const dataFile = "./data/names.json";
let names = fs.existsSync(dataFile)
  ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
  : {};

// === Сохранение names.json на GitHub ===
async function saveNamesToGitHub() {
  try {
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

    let sha = null;
    try {
      const { data: fileData } = await octokit.repos.getContent({
        owner: GITHUB_REPO.split("/")[0],
        repo: GITHUB_REPO.split("/")[1],
        path: GITHUB_FILE_PATH,
      });
      sha = fileData.sha;
    } catch (err) {
      if (err.status !== 404) throw err;
    }

    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_REPO.split("/")[0],
      repo: GITHUB_REPO.split("/")[1],
      path: GITHUB_FILE_PATH,
      message: "Обновлены реальные имена пользователей",
      content: Buffer.from(JSON.stringify(names, null, 2)).toString("base64"),
      sha: sha || undefined,
    });

    console.log("✅ names.json успешно сохранён на GitHub");
  } catch (err) {
    console.error("❌ Ошибка при сохранении names.json на GitHub:", err);
  }
}

// === Регистрация команд ===
const commands = [
  new SlashCommandBuilder()
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя для себя или другого пользователя (только VIP)")
    .addStringOption(option => option.setName("name").setDescription("Реальное имя").setRequired(true))
    .addUserOption(option => option.setName("target").setDescription("Кому изменить имя").setRequired(false)),

  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя пользователя")
    .addUserOption(option => option.setName("target").setDescription("Кого удалить").setRequired(false)),

  // Новая команда: syncnick — очищает серверный ник исполнителя, подставляется глобальное отображаемое имя
  new SlashCommandBuilder()
    .setName("syncnick")
    .setDescription("Очищает серверный ник — будет показано глобальное отображаемое имя (не трогает базу)"),

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

  const target = interaction.options.getUser("target") || interaction.user;
  const memberTarget = await interaction.guild.members.fetch(target.id);

  if (interaction.commandName === "setrealname") {
    const name = interaction.options.getString("name");

    // Проверка на VIP при изменении чужого имени
    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ Нет права изменять чужие имена!", ephemeral: true }).catch(()=>{});
      }
    }

    // Запрет повторного использования без удаления
    if (names[target.id]) {
      return interaction.reply({
        content: "❌ Не удалось обновить реальное имя. Очистите предыдущую запись через /removerealname и повторите запрос.",
        ephemeral: true
      });
    }

    // Максимальная длина ника
    const MAX_NICK_LENGTH = 32;
    const baseNick = memberTarget.displayName.split(" | ")[0];
    const extraLength = 3 + name.length; // " | " + длина реального имени

    // Если даже без базового ника реальное имя не влезает — ошибка
    if (extraLength > MAX_NICK_LENGTH) {
      return interaction.reply({
        content: "❌ Слишком длинное реальное имя! Уменьшите длину, чтобы итоговый ник не превышал 32 символа.",
        ephemeral: true
      });
    }

    // Обрезаем базовый ник при необходимости, чтобы итог не превышал 32 символа
    const baseNickTrimmed = (baseNick.length + extraLength > MAX_NICK_LENGTH)
      ? baseNick.substring(0, MAX_NICK_LENGTH - extraLength)
      : baseNick;
    const newNick = `${baseNickTrimmed} | ${name}`;

    // Сохраняем имя и пушим на GitHub
    names[target.id] = name;
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));
    await saveNamesToGitHub();

    try {
      await memberTarget.setNickname(newNick);
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} установлено: **${name}**`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }

  if (interaction.commandName === "removerealname") {
    if (!names[target.id]) {
      return interaction.reply({ content: "❌ Реальное имя у этого пользователя не установлено.", ephemeral: true });
    }

    const baseNick = memberTarget.displayName.split(" | ")[0];
    delete names[target.id];
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));
    await saveNamesToGitHub();

    try {
      await memberTarget.setNickname(baseNick); // очищаем серверный ник до базового
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} удалено`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }

  if (interaction.commandName === "syncnick") {
    // Вариант 1: очищаем серверный ник исполнителя, показывает глобальное имя; не трогаем базу
    const member = await interaction.guild.members.fetch(interaction.user.id);
    try {
      await member.setNickname(null); // сброс серверного ника — Discord подставит глобальное отображаемое имя
      await interaction.reply({ content: "✅ Серверный ник очищен. Теперь отображается ваше глобальное имя.", ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось сбросить ник. Проверьте права бота.", ephemeral: true });
    }
  }

  if (interaction.commandName === "ping") {
    await interaction.reply({ content: "🏓 Понг! Бот жив и работает 😎", ephemeral: true });
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
  const baseNickTrimmed = (baseNick.length + extraLength > MAX_NICK_LENGTH)
    ? baseNick.substring(0, MAX_NICK_LENGTH - extraLength)
    : baseNick;
  const expected = `${baseNickTrimmed} | ${realName}`;

  if (newMember.nickname !== expected) {
    try { await newMember.setNickname(expected); } catch {}
  }
});

// === Запуск бота ===
client.once("ready", () => console.log(`🤖 Бот запущен как ${client.user.tag}`));
client.login(TOKEN);
