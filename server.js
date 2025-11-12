// =============================================
// FonPay Task-Earnings Bot — Full Version (v3.1)
// Clean and optimized for Render
// =============================================

import dotenv from "dotenv";
import express from "express";
import { Telegraf, Markup } from "telegraf";
import pkg from "pg";
const { Pool } = pkg;

dotenv.config();

// ---------- CONFIG ----------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN in environment!");
  process.exit(1);
}

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "5236441213,5725566044")
  .split(",")
  .map((id) => id.trim());

const app = express();
app.use(express.json());

// ---------- DATABASE ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ---------- INIT BOT ----------
const bot = new Telegraf(BOT_TOKEN);

// ---------- SAFE QUERY ----------
async function safeQuery(query, params = []) {
  try {
    const res = await pool.query(query, params);
    return res;
  } catch (err) {
    console.error("DB Error:", err.message);
    return null;
  }
}

// ---------- SETTINGS HELPERS ----------
async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`,
    [key, value]
  );
}

async function getSetting(key) {
  const res = await pool.query(`SELECT value FROM settings WHERE key=$1`, [key]);
  return res.rows[0]?.value || null;
}

// ---------- CHECK ADMIN ----------
function isAdmin(ctx) {
  return ADMIN_IDS.includes(String(ctx.from.id));
}

// ---------- MAIN MENU BUILDER ----------
function getMainMenu(ctx) {
  const telegramId = ctx.from.id;
  const isUserAdmin = ADMIN_IDS.includes(String(telegramId));

  const userButtons = [
    [
      Markup.button.callback("💼 Wallet Balance", "wallet_balance"),
      Markup.button.callback("🎥 Perform Task", "perform_task"),
    ],
    [
      Markup.button.callback("💸 Withdraw", "withdraw"),
      Markup.button.callback("👥 Refer & Earn", "refer_earn"),
    ],
    [
      Markup.button.callback("🏦 Change Bank", "change_bank"),
      Markup.button.callback("🆘 Get Help", "get_help"),
    ],
  ];

  if (isUserAdmin) {
    userButtons.push([
      Markup.button.callback("🛠️ Admin Panel", "admin_panel"),
    ]);
  }

  return Markup.inlineKeyboard(userButtons);
}

// ---------- START COMMAND ----------
bot.start(async (ctx) => {
  const name = ctx.from.first_name || "there";
  await ctx.reply(
    `👋 Hello *${name}*!\n\nWelcome to *FonPay Task-Earnings Bot* 💸\n\nEarn, withdraw and manage your rewards easily.`,
    { parse_mode: "Markdown", ...getMainMenu(ctx) }
  );
});

// ---------- MAIN MENU ----------
bot.command("menu", async (ctx) => {
  await ctx.reply("📋 Main Menu:", getMainMenu(ctx));
});

// ---------- USER FEATURES ----------
bot.action("wallet_balance", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("💼 Your wallet balance is ₦0.00 (demo data).");
});

bot.action("perform_task", async (ctx) => {
  await ctx.answerCbQuery();
  const performTaskEnabled = (await getSetting("perform_task_enabled")) !== "false";
  if (!performTaskEnabled) {
    return ctx.reply("⚠️ The Perform Task feature is temporarily disabled. Please try again later.");
  }
  await ctx.reply("🎬 Tap the link below to perform your daily task:\n\nhttps://fonpay.ng/tasks");
});

bot.action("withdraw", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("💸 Withdrawals are processed manually by admin.\n\nContact support for payout assistance.");
});

bot.action("refer_earn", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    `👥 Share your referral link:\nhttps://t.me/FonPayBot?start=${ctx.from.id}\n\nEarn commissions from your referrals!`
  );
});

bot.action("change_bank", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("🏦 Bank update feature coming soon!");
});

bot.action("get_help", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply(
    "🆘 Need help? Contact support:\n\n📞 WhatsApp: wa.me/2349016755974\n📧 Email: askmeidealintegratedservic@gmail.com"
  );
});

// --------------------------
// Part 3 — Admin panel & actions
// --------------------------

