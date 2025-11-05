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
  // -------------------- CONTINUED WEBHOOK LOGIC & FLOWS --------------------

  // If user is in a state, handle those flows first:
  const state = userStates[chatId];

  // Awaiting bank details (format: BankName,AccountNumber,AccountName)
  if (state && state.action === "await_bank_details") {
    if (!text.includes(",") || text.split(",").length < 3) {
      await sendMessage(chatId, "⚠️ Invalid format. Send as: BankName,AccountNumber,AccountName");
      return res.sendStatus(200);
    }
    const [bankName, accountNumber, accountName] = text.split(",").map(s => s.trim());
    userBankAccounts[chatId] = { bankName, accountNumber, accountName };
    userStates[chatId] = null;
    await sendMessage(chatId, "✅ Bank account updated successfully. You can now request withdrawals.");
    return res.sendStatus(200);
  }

  // Awaiting change bank flow (format: oldBank,oldAcc,oldName|newBank,newAcc,newName)
  if (state && state.action === "await_change_bank") {
    if (!text.includes("|")) {
      await sendMessage(chatId, "⚠️ Invalid format. Send: oldBank,oldAcc,oldName|newBank,newAcc,newName");
      return res.sendStatus(200);
    }
    const [oldStr, newStr] = text.split("|").map(s => s.trim());
    const oldParts = oldStr.split(",").map(s => s.trim());
    const newParts = newStr.split(",").map(s => s.trim());
    if (oldParts.length < 2 || newParts.length < 2) {
      await sendMessage(chatId, "⚠️ Invalid format. Use oldBank,oldAcc|newBank,newAcc (names optional)");
      return res.sendStatus(200);
    }
    const [oldBank, oldAcc, oldName] = oldParts;
    const [newBank, newAcc, newName] = newParts;
    const existing = userBankAccounts[chatId];
    if (!existing) {
      userStates[chatId] = null;
      await sendMessage(chatId, "⚠️ You have no bank on record. Use /addbank to add one first.");
      return res.sendStatus(200);
    }
    // verify old details match (account number mandatory)
    if ((existing.bankName || "").toLowerCase() !== (oldBank || "").toLowerCase() || (existing.accountNumber || "") !== (oldAcc || "")) {
      userStates[chatId] = null;
      await sendMessage(chatId, "🚫 Old bank details don't match our records. New account not updated.");
      return res.sendStatus(200);
    }
    // update to new
    userBankAccounts[chatId] = { bankName: newBank, accountNumber: newAcc, accountName: newName || existing.accountName };
    userStates[chatId] = null;
    await sendMessage(chatId, "✅ Bank account changed successfully.");
    return res.sendStatus(200);
  }

  // Awaiting help text (forward to admins)
  if (state && state.action === "await_help") {
    // forward the message text to all admins
    for (const aid of ADMIN_TELEGRAM_ID) {
      try {
        await sendMessage(aid, `🆘 Support request from ${chatId}:\n\n${text}`);
      } catch (e) { /* ignore */ }
    }
    userStates[chatId] = null;
    await sendMessage(chatId, "✅ Your message has been sent to support. An admin will reply shortly.");
    return res.sendStatus(200);
  }

  // Handling ad-watching actions when user indicates they've watched one ad (allowing a text trigger /adwatched)
  if (text === "/adwatched" || (state && state.action === "watching_ads" && text === "AD_WATCHED")) {
    // If a session mapping exists for this user, increment session count; otherwise increment ad progress
    if (userAdProgressSessions && userAdProgressSessions[chatId] && userAdProgressSessions[chatId].sessionId) {
      const sessionId = userAdProgressSessions[chatId].sessionId;
      sessionCounts[sessionId] = (sessionCounts[sessionId] || 0) + 1;
      const cnt = sessionCounts[sessionId];
      const progressBar = getProgressBar(cnt, 10);
      await sendMessage(chatId, `✅ Ad recorded for session ${sessionId}\n${progressBar}`);
      if (cnt >= 10) {
        await sendMessage(chatId, "🎉 You have completed 10 ads for this session. Return to Telegram and press Submit (or use /submit_session <sessionId>).");
      }
      return res.sendStatus(200);
    } else {
      // no session; increment per-user counter
      userAdProgress[chatId] = (userAdProgress[chatId] || 0) + 1;
      const cnt = userAdProgress[chatId];
      const progressBar = getProgressBar(cnt, 10);
      if (cnt >= 10) {
        // credit reward automatically for per-user flow
        userBalances[chatId] = Number(userBalances[chatId] || 0) + 0; // balance (cash) unchanged in coin flow; we store coins separately
        userTransactions[chatId].push({ type: "ad_complete", coins: REWARD_PER_TASK, date: new Date().toISOString() });
        // credit coins mapping (not wallet cash)
        userAdProgress[chatId] = 10; // cap
        // store coins in a simple field
        userCoins = userCoins || {};
        userCoins[chatId] = (userCoins[chatId] || 0) + REWARD_PER_TASK;
        await sendMessage(chatId, `🎉 You completed 10 ads — ${REWARD_PER_TASK} coins have been credited to your account.\n${progressBar}`);
      } else {
        await sendMessage(chatId, `✅ Ad recorded. ${progressBar}`);
      }
      return res.sendStatus(200);
    }
  }

  // Submit session explicitly (for session-based flow)
  if (text.startsWith("/submit_session")) {
    const parts = text.split(" ");
    const sessionId = parts[1];
    if (!sessionId) {
      await sendMessage(chatId, "Usage: /submit_session <sessionId>");
      return res.sendStatus(200);
    }
    const cnt = sessionCounts[sessionId] || 0;
    if (cnt < 10) {
      await sendMessage(chatId, `You have completed ${cnt}/10 ads for session ${sessionId}. Please finish all 10.`);
      return res.sendStatus(200);
    }
    // credit reward
    userCoins = userCoins || {};
    userCoins[chatId] = (userCoins[chatId] || 0) + REWARD_PER_TASK;
    userTransactions[chatId].push({ type: "ad_complete", coins: REWARD_PER_TASK, session: sessionId, date: new Date().toISOString() });
    await sendMessage(chatId, `✅ Reward credited — ${REWARD_PER_TASK} coins added to your account.`);
    return res.sendStatus(200);
  }

  // ADMIN COMMANDS via regular messages (simple commands)
  if (isAdmin) {
    // view pending withdrawals
    if (text === "/view_withdrawals" || text === "/pending_withdrawals") {
      const list = withdrawals.map(w => `ID:${w.id} User:${w.userId} Coins:${w.amount_coins} USD:${w.amount_usd} Status:${w.status}`).join("\n\n") || "No pending withdrawals.";
      await sendMessage(chatId, list);
      return res.sendStatus(200);
    }

    // approve: /approve <id>
    if (text.startsWith("/approve")) {
      const id = (text.split(" ")[1] || "").trim();
      const w = withdrawals.find(x => String(x.id) === id);
      if (!w) { await sendMessage(chatId, "Withdrawal not found."); return res.sendStatus(200); }
      w.status = "approved";
      w.processed_at = new Date().toISOString();
      // notify user
      await sendMessage(w.userId, `✅ Your withdrawal #${id} has been approved by admin.`);
      await sendMessage(chatId, `Withdrawal ${id} approved.`);
      return res.sendStatus(200);
    }

    // decline: /decline <id> reason...
    if (text.startsWith("/decline")) {
      const parts = text.split(" ");
      const id = parts[1];
      const reason = parts.slice(2).join(" ") || "No reason provided";
      const w = withdrawals.find(x => String(x.id) === id);
      if (!w) { await sendMessage(chatId, "Withdrawal not found."); return res.sendStatus(200); }
      w.status = "declined";
      w.processed_at = new Date().toISOString();
      await sendMessage(w.userId, `❌ Your withdrawal #${id} was declined. Reason: ${reason}`);
      await sendMessage(chatId, `Withdrawal ${id} declined.`);
      return res.sendStatus(200);
    }

    // transactions: /transactions <userId>
    if (text.startsWith("/transactions")) {
      const target = text.split(" ")[1];
      if (!target) { await sendMessage(chatId, "Usage: /transactions <telegramId>"); return res.sendStatus(200); }
      const txs = (userTransactions[target] || []).slice(-100);
      const summary = txs.map(t => `${t.date} - ${t.type} - ${t.coins || t.amount || 0}`).join("\n") || "No transactions.";
      await sendMessage(chatId, `Transactions for ${target} (last entries):\n${summary}`);
      return res.sendStatus(200);
    }
  }

  // If message not handled above, and not in a state, check allowed texts; otherwise mark invalid
  const allowedTexts = ["/start","/watchads","/wallet","/withdraw","/addbank","/changebank","/gethelp","/adwatched","/submit_session","/transactions","/approve","/decline","/view_withdrawals"];
  if (!state && !allowedTexts.includes(text.split(" ")[0])) {
    await sendMessage(chatId, "❌ Invalid command. Please use the available commands only.\n\n" + COMMANDS);
    return res.sendStatus(200);
  }

  // default ack
  return res.sendStatus(200);
});

