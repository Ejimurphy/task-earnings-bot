// ==========================
// Task Earnings Bot - Server
// Stable Build (No Syntax Error)
// Admins: 5236441213, 5725566044
// Monetag Zone: 10136395
// ==========================

import express from "express";
import { Telegraf } from "telegraf";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(express.json());

// ========= ENV =========
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = process.env.PORT || 10000;
const MONETAG_ZONE = process.env.MONETAG_ZONE || "10136395";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "5236441213,5725566044")
  .split(",")
  .map((id) => id.trim());

// ========= DB =========
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
        bank_name TEXT,
        account_name TEXT,
        account_number TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
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
  } catch (err) {
    console.error("❌ DB init failed:", err);
  }
}

// ========= BOT =========
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || "Unknown";

  try {
    const user = await pool.query("SELECT * FROM users WHERE telegram_id=$1", [
      telegramId,
    ]);

    if (user.rows.length === 0) {
      await pool.query(
        "INSERT INTO users (telegram_id, username) VALUES ($1,$2)",
        [telegramId, username]
      );
      await ctx.reply(
        `🎉 Welcome, ${username}! Your FonPay Task account is ready.\n\nUse /menu to view available options.`
      );
    } else {
      await ctx.reply(`👋 Welcome back, ${username}! Use /menu to continue.`);
    }
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ Error creating your account.");
  }
});

// ========= MENU =========
bot.command("menu", async (ctx) => {
  const keyboard = [
    [{ text: "💼 Wallet Balance" }, { text: "🎥 Perform Task" }],
    [{ text: "💸 Withdraw" }, { text: "👥 Refer & Earn" }],
    [{ text: "🏦 Change Bank" }, { text: "🆘 Get Help" }],
  ];
  await ctx.reply("📍 Choose an option below:", {
    reply_markup: { keyboard, resize_keyboard: true },
  });
});

// ========= WALLET =========
bot.hears("💼 Wallet Balance", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const res = await pool.query(
      "SELECT balance, coins FROM users WHERE telegram_id=$1",
      [telegramId]
    );
    if (res.rows.length === 0)
      return ctx.reply("⚠️ You don’t have a wallet yet. Type /start first.");

    const { balance, coins } = res.rows[0];
    const dollarValue = (coins * 0.00005).toFixed(2);
    await ctx.reply(
      `💰 *Wallet Summary*\n\nCoins: ${coins} 🪙\n≈ $${dollarValue}\nCash: ₦${balance}\n\n#PayWithFonPayAndRelax`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ Error fetching wallet details.");
  }
});

// ========= TASK =========
bot.hears("🎥 Perform Task", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    await pool.query(
      "INSERT INTO ad_views (user_id, ad_count, completed) VALUES ($1,0,FALSE) ON CONFLICT (user_id) DO NOTHING",
      [telegramId]
    );

    const { rows } = await pool.query(
      "SELECT ad_count FROM ad_views WHERE user_id=$1",
      [telegramId]
    );
    const count = rows.length ? rows[0].ad_count : 0;

    await ctx.reply(
      `🎬 *Task Started!*\n\nProgress: ${count}/10 ads watched.\n\nWatch ads here 👇\n<script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script>\n\nAfter all 10 ads, type *Done* to claim reward.`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ Error starting your task.");
  }
});
// ==========================
// Task Earnings Bot - Server
// Stable Build (No Syntax Error)
// Admins: 5236441213, 5725566044
// Monetag Zone: 10136395
// ==========================

import express from "express";
import { Telegraf } from "telegraf";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(express.json());

// ========= ENV =========
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const PORT = process.env.PORT || 10000;
const MONETAG_ZONE = process.env.MONETAG_ZONE || "10136395";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "5236441213,5725566044")
  .split(",")
  .map((id) => id.trim());

// ========= DB =========
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
        bank_name TEXT,
        account_name TEXT,
        account_number TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_id BIGINT REFERENCES users(telegram_id),
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
  } catch (err) {
    console.error("❌ DB init failed:", err);
  }
}

// ========= BOT =========
const bot = new Telegraf(BOT_TOKEN);

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || "Unknown";

  try {
    const user = await pool.query("SELECT * FROM users WHERE telegram_id=$1", [
      telegramId,
    ]);

    if (user.rows.length === 0) {
      await pool.query(
        "INSERT INTO users (telegram_id, username) VALUES ($1,$2)",
        [telegramId, username]
      );
      await ctx.reply(
        `🎉 Welcome, ${username}! Your FonPay Task account is ready.\n\nUse /menu to view available options.`
      );
    } else {
      await ctx.reply(`👋 Welcome back, ${username}! Use /menu to continue.`);
    }
  } catch (err) {
    console.error(err);
    await ctx.reply("⚠️ Error creating your account.");
  }
});

// ========= MENU =========
bot.command("menu", async (ctx) => {
  const keyboard = [
    [{ text: "💼 Wallet Balance" }, { text: "🎥 Perform Task" }],
    [{ text: "💸 Withdraw" }, { text: "👥 Refer & Earn" }],
    [{ text: "🏦 Change Bank" }, { text: "🆘 Get Help" }],
  ];
  await ctx.reply("📍 Choose an option below:", {
    reply_markup: { keyboard, resize_keyboard: true },
  });
});

