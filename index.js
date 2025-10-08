import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs";
import express from "express";
import { Octokit } from "@octokit/rest";

// === Веб-сервер для Render ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Web server is online on port ${PORT}`));

// === Переменные окружения ===
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "hundetigern/realname-bot";

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !GITHUB_TOKEN) {
  console.error("❌ Не заданы DISCORD_BOT_TOKEN, CLIENT_ID, GUILD_ID или GITHUB_TOKEN");
  process.exit(1);
}

const [owner, repo] = GITHUB_REPO.split("/");
const octokit = new Octokit({ auth: GITHUB_TOKEN });

// === Локальный файл с именами ===
const dataFile = "./data/names.json";
let names = fs.existsSync(dataFile)
  ? JSON.parse(fs.readFileSync(dataFile, "utf8"))
  : {};

// === Инициализация клиента Discord ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
  ],
});

// === Регистрация команд ===
const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверить, жив ли бот"),
  new SlashCommandBuilder()
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя (только VIP может менять чужие)")
    .addStringOption(option =>
      option.setName("name").setDescription("Реальное имя").setRequired(true)
    )
    .addUserOption(option =>
      option.setName("target").setDescription("Пользователь").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя у пользователя")
    .addUserOption(option =>
      option.setName("target").setDescription("Пользователь").setRequired(false)
    ),
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

  if (interaction.commandName === "ping") {
    await interaction.reply({ content: "🏓 Бот на связи!", ephemeral: true });
  }

  if (interaction.commandName === "setrealname") {
    const name = interaction.options.getString("name");
    const target = interaction.options.getUser("target") || interaction.user;

    // Проверка VIP
    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ Нет прав менять имя других!", ephemeral: true });
      }
    }

    // Сохраняем имя локально
    names[target.id] = name;
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

    // Пытаемся отправить обновлённый файл в GitHub
    try {
      const content = Buffer.from(JSON.stringify(names, null, 2)).toString("base64");

      // Получаем SHA, если файл уже существует
      let sha;
      try {
        const res = await octokit.repos.getContent({ owner, repo, path: "data/names.json" });
        sha = res.data.sha;
      } catch {
        sha = undefined;
      }

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: "data/names.json",
        message: `Update names.json for ${target.username}`,
        content,
        sha,
      });

      console.log("✅ names.json успешно обновлён на GitHub");
    } catch (err) {
      console.error("⚠️ Ошибка при обновлении GitHub:", err.message);
    }

    // Меняем ник
    await interaction.guild.members.fetch();
    const memberTarget = interaction.guild.members.cache.get(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0].slice(0, 25); // ограничим длину
    const newNick = `${baseNick} | ${name}`.slice(0, 32);

    try {
      await memberTarget.setNickname(newNick);
      await interaction.reply({ content: `✅ Реальное имя для ${target.username}: **${name}**`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник.", ephemeral: true });
    }
  }

  if (interaction.commandName === "removerealname") {
    const target = interaction.options.getUser("target") || interaction.user;

    if (!names[target.id]) {
      return interaction.reply({ content: "❌ У этого пользователя нет реального имени.", ephemeral: true });
    }

    delete names[target.id];
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

    try {
      const content = Buffer.from(JSON.stringify(names, null, 2)).toString("base64");
      const res = await octokit.repos.getContent({ owner, repo, path: "data/names.json" });

      await octokit.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: "data/names.json",
        message: `Remove name for ${target.username}`,
        content,
        sha: res.data.sha,
      });

      console.log("✅ Удалено имя и обновлён GitHub");
    } catch (err) {
      console.error("⚠️ Ошибка при обновлении GitHub:", err.message);
    }

    const memberTarget = await interaction.guild.members.fetch(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    try {
      await memberTarget.setNickname(baseNick);
      await interaction.reply({ content: `🧹 Реальное имя удалено у ${target.username}`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "⚠️ Не удалось обновить ник.", ephemeral: true });
    }
  }
});

// === Автоматическое восстановление ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const id = newMember.id;
  if (!names[id]) return;

  const realName = names[id];
  const baseNick = newMember.displayName.split(" | ")[0].slice(0, 25);
  const expected = `${baseNick} | ${realName}`.slice(0, 32);

  if (newMember.nickname !== expected) {
    try {
      await newMember.setNickname(expected);
      console.log(`🔁 Ник обновлён для ${newMember.user.username}`);
    } catch {
      console.log(`⚠️ Не удалось обновить ник для ${newMember.user.username}`);
    }
  }
});

client.once("ready", () => console.log(`🤖 Бот запущен как ${client.user.tag}`));
client.login(TOKEN);
