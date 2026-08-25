const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder
} = require("discord.js");

const Database = require("better-sqlite3");

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("DISCORD_TOKEN غير موجود في Environment Variables");
  process.exit(1);
}

const db = new Database("points.db");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  points INTEGER DEFAULT 0,
  salary_at INTEGER DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS settings (
  guild_id TEXT PRIMARY KEY,
  allowed_roles TEXT DEFAULT '[]',
  blocked_roles TEXT DEFAULT '[]',
  all_staff INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS claims (
  ticket_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  claimer_id TEXT,
  claim_count INTEGER DEFAULT 0
);
`);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

function getUser(guildId, userId) {
  db.prepare(`
    INSERT OR IGNORE INTO users (guild_id, user_id)
    VALUES (?, ?)
  `).run(guildId, userId);

  return db.prepare(`
    SELECT * FROM users
    WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId);
}

function addPoints(guildId, userId, amount) {
  getUser(guildId, userId);

  db.prepare(`
    UPDATE users
    SET points = points + ?
    WHERE guild_id = ? AND user_id = ?
  `).run(amount, guildId, userId);

  return getUser(guildId, userId);
}

function getSettings(guildId) {
  db.prepare(`
    INSERT OR IGNORE INTO settings (guild_id)
    VALUES (?)
  `).run(guildId);

  const s = db.prepare(`
    SELECT * FROM settings WHERE guild_id = ?
  `).get(guildId);

  return {
    allowed: JSON.parse(s.allowed_roles),
    blocked: JSON.parse(s.blocked_roles),
    allStaff: Boolean(s.all_staff)
  };
}

function canManagePoints(message) {
  if (message.member.permissions.has(
    PermissionsBitField.Flags.Administrator
  )) {
    return true;
  }

  const settings = getSettings(message.guild.id);

  if (settings.allStaff) return true;

  return message.member.roles.cache.some(role =>
    settings.allowed.includes(role.id)
  );
}

client.once("ready", () => {
  console.log(`✅ ${client.user.tag} ONLINE`);
});

/* =========================
   MESSAGE COMMANDS
========================= */

