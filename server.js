import express from "express";
import dotenv from "dotenv";
import { Telegraf } from "telegraf";
import pool from "./src/db.js";
import { initializeDatabase } from "./src/db.js";
import { setupBot } from "./src/bot.js";

dotenv.config();

const app = express();
app.use(express.json());

// ---------- Environment ----------
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const PORT = process.env.PORT || 10000;
const BASE_URL = process.env.BASE_URL || `https://${process.env.RENDER_EXTERNAL_URL || process.env.HOSTNAME || "your-app-url.example"}`;

if (!BOT_TOKEN) {
  console.error("❌ Missing TELEGRAM_BOT_TOKEN in .env");
  process.exit(1);
}

// ---------- Initialize Bot ----------
const bot = new Telegraf(BOT_TOKEN);

// ---------- Initialize Database ----------
await initializeDatabase();

// ---------- Setup Bot Commands & API ----------
setupBot(bot, app, pool, BASE_URL);

// ---------- Express server ----------
app.get("/", (req, res) => {
  res.send("✅ FonPay Task Earnings Bot is running...");
});

bot.launch();
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// Graceful stop
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
