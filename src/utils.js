import pool from "./db.js";
import { Telegraf } from "telegraf";

export const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ---------- Database Helper (safe queries) ----------
export async function safeQuery(query, params = []) {
  try {
    const result = await pool.query(query, params);
    return result;
  } catch (error) {
    console.error("Database Error:", error);
    throw error;
  }
}

// ---------- Utility Functions ----------
export function coinsToUSD(coins) {
  const rate = Number(process.env.COIN_TO_USD || 0.00005);
  return (coins * rate).toFixed(4);
}

export function usdToCoins(usd) {
  const rate = Number(process.env.COIN_TO_USD || 0.00005);
  return Math.floor(usd / rate);
}

export function isAdmin(id) {
  const admins = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  return admins.includes(String(id));
}

// ---------- Notify Admin ----------
export async function notifyAdmin(message) {
  const admins = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

  for (const adminId of admins) {
    try {
      await bot.telegram.sendMessage(adminId, message);
    } catch (err) {
      console.error("Failed to notify admin:", adminId, err.message);
    }
  }
}

// ---------- Format Currency ----------
export function formatCurrency(amount) {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
  }).format(amount);
}

// ---------- Validate Bank Info ----------
export function validateBankDetails(accountNumber, accountName, bankName) {
  if (!accountNumber || !accountName || !bankName) return false;
  if (String(accountNumber).length < 10) return false;
  return true;
}

// ---------- Delay Helper ----------
export const delay = (ms) => new Promise((res) => setTimeout(res, ms));

// ---------- Error Reply Wrapper ----------
export async function replyWithError(ctx, message = "⚠️ Something went wrong!") {
  try {
    await ctx.reply(message);
  } catch (e) {
    console.error("Reply error:", e);
  }
    }
