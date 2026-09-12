require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
  ChannelType,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const fs = require("fs");

// ======================================================
// CONFIG
// ======================================================

const TOKEN = process.env.TOKEN;

const GUILD_ID = "1548054046387085424";

// ---------------- ROLES ----------------

const ROLES = {
  OWNER: "1548393819207114964",
  CO_OWNER: "1548396117501411378",
  ADMIN: "1548396434121040022",
  MODERATOR: "1548396650542792745",
  EVENT_MANAGER: "1548396942827069480"
};

// ---------------- CHANNELS ----------------

const TICKET_CHANNELS = [
  "1548415495320117349",
  "1548418238533206016"
];

const WELCOME_CHANNEL = "1548406177698811924";
const BOT_LOG_CHANNEL = "1548414502805049485";
const MOD_LOG_CHANNEL = "1548414647005351976";
const LOG_CHANNEL = "1548417311751409825";

// ---------------- SALARY ----------------

const SALARY = {
  [ROLES.OWNER]: 100,
  [ROLES.CO_OWNER]: 90,
  [ROLES.ADMIN]: 80,
  [ROLES.MODERATOR]: 50,
  [ROLES.EVENT_MANAGER]: 20
};

// ---------------- PROMOTIONS ----------------

const PROMOTIONS = [
  {
    from: ROLES.EVENT_MANAGER,
    to: ROLES.MODERATOR,
    points: 100
  },
  {
    from: ROLES.MODERATOR,
    to: ROLES.ADMIN,
    points: 200
  },
  {
    from: ROLES.ADMIN,
    to: ROLES.CO_OWNER,
    points: 300
  },
  {
    from: ROLES.CO_OWNER,
    to: ROLES.OWNER,
    points: 400
  }
];

// ======================================================
// DATABASE
// ======================================================

const DB_FILE = "./database.json";

if (!fs.existsSync(DB_FILE)) {
  fs.writeFileSync(
    DB_FILE,
    JSON.stringify(
      {
        users: {},
        tickets: {}
      },
      null,
      2
    )
  );
}

function loadDB() {
  try {
    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
  } catch {
    return {
      users: {},
      tickets: {}
    };
  }
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

const db = loadDB();

// ======================================================
// CLIENT
// ======================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel]
});

// ======================================================
// HELPERS
// ======================================================

function isStaff(member) {
  return Object.values(ROLES).some(roleId =>
    member.roles.cache.has(roleId)
  );
}

function isOwner(member) {
  return member.roles.cache.has(ROLES.OWNER);
}

function getStaffRole(member) {
  const priority = [
    ROLES.OWNER,
    ROLES.CO_OWNER,
    ROLES.ADMIN,
    ROLES.MODERATOR,
    ROLES.EVENT_MANAGER
  ];

  return priority.find(roleId => member.roles.cache.has(roleId));
}

function getStaffRoleName(member) {
  const role = getStaffRole(member);

  if (role === ROLES.OWNER) return "👑 Owner";
  if (role === ROLES.CO_OWNER) return "💜 Co-Owner";
  if (role === ROLES.ADMIN) return "🛡️ Admin";
  if (role === ROLES.MODERATOR) return "🔨 Moderator";
  if (role === ROLES.EVENT_MANAGER) return "🎯 Event Manager";

  return "لا توجد رتبة إدارة";
}

function ensureUser(userId) {
  if (!db.users[userId]) {
    db.users[userId] = {
      points: 0,
      salaryLastClaim: 0,
      ticketClaims: 0
    };
  }

  return db.users[userId];
}

function getPoints(userId) {
  return ensureUser(userId).points;
}

function addPoints(userId, amount) {
  const user = ensureUser(userId);

  user.points += amount;

  if (user.points < 0) {
    user.points = 0;
  }

  saveDB(db);
}

