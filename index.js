import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fs from "fs";
import express from "express";
import { Octokit } from "@octokit/rest";

// === Веб-сервер для Render ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🌐 Web server is online on port ${PORT}`));

// === Переменные окружения ===
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO || "hundetigern/realname-bot"; // <-- твой репозиторий

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !GITHUB_TOKEN) {
  console.error("❌ Отсутствуют необходимые переменные окружения");
  process.exit(1);
}

// === GitHub клиент ===
const octokit = new Octokit({ auth: GITHUB_TOKEN });
const [owner, repo] = GITHUB_REPO.split("/");

// === Работа с файлом ===
const dataFile = "./data/names.json";
let names = {};

if (fs.existsSync(dataFile)) {
  try {
    names = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  } catch {
    names = {};
  }
} else {
  fs.mkdirSync("./data", { recursive: true });
  fs.writeFileSync(dataFile, "{}");
}

// === Discord клиент ===
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ],
});

// === Команды ===
const commands = [
  new SlashCommandBuilder()
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя для себя или другого пользователя (только VIP)")
    .addStringOption(option =>
      option.setName("name").setDescription("Реальное имя").setRequired(true)
    )
    .addUserOption(option =>
      option.setName("target").setDescription("Пользователь (опционально)").setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя пользователя"),
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверить, жив ли бот"),
];

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
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  if (commandName === "ping") {
    return interaction.reply({
      content: "🏓 Понг! Всё отлично — бот жив, бодр, и готов управлять реальными именами пользователей 😎",
      ephemeral: true
    });
  }

  if (commandName === "setrealname") {
    const name = interaction.options.getString("name");
    const target = interaction.options.getUser("target") || interaction.user;

    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({
          content: "❌ У вас нет права изменять имя других пользователей!",
          ephemeral: true
        });
      }
    }

    names[target.id] = name;
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

    const memberTarget = await interaction.guild.members.fetch(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    const shortBase = baseNick.slice(0, 25 - name.length); // чтобы не превышать лимит
    const newNick = `${shortBase} | ${name}`;

    try {
      await memberTarget.setNickname(newNick);
      await interaction.reply({
        content: `✅ Реальное имя для ${target.username} установлено: **${name}**`,
        ephemeral: true
      });
      await updateGitHubFile();
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "❌ Не удалось изменить ник. Проверьте права бота.",
        ephemeral: true
      });
    }
  }

  if (commandName === "removerealname") {
    const userId = interaction.user.id;
    if (!names[userId]) {
      return interaction.reply({
        content: "❌ Реальное имя у этого пользователя не установлено.",
        ephemeral: true
      });
    }

    delete names[userId];
    fs.writeFileSync(dataFile, JSON.stringify(names, null, 2));

    const member = await interaction.guild.members.fetch(userId);
    const baseNick = member.displayName.split(" | ")[0];

    try {
      await member.setNickname(baseNick);
      await interaction.reply({
        content: "✅ Реальное имя удалено.",
        ephemeral: true
      });
      await updateGitHubFile();
    } catch (err) {
      console.error(err);
      await interaction.reply({
        content: "⚠️ Не удалось обновить ник, но имя удалено из базы.",
        ephemeral: true
      });
    }
  }
});

// === Восстановление ников ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  const id = newMember.id;
  if (!names[id]) return;

  const realName = names[id];
  const baseNick = newMember.displayName.split(" | ")[0];
  const shortBase = baseNick.slice(0, 25 - realName.length);
  const expected = `${shortBase} | ${realName}`;

  if (newMember.nickname !== expected) {
    try {
      await newMember.setNickname(expected);
      console.log(`🔁 Ник обновлён для ${newMember.user.username}`);
    } catch {
      console.log(`⚠️ Не удалось обновить ник для ${newMember.user.username}`);
    }
  }
});

// === Функция автосейва на GitHub ===
async function updateGitHubFile() {
  try {
    const content = fs.readFileSync(dataFile, "utf8");
    const { data: file } = await octokit.repos.getContent({ owner, repo, path: "data/names.json" });

    await octokit.repos.createOrUpdateFileContents({
      owner,
      repo,
      path: "data/names.json",
      message: "Автосейв: обновлены реальные имена",
      content: Buffer.from(content).toString("base64"),
      sha: file.sha
    });

    console.log("✅ names.json успешно обновлён на GitHub");
  } catch (err) {
    console.error("⚠️ Ошибка при обновлении names.json:", err.message);
  }
}

// === Автосейв каждые 5 минут ===
setInterval(updateGitHubFile, 5 * 60 * 1000);

// === Запуск ===
client.once("ready", () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
});

client.login(TOKEN);