// -------------------- SESSION & MONETAG SUPPORT (server-side) --------------------

// maps and counters for session-based ad flow
const sessionCounts = {}; // sessionId => count
const userAdProgressSessions = {}; // telegramId => { sessionId }

// in-memory withdrawals list (simple incremental id)
let withdrawals = [];
let withdrawalIdCounter = 1;

// endpoint that Monetag will POST to on ad validation; expects custom=sessionId=...
app.post("/api/monetag/postback", express.json(), async (req, res) => {
  const payload = req.body || {};
  let sessionId = null;
  try {
    const custom = payload.custom || "";
    if (typeof custom === "string" && custom.includes("sessionId=")) {
      const m = custom.match(/sessionId=([a-zA-Z0-9-]+)/);
      if (m) sessionId = m[1];
    }
    if (!sessionId && payload.sessionId) sessionId = payload.sessionId;
    if (!sessionId) {
      console.warn("postback without sessionId", payload);
      return res.status(200).send("no-session");
    }
    // increment session count
    sessionCounts[sessionId] = (sessionCounts[sessionId] || 0) + 1;
    console.log(`postback session ${sessionId} count=${sessionCounts[sessionId]}`);
    return res.status(200).send("ok");
  } catch (e) {
    console.error("monetag postback error", e);
    return res.status(500).send("error");
  }
});

