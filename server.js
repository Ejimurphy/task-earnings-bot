/**
 * server.js
 * Task-Earnings Bot - Complete version (Part A)
 */

import express from "express";
import dotenv from "dotenv";
import { Telegraf, Markup } from "telegraf";
import pkg from "pg";
import csvStringify from "csv-stringify/lib/sync";
import crypto from "crypto";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(express.json({ limit: "1mb" }));

// Config (from .env)
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const MONETAG_ZONE = process.env.MONETAG_ZONE || "10136395";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "5236441213,5725566044")
  .split(",").map(s => Number(s.trim())).filter(Boolean);
const ADMIN_PANEL_TOKEN = process.env.ADMIN_PANEL_TOKEN || "admin-secret";
const COIN_TO_USD = Number(process.env.COIN_TO_USD || 0.00005);
const PORT = Number(process.env.PORT || 10000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MIN_WITHDRAWAL_COINS = Number(process.env.MIN_WITHDRAWAL_COINS || 60000);
const REWARD_PER_TASK = Number(process.env.REWARD_PER_TASK || 200);
const REFERRAL_REWARD = Number(process.env.REFERRAL_REWARD || 50);

// Validate essential env
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing in environment");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("DATABASE_URL missing in environment");
  process.exit(1);
}

// DB pool
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

// Initialize DB tables
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE,
      username TEXT,
      coins BIGINT DEFAULT 0,
      balance_cash NUMERIC DEFAULT 0,
      referred_by BIGINT,
      referral_credited BOOLEAN DEFAULT FALSE,
      bank_name TEXT,
      bank_account_number TEXT,
      bank_account_name TEXT,
      next_task_available_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_sessions (
      id TEXT PRIMARY KEY,
      telegram_id BIGINT,
      created_at TIMESTAMP DEFAULT NOW(),
      completed BOOLEAN DEFAULT FALSE
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_watches (
      id SERIAL PRIMARY KEY,
      session_id TEXT,
      telegram_id BIGINT,
      ad_index INTEGER,
      validated BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      amount_coins BIGINT,
      amount_usd NUMERIC,
      bank_name TEXT,
      account_name TEXT,
      account_number TEXT,
      status TEXT DEFAULT 'pending',
      requested_at TIMESTAMP DEFAULT NOW(),
      processed_at TIMESTAMP
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // seed basic config values
  await pool.query(`INSERT INTO system_config (key,value) VALUES ('coin_to_usd',$1) ON CONFLICT (key) DO NOTHING`, [String(COIN_TO_USD)]);
  await pool.query(`INSERT INTO system_config (key,value) VALUES ('reward_per_task',$1) ON CONFLICT (key) DO NOTHING`, [String(REWARD_PER_TASK)]);
  await pool.query(`INSERT INTO system_config (key,value) VALUES ('referral_reward',$1) ON CONFLICT (key) DO NOTHING`, [String(REFERRAL_REWARD)]);
  await pool.query(`INSERT INTO system_config (key,value) VALUES ('min_withdrawal_coins',$1) ON CONFLICT (key) DO NOTHING`, [String(MIN_WITHDRAWAL_COINS)]);

  console.log("✅ Database initialized");
}

// Bot instance
const bot = new Telegraf(BOT_TOKEN);

// ephemeral in-memory states for users awaiting input (bank add/change/withdraw/help)
const userState = new Map();

function mainMenuKeyboard() {
  return Markup.keyboard([
    ["💼 Wallet Balance", "🎯 Perform Task"],
    ["👥 Refer & Earn", "💸 Withdraw"],
    ["🏦 Bank Account", "🔁 Change Bank Account"],
    ["🆘 Get Help"]
  ]).resize();
}

function coinsToUSD(coins) {
  return Number(coins) * COIN_TO_USD;
}

async function getConfig(key, fallback) {
  const r = await pool.query("SELECT value FROM system_config WHERE key=$1", [key]);
  if (r.rows[0]) return r.rows[0].value;
  return fallback;
}

function isAdminId(id) {
  return ADMIN_IDS.includes(Number(id));
}

/* ---------- Handlers (Part A ends here; continue with Part B) */

/* ---------- Handlers (Part B begins) ---------- */

bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || "User";
  const payload = ctx.startPayload || null;
  try {
    await pool.query("INSERT INTO users (telegram_id, username, referred_by) VALUES ($1,$2,$3) ON CONFLICT (telegram_id) DO NOTHING", [telegramId, username, payload]);
    await ctx.reply(`👋 Hi ${username}! Welcome to Task-Earnings Bot.\nUse the menu below to get started.`, mainMenuKeyboard());
  } catch (err) {
    console.error("start err", err);
    await ctx.reply("⚠️ Error registering you — try again later.");
  }
});