function formatTime(ms) {
  const totalSeconds = Math.ceil(ms / 1000);

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours} ساعة، ${minutes} دقيقة، ${seconds} ثانية`;
}

async function sendLog(type, text) {
  let channelId = LOG_CHANNEL;

  if (type === "bot") {
    channelId = BOT_LOG_CHANNEL;
  }

  if (type === "mod") {
    channelId = MOD_LOG_CHANNEL;
  }

  const channel = await client.channels.fetch(channelId).catch(() => null);

  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setDescription(text)
    .setTimestamp();

  await channel.send({ embeds: [embed] }).catch(() => {});
}

// ======================================================
// PROMOTION SYSTEM
// ======================================================

async function checkPromotion(member) {
  if (!isStaff(member)) return;

  const role = getStaffRole(member);

  const promotion = PROMOTIONS.find(
    p => p.from === role
  );

  if (!promotion) return;

  const user = ensureUser(member.id);

  if (user.points < promotion.points) return;

  const oldRole = member.guild.roles.cache.get(promotion.from);
  const newRole = member.guild.roles.cache.get(promotion.to);

  if (!newRole) return;

  await member.roles.remove(oldRole).catch(() => {});
  await member.roles.add(newRole).catch(() => {});

  user.points = 0;

  saveDB(db);

  await sendLog(
    "normal",
    `📈 **ترقية موظف**\n\n` +
    `👤 العضو: ${member}\n` +
    `⬆️ الرتبة الجديدة: <@&${promotion.to}>\n` +
    `⭐ تم تصفير النقاط بعد الترقية.`
  );

  const dm = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("🎉 تمت ترقيتك!")
    .setDescription(
      `مبروك ${member}!\n\n` +
      `⬆️ ترقيتك الجديدة: <@&${promotion.to}>\n` +
      `⭐ تم تصفير نقاطك وبدأ نظام الرتبة الجديدة.`
    );

  await member.send({ embeds: [dm] }).catch(() => {});
}

// ======================================================
// WELCOME
// ======================================================

client.on("guildMemberAdd", async member => {
  const channel = member.guild.channels.cache.get(
    WELCOME_CHANNEL
  );

  if (!channel) return;

  const memberNumber = member.guild.memberCount;

  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("🌸 أهلاً بك!")
    .setDescription(
      `🦋 نورتنا يا ${member} 💜\n\n` +
      `🩵 نورتنا في سيرفرنا **${member.guild.name}**\n\n` +
      `✨ أنت العضو رقم **${memberNumber}** 🎉\n\n` +
      `📜 لا تنسَ الاطلاع على القوانين.\n\n` +
      `💜 نتمنى لك إقامة سعيدة معنا!`
    )
    .setFooter({
      text: "Gaming Hub • Welcome"
    })
    .setTimestamp();

  await channel.send({
    content: `${member}`,
    embeds: [embed]
  });

  await sendLog(
    "normal",
    `👋 **عضو جديد**\n\n${member} دخل السيرفر.\n👥 رقم العضو: **${memberNumber}**`
  );
});

// ======================================================
// TICKET PANEL
// ======================================================

function ticketPanelEmbed() {
  return new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("🎫 الدعم الفني")
    .setDescription(
      "💜 تحتاج مساعدة؟\n\n" +
      "اضغط على الزر بالأسفل لإنشاء تذكرة.\n\n" +
      "🩵 سيتم فتح تذكرة خاصة بك.\n" +
      "🎯 سيتم تنبيه Event Manager عند فتح التذكرة."
    )
    .setFooter({
      text: "Gaming Hub • Support"
    });
}

function ticketPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("create_ticket")
      .setLabel("فتح تذكرة")
      .setEmoji("🎫")
      .setStyle(ButtonStyle.Primary)
  );
}

// ======================================================
// TICKET BUTTONS
// ======================================================

function ticketControlButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("claim_ticket")
      .setLabel("استلم التذكرة")
      .setEmoji("📥")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId("close_ticket")
      .setLabel("قفل التذكرة")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Danger)
  );
}

// ======================================================
// CREATE TICKET
// ======================================================

async function createTicket(interaction) {
  const guild = interaction.guild;
  const member = interaction.member;

  const alreadyOpen = Object.values(db.tickets).find(
    ticket =>
      ticket.userId === member.id &&
      ticket.guildId === guild.id &&
      ticket.closed === false
  );

  if (alreadyOpen) {
    return interaction.reply({
      content: `🎫 لديك تذكرة مفتوحة بالفعل: <#${alreadyOpen.channelId}>`,
      ephemeral: true
    });
  }

  const sourceChannel = interaction.channel;

  const parentId = sourceChannel.parentId || undefined;

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionsBitField.Flags.ViewChannel
      ]
    },

    {
      id: member.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    }
  ];

  for (const roleId of Object.values(ROLES)) {
    overwrites.push({
      id: roleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory
      ]
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${member.user.username}`
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "")
      .slice(0, 20) || `ticket-${member.id}`,

    type: ChannelType.GuildText,

    parent: parentId,

    permissionOverwrites: overwrites
  });

  db.tickets[channel.id] = {
    channelId: channel.id,
    guildId: guild.id,
    userId: member.id,
    claimedBy: null,
    closed: false,
    createdAt: Date.now()
  };

  saveDB(db);

  const embed = new EmbedBuilder()
    .setColor("#8B5CF6")
    .setTitle("🎫 تذكرة جديدة")
    .setDescription(
      `🌸 أهلاً بك ${member}\n\n` +
      `🩵 سيتم مساعدتك من قبل الإدارة.\n\n` +
      `🎯 <@&${ROLES.EVENT_MANAGER}>\n` +
      `يرجى التوصل معها بأسرع وقت.\n\n` +
      `📥 **استلم التذكرة**\n` +
      `🔒 **قفل التذكرة**`
    )
    .setTimestamp();

  await channel.send({
    content:
      `${member} <@&${ROLES.EVENT_MANAGER}>`,
    embeds: [embed],
    components: [ticketControlButtons()]
  });

  await interaction.reply({
    content: `🎫 تم إنشاء تذكرتك: ${channel}`,
    ephemeral: true
  });

  await sendLog(
    "normal",
    `🎫 **تم فتح تذكرة**\n\n` +
    `👤 صاحب التذكرة: ${member}\n` +
    `📁 القناة: ${channel}\n` +
    `🎯 تم تنبيه Event Manager.`
  );
}

// ======================================================
// CLAIM TICKET
// ======================================================

async function claimTicket(interaction) {
  const member = interaction.member;

  if (!isStaff(member)) {
    return interaction.reply({
      content: "❌ هذا الزر مخصص للإدارة فقط.",
      ephemeral: true
    });
  }

  const ticket = db.tickets[interaction.channel.id];

  if (!ticket) {
    return interaction.reply({
      content: "❌ هذه ليست تذكرة مسجلة.",
      ephemeral: true
    });
  }

  if (ticket.closed) {
    return interaction.reply({
      content: "❌ هذه التذكرة مغلقة.",
      ephemeral: true
    });
  }

  if (ticket.claimedBy) {
    return interaction.reply({
      content: `❌ التذكرة مستلمة بالفعل بواسطة <@${ticket.claimedBy}>.`,
      ephemeral: true
    });
  }

  const user = ensureUser(member.id);

  user.ticketClaims++;

  let pointsChange = 10;

  // أول استلام = +10
  // كل استلام بعد ذلك = -20
  if (user.ticketClaims > 1) {
    pointsChange = -20;
  }

  user.points += pointsChange;

  if (user.points < 0) {
    user.points = 0;
  }

  ticket.claimedBy = member.id;

  saveDB(db);

  const embed = new EmbedBuilder()
    .setColor(pointsChange > 0 ? "#22C55E" : "#EF4444")
    .setDescription(
      `📥 **تم استلام التذكرة**\n\n` +
      `👤 الموظف: ${member}\n` +
      `⭐ النقاط: **${pointsChange > 0 ? "+" : ""}${pointsChange}**\n\n` +
      `🎯 الرتبة: ${getStaffRoleName(member)}`
    )
    .setTimestamp();

  await interaction.reply({
    embeds: [embed]
  });

  await sendLog(
    "normal",
    `📥 **Ticket Claimed**\n\n` +
    `🎫 القناة: ${interaction.channel}\n` +
    `👤 الموظف: ${member}\n` +
    `⭐ النقاط: ${pointsChange > 0 ? "+" : ""}${pointsChange}`
  );

  await checkPromotion(member);
}

// ======================================================
// CLOSE TICKET
// ======================================================

async function closeTicket(interaction) {
  const member = interaction.member;

  if (!isStaff(member)) {
    return interaction.reply({
      content: "❌ زر قفل التذكرة مخصص للإدارة فقط.",
      ephemeral: true
    });
  }

  const ticket = db.tickets[interaction.channel.id];

  if (!ticket) {
    return interaction.reply({
      content: "❌ هذه ليست تذكرة مسجلة.",
      ephemeral: true
    });
  }

  if (ticket.closed) {
    return interaction.reply({
      content: "❌ التذكرة مغلقة بالفعل.",
      ephemeral: true
    });
  }

  ticket.closed = true;
  ticket.closedBy = member.id;
  ticket.closedAt = Date.now();

  saveDB(db);

  await interaction.reply({
    embeds: [
      new EmbedBuilder()
        .setColor("#EF4444")
        .setTitle("🔒 تم قفل التذكرة")
        .setDescription(
          `تم قفل التذكرة بواسطة ${member}.\n\n` +
          `سيتم حذف القناة بعد **5 ثوانٍ**.`
        )
        .setTimestamp()
    ]
  });

  await sendLog(
    "normal",
    `🔒 **Ticket Closed**\n\n` +
    `🎫 القناة: <#${interaction.channel.id}>\n` +
    `👤 بواسطة: ${member}\n` +
    `👤 صاحب التذكرة: <@${ticket.userId}>`
  );

  setTimeout(async () => {
    await interaction.channel.delete(
      "Ticket closed"
    ).catch(() => {});
  }, 5000);
}

