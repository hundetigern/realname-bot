import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder } from "discord.js";
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

if (!TOKEN || !CLIENT_ID || !GUILD_ID || !GITHUB_TOKEN) {
  console.error("❌ Не заданы необходимые токены или ID");
  process.exit(1);
}

// === GitHub API ===
const octokit = new Octokit({ auth: GITHUB_TOKEN });
const owner = "твой-гитхаб-логин";
const repo = "realname-bot";
const path = "data/names.json";
const branch = "main";

// === Функции для работы с names.json на GitHub ===
async function loadNames() {
  try {
    const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    const content = Buffer.from(data.content, "base64").toString("utf8");
    return JSON.parse(content);
  } catch {
    return {}; // если файла нет или пустой
  }
}

async function saveNames(names) {
  const { data } = await octokit.repos.getContent({ owner, repo, path, ref: branch });
  await octokit.repos.createOrUpdateFileContents({
    owner, repo, path, message: "Обновление names.json ботом",
    content: Buffer.from(JSON.stringify(names, null, 2)).toString("base64"),
    sha: data.sha,
    branch
  });
}

// === Инициализация Discord клиента ===
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
    .setName("setrealname")
    .setDescription("Устанавливает реальное имя для себя или другого пользователя (VIP)")
    .addStringOption(opt => opt.setName("name").setDescription("Реальное имя").setRequired(true))
    .addUserOption(opt => opt.setName("target").setDescription("Другой пользователь").setRequired(false)),

  new SlashCommandBuilder()
    .setName("removerealname")
    .setDescription("Удаляет реальное имя пользователя (VIP)")
    .addUserOption(opt => opt.setName("target").setDescription("Пользователь").setRequired(false))
].map(c => c.toJSON());

const rest = new REST({ version: "10" }).setToken(TOKEN);

(async () => {
  try {
    console.log("⏳ Регистрирую команды /setrealname и /removerealname ...");
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("✅ Команды зарегистрированы!");
  } catch (err) {
    console.error("Ошибка регистрации команд:", err);
  }
})();

// === Обработка команд ===
client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  let names = await loadNames();

  // === /setrealname ===
  if (interaction.commandName === "setrealname") {
    const name = interaction.options.getString("name");
    const target = interaction.options.getUser("target") || interaction.user;

    // Проверка VIP, если изменяем чужое имя
    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ У вас нет права изменять имя других!", ephemeral: true });
      }
    }

    // Сохраняем и пушим на GitHub
    names[target.id] = name;
    await saveNames(names);

    // Меняем ник
    await interaction.guild.members.fetch();
    const memberTarget = interaction.guild.members.cache.get(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    const newNick = `${baseNick} | ${name}`;
    try {
      await memberTarget.setNickname(newNick);
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} установлено: **${name}**`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }

  // === /removerealname ===
  if (interaction.commandName === "removerealname") {
    const target = interaction.options.getUser("target") || interaction.user;

    if (target.id !== interaction.user.id) {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      if (!member.roles.cache.some(r => r.name === "🤴VIP👸")) {
        return interaction.reply({ content: "❌ У вас нет права изменять чужие имена!", ephemeral: true });
      }
    }

    if (!names[target.id]) return interaction.reply({ content: "❌ Реальное имя у этого пользователя не установлено.", ephemeral: true });

    delete names[target.id];
    await saveNames(names);

    // Убираем часть ника после " | "
    await interaction.guild.members.fetch();
    const memberTarget = interaction.guild.members.cache.get(target.id);
    const baseNick = memberTarget.displayName.split(" | ")[0];
    try {
      await memberTarget.setNickname(baseNick);
      await interaction.reply({ content: `✅ Реальное имя для ${target.username} удалено`, ephemeral: true });
    } catch {
      await interaction.reply({ content: "❌ Не удалось изменить ник. Проверьте права бота.", ephemeral: true });
    }
  }
});

// === Авто-восстановление ника ===
client.on("guildMemberUpdate", async (oldMember, newMember) => {
  let names = await loadNames();
  const id = newMember.id;
  if (!names[id]) return;
  const realName = names[id];
  const baseNick = newMember.displayName.split(" | ")[0];
  const expected = `${baseNick} | ${realName}`;
  if (newMember.nickname !== expected) {
    try {
      await newMember.setNickname(expected);
      console.log(`🔁 Ник обновлён для ${newMember.user.username} → ${expected}`);
    } catch {}
  }
});

// === Запуск ===
client.once("ready", () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
});

client.login(TOKEN);