bot.command("menu", async (ctx) => {
  await ctx.reply("Main menu", mainMenuKeyboard());
});

/* Wallet */
bot.hears("💼 Wallet Balance", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const r = await pool.query("SELECT coins, balance_cash FROM users WHERE telegram_id=$1", [telegramId]);
    if (!r.rows[0]) {
      await pool.query("INSERT INTO users (telegram_id, username) VALUES ($1,$2) ON CONFLICT DO NOTHING", [telegramId, ctx.from.username || ctx.from.first_name]);
      return ctx.reply("💰 Wallet Balance:\n0 coins ($0.00)\nCash balance: ₦0", mainMenuKeyboard());
    }
    const { coins = 0, balance_cash = 0 } = r.rows[0];
    const usd = coinsToUSD(Number(coins)).toFixed(2);
    return ctx.reply(`💼 Wallet Balance:\n• ${coins} coins\n• ≈ $${usd}\n• Cash balance: ₦${balance_cash}`, mainMenuKeyboard());
  } catch (err) {
    console.error("wallet error", err);
    return ctx.reply("⚠️ Error fetching wallet details. Try again later.", mainMenuKeyboard());
  }
});

/* Refer */
bot.hears("👥 Refer & Earn", async (ctx) => {
  const telegramId = ctx.from.id;
  const link = `https://t.me/${ctx.botInfo.username}?start=${telegramId}`;
  await ctx.reply(`👥 Share this referral link:\n${link}\nYou earn ${REFERRAL_REWARD} coins for every referral.`, mainMenuKeyboard());
});