// ---------- Admin Panel (card-style) ----------
bot.action("admin_panel", async (ctx) => {
  await ctx.answerCbQuery().catch(()=>{});
  const telegramId = String(ctx.from.id);
  if (!ADMIN_IDS.includes(telegramId)) {
    return ctx.reply("⛔ You don’t have permission to access admin controls.");
  }

  const caption = `
🛠️ *FonPay Admin Panel*

Manage tasks, view stats and export data.
Choose an action below:
  `;

  await ctx.replyWithPhoto(
    { url: "https://i.ibb.co/4d1w2kD/fonpay-logo.png" },
    {
      caption,
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "🟢 Enable Tasks", callback_data: "admin_enable_task" },
            { text: "🔴 Disable Tasks", callback_data: "admin_disable_task" }
          ],
          [
            { text: "📊 View Stats", callback_data: "admin_stats" },
            { text: "📥 Pending Withdrawals", callback_data: "admin_pending_withdrawals" }
          ],
          [
            { text: "📤 Export Withdrawals", callback_data: "admin_export_withdrawals" },
            { text: "📣 Broadcast (use /broadcast)", callback_data: "admin_broadcast_hint" }
          ],
          [
            { text: "↩️ Back to Menu", callback_data: "back_to_menu" }
          ]
        ]
      }
    }
  );
});

// ---------- Admin actions (inline callbacks) ----------
bot.action("admin_enable_task", async (ctx) => {
  const id = String(ctx.from.id);
  if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery("⛔ Not authorized");
  await setSetting("perform_task_enabled", "on");
  try { await ctx.editMessageCaption("✅ *Perform Task feature has been ENABLED.*", { parse_mode: "Markdown" }); } catch(e){}
  await ctx.answerCbQuery("Enabled");
});

bot.action("admin_disable_task", async (ctx) => {
  const id = String(ctx.from.id);
  if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery("⛔ Not authorized");
  await setSetting("perform_task_enabled", "off");
  try { await ctx.editMessageCaption("🚫 *Perform Task feature has been DISABLED.*", { parse_mode: "Markdown" }); } catch(e){}
  await ctx.answerCbQuery("Disabled");
});

bot.action("admin_stats", async (ctx) => {
  const id = String(ctx.from.id);
  if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery("⛔ Not authorized");
  try {
    const u = await safeQuery("SELECT COUNT(*)::int AS users FROM users");
    const v = await safeQuery("SELECT COUNT(*)::int AS views FROM ad_views");
    const pending = await safeQuery("SELECT COUNT(*)::int AS pending FROM withdrawals WHERE status='pending'");
    const usersCount = u?.rows?.[0]?.users ?? 0;
    const viewsCount = v?.rows?.[0]?.views ?? 0;
    const pendingCount = pending?.rows?.[0]?.pending ?? 0;

    await ctx.replyWithMarkdown(`📊 *Platform Stats*\n\n👥 Users: ${usersCount}\n🎥 Total Ad Views: ${viewsCount}\n📥 Pending withdrawals: ${pendingCount}`);
    await ctx.answerCbQuery();
  } catch (e) {
    console.error("admin_stats err", e);
    await ctx.answerCbQuery("Error fetching stats");
  }
});

bot.action("admin_pending_withdrawals", async (ctx) => {
  const id = String(ctx.from.id);
  if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery("⛔ Not authorized");

  try {
    const r = await safeQuery("SELECT id, telegram_id, coins, usd, bank_name, account_name, account_number, status, requested_at FROM withdrawals WHERE status='pending' ORDER BY requested_at DESC LIMIT 30");
    if (!r || r.rows.length === 0) return ctx.reply("No pending withdrawals.");
    let msg = "📥 Pending Withdrawals (latest 30):\n\n";
    for (const w of r.rows) {
      msg += `ID:${w.id} User:${w.telegram_id} Coins:${w.coins} USD:${w.usd}\nBank: ${w.bank_name} ${w.account_name} ${w.account_number}\nStatus:${w.status} Requested:${w.requested_at}\n\n`;
    }
    await ctx.reply(msg);
    await ctx.answerCbQuery();
  } catch (e) {
    console.error("admin_pending err", e);
    await ctx.answerCbQuery("Error");
  }
});

bot.action("admin_export_withdrawals", async (ctx) => {
  const id = String(ctx.from.id);
  if (!ADMIN_IDS.includes(id)) return ctx.answerCbQuery("⛔ Not authorized");
  try {
    const r = await safeQuery("SELECT * FROM withdrawals ORDER BY requested_at DESC LIMIT 1000");
    const rows = r?.rows || [];
    if (rows.length === 0) return ctx.reply("No withdrawals to export.");
    const header = Object.keys(rows[0]).join(",");
    const lines = [header];
    for (const row of rows) lines.push(Object.values(row).map(v => (v===null?'':String(v)).replace(/\n/g,' ')).join(","));
    const csv = lines.join("\n");
    await ctx.replyWithDocument({ source: Buffer.from(csv, "utf8"), filename: "withdrawals_export.csv" });
    await ctx.answerCbQuery();
  } catch (e) {
    console.error("admin_export err", e);
    await ctx.answerCbQuery("Export failed");
  }
});

