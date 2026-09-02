const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  RoleSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  ChannelType
} = require("discord.js");

const Database = require("better-sqlite3");

// ===============================
// TOKEN
// ===============================

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.log("❌ DISCORD_TOKEN غير موجود");
  process.exit(1);
}

// ===============================
// CLIENT
// ===============================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

// ===============================
// DATABASE
// ===============================

const db = new Database("database.sqlite");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  guild_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  points INTEGER NOT NULL DEFAULT 0,
  salary_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (guild_id, user_id)
);

CREATE TABLE IF NOT EXISTS ticket_settings (
  guild_id TEXT PRIMARY KEY,
  open_roles TEXT NOT NULL DEFAULT '[]',
  claim_roles TEXT NOT NULL DEFAULT '[]',
  close_roles TEXT NOT NULL DEFAULT '[]',
  view_roles TEXT NOT NULL DEFAULT '[]',
  category_id TEXT
);

CREATE TABLE IF NOT EXISTS tickets (
  channel_id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  opener_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  claimer_id TEXT,
  claimed INTEGER NOT NULL DEFAULT 0,
  closed INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
`);

// ===============================
// HELPERS
// ===============================

function getUser(guildId, userId) {
  let user = db
    .prepare(
      `SELECT * FROM users
       WHERE guild_id = ? AND user_id = ?`
    )
    .get(guildId, userId);

  if (!user) {
    db.prepare(
      `INSERT INTO users
       (guild_id, user_id, points, salary_at)
       VALUES (?, ?, 0, 0)`
    ).run(guildId, userId);

    user = db
      .prepare(
        `SELECT * FROM users
         WHERE guild_id = ? AND user_id = ?`
      )
      .get(guildId, userId);
  }

  return user;
}

function addPoints(guildId, userId, amount) {
  getUser(guildId, userId);

  db.prepare(
    `UPDATE users
     SET points = points + ?
     WHERE guild_id = ? AND user_id = ?`
  ).run(amount, guildId, userId);

  return getUser(guildId, userId);
}

function setPoints(guildId, userId, amount) {
  getUser(guildId, userId);

  db.prepare(
    `UPDATE users
     SET points = ?
     WHERE guild_id = ? AND user_id = ?`
  ).run(amount, guildId, userId);

  return getUser(guildId, userId);
}

function getTicketSettings(guildId) {
  let settings = db
    .prepare(
      `SELECT * FROM ticket_settings
       WHERE guild_id = ?`
    )
    .get(guildId);

  if (!settings) {
    db.prepare(
      `INSERT INTO ticket_settings
       (guild_id, open_roles, claim_roles, close_roles, view_roles, category_id)
       VALUES (?, '[]', '[]', '[]', '[]', NULL)`
    ).run(guildId);

    settings = db
      .prepare(
        `SELECT * FROM ticket_settings
         WHERE guild_id = ?`
      )
      .get(guildId);
  }

  return settings;
}

function roles(value) {
  try {
    return JSON.parse(value || "[]");
  } catch {
    return [];
  }
}

function hasRole(member, roleIds) {
  if (!member) return false;

  return roleIds.some((roleId) =>
    member.roles.cache.has(roleId)
  );
}

function isAdmin(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

function ticketInfo(channelId) {
  return db
    .prepare(
      `SELECT * FROM tickets
       WHERE channel_id = ?`
    )
    .get(channelId);
}

// ===============================
// TICKET PERMISSIONS
// ===============================

function canOpenTicket(member, settings) {
  if (isAdmin(member)) return true;

  const openRoles = roles(settings.open_roles);

  if (openRoles.length === 0) return true;

  return hasRole(member, openRoles);
}

function canClaimTicket(member, settings) {
  if (isAdmin(member)) return true;

  const claimRoles = roles(settings.claim_roles);

  if (claimRoles.length === 0) return false;

  return hasRole(member, claimRoles);
}

function canCloseTicket(member, settings) {
  if (isAdmin(member)) return true;

  const closeRoles = roles(settings.close_roles);

  if (closeRoles.length === 0) return false;

  return hasRole(member, closeRoles);
}

// ===============================
// READY
// ===============================

client.once("ready", () => {
  console.log(`✅ تم تشغيل البوت: ${client.user.tag}`);

  client.user.setActivity("#ticket | #نقاط", {
    type: 0
  });
});

// ===============================
// SETUP EMBED
// ===============================

function setupEmbed() {
  return new EmbedBuilder()
    .setTitle("⚙️ إعداد نظام التذاكر")
    .setDescription(
      "استخدم الأزرار والقوائم بالأسفل لإعداد نظام التذاكر.\n\n" +
      "🟢 **رتب فتح التذاكر:** الأشخاص المسموح لهم بفتح تذكرة.\n" +
      "🟡 **رتب الاستلام:** الأشخاص المسموح لهم بعمل Claim.\n" +
      "🔴 **رتب الإغلاق:** الأشخاص المسموح لهم بإغلاق التذكرة.\n" +
      "🔵 **رتب المشاهدة:** الرتب التي تستطيع مشاهدة التذاكر.\n" +
      "📁 **قسم التذاكر:** القسم الذي سيتم إنشاء التذاكر بداخله."
    );
}

// ===============================
// SETUP MENUS
// ===============================

function setupComponents() {
  const openRoles = new RoleSelectMenuBuilder()
    .setCustomId("setup_open_roles")
    .setPlaceholder("🟢 اختر رتب فتح التذاكر")
    .setMinValues(0)
    .setMaxValues(10);

  const claimRoles = new RoleSelectMenuBuilder()
    .setCustomId("setup_claim_roles")
    .setPlaceholder("🟡 اختر رتب الاستلام")
    .setMinValues(0)
    .setMaxValues(10);

  const closeRoles = new RoleSelectMenuBuilder()
    .setCustomId("setup_close_roles")
    .setPlaceholder("🔴 اختر رتب الإغلاق")
    .setMinValues(0)
    .setMaxValues(10);

  const viewRoles = new RoleSelectMenuBuilder()
    .setCustomId("setup_view_roles")
    .setPlaceholder("🔵 اختر رتب المشاهدة")
    .setMinValues(0)
    .setMaxValues(10);

  const category = new ChannelSelectMenuBuilder()
    .setCustomId("setup_category")
    .setPlaceholder("📁 اختر قسم التذاكر")
    .setChannelTypes(ChannelType.GuildCategory)
    .setMinValues(1)
    .setMaxValues(1);

  return [
    new ActionRowBuilder().addComponents(openRoles),
    new ActionRowBuilder().addComponents(claimRoles),
    new ActionRowBuilder().addComponents(closeRoles),
    new ActionRowBuilder().addComponents(viewRoles),
    new ActionRowBuilder().addComponents(category)
  ];
}

// ===============================
// TICKET PANEL
// ===============================

function ticketPanel() {
  const embed = new EmbedBuilder()
    .setTitle("🎫 نظام التذاكر")
    .setDescription(
      "اضغط على الزر بالأسفل لفتح تذكرة.\n\n" +
      "سيتم إنشاء التذكرة لك تلقائيًا."
    );

  const button = new ButtonBuilder()
    .setCustomId("create_ticket")
    .setLabel("فتح تذكرة")
    .setEmoji("🎫")
    .setStyle(ButtonStyle.Primary);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(button)
    ]
  };
}

// ===============================
// TICKET MESSAGE
// ===============================

function ticketMessage() {
  const embed = new EmbedBuilder()
    .setTitle("🎫 التذكرة")
    .setDescription(
      "أهلًا بك في التذكرة.\n\n" +
      "اضغط **استلام التذكرة** حتى تصبح مسؤولًا عنها.\n" +
      "بعد الاستلام سيتم احتساب **+3 نقاط**."
    );

  const claim = new ButtonBuilder()
    .setCustomId("claim_ticket")
    .setLabel("استلام التذكرة")
    .setEmoji("📌")
    .setStyle(ButtonStyle.Success);

  const close = new ButtonBuilder()
    .setCustomId("close_ticket")
    .setLabel("إغلاق التذكرة")
    .setEmoji("🔒")
    .setStyle(ButtonStyle.Danger);

  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        claim,
        close
      )
    ]
  };
}

// ===============================
// CREATE TICKET PERMISSIONS
// ===============================

function ticketOverwrites(guild, opener, settings) {
  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionsBitField.Flags.ViewChannel
      ]
    },

    {
      id: opener.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    },

    {
      id: guild.members.me.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageChannels
      ]
    }
  ];

  const staffRoles = [
    ...roles(settings.claim_roles),
    ...roles(settings.close_roles),
    ...roles(settings.view_roles)
  ];

  const uniqueRoles = [...new Set(staffRoles)];

  for (const roleId of uniqueRoles) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory
      ],
      deny: [
        PermissionsBitField.Flags.SendMessages
      ]
    });
  }

  return overwrites;
}

// ===============================
// INTERACTIONS
// ===============================

client.on("interactionCreate", async (interaction) => {
  try {
    // ===========================
    // CREATE TICKET
    // ===========================

    if (
      interaction.isButton() &&
      interaction.customId === "create_ticket"
    ) {
      const guild = interaction.guild;
      const member = interaction.member;

      const settings = getTicketSettings(guild.id);

      if (!canOpenTicket(member, settings)) {
        return interaction.reply({
          content: "❌ ليس لديك رتبة تسمح لك بفتح تذكرة.",
          ephemeral: true
        });
      }

      if (!settings.category_id) {
        return interaction.reply({
          content:
            "❌ لم يتم تحديد قسم التذاكر.\nاستخدم `#setup ticket` أولًا.",
          ephemeral: true
        });
      }

      const existing = db
        .prepare(
          `SELECT * FROM tickets
           WHERE guild_id = ?
           AND opener_id = ?
           AND closed = 0`
        )
        .get(guild.id, interaction.user.id);

      if (existing) {
        const existingChannel =
          guild.channels.cache.get(existing.channel_id);

        if (existingChannel) {
          return interaction.reply({
            content:
              `❌ لديك تذكرة مفتوحة بالفعل: ${existingChannel}`,
            ephemeral: true
          });
        }
      }

      const modal = new ModalBuilder()
        .setCustomId("ticket_reason")
        .setTitle("فتح تذكرة");

      const reason = new TextInputBuilder()
        .setCustomId("reason")
        .setLabel("سبب فتح التذكرة")
        .setStyle(TextInputStyle.Paragraph)
        .setPlaceholder("اكتب سبب فتح التذكرة...")
        .setRequired(true)
        .setMaxLength(1000);

      modal.addComponents(
        new ActionRowBuilder().addComponents(reason)
      );

      return interaction.showModal(modal);
    }

    // ===========================
    // MODAL
    // ===========================

    if (
      interaction.isModalSubmit() &&
      interaction.customId === "ticket_reason"
    ) {
      const guild = interaction.guild;
      const member = interaction.member;

      const settings = getTicketSettings(guild.id);

      if (!settings.category_id) {
        return interaction.reply({
          content: "❌ لم يتم تحديد قسم التذاكر.",
          ephemeral: true
        });
      }

      const reason =
        interaction.fields.getTextInputValue("reason");

      const channel = await guild.channels.create({
        name: `ticket-${interaction.user.username}`
          .toLowerCase()
          .replace(/[^a-z0-9-_]/g, "")
          .slice(0, 20) || "ticket",

        type: ChannelType.GuildText,

        parent: settings.category_id,

        permissionOverwrites:
          ticketOverwrites(
            guild,
            member,
            settings
          )
      });

      db.prepare(
        `INSERT INTO tickets
        (
          channel_id,
          guild_id,
          opener_id,
          reason,
          claimer_id,
          claimed,
          closed,
          created_at
        )
        VALUES (?, ?, ?, ?, NULL, 0, 0, ?)`
      ).run(
        channel.id,
        guild.id,
        interaction.user.id,
        reason,
        Date.now()
      );

      const embed = ticketMessage();

      embed.embeds[0].addFields({
        name: "👤 صاحب التذكرة",
        value: `${interaction.user}`,
        inline: true
      });

      embed.embeds[0].addFields({
        name: "📝 السبب",
        value: reason,
        inline: false
      });

      await channel.send({
        content: `${interaction.user}`,
        embeds: embed.embeds,
        components: embed.components
      });

      return interaction.reply({
        content: `✅ تم إنشاء التذكرة: ${channel}`,
        ephemeral: true
      });
    }

    // ===========================
    // CLAIM
    // ===========================

    if (
      interaction.isButton() &&
      interaction.customId === "claim_ticket"
    ) {
      const ticket = ticketInfo(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content: "❌ هذه القناة ليست تذكرة.",
          ephemeral: true
        });
      }

      const settings =
        getTicketSettings(interaction.guild.id);

      if (!canClaimTicket(interaction.member, settings)) {
        return interaction.reply({
          content:
            "❌ ليس لديك رتبة تسمح لك باستلام التذاكر.",
          ephemeral: true
        });
      }

      if (ticket.claimed) {
        addPoints(
          interaction.guild.id,
          interaction.user.id,
          -50
        );

        return interaction.reply({
          content:
            "⚠️ التذكرة تم استلامها بالفعل.\nتم خصم **50 نقطة** منك.",
          ephemeral: true
        });
      }

      db.prepare(
        `UPDATE tickets
         SET claimed = 1,
             claimer_id = ?
         WHERE channel_id = ?`
      ).run(
        interaction.user.id,
        interaction.channel.id
      );

      addPoints(
        interaction.guild.id,
        interaction.user.id,
        3
      );

      await interaction.channel.permissionOverwrites.edit(
        interaction.member.id,
        {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        }
      );

      const embed = new EmbedBuilder()
        .setTitle("📌 تم استلام التذكرة")
        .setDescription(
          `تم استلام التذكرة بواسطة ${interaction.user}\n\n` +
          "⭐ حصلت على **+3 نقاط**."
        );

      return interaction.reply({
        embeds: [embed]
      });
    }

    // ===========================
    // CLOSE
    // ===========================

    if (
      interaction.isButton() &&
      interaction.customId === "close_ticket"
    ) {
      const ticket = ticketInfo(interaction.channel.id);

      if (!ticket) {
        return interaction.reply({
          content: "❌ هذه القناة ليست تذكرة.",
          ephemeral: true
        });
      }

      const settings =
        getTicketSettings(interaction.guild.id);

      if (!canCloseTicket(interaction.member, settings)) {
        return interaction.reply({
          content:
            "❌ ليس لديك رتبة تسمح لك بإغلاق التذاكر.",
          ephemeral: true
        });
      }

      db.prepare(
        `UPDATE tickets
         SET closed = 1
         WHERE channel_id = ?`
      ).run(interaction.channel.id);

      await interaction.channel.permissionOverwrites.edit(
        ticket.opener_id,
        {
          ViewChannel: true,
          SendMessages: false,
          ReadMessageHistory: true
        }
      );

      const embed = new EmbedBuilder()
        .setTitle("🔒 تم إغلاق التذكرة")
        .setDescription(
          `تم إغلاق التذكرة بواسطة ${interaction.user}.\n` +
          "سيتم حذف القناة خلال 10 ثوانٍ."
        );

      await interaction.reply({
        embeds: [embed]
      });

      setTimeout(async () => {
        await interaction.channel.delete().catch(() => {});
      }, 10000);

      return;
    }

    // ===========================
    // SETUP OPEN ROLES
    // ===========================

    if (
      interaction.isRoleSelectMenu() &&
      interaction.customId === "setup_open_roles"
    ) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ يجب أن تكون Administrator.",
          ephemeral: true
        });
      }

      db.prepare(
        `UPDATE ticket_settings
         SET open_roles = ?
         WHERE guild_id = ?`
      ).run(
        JSON.stringify(interaction.values),
        interaction.guild.id
      );

      return interaction.reply({
        content: "✅ تم حفظ رتب فتح التذاكر.",
        ephemeral: true
      });
    }

    // ===========================
    // SETUP CLAIM ROLES
    // ===========================

    if (
      interaction.isRoleSelectMenu() &&
      interaction.customId === "setup_claim_roles"
    ) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ يجب أن تكون Administrator.",
          ephemeral: true
        });
      }

      db.prepare(
        `UPDATE ticket_settings
         SET claim_roles = ?
         WHERE guild_id = ?`
      ).run(
        JSON.stringify(interaction.values),
        interaction.guild.id
      );

      return interaction.reply({
        content: "✅ تم حفظ رتب استلام التذاكر.",
        ephemeral: true
      });
    }

    // ===========================
    // SETUP CLOSE ROLES
    // ===========================

    if (
      interaction.isRoleSelectMenu() &&
      interaction.customId === "setup_close_roles"
    ) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ يجب أن تكون Administrator.",
          ephemeral: true
        });
      }

      db.prepare(
        `UPDATE ticket_settings
         SET close_roles = ?
         WHERE guild_id = ?`
      ).run(
        JSON.stringify(interaction.values),
        interaction.guild.id
      );

      return interaction.reply({
        content: "✅ تم حفظ رتب إغلاق التذاكر.",
        ephemeral: true
      });
    }

    // ===========================
    // SETUP VIEW ROLES
    // ===========================

    if (
      interaction.isRoleSelectMenu() &&
      interaction.customId === "setup_view_roles"
    ) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ يجب أن تكون Administrator.",
          ephemeral: true
        });
      }

      db.prepare(
        `UPDATE ticket_settings
         SET view_roles = ?
         WHERE guild_id = ?`
      ).run(
        JSON.stringify(interaction.values),
        interaction.guild.id
      );

      return interaction.reply({
        content: "✅ تم حفظ رتب مشاهدة التذاكر.",
        ephemeral: true
      });
    }

    // ===========================
    // SETUP CATEGORY
    // ===========================

    if (
      interaction.isChannelSelectMenu() &&
      interaction.customId === "setup_category"
    ) {
      if (!isAdmin(interaction.member)) {
        return interaction.reply({
          content: "❌ يجب أن تكون Administrator.",
          ephemeral: true
        });
      }

      const categoryId = interaction.values[0];

      db.prepare(
        `UPDATE ticket_settings
         SET category_id = ?
         WHERE guild_id = ?`
      ).run(
        categoryId,
        interaction.guild.id
      );

      return interaction.reply({
        content: "✅ تم حفظ قسم التذاكر.",
        ephemeral: true
      });
    }
  } catch (error) {
    console.error("Interaction Error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ حدث خطأ.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ===============================
// MESSAGE COMMANDS
// ===============================

client.on("messageCreate", async (message) => {
  try {
    if (message.author.bot) return;

    if (!message.guild) return;

    // ===========================
    // #ticket
    // ===========================

    if (message.content === "#ticket") {
      if (!isAdmin(message.member)) {
        return message.reply(
          "❌ يجب أن تكون Administrator."
        );
      }

      const settings =
        getTicketSettings(message.guild.id);

      if (!settings.category_id) {
        return message.reply(
          "❌ يجب إعداد نظام التذاكر أولًا باستخدام `#setup ticket`."
        );
      }

      return message.channel.send(
        ticketPanel()
      );
    }

    // ===========================
    // #setup ticket
    // ===========================

    if (message.content === "#setup ticket") {
      if (!isAdmin(message.member)) {
        return message.reply(
          "❌ يجب أن تكون Administrator."
        );
      }

      getTicketSettings(message.guild.id);

      return message.channel.send({
        embeds: [setupEmbed()],
        components: setupComponents()
      });
    }

    // ===========================
    // #claim
    // ===========================

    if (message.content === "#claim") {
      const ticket = ticketInfo(
        message.channel.id
      );

      if (!ticket) {
        return message.reply(
          "❌ هذه القناة ليست تذكرة."
        );
      }

      const settings =
        getTicketSettings(message.guild.id);

      if (!canClaimTicket(message.member, settings)) {
        return message.reply(
          "❌ ليس لديك رتبة تسمح لك باستلام التذاكر."
        );
      }

      if (ticket.claimed) {
        addPoints(
          message.guild.id,
          message.author.id,
          -50
        );

        return message.reply(
          "⚠️ التذكرة مستلمة بالفعل.\nتم خصم **50 نقطة** منك."
        );
      }

      db.prepare(
        `UPDATE tickets
         SET claimed = 1,
             claimer_id = ?
         WHERE channel_id = ?`
      ).run(
        message.author.id,
        message.channel.id
      );

      addPoints(
        message.guild.id,
        message.author.id,
        3
      );

      await message.channel.permissionOverwrites.edit(
        message.author.id,
        {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true
        }
      );

      return message.reply(
        `📌 تم استلام التذكرة بواسطة ${message.author}.\n⭐ +3 نقاط`
      );
    }

    // ===========================
    // #نقاط
    // ===========================

    if (
      message.content === "#نقاط" ||
      message.content === "#points"
    ) {
      const user = getUser(
        message.guild.id,
        message.author.id
      );

      return message.reply(
        `⭐ نقاطك: **${user.points}**`
      );
    }

    // ===========================
    // #addpoints
    // ===========================

    if (
      message.content.startsWith("#addpoints ")
    ) {
      if (!isAdmin(message.member)) {
        return message.reply(
          "❌ يجب أن تكون Administrator."
        );
      }

      const args = message.content
        .trim()
        .split(/\s+/);

      const member =
        message.mentions.members.first();

      const amount = Number(args[2]);

      if (!member || !Number.isInteger(amount)) {
        return message.reply(
          "❌ الاستخدام الصحيح:\n`#addpoints @user 10`"
        );
      }

      const user = addPoints(
        message.guild.id,
        member.id,
        amount
      );

      return message.reply(
        `✅ تم تعديل نقاط ${member}.\n⭐ النقاط الحالية: **${user.points}**`
      );
    }

    // ===========================
    // #setpoints
    // ===========================

    if (
      message.content.startsWith("#setpoints ")
    ) {
      if (!isAdmin(message.member)) {
        return message.reply(
          "❌ يجب أن تكون Administrator."
        );
      }

      const args = message.content
        .trim()
        .split(/\s+/);

      const member =
        message.mentions.members.first();

      const amount = Number(args[2]);

      if (!member || !Number.isInteger(amount)) {
        return message.reply(
          "❌ الاستخدام الصحيح:\n`#setpoints @user 100`"
        );
      }

      const user = setPoints(
        message.guild.id,
        member.id,
        amount
      );

      return message.reply(
        `✅ تم تحديد نقاط ${member} إلى **${user.points}**.`
      );
    }
  } catch (error) {
    console.error(
      "Message Error:",
      error
    );

    await message.reply(
      "❌ حدث خطأ."
    ).catch(() => {});
  }
});

// ===============================
// LOGIN
// ===============================

client.login(TOKEN);
