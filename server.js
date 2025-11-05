import express from "express";
import bodyParser from "body-parser";
import sqlite3 from "sqlite3";
import { open } from "sqlite";
import TelegramBot from "node-telegram-bot-api";
import cron from "node-cron";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(bodyParser.json());

// ====== CONFIG ======
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID || "5725566044";
const COIN_TO_USD = 0.00005;
const REWARD_PER_TASK = 200;
const REFERRAL_REWARD = 50;
const MIN_WITHDRAWAL_COINS = 60000;

// ====== TELEGRAM BOT ======
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, { polling: true });

// ====== DATABASE ======
let db;
(async () => {
  db = await open({
    filename: "./taskbot.db",
    driver: sqlite3.Database,
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id TEXT UNIQUE,
      username TEXT,
      wallet_coins INTEGER DEFAULT 0,
      invited_by TEXT,
      next_task_time TEXT,
      is_banned INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);

  await db.exec(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      coins INTEGER,
      usd REAL,
      status TEXT DEFAULT 'pending',
      account_name TEXT,
      account_number TEXT,
      bank_name TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `);
})();

// ====== HELPERS ======
function coinsToUSD(coins) {
  return (coins * COIN_TO_USD).toFixed(2);
}

async function scheduleNextTask(userId) {
  const now = new Date();
  const offset = Math.floor(Math.random() * 600000) - 300000; // ±5 mins
  const nextTime = new Date(now.getTime() + 20 * 60000 + offset);
  await db.run(`UPDATE users SET next_task_time = ? WHERE id = ?`, [
    nextTime.toISOString(),
    userId,
  ]);
}

// ====== TELEGRAM COMMANDS ======
bot.onText(/\/start(?: (.+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const username = msg.from.username || msg.from.first_name;
  const refCode = match[1];

  let user = await db.get(`SELECT * FROM users WHERE telegram_id = ?`, [
    chatId,
  ]);
  if (!user) {
    await db.run(
      `INSERT INTO users (telegram_id, username, invited_by) VALUES (?, ?, ?)`,
      [chatId, username, refCode || null]
    );
    user = await db.get(`SELECT * FROM users WHERE telegram_id = ?`, [chatId]);

    // Give referrer bonus if valid
    if (refCode) {
      const refUser = await db.get(
        `SELECT * FROM users WHERE telegram_id = ?`,
        [refCode]
      );
      if (refUser) {
        await db.run(
          `UPDATE users SET wallet_coins = wallet_coins + ? WHERE id = ?`,
          [REFERRAL_REWARD, refUser.id]
        );
        bot.sendMessage(
          refUser.telegram_id,
          `🎉 You earned ${REFERRAL_REWARD} coins from referring ${username}!`
        );
      }
    }
  }

  await scheduleNextTask(user.id);

  bot.sendMessage(
    chatId,
    `👋 Welcome ${username}!\n\nYour wallet: ${user.wallet_coins} coins ($${coinsToUSD(
      user.wallet_coins
    )}).\n\nUse /task to perform your next task.\nInvite others with your link:\nhttps://t.me/${
      bot.me?.username || "YourBot"
    }?start=${chatId}`
  );
});

// ====== TASK COMMAND ======
bot.onText(/\/task/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await db.get(`SELECT * FROM users WHERE telegram_id = ?`, [
    chatId,
  ]);

  if (!user) return bot.sendMessage(chatId, "Please use /start first.");
  if (user.is_banned) return bot.sendMessage(chatId, "🚫 You are banned.");

  const now = new Date();
  const next = new Date(user.next_task_time);

  if (now < next) {
    const diff = Math.round((next - now) / 60000);
    return bot.sendMessage(
      chatId,
      `⏳ Please wait ${diff} minutes before your next task.`
    );
  }

  // Task simulation (watching 10 ads)
  await db.run(
    `UPDATE users SET wallet_coins = wallet_coins + ? WHERE id = ?`,
    [REWARD_PER_TASK, user.id]
  );
  await scheduleNextTask(user.id);

  const updated = await db.get(
    `SELECT wallet_coins FROM users WHERE id = ?`,
    [user.id]
  );

  bot.sendMessage(
    chatId,
    `✅ Task completed! You earned ${REWARD_PER_TASK} coins.\n\nWallet: ${updated.wallet_coins} coins ($${coinsToUSD(
      updated.wallet_coins
    )}).`
  );
});

// ====== WALLET COMMAND ======
bot.onText(/\/wallet/, async (msg) => {
  const chatId = msg.chat.id;
  const user = await db.get(`SELECT * FROM users WHERE telegram_id = ?`, [
    chatId,
  ]);
  if (!user) return bot.sendMessage(chatId, "Please use /start first.");

  bot.sendMessage(
    chatId,
    `💰 Wallet balance:\n${user.wallet_coins} coins ($${coinsToUSD(
      user.wallet_coins
    )}).`
  );
});

// ====== WITHDRAW COMMAND ======
bot.onText(/\/withdraw (.+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  const [account_number, bank_name, account_name] = match[1].split(",");
  const user = await db.get(`SELECT * FROM users WHERE telegram_id = ?`, [
    chatId,
  ]);

  if (!user) return bot.sendMessage(chatId, "Please use /start first.");
  if (user.wallet_coins < MIN_WITHDRAWAL_COINS)
    return bot.sendMessage(
      chatId,
      `🚫 Minimum withdrawal is ${MIN_WITHDRAWAL_COINS} coins.`
    );

  await db.run(
    `INSERT INTO withdrawals (user_id, coins, usd, account_name, account_number, bank_name) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      user.id,
      user.wallet_coins,
      coinsToUSD(user.wallet_coins),
      account_name,
      account_number,
      bank_name,
    ]
  );
  await db.run(`UPDATE users SET wallet_coins = 0 WHERE id = ?`, [user.id]);

  bot.sendMessage(
    chatId,
    `✅ Withdrawal request submitted for ${coinsToUSD(
      user.wallet_coins
    )} USD.\nWe’ll review and process shortly.`
  );

  bot.sendMessage(
    ADMIN_ID,
    `💸 New withdrawal request from ${user.username}\nAmount: ${user.wallet_coins} coins ($${coinsToUSD(
      user.wallet_coins
    )}).\nAccount: ${account_name} - ${bank_name} (${account_number}).`
  );
});

