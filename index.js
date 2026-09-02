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

const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.log("❌ DISCORD_TOKEN غير موجود");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

const db = new Database("points.db");

db.pragma("journal_mode = WAL");

// ===============================
// DATABASE
// ===============================

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
  let user = db.prepare(`
    SELECT * FROM users
    WHERE guild_id = ? AND user_id = ?
  `).get(guildId, userId);

  if (!user) {
    db.prepare(`
      INSERT INTO users (guild_id, user_id, points)
      VALUES (?, ?, 0)
    `).run(guildId, userId);

    user = db.prepare(`
      SELECT * FROM users
      WHERE guild_id = ? AND user_id = ?
    `).get(guildId, userId);
  }

  return user;
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

function setPoints(guildId, userId, amount) {
  getUser(guildId, userId);

  db.prepare(`
    UPDATE users
    SET points = ?
    WHERE guild_id = ? AND user_id = ?
  `).run(amount, guildId, userId);

  return getUser(guildId, userId);
}

function getTicketSettings(guildId) {
  let settings = db.prepare(`
    SELECT * FROM ticket_settings
    WHERE guild_id = ?
  `).get(guildId);

  if (!settings) {
    db.prepare(`
      INSERT INTO ticket_settings (guild_id)
      VALUES (?)
    `).run(guildId);

    settings = db.prepare(`
      SELECT * FROM ticket_settings
      WHERE guild_id = ?
    `).get(guildId);
  }

  return settings;
}

function roles(value) {
  try {
    const data = JSON.parse(value || "[]");
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function hasRole(member, roleIds) {
  return roleIds.some(id => member.roles.cache.has(id));
}

function isAdmin(member) {
  return member.permissions.has(
    PermissionsBitField.Flags.Administrator
  );
}

function ticketInfo(channelId) {
  return db.prepare(`
    SELECT * FROM tickets
    WHERE channel_id = ?
  `).get(channelId);
}

// ===============================
// PERMISSIONS
// ===============================

function canOpenTicket(member) {
  if (isAdmin(member)) return true;

  const settings = getTicketSettings(member.guild.id);
  const openRoles = roles(settings.open_roles);

  return hasRole(member, openRoles);
}

function canClaimTicket(member) {
  if (isAdmin(member)) return true;

  const settings = getTicketSettings(member.guild.id);
  const claimRoles = roles(settings.claim_roles);

  return hasRole(member, claimRoles);
}

function canCloseTicket(member) {
  if (isAdmin(member)) return true;

  const settings = getTicketSettings(member.guild.id);
  const closeRoles = roles(settings.close_roles);

  return hasRole(member, closeRoles);
}

// ===============================
// SETUP EMBED
// ===============================

function setupEmbed(guildId) {
  const s = getTicketSettings(guildId);

  const open = roles(s.open_roles);
  const claim = roles(s.claim_roles);
  const close = roles(s.close_roles);
  const view = roles(s.view_roles);

  return new EmbedBuilder()
    .setTitle("⚙️ إعداد نظام التذاكر")
    .setDescription(
      "**الإعدادات الحالية:**\n\n" +

      "🎫 **رتب فتح التذكرة:**\n" +
      (open.length
        ? open.map(id => `<@&${id}>`).join(" ")
        : "❌ لم يتم تحديدها") +

      "\n\n🙋 **رتب Claim:**\n" +
      (claim.length
        ? claim.map(id => `<@&${id}>`).join(" ")
        : "❌ لم يتم تحديدها") +

      "\n\n🔒 **رتب إغلاق التذكرة:**\n" +
      (close.length
        ? close.map(id => `<@&${id}>`).join(" ")
        : "❌ لم يتم تحديدها") +

      "\n\n👀 **رتب مشاهدة التذكرة:**\n" +
      (view.length
        ? view.map(id => `<@&${id}>`).join(" ")
        : "❌ لم يتم تحديدها") +

      "\n\n📁 **قسم التذاكر:**\n" +
      (s.category_id
        ? `<#${s.category_id}>`
        : "❌ لم يتم تحديده") +

      "\n\n**ملاحظة:**\n" +
      "الموظف لا يستطيع الكتابة داخل التذكرة إلا بعد الضغط على Claim."
    )
    .setColor(0x5865f2);
}

// ===============================
// SETUP MENUS
// ===============================

function setupComponents() {

  const openRoles = new RoleSelectMenuBuilder()
    .setCustomId("setup_open")
    .setPlaceholder("🎫 اختر رتب فتح التذاكر")
    .setMinValues(1)
    .setMaxValues(10);

  const claimRoles = new RoleSelectMenuBuilder()
    .setCustomId("setup_claim")
    .setPlaceholder("🙋 اختر رتب Claim")
    .setMinValues(1)
    .setMaxValues(10);

  const closeRoles = new RoleSelectMenuBuilder()
    .setCustomId("setup_close")
    .setPlaceholder("🔒 اختر رتب إغلاق التذاكر")
    .setMinValues(1)
    .setMaxValues(10);

  const viewRoles = new RoleSelectMenuBuilder()
    .setCustomId("setup_view")
    .setPlaceholder("👀 اختر رتب مشاهدة التذاكر")
    .setMinValues(1)
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
      "اضغط على الزر بالأسفل لإنشاء تذكرة.\n\n" +
      "بعد الضغط سيطلب منك البوت كتابة سبب فتح التذكرة."
    )
    .setColor(0x5865f2);

  const row = new ActionRowBuilder().addComponents(

    new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("إنشاء تذكرة")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)

  );

  return {
    embeds: [embed],
    components: [row]
  };
}