/* Perform Task - create ad session */
bot.hears("🎯 Perform Task", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const sessionId = crypto.randomUUID();
    await pool.query("INSERT INTO ad_sessions (id, telegram_id, completed) VALUES ($1,$2,FALSE)", [sessionId, telegramId]);
    const adSessionUrl = `${BASE_URL}/ad-session/${sessionId}`;
    const progressVisual = "⚪".repeat(10);
    await ctx.replyWithMarkdown(`🎬 Ad Task started\nProgress: ${progressVisual} (0/10)\n\nOpen the ad viewer below. When you finish 10 validated ads, return and press Submit.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Open Ad Viewer", url: adSessionUrl }],
          [{ text: "✅ Submit (Claim Reward)", callback_data: `submit_${sessionId}` }]
        ]
      }
    });
  } catch (err) {
    console.error("perform task err", err);
    await ctx.reply("⚠️ Error starting ad session. Try again later.");
  }
});

/* Submit callback */
bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery?.data || "";
  if (data.startsWith("submit_")) {
    const sessionId = data.split("_")[1];
    try {
      const r = await pool.query("SELECT COUNT(*) AS c FROM ad_watches WHERE session_id=$1 AND validated=true", [sessionId]);
      const count = Number(r.rows[0]?.c || 0);
      if (count < 10) {
        await ctx.answerCbQuery(`You completed ${count}/10 ads. Please finish all 10 before claiming.`, { show_alert: true });
        return;
      }
      const s = await pool.query("SELECT completed, telegram_id FROM ad_sessions WHERE id=$1", [sessionId]);
      if (!s.rows[0]) {
        await ctx.answerCbQuery("Session not found.", { show_alert: true });
        return;
      }
      if (s.rows[0].completed) {
        await ctx.answerCbQuery("Reward already claimed for this session.", { show_alert: true });
        return;
      }
      const telegramId = s.rows[0].telegram_id;
      const reward = Number(await getConfig("reward_per_task", REWARD_PER_TASK));
      await pool.query("BEGIN");
      await pool.query("UPDATE users SET coins = COALESCE(coins,0) + $1 WHERE telegram_id=$2", [reward, telegramId]);
      await pool.query("UPDATE ad_sessions SET completed=TRUE WHERE id=$1", [sessionId]);

      // referral
      const refRow = await pool.query("SELECT referred_by, referral_credited FROM users WHERE telegram_id=$1", [telegramId]);
      if (refRow.rows[0]) {
        const { referred_by, referral_credited } = refRow.rows[0];
        if (referred_by && !referral_credited) {
          const rr = Number(await getConfig("referral_reward", REFERRAL_REWARD));
          await pool.query("UPDATE users SET coins = COALESCE(coins,0) + $1 WHERE telegram_id=$2", [rr, referred_by]);
          await pool.query("UPDATE users SET referral_credited=TRUE WHERE telegram_id=$1", [telegramId]);
          try { await bot.telegram.sendMessage(referred_by, `🎉 You earned ${rr} coins from your referral!`); } catch(e) {}
        }
      }

      await pool.query("COMMIT");
      await ctx.answerCbQuery("Reward credited! 🎉", { show_alert: true });
      await bot.telegram.sendMessage(telegramId, `✅ Congratulations — ${reward} coins have been added to your wallet.`);

      // schedule next task time with variance
      const offset = Math.floor(Math.random() * 600) - 300;
      await pool.query("UPDATE users SET next_task_available_at = NOW() + INTERVAL '20 minutes' + ($1 || ' seconds')::interval WHERE telegram_id=$2", [offset, telegramId]);
    } catch (err) {
      try { await pool.query("ROLLBACK"); } catch(e){}
      console.error("submit err", err);
      await ctx.answerCbQuery("⚠️ Error claiming reward. Try again later.", { show_alert: true });
    }
    return;
  }
  await ctx.answerCbQuery();
});

/* Monetag postback endpoint */
app.post("/api/monetag/postback", async (req, res) => {
  const payload = req.body || {};
  const custom = payload.custom || "";
  let sessionId = null;
  if (typeof custom === "string" && custom.includes("sessionId=")) {
    const m = custom.match(/sessionId=([a-zA-Z0-9-]+)/);
    if (m) sessionId = m[1];
  }
  if (!sessionId && payload.sessionId) sessionId = payload.sessionId;
  if (!sessionId) {
    console.warn("postback: no sessionId", payload);
    return res.status(200).send("no-session");
  }
  try {
    const telegramId = payload.user_id || null;
    const adIndex = payload.ad_index ? Number(payload.ad_index) : null;
    await pool.query("INSERT INTO ad_watches (session_id, telegram_id, ad_index, validated) VALUES ($1,$2,$3,$4)", [sessionId, telegramId, adIndex, true]);
    const r = await pool.query("SELECT COUNT(*) as c FROM ad_watches WHERE session_id=$1 AND validated=true", [sessionId]);
    const count = Number(r.rows[0].c || 0);
    console.log(`postback session ${sessionId} count=${count}`);
    return res.status(200).send("ok");
  } catch (err) {
    console.error("monetag postback error", err);
    return res.status(500).send("error");
  }
});

/* Ad session page (served to user) */
app.get("/ad-session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  res.send(`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="font-family: system-ui; padding:20px;">
  <h3>Watch Ads — Session</h3>
  <p id="status">Loading...</p>
  <div id="progress" style="font-size:22px; margin:12px 0;"></div>
  <button id="openAd">Open Ad</button>
  <script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script>
  <script>
    const sessionId = "${sessionId}";
    async function refresh(){
      try{
        const r = await fetch('/api/session/' + sessionId + '/status');
        const j = await r.json();
        const count = j.count || 0;
        const watched = '🔵'.repeat(count) + '⚪'.repeat(Math.max(0,10-count));
        document.getElementById('progress').innerText = watched + ' ('+count+'/10)';
        document.getElementById('status').innerText = count >= 10 ? 'Completed — return to Telegram and press Submit' : 'Watch ads and come back to submit when done';
      } catch(e) {
        document.getElementById('status').innerText = 'Error fetching progress';
      }
    }
    document.getElementById('openAd').addEventListener('click', function(){
      try {
        show_${MONETAG_ZONE}({
          type: 'inApp',
          inAppSettings: { frequency:2, capping:0.1, interval:30, timeout:5, everyPage:false },
          custom: 'sessionId=' + sessionId
        });
      } catch(e){ alert('Ad SDK error: '+e); }
    });
    setInterval(refresh, 3000);
    refresh();
  </script>
</body>
</html>`);
});

app.get("/api/session/:sessionId/status", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const r = await pool.query("SELECT COUNT(*) as c FROM ad_watches WHERE session_id=$1 AND validated=true", [sessionId]);
    const count = Number(r.rows[0]?.c || 0);
    res.json({ count });
  } catch (err) {
    console.error("session status err", err);
    res.json({ count: 0 });
  }
});

/* Withdraw & Bank flows */
bot.hears("💸 Withdraw", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const r = await pool.query("SELECT coins, bank_name, bank_account_number, bank_account_name FROM users WHERE telegram_id=$1", [telegramId]);
    const user = r.rows[0];
    const coins = Number(user?.coins || 0);
    if (coins < MIN_WITHDRAWAL_COINS) {
      return ctx.reply(`⚠️ Insufficient balance. Do more tasks today to increase your wallet balance. Minimum for withdrawal is ${MIN_WITHDRAWAL_COINS} coins.`, mainMenuKeyboard());
    }
    if (!user?.bank_account_number) {
      userState.set(telegramId, { action: "await_bank_first", meta: {} });
      return ctx.reply("Please send your bank details in this format:\nBankName,AccountName,AccountNumber", mainMenuKeyboard());
    } else {
      userState.set(telegramId, { action: "await_withdraw_amount", meta: {} });
      return ctx.reply("You have a linked bank account. Send amount in coins you want to withdraw (e.g. 60000)", mainMenuKeyboard());
    }
  } catch (err) {
    console.error("withdraw start error", err);
    return ctx.reply("⚠️ Error starting withdrawal. Try again later.");
  }
});

bot.hears("🏦 Bank Account", async (ctx) => {
  userState.set(ctx.from.id, { action: "await_bank_first" });
  return ctx.reply("Please send your bank details in this format:\nBankName,AccountName,AccountNumber", mainMenuKeyboard());
});

bot.hears("🔁 Change Bank Account", async (ctx) => {
  userState.set(ctx.from.id, { action: "await_change_bank" });
  return ctx.reply("To change your account, please send your old bank details and your new bank details in this format:\noldBank,oldAcc,oldName|newBank,newAcc,newName");
});

/* Reuse postback route defined earlier if duplicate; handled above */

/* Text handler for awaiting states and general invalid command guard */
bot.on("text", async (ctx) => {
  const telegramId = ctx.from.id;
  const text = (ctx.message.text || "").trim();
  const state = userState.get(telegramId);

  // awaiting bank first-time input
  if (state && state.action === "await_bank_first") {
    if (!text.includes(",") || text.split(",").length < 3) {
      return ctx.reply("Invalid format. Please send: BankName,AccountName,AccountNumber");
    }
    const [bank, accName, accNumber] = text.split(",").map(s => s.trim());
    try {
      await pool.query("UPDATE users SET bank_name=$1, bank_account_name=$2, bank_account_number=$3 WHERE telegram_id=$4", [bank, accName, accNumber, telegramId]);
      userState.delete(telegramId);
      await ctx.reply("✅ Bank account updated successfully. You can now request withdrawals.", mainMenuKeyboard());
    } catch (err) {
      console.error("save bank error", err);
      return ctx.reply("⚠️ Error saving bank details.");
    }
    return;
  }

  // awaiting withdraw amount
  if (state && state.action === "await_withdraw_amount") {
    const coins = Number(text.replace(/\D/g,""));
    if (!coins || coins <= 0) return ctx.reply("Please send a valid amount in coins (numbers only).");
    try {
      const r = await pool.query("SELECT coins, bank_name, bank_account_number, bank_account_name FROM users WHERE telegram_id=$1", [telegramId]);
      const user = r.rows[0];
      if (!user) return ctx.reply("User not found.");
      if (Number(user.coins) < coins) return ctx.reply("⚠️ Insufficient coins for that amount.");
      const usd = coinsToUSD(coins);
      await pool.query("INSERT INTO withdrawals (telegram_id, amount_coins, amount_usd, bank_name, account_name, account_number, status) VALUES ($1,$2,$3,$4,$5,$6,$7)", [telegramId, coins, usd, user.bank_name, user.bank_account_name, user.bank_account_number, "pending"]);
      await pool.query("UPDATE users SET coins = coins - $1 WHERE telegram_id=$2", [coins, telegramId]);
      userState.delete(telegramId);
      await ctx.reply(`✅ Withdrawal requested for ${coins} coins (~$${usd.toFixed(2)}). Admin will review.`);
      for (const aid of ADMIN_IDS) {
        try { await bot.telegram.sendMessage(aid, `💸 Withdrawal request:\nUser: ${telegramId}\nAmount: ${coins} coins (~$${usd.toFixed(2)})\nAccount: ${user.bank_account_name} - ${user.bank_name} (${user.bank_account_number})`); } catch(e) {}
      }
    } catch (err) {
      console.error("withdraw request error", err);
      return ctx.reply("⚠️ Error creating withdrawal request.");
    }
    return;
  }

  // change bank account flow
  if (state && state.action === "await_change_bank") {
    if (!text.includes("|")) {
      return ctx.reply("Invalid format. Please send: oldBank,oldAccNumber,oldName|newBank,newAccNumber,newName");
    }
    const [oldStr, newStr] = text.split("|").map(s => s.trim());
    const oldParts = oldStr.split(",").map(s=>s.trim());
    const newParts = newStr.split(",").map(s=>s.trim());
    if (oldParts.length < 2 || newParts.length < 2) return ctx.reply("Invalid format. Use: oldBank,oldAcc|newBank,newAcc");
    const [oldBank, oldAcc] = oldParts;
    const [newBank, newAcc, newName] = newParts;
    try {
      const r = await pool.query("SELECT bank_name, bank_account_number FROM users WHERE telegram_id=$1", [telegramId]);
      const user = r.rows[0];
      if (!user) return ctx.reply("User not found.");
      if (user.bank_name !== oldBank || user.bank_account_number !== oldAcc) {
        return ctx.reply("⚠️ Old bank details don't match our records. New account not updated.");
      }
      await pool.query("UPDATE users SET bank_name=$1, bank_account_number=$2, bank_account_name=$3 WHERE telegram_id=$4", [newBank, newAcc, newName || user.bank_account_name, telegramId]);
      userState.delete(telegramId);
      return ctx.reply("✅ Bank account changed successfully.", mainMenuKeyboard());
    } catch (err) {
      console.error("change bank error", err);
      return ctx.reply("⚠️ Error changing bank details.");
    }
  }

  // get help flow
  if (state && state.action === "await_help") {
    for (const aid of ADMIN_IDS) {
      try { await bot.telegram.sendMessage(aid, `🆘 Support request from ${telegramId}:\n\n${text}`); } catch(e) {}
    }
    userState.delete(telegramId);
    return ctx.reply("✅ Your message has been sent to support. We will reply shortly.", mainMenuKeyboard());
  }

  // invalid commands guard when not in awaited state
  const allowedButtons = ["💼 Wallet Balance","🎯 Perform Task","👥 Refer & Earn","💸 Withdraw","🏦 Bank Account","🔁 Change Bank Account","🆘 Get Help"];
  if (!state && !allowedButtons.includes(text) && !text.startsWith("/")) {
    return ctx.reply("❌ Invalid command. Please use the menu buttons to navigate.", mainMenuKeyboard());
  }
});

/* ---------- Admin Commands ---------- */

bot.command("pending_withdrawals", async (ctx) => {
  if (!isAdminId(ctx.from.id)) return ctx.reply("Access denied");
  const rows = (await pool.query("SELECT id, telegram_id, amount_coins, amount_usd, bank_name, account_name, account_number, status FROM withdrawals WHERE status='pending' ORDER BY requested_at DESC LIMIT 100")).rows;
  if (!rows.length) return ctx.reply("No pending withdrawals.");
  let text = "Pending Withdrawals:\n\n" + rows.map(r => `ID:${r.id} User:${r.telegram_id} ${r.amount_coins} coins (~$${Number(r.amount_usd).toFixed(2)}) ${r.bank_name} ${r.account_number}`).join("\n\n");
  return ctx.reply(text);
});

bot.command("approve", async (ctx) => {
  if (!isAdminId(ctx.from.id)) return ctx.reply("Access denied");
  const parts = ctx.message.text.split(" ");
  const id = parts[1];
  if (!id) return ctx.reply("Usage: /approve <withdrawal_id>");
  try {
    const r = await pool.query("UPDATE withdrawals SET status='approved', processed_at=NOW() WHERE id=$1 RETURNING telegram_id, amount_coins, amount_usd", [id]);
    if (!r.rows[0]) return ctx.reply("Withdrawal not found.");
    const t = r.rows[0].telegram_id;
    await bot.telegram.sendMessage(t, `✅ Your withdrawal #${id} has been approved by admin.`);
    return ctx.reply(`Withdrawal ${id} approved.`);
  } catch (err) {
    console.error("approve error", err);
    return ctx.reply("Error approving withdrawal.");
  }
});

