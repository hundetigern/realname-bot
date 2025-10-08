import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
import fetch from "node-fetch";
import express from "express";

// === Веб-сервер для Render ===
const app = express();
app.get("/", (req, res) => res.send("Bot is running!"));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Web server is online on port ${PORT}`));

// === Переменные окружения ===
const TOKEN = process.env.DISCORD_BOT_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO;
const GITHUB_FILE = process.env.GITHUB_FILE || "names.json";

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !GITHUB_TOKEN || !GITHUB_REPO) {
  console.error("❌ Не заданы все необходимые переменные окружения");
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

// === GitHub: загрузка и сохранение names.json ===
let names = {};

async function loadNames() {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  const res = await fetch(url, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
  const data = await res.json();
  if (data.content) {
    const buff = Buffer.from(data.content, "base64");
    names = JSON.parse(buff.toString("utf-8"));
    console.log("✅ Names loaded from GitHub");
  }
}

async function saveNames() {
  const url = `https://api.github.com/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`;
  const res = await fetch(url, { headers: { Authorization: `token ${GITHUB_TOKEN}` } });
  const data = await res.json();
  const sha = data.sha;

  const body = {
    message: "Update names.json via bot",
    content: Buffer.from(JSON.stringify(names, null, 2)).toString("base64"),
    sha,
  };

  await fetch(url, { method: "PUT", headers: { Authorization: `token ${GITHUB_TOKEN}` }, body: JSON.stringify(body) });
  console.log("✅ Names saved to GitHub");
}

// === Регистрация команд /setrealname и /removerealname ===
const commands = [
  new SlashCommandBuilder()
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя для себя или другого пользователя (VIP)")
    .addStringOption(option =>
      option.setName("name")
            .setDescription("Реальное имя")
            .setRequired(true)
    )
    .addUserOption(option =>
      option.setName("target")
            .setDescription("Пользователь, чьё имя изменить")
            .setRequired(false)
    ),
  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя для себя или другого пользователя (VIP)")
    .addUserOption(option =>
      option.setName("target")
            .setDescription("Пользователь, чьё имя удалить")
            .setRequired(false)
    )
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

  await loadNames(); // подгружаем актуальные имена

  // --- /setrealname ---
  if (interaction.commandName === "setrealname") {
    const name = interaction.options.getString("name");
    const target = interaction.options.getUser("target") || interaction.user;

    // Проверка VIP
    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ Нет права изменять чужие имена!", ephemeral: true });
      }
    }

    names[target.id] = name;

    // Меняем ник
    await interaction.guild.members.fetch();
    const memberTarget = interaction.guild.members.cache.get(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    const newNick = `${baseNick} | ${name}`;
    try {
      await memberTarget.setNickname(newNick);
      await saveNames();
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} установлено: **${name}**`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }

  // --- /removerealname ---
  if (interaction.commandName === "removerealname") {
    const target = interaction.options.getUser("target") || interaction.user;

    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ Нет права удалять чужие имена!", ephemeral: true });
      }
    }

    if (!names[target.id]) return interaction.reply({ content: "❌ Реальное имя у этого пользователя не установлено.", ephemeral: true });

    delete names[target.id];

    // Восстанавливаем базовый ник
    await interaction.guild.members.fetch();
    const memberTarget = interaction.guild.members.cache.get(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    try {
      await memberTarget.setNickname(baseNick);
      await saveNames();
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} удалено.`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }
});

// === Автообновление ника при ручной смене ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  await loadNames();
  const id = newMember.id;
  if (!names[id]) return;
  const realName = names[id];
  const baseNick = newMember.displayName.split(" | ")[0];
  const expected = `${baseNick} | ${realName}`;
  if (newMember.nickname !== expected) {
    try { await newMember.setNickname(expected); console.log(`🔁 Ник обновлён для ${newMember.user.username} → ${expected}`); }
    catch { console.log(`⚠️ Не удалось обновить ник для ${newMember.user.username}`); }
  }
});

// === Запуск ===
client.once("clientReady", () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
});

client.login(TOKEN);