// ===============================
// TICKET MESSAGE
// ===============================

function ticketMessage(ticket) {

  const embed = new EmbedBuilder()
    .setTitle("🎫 تذكرة جديدة")
    .setDescription(
      `👤 **صاحب التذكرة:** <@${ticket.opener_id}>\n\n` +
      `📝 **سبب التذكرة:**\n${ticket.reason}\n\n` +
      "🙋 اضغط **Claim** لاستلام التذكرة.\n" +
      "🔒 اضغط **Close** لإغلاق التذكرة."
    )
    .setColor(0x57f287)
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(

    new ButtonBuilder()
      .setCustomId("claim_ticket")
      .setLabel("Claim")
      .setEmoji("🙋")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("Close")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)

  );

  return {
    embeds: [embed],
    components: [row]
  };
}

// ===============================
// CREATE TICKET PERMISSIONS
// ===============================

async function setupTicketPermissions(channel, member) {

  const settings = getTicketSettings(member.guild.id);

  const viewRoles = roles(settings.view_roles);
  const claimRoles = roles(settings.claim_roles);
  const closeRoles = roles(settings.close_roles);

  // الجميع ممنوع من رؤية التذكرة
  await channel.permissionOverwrites.edit(
    member.guild.id,
    {
      ViewChannel: false
    }
  );

  // صاحب التذكرة
  await channel.permissionOverwrites.edit(
    member.id,
    {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    }
  );

  // الرتب المسموح لها بالمشاهدة
  const staffRoles = [
    ...new Set([
      ...viewRoles,
      ...claimRoles,
      ...closeRoles
    ])
  ];

  for (const roleId of staffRoles) {

    try {

      await channel.permissionOverwrites.edit(
        roleId,
        {
          ViewChannel: true,
          SendMessages: false,
          ReadMessageHistory: true
        }
      );

    } catch (error) {
      console.log(
        `❌ خطأ في رتبة ${roleId}:`,
        error.message
      );
    }
  }

  // البوت
  if (channel.guild.members.me) {

    await channel.permissionOverwrites.edit(
      channel.guild.members.me.id,
      {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        ManageChannels: true
      }
    );

  }
}