// Create a fresh ad session and return session page (this is used when user clicks watch next ad)
app.get("/ad-session-create/:telegramId", async (req, res) => {
  const { telegramId } = req.params;
  const sessionId = crypto.randomUUID();
  // map session to user for later reference
  userAdProgressSessions[telegramId] = { sessionId };
  sessionCounts[sessionId] = 0;
  // return ad-session URL that user should open (we also serve /ad-session/:id below)
  res.json({ sessionUrl: `${BASE_URL}/ad-session/${sessionId}`, sessionId });
});

// ad-session page serves SDK and polls our session status
app.get("/ad-session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ad Session</title></head><body style="font-family: system-ui; padding:20px;"><h3>Watch Ads — Session</h3><p id="status">Loading...</p><div id="progress" style="font-size:22px; margin:12px 0;"></div><button id="openAd">Open Ad</button><script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script><script>const sessionId='${sessionId}';async function refresh(){try{const r=await fetch('/api/session/'+sessionId+'/status');const j=await r.json();const count=j.count||0;document.getElementById('progress').innerText='🔵'.repeat(count)+'⚪'.repeat(Math.max(0,10-count))+' ('+count+'/10)';document.getElementById('status').innerText=count>=10?'Completed — return to Telegram and press Submit':'Watch ads and come back to submit when done';}catch(e){document.getElementById('status').innerText='Error fetching progress';}}document.getElementById('openAd').addEventListener('click', function(){try{show_${MONETAG_ZONE}({type:'inApp',inAppSettings:{frequency:2,capping:0.1,interval:30,timeout:5,everyPage:false},custom:'sessionId='+sessionId});}catch(e){alert('Ad SDK error:'+e);}});setInterval(refresh,3000);refresh();</script></body></html>`);
});

// session status endpoint for polling
app.get("/api/session/:sessionId/status", (req, res) => {
  const { sessionId } = req.params;
  const cnt = sessionCounts[sessionId] || 0;
  res.json({ count: cnt });
});

