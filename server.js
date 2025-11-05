import express from "express";
import bodyParser from "body-parser";
import dotenv from "dotenv";
import fetch from "node-fetch";
import fs from "fs";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// -------------------- ENVIRONMENT VARIABLES --------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
const MONETAG_ZONE = process.env.MONETAG_ZONE || "10136395";
const ADMIN_TELEGRAM_ID = (process.env.ADMIN_TELEGRAM_ID || "5236441213,5725566044")
  .split(",")
  .map(id => id.trim());

// -------------------- TELEGRAM API BASE --------------------
const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

// -------------------- IN-MEMORY USER STATE --------------------
let userStates = {}; // holds user’s current flow state
let userBalances = {}; // holds wallet balance per user
let userBankAccounts = {}; // holds user bank details
let userAdProgress = {}; // holds number of ads watched
let userTransactions = {}; // holds transaction history

// -------------------- UTIL FUNCTIONS --------------------
async function sendMessage(chatId, text, options = {}) {
  try {
    await fetch(`${TELEGRAM_API}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, ...options }),
    });
  } catch (error) {
    console.error("sendMessage Error:", error);
  }
}

function getProgressBar(current, total) {
  const filled = "█".repeat(current);
  const empty = "░".repeat(total - current);
  return `${filled}${empty} ${current}/${total}`;
}

// -------------------- COMMANDS HELP TEXT --------------------
const COMMANDS = `
💡 *Available Commands:*
/start - Begin using the bot
/watchads - Perform task and watch ads
/wallet - Check your wallet balance
/withdraw - Request withdrawal
/addbank - Add your bank details
/changebank - Request bank account change
/gethelp - Request admin assistance
`;

async function handleInvalidCommand(ctx) {
  await sendMessage(ctx.chat.id, "⚠️ Invalid text. Please use the available commands only.\n\n" + COMMANDS);
}

// -------------------- WEBHOOK HANDLER --------------------
app.post(`/webhook/${BOT_TOKEN}`, async (req, res) => {
  const update = req.body;
  if (!update.message) return res.sendStatus(200);

  const message = update.message;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();

  // Initialize defaults
  if (!userBalances[chatId]) userBalances[chatId] = 0;
  if (!userAdProgress[chatId]) userAdProgress[chatId] = 0;
  if (!userTransactions[chatId]) userTransactions[chatId] = [];

  // -------------------- ADMIN CHECK --------------------
  const isAdmin = ADMIN_TELEGRAM_ID.includes(String(chatId));

  // -------------------- USER COMMANDS --------------------
  if (text.startsWith("/start")) {
    await sendMessage(chatId, `👋 Welcome to Task-Earnings Bot!\n\nEarn rewards by completing simple ad tasks.\n\n${COMMANDS}`, { parse_mode: "Markdown" });
    return res.sendStatus(200);
  }

  if (text.startsWith("/watchads")) {
    const current = userAdProgress[chatId];
    const total = 10;
    const progress = getProgressBar(current, total);
    const sdkHtml = `<script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script>`;
    await sendMessage(chatId, `🎬 Ad Task Progress:\n${progress}\n\nClick the link to watch your ads:\n${sdkHtml}`);
    userStates[chatId] = { action: "watching_ads" };
    return res.sendStatus(200);
  }

  if (text.startsWith("/wallet")) {
    const bal = userBalances[chatId] || 0;
    if (bal === undefined) {
      await sendMessage(chatId, "⚠️ Error fetching wallet details.");
    } else {
      await sendMessage(chatId, `💰 Your wallet balance is ₦${bal.toFixed(2)}`);
    }
    return res.sendStatus(200);
  }

  if (text.startsWith("/withdraw")) {
    const bal = userBalances[chatId] || 0;
    if (bal <= 0) {
      await sendMessage(chatId, "❌ Insufficient balance. Do more tasks today to increase your wallet balance.");
      return res.sendStatus(200);
    }
    if (!userBankAccounts[chatId]) {
      await sendMessage(chatId, "🏦 Please add your bank details first using /addbank");
      return res.sendStatus(200);
    }
    await sendMessage(chatId, "✅ Withdrawal request submitted successfully. Admin will process shortly.");
    userTransactions[chatId].push({ type: "withdrawal", amount: bal, date: new Date().toISOString() });
    userBalances[chatId] = 0;
    return res.sendStatus(200);
  }

  if (text.startsWith("/addbank")) {
    userStates[chatId] = { action: "await_bank_details" };
    await sendMessage(chatId, "🏦 Please send your bank details in this format:\nBankName,AccountNumber,AccountName");
    return res.sendStatus(200);
  }

  if (text.startsWith("/changebank")) {
    userStates[chatId] = { action: "await_change_bank" };
    await sendMessage(chatId, "🔁 To change bank account, send:\noldBank,oldAccNumber,oldName|newBank,newAccNumber,newName");
    return res.sendStatus(200);
  }

  if (text.startsWith("/gethelp")) {
    await sendMessage(chatId, "💬 You can contact admin for help.\nPlease describe your issue. Admin will respond soon.");
    userStates[chatId] = { action: "await_help" };
    return res.sendStatus(200);
  }

  // Continue logic (handle user text flows etc.)...
