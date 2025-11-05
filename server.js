
// ======================= IMPORTS =======================
import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";

dotenv.config();
const { Pool } = pkg;

// ======================= CONFIG =======================
const app = express();
const PORT = process.env.PORT || 10000;
const bot = new Telegraf(process.env.BOT_TOKEN);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// ======================= DATABASE INIT =======================
async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        first_name TEXT,
        last_name TEXT,
        balance NUMERIC DEFAULT 0,
        coins NUMERIC DEFAULT 0,
        bank_name TEXT,
        account_number TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        amount NUMERIC,
        bank_name TEXT,
        account_number TEXT,
        requested_at TIMESTAMP DEFAULT NOW()
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS ads (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT,
        watched_count INT DEFAULT 0,
        last_watched TIMESTAMP
      );
    `);
    console.log("✅ Database initialized successfully");
  } catch (err) {
    console.error("❌ Database initialization failed:", err);
  } finally {
    client.release();
  }
}
initializeDatabase();

// ======================= EXPRESS SERVER =======================
app.get("/", (req, res) => res.send("✅ FonPay Task Earnings Bot running."));

// ======================= TELEGRAM BOT =======================
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "").split(",");

// USER COMMANDS
bot.start(async (ctx) => {
  const telegram_id = ctx.from.id;
  const username = ctx.from.username || "";
  const first_name = ctx.from.first_name || "";
  const last_name = ctx.from.last_name || "";

  await pool.query(
    `INSERT INTO users (telegram_id, username, first_name, last_name)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (telegram_id) DO NOTHING`,
    [telegram_id, username, first_name, last_name]
  );
  return ctx.reply(
    "👋 Welcome to *FonPay Task Earnings Bot!*

Use the menu below to earn and manage your rewards.",
    {
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [
          ["🎯 Perform Task", "💰 Wallet Balance"],
          ["🏦 Withdraw", "👥 Refer & Earn"],
          ["⚙️ Settings", "🆘 Get Help"]
        ],
        resize_keyboard: true
      }
    }
  );
});

// HANDLE PERFORM TASK
bot.hears("🎯 Perform Task", async (ctx) => {
  const telegram_id = ctx.from.id;
  const userRes = await pool.query("SELECT * FROM ads WHERE telegram_id=$1", [telegram_id]);
  let watched = userRes.rows.length ? userRes.rows[0].watched_count : 0;
  if (!watched) {
    await pool.query("INSERT INTO ads (telegram_id, watched_count) VALUES ($1, 0) ON CONFLICT (telegram_id) DO NOTHING", [telegram_id]);
  }
  const remaining = 10 - watched;
  if (remaining <= 0) {
    await pool.query("UPDATE users SET balance = balance + 10 WHERE telegram_id=$1", [telegram_id]);
    await pool.query("UPDATE ads SET watched_count=0 WHERE telegram_id=$1", [telegram_id]);
    return ctx.reply("✅ You completed all ads! ₦10 credited to your wallet.");
  }
  await pool.query("UPDATE ads SET watched_count = watched_count + 1 WHERE telegram_id=$1", [telegram_id]);
  ctx.reply(`📺 Ad watched successfully.
Progress: ${watched + 1}/10
Remaining: ${remaining - 1}`);
  if (watched + 1 >= 10) {
    await pool.query("UPDATE users SET balance = balance + 10 WHERE telegram_id=$1", [telegram_id]);
    ctx.reply("🎉 Task complete! ₦10 added to your wallet.");
  }
});

// WALLET BALANCE
bot.hears("💰 Wallet Balance", async (ctx) => {
  try {
    const { rows } = await pool.query("SELECT balance, coins FROM users WHERE telegram_id=$1", [ctx.from.id]);
    if (!rows.length) return ctx.reply("⚠️ Error fetching wallet details.");
    const { balance, coins } = rows[0];
    return ctx.reply(`💵 Balance: $${balance?.toFixed(2) || 0}
🪙 Coins: ${coins || 0}`);
  } catch {
    return ctx.reply("⚠️ Error fetching wallet details.");
  }
});

// WITHDRAW COMMAND
bot.hears("🏦 Withdraw", async (ctx) => {
  ctx.reply("💳 Please enter your bank name and account number separated by a comma.");
});

// REFER & EARN
bot.hears("👥 Refer & Earn", async (ctx) => {
  const refLink = `https://t.me/${ctx.botInfo.username}?start=${ctx.from.id}`;
  ctx.reply(`Invite friends and earn rewards!

Your referral link:
${refLink}`);
});

// SETTINGS
bot.hears("⚙️ Settings", async (ctx) => {
  ctx.reply("⚙️ Settings Menu:
- Update bank account
- View referral info
- Change password");
});

// GET HELP
bot.hears("🆘 Get Help", async (ctx) => {
  ctx.reply("💬 For assistance, contact our admin via @FonPaySupport.");
});

// INVALID MESSAGE HANDLER
bot.on("text", async (ctx) => {
  const validCmds = ["🎯 Perform Task", "💰 Wallet Balance", "🏦 Withdraw", "👥 Refer & Earn", "⚙️ Settings", "🆘 Get Help"];
  if (!validCmds.includes(ctx.message.text)) {
    return ctx.reply("⚠️ Invalid text. Please use one of the available command buttons.");
  }
});

// START SERVER & BOT
bot.launch();
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