// ===============================
// CLAIM TICKET
// ===============================

async function claimTicket(channel, member) {

  const ticket = ticketInfo(channel.id);

  if (!ticket) {
    return "❌ هذه ليست تذكرة.";
  }

  if (ticket.closed === 1) {
    return "❌ التذكرة مغلقة.";
  }

  if (!canClaimTicket(member)) {
    return "❌ رتبتك غير مسموح لها باستخدام Claim.";
  }

  // لو التذكرة مستلمة بالفعل
  if (ticket.claimed === 1) {

    addPoints(
      member.guild.id,
      member.id,
      -50
    );

    const user = getUser(
      member.guild.id,
      member.id
    );

    return (
      `⚠️ التذكرة مستلمة بالفعل بواسطة <@${ticket.claimer_id}>.\n\n` +
      "💸 تم خصم **50 نقطة** منك.\n" +
      `💰 رصيدك الآن: **${user.points} نقطة**`
    );
  }

  // استلام التذكرة
  db.prepare(`
    UPDATE tickets
    SET claimer_id = ?,
        claimed = 1
    WHERE channel_id = ?
  `).run(
    member.id,
    channel.id
  );

  // إعطاء 3 نقاط
  addPoints(
    member.guild.id,
    member.id,
    3
  );

  // الموظف الذي عمل Claim يستطيع الكتابة
  await channel.permissionOverwrites.edit(
    member.id,
    {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      AttachFiles: true,
      EmbedLinks: true
    }
  );

  const user = getUser(
    member.guild.id,
    member.id
  );

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🙋 تم استلام التذكرة")
        .setDescription(
          `👤 المستلم: <@${member.id}>\n\n` +
          "🎁 تمت إضافة **3 نقاط** لك.\n" +
          `💰 رصيدك: **${user.points} نقطة**`
        )
        .setColor(0x57f287)
    ]
  });

  return null;
}

// ===============================
// CLOSE TICKET
// ===============================

async function closeTicket(channel, member) {

  const ticket = ticketInfo(channel.id);

  if (!ticket) {
    return "❌ هذه ليست تذكرة.";
  }

  if (!canCloseTicket(member)) {
    return "❌ رتبتك غير مسموح لها بإغلاق التذاكر.";
  }

  if (ticket.closed === 1) {
    return "❌ التذكرة مغلقة بالفعل.";
  }

  db.prepare(`
    UPDATE tickets
    SET closed = 1
    WHERE channel_id = ?
  `).run(channel.id);

  await channel.permissionOverwrites.edit(
    ticket.opener_id,
    {
      ViewChannel: true,
      SendMessages: false,
      ReadMessageHistory: true
    }
  );

  const settings = getTicketSettings(
    member.guild.id
  );

  const staffRoles = [
    ...new Set([
      ...roles(settings.view_roles),
      ...roles(settings.claim_roles),
      ...roles(settings.close_roles)
    ])
  ];

  for (const roleId of staffRoles) {

    try {

      await channel.permissionOverwrites.edit(
        roleId,
        {
          ViewChannel: true,
          SendMessages: false,
          ReadMessageHistory: true
        }
      );

    } catch {}
  }

  await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle("🔒 تم إغلاق التذكرة")
        .setDescription(
          `تم إغلاق التذكرة بواسطة <@${member.id}>.\n\n` +
          "سيتم حذف التذكرة بعد 10 ثوانٍ."
        )
        .setColor(0xed4245)
    ]
  });

  setTimeout(async () => {

    try {
      await channel.delete(
        "Ticket closed"
      );
    } catch {}

  }, 10000);

  return null;
}

// ===============================
// BOT READY
// ===============================

client.once("ready", () => {

  console.log(
    `✅ البوت يعمل باسم ${client.user.tag}`
  );

  console.log(
    `📡 البوت موجود في ${client.guilds.cache.size} سيرفر`
  );

});

// ===============================
// INTERACTIONS
// ===============================