// ========= WALLET =========
bot.hears("💼 Wallet Balance", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const res = await pool.query(
      "SELECT balance, coins FROM users WHERE telegram_id=$1",
      [telegramId]
    );
    if (res.rows.length === 0)
      return ctx.reply("⚠️ You don’t have a wallet yet. Type /start first.");

    const { balance, coins } = res.rows[0];
    const dollarValue = (coins * 0.00005).toFixed(2);
    await ctx.reply(
      `💰 *Wallet Summary*\n\nCoins: ${coins} 🪙\n≈ $${dollarValue}\nCash: ₦${balance}\n\n#PayWithFonPayAndRelax`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ Error fetching wallet details.");
  }
});

// ========= TASK =========
bot.hears("🎥 Perform Task", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    await pool.query(
      "INSERT INTO ad_views (user_id, ad_count, completed) VALUES ($1,0,FALSE) ON CONFLICT (user_id) DO NOTHING",
      [telegramId]
    );

    const { rows } = await pool.query(
      "SELECT ad_count FROM ad_views WHERE user_id=$1",
      [telegramId]
    );
    const count = rows.length ? rows[0].ad_count : 0;

    await ctx.reply(
      `🎬 *Task Started!*\n\nProgress: ${count}/10 ads watched.\n\nWatch ads here 👇\n<script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script>\n\nAfter all 10 ads, type *Done* to claim reward.`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error(e);
    await ctx.reply("⚠️ Error starting your task.");
  }
});
// ========= UNKNOWN TEXT HANDLER =========
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();

  // If the message matches none of the commands or buttons
  if (!text.startsWith("/")) {
    await ctx.reply(
      "🤖 I didn’t understand that. Please choose an option below:",
      {
        reply_markup: {
          keyboard: [
            ["🎥 Perform Task", "💰 My Balance"],
            ["👥 Refer & Earn", "💸 Withdraw"],
            ["🏦 Change Bank", "🆘 Get Help"],
          ],
          resize_keyboard: true,
        },
      }
    );
  }
});

// ========= UNKNOWN TEXT HANDLER =========
bot.on("text", async (ctx) => {
  const text = ctx.message.text.trim();

  // If the message matches none of the commands or buttons
  if (!text.startsWith("/")) {
    await ctx.reply(
      "🤖 I didn’t understand that. Please choose an option below:",
      {
        reply_markup: {
          keyboard: [
            ["🎥 Perform Task", "💰 My Balance"],
            ["👥 Refer & Earn", "💸 Withdraw"],
            ["🏦 Change Bank", "🆘 Get Help"],
          ],
          resize_keyboard: true,
        },
      }
    );
  }
});

// ========= ADMIN COMMANDS =========

// View all users
bot.command("view_users", async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  try {
    const res = await pool.query(
      "SELECT telegram_id, username, balance FROM users ORDER BY id DESC"
    );
    if (res.rows.length === 0) return ctx.reply("No users found.");
    let msg = "👥 *Registered Users:*\n\n";
    for (const u of res.rows) {
      msg += `🧾 ID: ${u.telegram_id}\n👤 @${u.username || "N/A"}\n💰 ₦${u.balance}\n\n`;
    }
    await ctx.reply(msg, { parse_mode: "Markdown" });
  } catch (err) {
    console.error(err);
    await ctx.reply("Error fetching users.");
  }
});

// Platform stats
bot.command("stats", async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  try {
    const users = await pool.query("SELECT COUNT(*) FROM users");
    const withdrawals = await pool.query("SELECT COUNT(*) FROM withdrawals");
    const pending = await pool.query(
      "SELECT COUNT(*) FROM withdrawals WHERE status='pending'"
    );

    await ctx.reply(
      `📊 *FonPay Bot Stats*\n\n👥 Users: ${users.rows[0].count}\n💸 Withdrawals: ${withdrawals.rows[0].count}\n🕒 Pending: ${pending.rows[0].count}`,
      { parse_mode: "Markdown" }
    );
  } catch (err) {
    console.error(err);
    await ctx.reply("Error loading stats.");
  }
});

// Broadcast message
bot.command("broadcast", async (ctx) => {
  if (!ADMIN_IDS.includes(ctx.from.id)) return;
  const parts = ctx.message.text.split(" ");
  parts.shift();
  const message = parts.join(" ");
  if (!message) return ctx.reply("Usage: /broadcast your_message");

  try {
    const res = await pool.query("SELECT telegram_id FROM users");
    for (const row of res.rows) {
      await bot.telegram.sendMessage(row.telegram_id, message);
    }
    await ctx.reply("✅ Broadcast sent successfully!");
  } catch (err) {
    console.error(err);
    await ctx.reply("❌ Broadcast failed.");
  }
});

// ========= EXPRESS SERVER =========
const app = express();

app.get("/", (req, res) => {
  res.send("✅ FonPay Task-Earnings Bot is running smoothly.");
});

// Health check endpoint (Render requirement)
app.get("/health", (req, res) => res.send("OK"));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Server running on port ${PORT}`);
});

// ========= START BOT =========
bot.launch()
  .then(() => console.log("🤖 FonPay Task-Earnings Bot started successfully!"))
  .catch((err) => console.error("Bot launch error:", err));

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
            
