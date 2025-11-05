// ==========================
// Task Earnings Bot - Server
// Updated with Monetag Zone 10136395
// Admins: 5236441213, 5725566044
// ==========================

import express from "express";
import { Telegraf } from "telegraf";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(express.json());

// ========== ENVIRONMENT CONFIG ==========
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = process.env.PORT || 10000;
const MONETAG_ZONE = process.env.MONETAG_ZONE || "10136395";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "5236441213,5725566044")
  .split(",")
  .map((id) => id.trim());

// ========== DATABASE SETUP ==========
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        balance NUMERIC DEFAULT 0,
        coins BIGINT DEFAULT 0,
        referred_by BIGINT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
        bank_name TEXT,
        account_name TEXT,
        account_number TEXT,
        amount NUMERIC,
        status TEXT DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ad_views (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
        ad_count INT DEFAULT 0,
        completed BOOLEAN DEFAULT FALSE,
        last_watch TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    console.log("✅ Database initialized successfully");
  } catch (error) {
    console.error("❌ Database initialization failed:", error);
  }
}

// ========== TELEGRAM BOT ==========
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || "Unknown";

  try {
    const existing = await pool.query(
      "SELECT * FROM users WHERE telegram_id = $1",
      [telegramId]
    );

    if (existing.rows.length === 0) {
      await pool.query(
        "INSERT INTO users (telegram_id, username) VALUES ($1, $2)",
        [telegramId, username]
      );
      await ctx.reply(
        `🎉 Welcome, ${username}! Your account has been created successfully.\n\nUse /menu to view available options.`
      );
    } else {
      await ctx.reply(`👋 Welcome back, ${username}! Use /menu to continue.`);
    }
  } catch (err) {
    console.error("Error on start:", err);
    await ctx.reply("⚠️ An error occurred while creating your account.");
  }
});

// ========== MAIN MENU ==========
bot.command("menu", async (ctx) => {
  const keyboard = [
    [{ text: "💼 Wallet Balance" }, { text: "🎥 Perform Task" }],
    [{ text: "💸 Withdraw" }, { text: "👥 Refer & Earn" }],
  ];
  await ctx.reply("📍 Choose an option below:", {
    reply_markup: { keyboard, resize_keyboard: true },
  });
});

// ========== HANDLE BUTTONS ==========
bot.hears("💼 Wallet Balance", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const res = await pool.query(
      "SELECT balance, coins FROM users WHERE telegram_id=$1",
      [telegramId]
    );
    if (res.rows.length === 0) {
      return ctx.reply("⚠️ You don’t have a wallet yet. Type /start to register.");
    }
    const { balance, coins } = res.rows[0];
    const dollarValue = (coins * 0.00005).toFixed(2);
    await ctx.reply(
      `💰 *Wallet Summary*\n\nCoins: ${coins} 🪙\nEquivalent: $${dollarValue}\nCash: ₦${balance}\n\n#PayWithFonPayAndRelax`,
      { parse_mode: "Markdown" }
    );
  } catch (error) {
    console.error(error);
    await ctx.reply("⚠️ Error fetching wallet details.");
  }
});

bot.hears("🎥 Perform Task", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    await pool.query(
      "INSERT INTO ad_views (user_id, ad_count, completed) VALUES ($1, 0, FALSE) ON CONFLICT DO NOTHING",
      [telegramId]
    );
    await ctx.reply(
      `🎬 Task Started! Watch ads to earn rewards.\n\n👉 Visit: https://www.monetag.com/?zone=${MONETAG_ZONE}\n\nAfter watching all 10 ads, return and type *Done* to claim your reward.`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ Error starting your task.");
  }
});

bot.hears("Done", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const adRes = await pool.query(
      "SELECT * FROM ad_views WHERE user_id=$1",
      [telegramId]
    );
    if (adRes.rows.length === 0) {
      return ctx.reply("⚠️ You have no active task. Use /menu to start one.");
    }

    const adCount = adRes.rows[0].ad_count;
    if (adCount < 10) {
      return ctx.reply(
        `⚠️ You’ve only watched ${adCount}/10 ads.\nPlease complete all before submitting.`
      );
    }

    // Credit reward
    await pool.query(
      "UPDATE users SET coins = coins + 200 WHERE telegram_id = $1",
      [telegramId]
    );
    await pool.query(
      "UPDATE ad_views SET completed=TRUE WHERE user_id=$1",
      [telegramId]
    );

    await ctx.reply("✅ Task completed! 200 coins credited to your wallet. 🪙");
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ Error processing reward.");
  }
});

bot.hears("👥 Refer & Earn", async (ctx) => {
  const telegramId = ctx.from.id;
  const referralLink = `https://t.me/${ctx.botInfo.username}?start=${telegramId}`;
  await ctx.reply(
    `👥 *Refer and Earn!*\n\nShare this link with your friends:\n${referralLink}\n\nYou earn 50 coins for every active referral.`,
    { parse_mode: "Markdown" }
  );
});

// ========== WITHDRAWAL ==========
bot.hears("💸 Withdraw", async (ctx) => {
  await ctx.reply(
    "💳 To withdraw, please enter your bank details in this format:\n\nBankName,AccountName,AccountNumber,Amount"
  );
});

bot.on("text", async (ctx) => {
  const msg = ctx.message.text;
  if (msg.includes(",") && msg.split(",").length === 4) {
    const [bank, name, number, amount] = msg.split(",");
    const telegramId = ctx.from.id;

    try {
      await pool.query(
        "INSERT INTO withdrawals (user_id, bank_name, account_name, account_number, amount) VALUES ($1,$2,$3,$4,$5)",
        [telegramId, bank.trim(), name.trim(), number.trim(), parseFloat(amount)]
      );
      await ctx.reply(
        "✅ Withdrawal request received! Admin will review shortly."
      );
    } catch (err) {
      console.error(err);
      await ctx.reply("⚠️ Error submitting withdrawal request.");
    }
  }
});

// ========== ADMIN COMMANDS ==========
bot.command("admin", async (ctx) => {
  const telegramId = ctx.from.id.toString();
  if (!ADMIN_IDS.includes(telegramId)) {
    return ctx.reply("❌ You are not authorized to use admin commands.");
  }
  await ctx.reply(
    "🛠 Admin Commands:\n/export_withdrawals\n/view_users\n/approve_withdrawal <id>\n/decline_withdrawal <id>"
  );
});

// ========== START SERVER ==========
app.get("/", (req, res) => {
  res.send("FonPay Task-Earnings Bot Server is running successfully ✅");
});

app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  await initializeDatabase();
});

bot.launch();
    