client.on(
  "interactionCreate",
  async interaction => {

    try {

      // =========================
      // BUTTONS
      // =========================

      if (interaction.isButton()) {

        // إنشاء تذكرة
        if (
          interaction.customId ===
          "create_ticket"
        ) {

          if (!canOpenTicket(interaction.member)) {

            return interaction.reply({
              content:
                "❌ رتبتك غير مسموح لها بفتح تذكرة.",
              ephemeral: true
            });

          }

          const settings =
            getTicketSettings(
              interaction.guild.id
            );

          if (!settings.category_id) {

            return interaction.reply({
              content:
                "❌ لم يتم تحديد قسم التذاكر.\nاستخدم `#setup ticket` أولاً.",
              ephemeral: true
            });

          }

          // منع فتح أكثر من تذكرة
          const existing =
            db.prepare(`
              SELECT * FROM tickets
              WHERE guild_id = ?
              AND opener_id = ?
              AND closed = 0
            `).get(
              interaction.guild.id,
              interaction.user.id
            );

          if (existing) {

            return interaction.reply({
              content:
                `❌ لديك تذكرة مفتوحة بالفعل: <#${existing.channel_id}>`,
              ephemeral: true
            });

          }

          // نموذج السبب
          const modal =
            new ModalBuilder()
              .setCustomId(
                "ticket_reason_modal"
              )
              .setTitle(
                "سبب فتح التذكرة"
              );

          const reason =
            new TextInputBuilder()
              .setCustomId(
                "ticket_reason"
              )
              .setLabel(
                "ما سبب فتح التذكرة؟"
              )
              .setPlaceholder(
                "اكتب السبب هنا..."
              )
              .setStyle(
                TextInputStyle.Paragraph
              )
              .setRequired(true)
              .setMinLength(2)
              .setMaxLength(1000);

          modal.addComponents(
            new ActionRowBuilder()
              .addComponents(reason)
          );

          return interaction.showModal(
            modal
          );
        }

        // Claim
        if (
          interaction.customId ===
          "claim_ticket"
        ) {

          const result =
            await claimTicket(
              interaction.channel,
              interaction.member
            );

          if (result) {

            return interaction.reply({
              content: result,
              ephemeral: true
            });

          }

          return interaction.reply({
            content:
              "✅ تم استلام التذكرة وحصلت على **3 نقاط**.",
            ephemeral: true
          });
        }

        // Close
        if (
          interaction.customId ===
          "close_ticket"
        ) {

          const result =
            await closeTicket(
              interaction.channel,
              interaction.member
            );

          if (result) {

            return interaction.reply({
              content: result,
              ephemeral: true
            });

          }

          return interaction.reply({
            content:
              "🔒 تم إغلاق التذكرة.",
            ephemeral: true
          });
        }
      }

      // =========================
      // ROLE SELECT
      // =========================

      if (
        interaction.isRoleSelectMenu()
      ) {

        if (
          !interaction.customId.startsWith(
            "setup_"
          )
        ) {
          return;
        }

        if (
          !isAdmin(
            interaction.member
          )
        ) {

          return interaction.reply({
            content:
              "❌ تحتاج Administrator.",
            ephemeral: true
          });

        }

        const map = {

          setup_open:
            "open_roles",

          setup_claim:
            "claim_roles",

          setup_close:
            "close_roles",

          setup_view:
            "view_roles"

        };

        const field =
          map[interaction.customId];

        if (!field) return;

        db.prepare(`
          INSERT INTO ticket_settings
          (guild_id, ${field})
          VALUES (?, ?)

          ON CONFLICT(guild_id)
          DO UPDATE SET
          ${field} = excluded.${field}
        `).run(
          interaction.guild.id,
          JSON.stringify(
            interaction.values
          )
        );

        return interaction.update({
          embeds: [
            setupEmbed(
              interaction.guild.id
            )
          ],
          components:
            setupComponents()
        });
      }

      // =========================
      // CATEGORY SELECT
      // =========================

      if (
        interaction.isChannelSelectMenu()
      ) {

        if (
          interaction.customId !==
          "setup_category"
        ) {
          return;
        }

        if (
          !isAdmin(
            interaction.member
          )
        ) {

          return interaction.reply({
            content:
              "❌ تحتاج Administrator.",
            ephemeral: true
          });

        }

        const categoryId =
          interaction.values[0];

        db.prepare(`
          INSERT INTO ticket_settings
          (guild_id, category_id)
          VALUES (?, ?)

          ON CONFLICT(guild_id)
          DO UPDATE SET
          category_id =
          excluded.category_id
        `).run(
          interaction.guild.id,
          categoryId
        );

        return interaction.update({
          embeds: [
            setupEmbed(
              interaction.guild.id
            )
          ],
          components:
            setupComponents()
        });
      }

      // =========================
      // MODAL
      // =========================

      if (
        interaction.isModalSubmit()
      ) {

        if (
          interaction.customId !==
          "ticket_reason_modal"
        ) {
          return;
        }

        if (
          !canOpenTicket(
            interaction.member
          )
        ) {

          return interaction.reply({
            content:
              "❌ رتبتك غير مسموح لها بفتح التذكرة.",
            ephemeral: true
          });

        }

        const reason =
          interaction.fields
            .getTextInputValue(
              "ticket_reason"
            );

        const settings =
          getTicketSettings(
            interaction.guild.id
          );

        if (!settings.category_id) {

          return interaction.reply({
            content:
              "❌ لم يتم تحديد قسم التذاكر.",
            ephemeral: true
          });

        }

        const category =
          interaction.guild.channels.cache.get(
            settings.category_id
          );

        if (
          !category ||
          category.type !==
            ChannelType.GuildCategory
        ) {

          return interaction.reply({
            content:
              "❌ قسم التذاكر غير موجود.",
            ephemeral: true
          });

        }

        const username =
          interaction.user.username
            .toLowerCase()
            .replace(
              /[^a-z0-9-_]/g,
              ""
            )
            .slice(0, 15) ||
          "user";

        const channel =
          await interaction.guild.channels.create({

            name:
              `ticket-${username}`,

            type:
              ChannelType.GuildText,

            parent:
              category.id,

            reason:
              "Ticket created"

          });

        await setupTicketPermissions(
          channel,
          interaction.member
        );

        db.prepare(`
          INSERT INTO tickets
          (
            channel_id,
            guild_id,
            opener_id,
            reason,
            claimed,
            closed,
            created_at
          )
          VALUES (?, ?, ?, ?, 0, 0, ?)
        `).run(
          channel.id,
          interaction.guild.id,
          interaction.user.id,
          reason,
          Date.now()
        );

        const ticket =
          ticketInfo(channel.id);

        await channel.send(
          ticketMessage(ticket)
        );

        return interaction.reply({
          content:
            `✅ تم إنشاء التذكرة: ${channel}`,
          ephemeral: true
        });
      }

    } catch (error) {

      console.error(
        "Interaction Error:",
        error
      );

      if (
        interaction.replied ||
        interaction.deferred
      ) {

        await interaction.followUp({
          content:
            "❌ حدث خطأ.",
          ephemeral: true
        }).catch(() => {});

      } else {

        await interaction.reply({
          content:
            "❌ حدث خطأ.",
          ephemeral: true
        }).catch(() => {});

      }
    }
  }
);