bot.command("decline", async (ctx) => {
  if (!isAdminId(ctx.from.id)) return ctx.reply("Access denied");
  const parts = ctx.message.text.split(" ");
  const id = parts[1];
  const reason = parts.slice(2).join(" ") || "No reason provided";
  if (!id) return ctx.reply("Usage: /decline <withdrawal_id> [reason]");
  try {
    const r = await pool.query("UPDATE withdrawals SET status='declined', processed_at=NOW() WHERE id=$1 RETURNING telegram_id", [id]);
    if (!r.rows[0]) return ctx.reply("Withdrawal not found.");
    const t = r.rows[0].telegram_id;
    await bot.telegram.sendMessage(t, `❌ Your withdrawal #${id} has been declined.\nReason: ${reason}`);
    return ctx.reply(`Withdrawal ${id} declined.`);
  } catch (err) {
    console.error("decline error", err);
    return ctx.reply("Error declining withdrawal.");
  }
});

bot.command("export_withdrawals", async (ctx) => {
  if (!isAdminId(ctx.from.id)) return ctx.reply("Access denied");
  try {
    const rows = (await pool.query("SELECT * FROM withdrawals ORDER BY requested_at DESC")).rows;
    const csv = csvStringify(rows, { header: true });
    await ctx.replyWithDocument({ source: Buffer.from(csv, "utf8"), filename: "withdrawals.csv" });
  } catch (err) {
    console.error("export error", err);
    return ctx.reply("Error exporting withdrawals.");
  }
});