client.on("messageCreate", async message => {
  if (message.author.bot || !message.guild) return;

  const content = message.content.trim();

  /* نقاطي */

  if (content === "#نقاطي") {
    const user = getUser(
      message.guild.id,
      message.author.id
    );

    return message.reply(
      `📊 **نقاطك**\n\n💰 رصيدك: **${user.points} نقطة**`
    );
  }

  /* TOP */

  if (content === "#top") {
    const users = db.prepare(`
      SELECT user_id, points
      FROM users
      WHERE guild_id = ?
      ORDER BY points DESC
      LIMIT 5
    `).all(message.guild.id);

    if (!users.length) {
      return message.reply("🏆 لا توجد نقاط حتى الآن.");
    }

    const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];

    const text = users.map((u, i) =>
      `${medals[i]} **المركز ${i + 1}** — <@${u.user_id}> | **${u.points} نقطة**`
    ).join("\n");

    return message.reply(
      `🏆 **TOP POINTS**\n\n${text}`
    );
  }

  /* الراتب */

  if (content === "#راتبي") {
    const user = getUser(
      message.guild.id,
      message.author.id
    );

    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;

    if (now - user.salary_at < day) {
      const remaining =
        day - (now - user.salary_at);

      const hours = Math.ceil(
        remaining / (60 * 60 * 1000)
      );

      return message.reply(
        `⏳ لم يحن موعد راتبك بعد.\n\nيمكنك استلامه بعد **${hours} ساعة تقريبًا**.`
      );
    }

    db.prepare(`
      UPDATE users
      SET points = points + 10,
          salary_at = ?
      WHERE guild_id = ? AND user_id = ?
    `).run(
      now,
      message.guild.id,
      message.author.id
    );

    const updated = getUser(
      message.guild.id,
      message.author.id
    );

    return message.reply(
      `💰 **تم استلام راتبك!**\n\n` +
      `➕ **+10 نقاط**\n` +
      `📊 رصيدك الآن: **${updated.points} نقطة**`
    );
  }

  /* ADD */

  if (content.startsWith("#add ")) {
    if (!canManagePoints(message)) {
      return message.reply(
        "❌ ليس لديك صلاحية استخدام هذا الأمر."
      );
    }

    const member =
      message.mentions.members.first();

    const args = content.split(/\s+/);
    const amount = Number(args[2]);

    if (
      !member ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return message.reply(
        "❌ الاستخدام الصحيح:\n`#add @العضو عدد`"
      );
    }

    const updated = addPoints(
      message.guild.id,
      member.id,
      amount
    );

    return message.reply(
      `✅ تم إضافة **${amount} نقطة** إلى ${member}.\n\n` +
      `📊 رصيده الآن: **${updated.points} نقطة**`
    );
  }

  /* خصم */

  if (content.startsWith("#- ")) {
    if (!canManagePoints(message)) {
      return message.reply(
        "❌ ليس لديك صلاحية استخدام هذا الأمر."
      );
    }

    const member =
      message.mentions.members.first();

    const args = content.split(/\s+/);
    const amount = Number(args[2]);

    if (
      !member ||
      !Number.isInteger(amount) ||
      amount <= 0
    ) {
      return message.reply(
        "❌ الاستخدام الصحيح:\n`#- @العضو عدد`"
      );
    }

    const updated = addPoints(
      message.guild.id,
      member.id,
      -amount
    );

    return message.reply(
      `➖ تم خصم **${amount} نقطة** من ${member}.\n\n` +
      `📊 رصيده الآن: **${updated.points} نقطة**`
    );
  }

  /* SETUP */

  if (content === "#setup") {
    if (
      message.author.id !== message.guild.ownerId &&
      !message.member.permissions.has(
        PermissionsBitField.Flags.Administrator
      )
    ) {
      return message.reply(
        "❌ هذا الأمر لصاحب السيرفر فقط."
      );
    }

    const embed = new EmbedBuilder()
      .setTitle("⚙️ إعداد نظام النقاط")
      .setDescription(
        "اختار الرتب التي تريد السماح لها باستخدام النظام.\n\n" +
        "⚫ **الرتب المسموح لها**\n" +
        "⚪ **الرتب الممنوعة**\n" +
        "🔴 **السماح لـ #add و #- للجميع**\n\n" +
        "اضغط **Done** بعد الانتهاء."
      );

    const row = new ActionRowBuilder().addComponents(

      new ButtonBuilder()
        .setCustomId("allowed_roles")
        .setLabel("اختيار الرتب المسموح بها")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("blocked_roles")
        .setLabel("اختيار الرتب الممنوعة")
        .setStyle(ButtonStyle.Secondary),

      new ButtonBuilder()
        .setCustomId("all_staff")
        .setLabel("السماح للجميع")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId("setup_done")
        .setLabel("Done")
        .setStyle(ButtonStyle.Success)
    );

    return message.reply({
      embeds: [embed],
      components: [row]
    });
  }
});

/* =========================
   BUTTONS
========================= */

client.on("interactionCreate", async interaction => {
  if (!interaction.isButton()) return;

  if (
    interaction.customId === "setup_done"
  ) {
    return interaction.reply({
      content: "✅ تم حفظ إعدادات نظام النقاط.",
      ephemeral: true
    });
  }

  if (
    interaction.customId === "all_staff"
  ) {
    db.prepare(`
      UPDATE settings
      SET all_staff = 1
      WHERE guild_id = ?
    `).run(interaction.guild.id);

    return interaction.reply({
      content:
        "🔴 تم السماح باستخدام `#add` و `#-` لجميع الرتب.",
      ephemeral: true
    });
  }

  if (
    interaction.customId === "allowed_roles"
  ) {
    return interaction.reply({
      content:
        "🛠️ سنضيف هنا قائمة رتب السيرفر في الخطوة التالية.",
      ephemeral: true
    });
  }

  if (
    interaction.customId === "blocked_roles"
  ) {
    return interaction.reply({
      content:
        "🛠️ سنضيف هنا قائمة الرتب الممنوعة في الخطوة التالية.",
      ephemeral: true
    });
  }
});

client.login(TOKEN);