// ===============================
// MESSAGE COMMANDS
// ===============================

client.on(
  "messageCreate",
  async message => {

    if (
      message.author.bot ||
      !message.guild
    ) {
      return;
    }

    const content =
      message.content.trim();

    const command =
      content.toLowerCase();

    try {

      // =========================
      // #ticket
      // =========================

      if (
        command === "#ticket"
      ) {

        if (
          !isAdmin(
            message.member
          )
        ) {

          return message.reply(
            "❌ فقط Administrator يستطيع إرسال لوحة التذاكر."
          );

        }

        const settings =
          getTicketSettings(
            message.guild.id
          );

        if (
          !settings.category_id
        ) {

          return message.reply(
            "❌ استخدم `#setup ticket` أولاً واضبط نظام التذاكر."
          );

        }

        return message.channel.send(
          ticketPanel()
        );
      }

      // =========================
      // #setup ticket
      // =========================

      if (
        command === "#setup ticket"
      ) {

        if (
          !isAdmin(
            message.member
          )
        ) {

          return message.reply(
            "❌ تحتاج Administrator."
          );

        }

        return message.channel.send({

          embeds: [
            setupEmbed(
              message.guild.id
            )
          ],

          components:
            setupComponents()

        });
      }

      // =========================
      // #claim
      // =========================

      if (
        command === "#claim"
      ) {

        const ticket =
          ticketInfo(
            message.channel.id
          );

        if (!ticket) {

          return message.reply(
            "❌ هذا الأمر يعمل داخل التذاكر فقط."
          );

        }

        const result =
          await claimTicket(
            message.channel,
            message.member
          );

        if (result) {

          return message.reply(
            result
          );

        }

        return message.reply(
          "🙋 تم استلام التذكرة وحصلت على **+3 نقاط**."
        );
      }

      // =========================
      // #نقاط
      // =========================

      if (
        command === "#نقاط" ||
        command === "#points"
      ) {

        const user =
          getUser(
            message.guild.id,
            message.author.id
          );

        return message.reply(
          `💰 ${message.author} لديك **${user.points} نقطة**.`
        );
      }

      // =========================
      // #نقاط @user
      // =========================

      if (
        command.startsWith("#نقاط ") ||
        command.startsWith("#points ")
      ) {

        const target =
          message.mentions.members.first();

        if (!target) {

          return message.reply(
            "❌ منشن العضو."
          );

        }

        const user =
          getUser(
            message.guild.id,
            target.id
          );

        return message.reply(
          `💰 ${target} لديه **${user.points} نقطة**.`
        );
      }

      // =========================
      // #addpoints
      // =========================

      if (
        command.startsWith(
          "#addpoints "
        )
      ) {

        if (
          !isAdmin(
            message.member
          )
        ) {

          return message.reply(
            "❌ تحتاج Administrator."
          );

        }

        const target =
          message.mentions.members.first();

        const parts =
          content.split(/\s+/);

        const amount =
          Number(parts[parts.length - 1]);

        if (
          !target ||
          !Number.isInteger(amount)
        ) {

          return message.reply(
            "❌ الاستخدام:\n`#addpoints @user 10`"
          );

        }

        const user =
          addPoints(
            message.guild.id,
            target.id,
            amount
          );

        return message.reply(
          `✅ تم تعديل نقاط ${target}.\n💰 الرصيد: **${user.points}**`
        );
      }

      // =========================
      // #setpoints
      // =========================

      if (
        command.startsWith(
          "#setpoints "
        )
      ) {

        if (
          !isAdmin(
            message.member
          )
        ) {

          return message.reply(
            "❌ تحتاج Administrator."
          );

        }

        const target =
          message.mentions.members.first();

        const parts =
          content.split(/\s+/);

        const amount =
          Number(parts[parts.length - 1]);

        if (
          !target ||
          !Number.isInteger(amount) ||
          amount < 0
        ) {

          return message.reply(
            "❌ الاستخدام:\n`#setpoints @user 100`"
          );

        }

        const user =
          setPoints(
            message.guild.id,
            target.id,
            amount
          );

        return message.reply(
          `✅ تم تعيين نقاط ${target} إلى **${user.points}**.`
        );
      }

    } catch (error) {

      console.error(
        "Message Error:",
        error
      );

      await message.reply(
        "❌ حدث خطأ."
      