bot.command("change_account", async (ctx) => {
  if (!isAdminId(ctx.from.id)) return ctx.reply("Access denied");
  const args = ctx.message.text.split(" ").slice(1).join(" ");
  if (!args) return ctx.reply("Usage: /change_account <telegramId> bank,accName,accNumber");
  const [tid, rest] = args.split(" ", 2);
  if (!rest) return ctx.reply("Provide bank,accName,accNumber after telegramId");
  if (!rest.includes(",")) return ctx.reply("Invalid format. Use bank,accName,accNumber");
  const [bank, accName, accNumber] = rest.split(",").map(s => s.trim());
  try {
    await pool.query("UPDATE users SET bank_name=$1, bank_account_name=$2, bank_account_number=$3 WHERE telegram_id=$4", [bank, accName, accNumber, Number(tid)]);
    return ctx.reply("Account updated.");
  } catch (err) {
    console.error("admin change account error", err);
    return ctx.reply("Error updating account.");
  }
});

bot.command("transactions", async (ctx) => {
  if (!isAdminId(ctx.from.id)) return ctx.reply("Access denied");
  const parts = ctx.message.text.split(" ");
  const target = parts[1];
  if (!target) return ctx.reply("Usage: /transactions <telegramId>");
  try {
    const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const adRows = (await pool.query("SELECT * FROM ad_watches WHERE telegram_id=$1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 200", [target, since])).rows;
    const wRows = await pool.query(
  `SELECT * FROM withdrawals 
   WHERE telegram_id=$1 
   AND requested_at >= $2 
   ORDER BY requested_at DESC`,
  [ctx.from.id, since]
);
// Handle withdraw history
bot.command("withdraw_history", async (ctx) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 30); // last 30 days

    const wRows = await pool.query(
      `SELECT * FROM withdrawals 
       WHERE telegram_id=$1 
       AND requested_at >= $2 
       ORDER BY requested_at DESC`,
      [ctx.from.id, since]
    );

    if (wRows.rows.length === 0) {
      return ctx.reply("You have no withdrawal history in the last 30 days.");
    }

    let historyText = "📜 *Withdrawal History (Last 30 Days)*\n\n";
    wRows.rows.forEach((w) => {
      historyText += `💸 Amount: ₦${w.amount}\n🏦 Bank: ${w.bank_name}\n📅 Date: ${new Date(
        w.requested_at
      ).toLocaleString()}\n📍 Status: ${w.status || "Pending"}\n\n`;
    });

    await ctx.replyWithMarkdown(historyText);
  } catch (err) {
    console.error("Error in /withdraw_history:", err);
    ctx.reply("⚠️ Error retrieving withdrawal history. Please try again later.");
  }
});

// Handle invalid text inputs
bot.on("text", (ctx) => {
  ctx.reply(
    "🤖 Sorry, I didn’t recognize that command.\nUse /menu or /help to see available options."
  );
});

// Start bot
bot.launch();
console.log("✅ Task Earnings Bot is running...");

// Graceful stop on termination signals
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));
    
