import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import { Telegraf, Markup } from "telegraf";

dotenv.config();
const { Pool } = pkg;

const app = express();
const port = process.env.PORT || 10000;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const bot = new Telegraf(process.env.BOT_TOKEN);

// ==============================
// 🧱 Auto Database Setup
// ==============================
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        coins BIGINT DEFAULT 0,
        referred_by BIGINT,
        is_admin BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
        task_name TEXT,
        status TEXT DEFAULT 'pending',
        completed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
        amount BIGINT,
        bank_name TEXT,
        account_number TEXT,
        account_name TEXT,
        status TEXT DEFAULT 'pending',
        requested_at TIMESTAMP DEFAULT NOW()
      );
    `);

    // Insert admin users if not exist
    const adminIds = [5236441213, 5725566044];
    for (const id of adminIds) {
      await pool.query(
        `INSERT INTO users (telegram_id, username, is_admin)
         VALUES ($1, 'admin', TRUE)
         ON CONFLICT (telegram_id) DO NOTHING;`,
        [id]
      );
    }

    console.log("✅ Database initialized successfully");
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
  }
}

// Run DB setup on start
initializeDatabase();

// ==============================
// 🤖 Telegram Bot Commands
// ==============================
bot.start(async (ctx) => {
  const tgId = ctx.from.id;
  const username = ctx.from.username || "User";

  await pool.query(
    `INSERT INTO users (telegram_id, username)
     VALUES ($1, $2)
     ON CONFLICT (telegram_id) DO NOTHING;`,
    [tgId, username]
  );

  ctx.reply(
    `👋 Welcome ${username}!\n\nEarn coins by performing tasks every 20 minutes.\nClick below to begin:`,
    Markup.inlineKeyboard([
      [Markup.button.callback("🎬 Perform Task", "perform_task")],
      [Markup.button.callback("💰 Withdraw", "withdraw")],
      [Markup.button.callback("👥 Refer & Earn", "refer")]
    ])
  );
});

// Handle Perform Task
bot.action("perform_task", async (ctx) => {
  const tgId = ctx.from.id;
  const userRes = await pool.query("SELECT * FROM users WHERE telegram_id = $1", [tgId]);
  const user = userRes.rows[0];

  if (!user) return ctx.reply("❌ User not found, please restart the bot.");

  ctx.replyWithHTML(
    `🎯 Task Available!\n\nWatch 10 ads to earn <b>200 coins</b>.`,
    Markup.inlineKeyboard([
      [Markup.button.url("▶️ Watch Ads", `https://task-earnings-bot.onrender.com/ad/${tgId}`)]
    ])
  );
});

// Handle Withdraw
bot.action("withdraw", (ctx) => {
  ctx.reply("💸 Enter your withdrawal details:\n\nBank name, Account number, Account name, and amount.");
});

// Handle Referral
bot.action("refer", (ctx) => {
  const tgId = ctx.from.id;
  ctx.reply(
    `👥 Invite friends and earn 50 coins per referral!\n\nYour link:\nhttps://t.me/${ctx.botInfo.username}?start=${tgId}`
  );
});

// ==============================
// ⚙️ Admin Panel Command
// ==============================
bot.command("admin", async (ctx) => {
  const tgId = ctx.from.id;
  const adminCheck = await pool.query("SELECT is_admin FROM users WHERE telegram_id = $1", [tgId]);
  const isAdmin = adminCheck.rows[0]?.is_admin;

  if (!isAdmin) return ctx.reply("❌ You are not authorized to access this command.");

  ctx.reply(
    "⚙️ Admin Panel",
    Markup.inlineKeyboard([
      [Markup.button.callback("📋 View Users", "view_users")],
      [Markup.button.callback("💰 View Withdrawals", "view_withdrawals")],
      [Markup.button.callback("🚫 Ban User", "ban_user")]
    ])
  );
});

// ==============================
// 🌐 Express Server
// ==============================
app.get("/", (req, res) => {
  res.send("Task Earnings Bot is running ✅");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

bot.launch();
