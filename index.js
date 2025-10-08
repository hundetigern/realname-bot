import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs";
import express from "express";
import { Octokit } from "@octokit/rest";

// === Веб-сервер для Render/UptimeRobot ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web server is online on port ${PORT}`));

// === Переменные окружения ===
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = "hundetigern/realname-bot"; // <- твой репозиторий с names.json

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

// === Names.json ===
const dataFile = "./data/names.json";
let names = fs.existsSync(dataFile)
  ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
  : {};

// === GitHub API ===
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// === Команды ===
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
    .setDescription("Удаляет реальное имя пользователя (только VIP)")
    .addUserOption(option =>
      option.setName("target")
            .setDescription("Пользователь, чьё имя удалить")
            .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверка работы бота")
].map(c => c.toJSON());

// === Регистрация команд ===
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

// === Хелпер для сохранения на GitHub ===
async function saveNamesToGitHub() {
  const content = JSON.stringify(names, null, 2);
  const path = "data/names.json";

  try {
    // Получаем SHA существующего файла
    let sha;
    try {
      const resp = await octokit.repos.getContent({
        owner: GITHUB_REPO.split("/")[0],
        repo: GITHUB_REPO.split("/")[1],
        path,
      });
      sha = resp.data.sha;
    } catch {}

    await octokit.repos.createOrUpdateFileContents({
      owner: GITHUB_REPO.split("/")[0],
      repo: GITHUB_REPO.split("/")[1],
      path,
      message: "Обновлены реальные имена пользователей",
      content: Buffer.from(content).toString("base64"),
      sha,
    });
    console.log("✅ names.json успешно обновлён на GitHub");
  } catch (err) {
    console.error("❌ Ошибка при сохранении names.json на GitHub:", err);
  }
}

// === Ограничение длины ника ===
const MAX_NICK_LENGTH = 32;
function formatNick(baseNick, realName) {
  const extraLength = 3 + realName.length; // " | " + длина реального имени
  let trimmedBase = baseNick;
  if ((baseNick.length + extraLength) > MAX_NICK_LENGTH) {
    trimmedBase = baseNick.substring(0, MAX_NICK_LENGTH - extraLength);
  }
  return `${trimmedBase} | ${realName}`;
}

// === Обработка команд ===
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "ping") {
    await interaction.reply({
      content: "🏓 Понг! Бот работает и готов управлять реальными именами! 😎",
      ephemeral: true,
    });
  }

  if (interaction.commandName === "setrealname") {
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
    await saveNamesToGitHub();

    await interaction.guild.members.fetch();
    const memberTarget = interaction.guild.members.cache.get(target.id);
    const newNick = formatNick(memberTarget.displayName.split(" | ")[0], name);
    try {
      await memberTarget.setNickname(newNick);
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} установлено: **${name}**`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }

  if (interaction.commandName === "removerealname") {
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
    await saveNamesToGitHub();

    await interaction.guild.members.fetch();
    const memberTarget = interaction.guild.members.cache.get(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    try {
      await memberTarget.setNickname(baseNick);
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} удалено.`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }
});

// === Автообновление никнейма ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const id = newMember.id;
  if (!names[id]) return;
  const realName = names[id];
  const baseNick = newMember.displayName.split(" | ")[0];
  const expected = formatNick(baseNick, realName);

  if (newMember.nickname !== expected) {
    try {
      await newMember.setNickname(expected);
      console.log(`🔁 Ник обновлён для ${newMember.user.username} → ${expected}`);
    } catch {
      console.log(`⚠️ Не удалось обновить ник для ${newMember.user.username}`);
    }
  }
});

// === Автосохранение на GitHub каждые 5 минут ===
setInterval(saveNamesToGitHub, 5 * 60 * 1000);

// === Запуск бота ===
client.once("clientReady", () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
});

client.login(TOKEN);