// ======================================================
// SLASH COMMANDS
// ======================================================

const commands = [

  new SlashCommandBuilder()
    .setName("top")
    .setDescription("عرض أفضل 10 موظفين بالنقاط"),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("استلام راتب الإدارة كل 24 ساعة"),

  new SlashCommandBuilder()
    .setName("add")
    .setDescription("إضافة نقاط لموظف - Owner فقط")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("الشخص")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("points")
        .setDescription("عدد النقاط")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("minus")
    .setDescription("خصم نقاط من موظف - Owner فقط")
    .addUserOption(option =>
      option
        .setName("user")
        .setDescription("الشخص")
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName("points")
        .setDescription("عدد النقاط")
        .setRequired(true)
        .setMinValue(1)
    ),

  new SlashCommandBuilder()
    .setName("clear")
    .setDescription("مسح عدد من الرسائل - Owner فقط")
    .addIntegerOption(option =>
      option
        .setName("amount")
        .setDescription("عدد الرسائل")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("staff-request")
    .setDescription("طلب مساعدة الإدارة"),

  new SlashCommandBuilder()
    .setName("setup-ticket")
    .setDescription("إنشاء لوحة التذاكر - Owner فقط")

].map(command => command.toJSON());

// ======================================================
// READY
// ======================================================

client.once("ready", async () => {

  console.log(`================================`);
  console.log(`🤖 Logged in as ${client.user.tag}`);
  console.log(`🏠 Guild: ${GUILD_ID}`);
  console.log(`================================`);

  const rest = new REST({ version: "10" })
    .setToken(TOKEN);

  try {

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        GUILD_ID
      ),
      {
        body: commands
      }
    );

    console.log("✅ Slash commands registered.");

  } catch (error) {
    console.error(error);
  }

  await sendLog(
    "bot",
    `🟢 **Bot Online**\n\n🤖 ${client.user.tag} يعمل الآن.`
  );
});