bot.action("admin_broadcast_hint", async (ctx) => {
  await ctx.answerCbQuery("Use /broadcast <message> to broadcast to all users.");
});

// back to menu
bot.action("back_to_menu", async (ctx) => {
  try {
    await ctx.editMessageReplyMarkup(null);
  } catch (e) {}
  await ctx.reply("🔙 Back to menu", getMainMenu(ctx));
});

// ---------- Admin-only commands: /broadcast, /approve_withdraw, /decline_withdraw ----------
bot.command("broadcast", async (ctx) => {
  const id = String(ctx.from.id);
  if (!ADMIN_IDS.includes(id)) return ctx.reply("⛔ Not authorized.");
  const parts = (ctx.message.text || "").split(" ").slice(1);
  if (parts.length === 0) return ctx.reply("Usage: /broadcast <message>");
  const message = parts.join(" ");
  const users = await safeQuery("SELECT telegram_id FROM users");
  let sent = 0;
  for (const u of users.rows) {
    try { await bot.telegram.sendMessage(u.telegram_id, message); sent++; } catch(e){}
  }
  await ctx.reply(`✅ Broadcast sent to ${sent} users.`);
});

// /approve_withdraw and /decline_withdraw are already present in parts earlier (ensure they exist in your merged file)

// --------------------------
// Part 4 — DB init, Webhook + Server Startup
// --------------------------

/**
 * initializeDatabase() — create tables if missing.
 * If you already run a schema elsewhere, this is safe (uses CREATE TABLE IF NOT EXISTS).
 */
async function initializeDatabase() {
  try {
    const sql = `
      -- users
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        coins BIGINT DEFAULT 0,
        balance NUMERIC DEFAULT 0,
        referred_by BIGINT,
        referral_credited BOOLEAN DEFAULT FALSE,
        bank_name TEXT,
        bank_account_number TEXT,
        bank_account_name TEXT,
        is_banned BOOLEAN DEFAULT FALSE,
        next_task_available_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        amount NUMERIC,
        type TEXT,
        coins BIGINT,
        meta JSONB,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        coins BIGINT,
        usd NUMERIC,
        bank_name TEXT,
        account_name TEXT,
        account_number TEXT,
        status TEXT DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP,
        admin_note TEXT
      );

      CREATE TABLE IF NOT EXISTS ad_sessions (
        id UUID PRIMARY KEY,
        telegram_id BIGINT,
        completed BOOLEAN DEFAULT FALSE,
        progress INT DEFAULT 0,
        last_view_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ad_views (
        id SERIAL PRIMARY KEY,
        session_id UUID REFERENCES ad_sessions(id) ON DELETE CASCADE,
        telegram_id BIGINT,
        ad_index INT,
        validated BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS support_requests (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        help_topic TEXT,
        message TEXT,
        status TEXT DEFAULT 'pending',
        admin_reply TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS reward_logs (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        task_id UUID,
        reward_amount NUMERIC DEFAULT 0,
        credited BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    await pool.query(sql);
    console.log("✅ All database tables created successfully!");
  } catch (e) {
    console.error("initializeDatabase error:", e);
    throw e;
  }
}

// Start everything (DB then webhook + server)
(async () => {
  try {
    await initializeDatabase();

    // Setup webhook for Render (if BASE_URL present). If you prefer polling, replace this flow with bot.launch()
    const BASE_URL = process.env.BASE_URL || "";
    if (BASE_URL) {
      const webhookUrl = `${BASE_URL.replace(/\/+$/,"")}/bot${BOT_TOKEN}`;
      try {
        await bot.telegram.setWebhook(webhookUrl);
        app.use(bot.webhookCallback(`/bot${BOT_TOKEN}`));
        console.log(`🚀 Bot running in webhook mode at: ${webhookUrl}`);
      } catch (e) {
        console.warn("Webhook setup failed, falling back to polling. Error:", e.message || e);
        await bot.launch();
        console.log("Bot launched (polling mode)");
      }
    } else {
      await bot.launch();
      console.log("Bot launched (polling mode)");
    }

    const PORT = process.env.PORT || 10000;
    app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
  } catch (e) {
    console.error("Startup error:", e);
    process.exit(1);
  }
})();

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