// ====== ADMIN COMMANDS ======
bot.onText(/\/users/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return;
  const users = await db.all(`SELECT * FROM users`);
  bot.sendMessage(
    msg.chat.id,
    `👥 Total users: ${users.length}\n\n${users
      .map((u) => `${u.username} - ${u.wallet_coins} coins`)
      .join("\n")}`
  );
});

bot.onText(/\/withdrawals/, async (msg) => {
  if (msg.chat.id.toString() !== ADMIN_ID) return;
  const rows = await db.all(
    `SELECT * FROM withdrawals WHERE status='pending'`
  );
  if (!rows.length) return bot.sendMessage(msg.chat.id, "No pending requests.");
  bot.sendMessage(
    msg.chat.id,
    `💵 Pending withdrawals:\n\n${rows
      .map(
        (r) =>
          `ID: ${r.id} | ${r.usd} USD | ${r.account_name} (${r.bank_name})`
      )
      .join("\n")}`
  );
});

// ====== EXPRESS ROUTE (optional health check) ======
app.get("/", (req, res) => res.send("Task-Earning Bot Server is running!"));

// ====== CRON JOB TO REMIND USERS ======
cron.schedule("*/5 * * * *", async () => {
  const now = new Date();
  const rows = await db.all(`SELECT * FROM users WHERE next_task_time IS NOT NULL`);
  for (const user of rows) {
    const next = new Date(user.next_task_time);
    const diff = Math.floor((next - now) / 60000);
    if (diff <= 5 && diff > 0) {
      bot.sendMessage(
        user.telegram_id,
        `⏰ Reminder: Your next task will be available in ${diff} minutes!`
      );
    }
  }
});

// ====== START SERVER ======
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
              
