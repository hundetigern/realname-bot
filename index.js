import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs";
import express from "express";
import { Octokit } from "@octokit/rest";

// === Веб-сервер для Render / UptimeRobot ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server is online on port ${PORT}`));

// === Переменные окружения ===
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;

if (!TOKEN || !CLIENT_ID || !GUILD_ID) {
  console.error("❌ Не заданы DISCORD_BOT_TOKEN, CLIENT_ID или GUILD_ID");
  process.exit(1);
}

const octokit = new Octokit({ auth: GITHUB_TOKEN });
const [owner, repo] = GITHUB_REPO.split("/");

const dataFile = "./names.json";

// === Чтение/запись данных ===
async function loadNames() {
  try {
    const res = await octokit.repos.getContent({ owner, repo, path: "names.json" });
    const content = Buffer.from(res.data.content, "base64").toString("utf8");
    return JSON.parse(content);
  } catch {
    console.log("ℹ️ Файл names.json не найден в репозитории, создаём новый.");
    return {};
  }
}

async function saveNames(names) {
  const content = JSON.stringify(names, null, 2);
  const encoded = Buffer.from(content).toString("base64");
  try {
    const res = await octokit.repos.getContent({ owner, repo, path: "names.json" });
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "names.json",
      message: "Обновление realname-базы",
      content: encoded,
      sha: res.data.sha
    });
  } catch {
    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "names.json",
      message: "Создание realname-базы",
      content: encoded
    });
  }
}

// === Discord клиент ===
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

let names = await loadNames();

// === Регистрация команд ===
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверить, жив ли бот"),
  new SlashCommandBuilder()
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя для себя или другого пользователя (только VIP)")
    .addStringOption(opt =>
      opt.setName("name")
        .setDescription("Реальное имя (может быть из нескольких слов)")
        .setRequired(true))
    .addUserOption(opt =>
      opt.setName("target")
        .setDescription("Пользователь, чьё имя вы хотите изменить")
        .setRequired(false)),
  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя пользователя (только VIP)")
    .addUserOption(opt =>
      opt.setName("target")
        .setDescription("Пользователь, чьё имя вы хотите очистить")
        .setRequired(false))
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

  // /ping
  if (interaction.commandName === "ping") {
    return interaction.reply({ content: "🏓 Pong! Бот онлайн!", ephemeral: true });
  }

  // /setrealname
  if (interaction.commandName === "setrealname") {
    const name = interaction.options.getString("name");
    const target = interaction.options.getUser("target") || interaction.user;

    // Проверка VIP
    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ У вас нет прав менять чужие имена!", ephemeral: true });
      }
    }

    names[target.id] = name;
    await saveNames(names);

    const memberTarget = await interaction.guild.members.fetch(target.id);
    const base = memberTarget.displayName.split(" | ")[0];
    const newNick = `${base} | ${name}`.slice(0, 32);

    try {
      await memberTarget.setNickname(newNick);
      await interaction.reply({ content: `✅ Реальное имя для ${target.username}: **${name}**`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "⚠️ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }

  // /removerealname
  if (interaction.commandName === "removerealname") {
    const target = interaction.options.getUser("target") || interaction.user;
    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ У вас нет прав удалять чужие имена!", ephemeral: true });
      }
    }

    if (!names[target.id]) {
      return interaction.reply({ content: "⚠️ У этого пользователя нет сохранённого реального имени.", ephemeral: true });
    }

    delete names[target.id];
    await saveNames(names);

    const memberTarget = await interaction.guild.members.fetch(target.id);
    const base = memberTarget.displayName.split(" | ")[0];
    try {
      await memberTarget.setNickname(base);
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} удалено.`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "⚠️ Не удалось очистить ник. Проверьте права бота.", ephemeral: true });
    }
  }
});

// === Автоматическое восстановление ===
client.on("guildMemberUpdate", async (_, newMember) => {
  const id = newMember.id;
  if (!names[id]) return;
  const real = names[id];
  const base = newMember.displayName.split(" | ")[0];
  const expected = `${base} | ${real}`.slice(0, 32);
  if (newMember.nickname !== expected) {
    try {
      await newMember.setNickname(expected);
      console.log(`🔁 Ник обновлён: ${newMember.user.username} → ${expected}`);
    } catch {
      console.log(`⚠️ Не удалось обновить ник: ${newMember.user.username}`);
    }
  }
});

// === Запуск ===
client.once("ready", () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
});
client.login(TOKEN);
