// ==========================
// FonPay Task-Earnings Bot
// Full Production Version (Fixed)
// ==========================

// ---------- Imports ----------
import express from "express";
import { Telegraf, Markup } from "telegraf";
import dotenv from "dotenv";
import pool from "./src/db.js";
import axios from "axios";
import fs from "fs";
import path from "path";

dotenv.config();

// ---------- App Setup ----------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ---------- Constants ----------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("❌ TELEGRAM_BOT_TOKEN not set!");

const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "5236441213,5725566044")
  .split(",")
  .map((x) => x.trim());

const BASE_URL = process.env.BASE_URL || "https://fonpaybot.onrender.com";
const PORT = process.env.PORT || 3000;

let performTaskEnabled = true;

// ---------- Initialize Bot ----------
const bot = new Telegraf(BOT_TOKEN);

// ---------- Helper: Safe Query ----------
async function safeQuery(query, params = []) {
  try {
    return await pool.query(query, params);
  } catch (err) {
    console.error("DB Error:", err);
    return { rows: [] };
  }
}

// ---------- Helper: Main Menu ----------
function mainMenuKeyboard(isAdmin = false) {
  const buttons = [
    ["💼 Wallet Balance", "🎥 Perform Task"],
    ["💸 Withdraw", "👥 Refer & Earn"],
    ["🏦 Change Bank", "🆘 Get Help"],
  ];

  if (isAdmin) {
    buttons.push(["🛠️ Admin Panel"]);
  }

  return Markup.keyboard(buttons).resize();
}

// ---------- Start Command ----------
bot.start(async (ctx) => {
  const telegramId = String(ctx.from.id);
  const name = ctx.from.first_name || "User";

  await ctx.reply(
    `👋 Welcome ${name}!\n\nFonPay Task-Earnings Bot helps you perform tasks, earn rewards, and manage your FonPay wallet easily.\n\nUse the menu below to get started.`,
    mainMenuKeyboard(ADMIN_IDS.includes(telegramId))
  );
});

// ---------- Wallet Balance ----------
bot.hears("💼 Wallet Balance", async (ctx) => {
  const telegramId = String(ctx.from.id);

  const result = await safeQuery(
    "SELECT balance FROM users WHERE telegram_id=$1 LIMIT 1",
    [telegramId]
  );

  const balance = result.rows[0]?.balance || 0;
  await ctx.reply(`💰 Your current FonPay wallet balance is ₦${balance}`);
});

// ---------- Perform Task ----------
bot.hears("🎥 Perform Task", async (ctx) => {
  if (!performTaskEnabled) {
    return ctx.reply("⚠️ The Perform Task feature is temporarily disabled. Please try again later.");
  }

  const telegramId = String(ctx.from.id);
  await ctx.reply(
    "🎬 Please wait while we fetch your task session...",
    mainMenuKeyboard(ADMIN_IDS.includes(telegramId))
  );

  try {
    const sessionId = `${telegramId}-${Date.now()}`;
    await safeQuery(
      "INSERT INTO ad_sessions (session_id, telegram_id, created_at) VALUES ($1,$2,NOW())",
      [sessionId, telegramId]
    );

    const adLink = `${BASE_URL}/ad-session/${sessionId}`;
    await ctx.reply(
      `📺 Click the link below to start your task:\n\n${adLink}\n\nOnce done, return here to confirm.`,
      mainMenuKeyboard(ADMIN_IDS.includes(telegramId))
    );
  } catch (err) {
    console.error("Perform Task Error:", err);
    await ctx.reply("⚠️ Something went wrong. Please try again later.");
  }
});

// ---------- Withdraw ----------
bot.hears("💸 Withdraw", async (ctx) => {
  const telegramId = String(ctx.from.id);

  await ctx.reply(
    "💸 Please enter the amount you wish to withdraw. (Minimum ₦1000)",
    mainMenuKeyboard(ADMIN_IDS.includes(telegramId))
  );

  // Implement user input & withdraw validation later
});

// ---------- Refer & Earn ----------
bot.hears("👥 Refer & Earn", async (ctx) => {
  const telegramId = String(ctx.from.id);
  const referralLink = `https://t.me/${ctx.botInfo.username}?start=${telegramId}`;

  await ctx.reply(
    `👥 *Refer & Earn*\n\nShare your referral link and earn ₦200 for each verified signup.\n\n🔗 ${referralLink}`,
    { parse_mode: "Markdown", ...mainMenuKeyboard(ADMIN_IDS.includes(telegramId)) }
  );
});

// ---------- Change Bank ----------
bot.hears("🏦 Change Bank", async (ctx) => {
  await ctx.reply(
    "🏦 To update your withdrawal bank account, please send your bank details in this format:\n\n`BankName - AccountNumber - AccountName`",
    { parse_mode: "Markdown", ...mainMenuKeyboard(ADMIN_IDS.includes(ctx.from.id)) }
  );
});