// ======================================================
// INTERACTIONS
// ======================================================

client.on("interactionCreate", async interaction => {

  try {

    // ---------------- BUTTONS ----------------

    if (interaction.isButton()) {

      if (interaction.customId === "create_ticket") {
        return createTicket(interaction);
      }

      if (interaction.customId === "claim_ticket") {
        return claimTicket(interaction);
      }

      if (interaction.customId === "close_ticket") {
        return closeTicket(interaction);
      }

      return;
    }

    // ---------------- SLASH COMMANDS ----------------

    if (!interaction.isChatInputCommand()) return;

    // ==================================================
    // /TOP
    // ==================================================

    if (interaction.commandName === "top") {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ هذا الأمر للإدارة فقط.",
          ephemeral: true
        });
      }

      const top = Object.entries(db.users)
        .sort((a, b) => b[1].points - a[1].points)
        .slice(0, 10);

      if (!top.length) {
        return interaction.reply({
          content: "🏆 لا توجد نقاط حتى الآن."
        });
      }

      let text = "";

      const medals = [
        "🥇",
        "🥈",
        "🥉",
        "4️⃣",
        "5️⃣",
        "6️⃣",
        "7️⃣",
        "8️⃣",
        "9️⃣",
        "🔟"
      ];

      top.forEach(([userId, data], index) => {
        text += `${medals[index]} <@${userId}> — **${data.points}** ⭐\n`;
      });

      const embed = new EmbedBuilder()
        .setColor("#8B5CF6")
        .setTitle("🏆 TOP STAFF")
        .setDescription(text)
        .setTimestamp();

      return interaction.reply({
        embeds: [embed]
      });
    }

    // ==================================================
    // /ROLE
    // ==================================================

    if (interaction.commandName === "role") {

      if (!isStaff(interaction.member)) {
        return interaction.reply({
          content: "❌ هذا الأمر للإدارة فقط.",
          ephemeral: true
        });
      }

      const roleId = getStaffRole(interaction.member);

      const salary = SALARY[roleId];

      if (!salary) {
        return interaction.reply({
          content: "❌ لا يوجد راتب لهذه الرتبة.",
          ephemeral: true
        });
      }

      const user = ensureUser(interaction.user.id);

      const now = Date.now();
      const cooldown = 24 * 60 * 60 * 1000;

      if (
        user.salaryLastClaim &&
        now - user.salaryLastClaim < cooldown
      ) {

        const remaining =
          cooldown - (now - user.salaryLastClaim);

        return interaction.reply({
          content:
            `⏰ استلمت راتبك بالفعل.\n\n` +
            `💰 يمكنك استلامه مرة أخرى بعد:\n` +
            `**${formatTime(remaining)}**`,
          ephemeral: true
        });
      }

      user.salaryLastClaim = now;
      user.points += salary;

      saveDB(db);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor("#8B5CF6")
            .setTitle("💰 راتب الإدارة")
            .setDescription(
              `👤 ${interaction.user}\n\n` +
              `🎯 رتبتك: **${getStaffRoleName(interaction.member)}**\n` +
              `⭐ الراتب: **+${salary} نقطة**\n\n` +
              `💜 تم إضافة الراتب إلى نقاطك.\n` +
              `⏰ يمكنك استلام الراتب مرة أخرى بعد 24 ساعة.`
            )
        ]
      });

      await sendLog(
        "normal",
        `💰 **Salary Claimed**\n\n` +
        `👤 الموظف: ${interaction.user}\n` +
        `🎯 الرتبة: ${getStaffRoleName(interaction.member)}\n` +
        `⭐ الراتب: +${salary}`
      );

      return checkPromotion(interaction.member);
    }

    // ==================================================
    // /ADD
    // ==================================================

    if (interaction.commandName === "add") {

      if (!isOwner(interaction.member)) {
        return interaction.reply({
          content: "❌ هذا الأمر للـ Owner فقط.",
          ephemeral: true
        });
      }

      const target =
        interaction.options.getMember("user");

      const points =
        interaction.options.getInteger("points");

      if (!target) {
        return interaction.reply({
          content: "❌ لم أجد العضو.",
          ephemeral: true
        });
      }

      addPoints(target.id, points);

      await interaction.reply({
        content:
          `⭐ تم إضافة **${points}** نقطة إلى ${target}.`
      });

      await sendLog(
        "normal",
        `➕ **Points Added**\n\n` +
        `👑 بواسطة: ${interaction.user}\n` +
        `👤 للعضو: ${target}\n` +
        `⭐ النقاط: +${points}`
      );

      return checkPromotion(target);
    }

    // ==================================================
    // /MINUS
    // ==================================================

    if (interaction.commandName === "minus") {

      if (!isOwner(interaction.member)) {
        return interaction.reply({
          content: "❌ هذا الأمر للـ Owner فقط.",
          ephemeral: true
        });
      }

      const target =
        interaction.options.getMember("user");

      const points =
        interaction.options.getInteger("points");

      if (!target) {
        return interaction.reply({
          content: "❌ لم أجد العضو.",
          ephemeral: true
        });
      }

      addPoints(target.id, -points);

      await interaction.reply({
        content:
          `⭐ تم خصم **${points}** نقطة من ${target}.`
      });

      await sendLog(
        "normal",
        `➖ **Points Removed**\n\n` +
        `👑 بواسطة: ${interaction.user}\n` +
        `👤 من العضو: ${target}\n` +
        `⭐ النقاط: -${points}`
      );

      return;
    }

    // ==================================================
    // /CLEAR
    // ==================================================

    if (interaction.commandName === "clear") {

      if (!isOwner(interaction.member)) {
        return interaction.reply({
          content: "❌ هذا الأمر للـ Owner فقط.",
          ephemeral: true
        });
      }

      const amount =
        interaction.options.getInteger("amount");

      await interaction.channel.bulkDelete(
        amount,
        true
      );

      await interaction.reply({
        content:
          `🧹 تم مسح **${amount}** رسالة.`,
        ephemeral: true
      });

      await sendLog(
        "mod",
        `🧹 **Clear Messages**\n\n` +
        `👑 بواسطة: ${interaction.user}\n` +
        `📊 العدد: ${amount}\n` +
        `📁 القناة: ${interaction.channel}`
      );

      return;
    }

    // ==================================================
    // /STAFF-REQUEST
    // ==================================================

    if (interaction.commandName === "staff-request") {

      await interaction.reply({
        content:
          `🎯 <@&${ROLES.EVENT_MANAGER}>\n\n` +
          `📢 **رجاءً التوصل معها بأسرع وقت.**`
      });

      return;
    }

    // ==================================================
    // /SETUP-TICKET
    // ==================================================

    if (interaction.commandName === "setup-ticket") {

      if (!isOwner(interaction.member)) {
        return interaction.reply({
          content: "❌ هذا الأمر للـ Owner فقط.",
          ephemeral: true
        });
      }

      await interaction.channel.send({
        embeds: [ticketPanelEmbed()],
        components: [ticketPanelButtons()]
      });

      return interaction.reply({
        content: "✅ تم إنشاء لوحة التذاكر.",
        ephemeral: true
      });
    }

  } catch (error) {

    console.error("Interaction Error:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ حدث خطأ غير متوقع.",
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ======================================================
// LOGIN
// ======================================================

if (!TOKEN) {
  console.error("❌ TOKEN غير موجود في Environment Variables.");
  process.exit(1);
}

client.login(TOKEN);