// function to create a withdrawal entry (in-memory)
function createWithdrawalForUser(userId, coins, usd, bankName, accountName, accountNumber) {
  const w = {
    id: withdrawalIdCounter++,
    userId,
    amount_coins: coins,
    amount_usd: usd,
    bank_name: bankName,
    account_name: accountName,
    account_number: accountNumber,
    status: "pending",
    requested_at: new Date().toISOString()
  };
  withdrawals.push(w);
  return w;
        }
      
  // HANDLE change bank account flow: expecting "oldBank,oldAccNum,oldName|newBank,newAccNum,newName"
  if (state.action === "await_change_bank") {
    if (!text.includes("|")) {
      return ctx.reply("❌ Invalid format. Please send:\noldBank,oldAccNumber,oldName | newBank,newAccNumber,newName");
    }

    const [oldStr, newStr] = text.split("|").map(s => s.trim());
    const [oldBank, oldAcc, oldName] = oldStr.split(",").map(s => s.trim());
    const [newBank, newAcc, newName] = newStr.split(",").map(s => s.trim());

    const user = getUser(ctx.from.id);
    if (user.bankDetails && (user.bankDetails.bank !== oldBank || user.bankDetails.accNum !== oldAcc)) {
      return ctx.reply("⚠️ The old bank details do not match our records. Bank change denied.");
    }

    user.bankDetails = { bank: newBank, accNum: newAcc, accName: newName };
    ctx.reply("✅ Bank account updated successfully!");
    delete userState[ctx.from.id];
    return;
  }

  // Handle "Get Help"
  if (text.toLowerCase() === "get help") {
    return ctx.reply(
      "🆘 *FonPay Task-Earnings Support*\n\nNeed assistance?\n• Describe your issue clearly\n• Include your Telegram ID\n\nAn admin will reach out to you shortly.",
      { parse_mode: "Markdown" }
    );
  }

  // INVALID COMMAND HANDLER
  const validCommands = [
    "perform task",
    "withdraw funds",
    "add bank account",
    "change bank account",
    "get help",
    "check balance",
    "start"
  ];

  if (!validCommands.includes(text.toLowerCase()) && !state.action) {
    return ctx.reply("❌ Invalid text. Please use the available commands from the menu or send /start.");
  }
});

// ======================== ADMIN FEATURES ========================

bot.command("admin", ctx => {
  const id = ctx.from.id.toString();
  if (!process.env.ADMIN_TELEGRAM_ID.split(",").includes(id)) {
    return ctx.reply("❌ You are not authorized to use this command.");
  }

  ctx.reply(
    "👑 *Admin Commands:*\n\n" +
    "/recent_users — View users registered in last 7 days\n" +
    "/recent_transactions — View transactions in last 7 days\n" +
    "/change_bank — Update a user’s bank account manually\n",
    { parse_mode: "Markdown" }
  );
});

bot.command("recent_users", ctx => {
  const id = ctx.from.id.toString();
  if (!process.env.ADMIN_TELEGRAM_ID.split(",").includes(id)) return;

  const recent = Object.values(users)
    .filter(u => Date.now() - u.joinedAt < 7 * 24 * 60 * 60 * 1000)
    .map(u => `${u.username} - Balance: ₦${u.balance}`)
    .join("\n");

  ctx.reply(recent || "No recent users found.");
});

bot.command("recent_transactions", ctx => {
  const id = ctx.from.id.toString();
  if (!process.env.ADMIN_TELEGRAM_ID.split(",").includes(id)) return;

  const transactions = [];
  Object.values(users).forEach(u => {
    if (u.transactions) {
      u.transactions
        .filter(t => Date.now() - t.date < 7 * 24 * 60 * 60 * 1000)
        .forEach(t => transactions.push(`${u.username}: ${t.type} ₦${t.amount}`));
    }
  });

  ctx.reply(transactions.length ? transactions.join("\n") : "No transactions in the last 7 days.");
});

bot.command("change_bank", ctx => {
  const id = ctx.from.id.toString();
  if (!process.env.ADMIN_TELEGRAM_ID.split(",").includes(id)) return;

  ctx.reply("Send user ID and new bank details in this format:\nuserId|Bank,AccountNumber,AccountName");
  userState[ctx.from.id] = { action: "admin_change_bank" };
});

bot.on("text", ctx => {
  const id = ctx.from.id.toString();
  const state = userState[id];
  if (!state) return;

  if (state.action === "admin_change_bank") {
    if (!text.includes("|")) return ctx.reply("Invalid format. Use: userId|Bank,AccNum,AccName");
    const [userId, details] = text.split("|").map(s => s.trim());
    const [bank, accNum, accName] = details.split(",").map(s => s.trim());
    const target = users[userId];
    if (!target) return ctx.reply("User not found.");

    target.bankDetails = { bank, accNum, accName };
    ctx.reply(`✅ Updated ${target.username}'s bank details successfully.`);
    delete userState[id];
  }
});

// ======================== SERVER & BOT START ========================

app.get("/", (req, res) => {
  res.send(`
    <html>
      <head><title>Task Earnings Bot</title></head>
      <body style="font-family: Arial; text-align: center;">
        <h2>FonPay Task Earnings Bot is running ✅</h2>
        <p>Monetag Zone: ${process.env.MONETAG_ZONE}</p>
        <script src='//libtl.com/sdk.js' data-zone='${process.env.MONETAG_ZONE}' data-sdk='show_${process.env.MONETAG_ZONE}'></script>
      </body>
    </html>
  `);
});

bot.launch();
app.listen(PORT, () => console.log(`✅ Server running on port ${PORT}`));

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
    
