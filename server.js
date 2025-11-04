import express from "express";
import pkg from "pg";
import dotenv from "dotenv";
import { Telegraf, Markup } from "telegraf";

dotenv.config();

const app = express();
const port = process.env.PORT || 10000;

const { Pool } = pkg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ✅ Initialize Database
async function initializeDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE,
      username TEXT,
      balance NUMERIC DEFAULT 0,
      is_admin BOOLEAN DEFAULT FALSE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id SERIAL PRIMARY KEY,
      title TEXT,
      reward NUMERIC,
      ad_link TEXT
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      bank_name TEXT,
      account_number TEXT,
      account_name TEXT,
      amount NUMERIC DEFAULT 0,
      status TEXT DEFAULT 'pending'
    );
  `);

  console.log("✅ Database initialized successfully");
}

// ✅ Start Database Init
initializeDatabase().catch((err) => {
  console.error("❌ Database initialization failed:", err);
});

// ✅ Initialize Bot
const bot = new Telegraf(process.env.BOT_TOKEN);

// Helper: Register user if not exists
async function ensureUser(ctx) {
  const telegram_id = ctx.from.id;
  const username = ctx.from.username || "Unknown";
  const user = await pool.query("SELECT * FROM users WHERE telegram_id = $1", [telegram_id]);

  if (user.rows.length === 0) {
    await pool.query(
      "INSERT INTO users (telegram_id, username, balance) VALUES ($1, $2, 0)",
      [telegram_id, username]
    );
  }
}

// ✅ /start command
bot.start(async (ctx) => {
  await ensureUser(ctx);

  await ctx.reply(
    `👋 Welcome ${ctx.from.first_name}!\n\nEarn by watching ads, completing tasks, and withdrawing your balance anytime.`,
    Markup.inlineKeyboard([
      [Markup.button.callback("💰 Wallet Balance", "balance")],
      [Markup.button.callback("🎬 Watch Ads", "watch_ads")],
      [Markup.button.callback("💳 Withdraw", "withdraw")],
    ])
  );
});

// ✅ Balance button
bot.action("balance", async (ctx) => {
  const telegram_id = ctx.from.id;
  const result = await pool.query("SELECT balance FROM users WHERE telegram_id = $1", [telegram_id]);
  const balance = result.rows[0]?.balance || 0;
  await ctx.answerCbQuery();
  await ctx.reply(`💼 Your current balance: ₦${balance}`);
});

// ✅ Watch Ads button
bot.action("watch_ads", async (ctx) => {
  const telegram_id = ctx.from.id;
  const adUrl = `${process.env.BASE_URL || "https://task-earnings-bot.onrender.com"}/ad/${telegram_id}`;
  await ctx.answerCbQuery();
  await ctx.reply(`🎬 Click below to watch your ad and earn:\n\n${adUrl}`);
});

// ✅ Withdraw button
bot.action("withdraw", async (ctx) => {
  await ctx.answerCbQuery();
  await ctx.reply("🏦 Please enter your bank details in this format:\n\nBankName-AccountNumber-AccountName");
});

// ✅ Handle Bank Details
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();
  if (text.includes("-") && text.split("-").length === 3) {
    const [bankName, accountNumber, accountName] = text.split("-");
    const telegramId = ctx.from.id;

    await pool.query(
      `INSERT INTO withdrawals (telegram_id, bank_name, account_number, account_name)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (telegram_id) DO NOTHING;`,
      [telegramId, bankName.trim(), accountNumber.trim(), accountName.trim()]
    );

    await ctx.reply("✅ Your bank details have been saved successfully. You can now request withdrawals anytime!");
  }
});

// ✅ Ad route (for “Watch Ads”)
app.get("/ad/:userId", async (req, res) => {
  const { userId } = req.params;

  // reward user for visiting ad page
  try {
    await pool.query("UPDATE users SET balance = balance + 10 WHERE telegram_id = $1", [userId]);
  } catch (err) {
    console.error("❌ Error crediting reward:", err);
  }

  res.send(`
    <html>
      <head><title>Watch Ad</title></head>
      <body style="text-align:center; margin-top:50px;">
        <h2>🎉 Thanks for watching this ad!</h2>
        <p>Your wallet has been credited with ₦10 reward.</p>
      </body>
    </html>
  `);
});

// ✅ Root endpoint
app.get("/", (req, res) => {
  res.send("FonPay Task-Earnings Bot is running successfully 🚀");
});

// ✅ Start server
bot.launch();
app.listen(port, () => console.log(`Server running on port ${port}`));

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
