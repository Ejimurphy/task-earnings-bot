/**
 * server.js
 * Task-Earnings Bot - Combined Telegram + Admin Web Panel
 *
 * Requirements:
 * - .env with BOT_TOKEN, DATABASE_URL, MONETAG_ZONE, ADMIN_TELEGRAM_ID, ADMIN_PANEL_TOKEN etc.
 * - Monetag server postback configured to POST to /api/monetag/postback
 *
 * Notes:
 * - This script does safe table creation (IF NOT EXISTS / ALTER TABLE IF NOT EXISTS)
 * - Minimal in-memory userState map used to expect next text input (bank/change/withdraw/help)
 *   -> state is temporary and will be lost on restart, but DB persists important data.
 */

import express from "express";
import dotenv from "dotenv";
import { Telegraf, Markup } from "telegraf";
import pkg from "pg";
import csvStringify from "csv-stringify/lib/sync"; // npm install csv-stringify
import crypto from "crypto";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(express.json());

/* ========== CONFIG ========== */
const BOT_TOKEN = process.env.BOT_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const MONETAG_ZONE = process.env.MONETAG_ZONE || "10136395";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);
const ADMIN_PANEL_TOKEN = process.env.ADMIN_PANEL_TOKEN || "admin-secret";
const COIN_TO_USD = Number(process.env.COIN_TO_USD || 0.00005);
const PORT = Number(process.env.PORT || 10000);
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
const MIN_WITHDRAWAL_COINS = Number(process.env.MIN_WITHDRAWAL_COINS || 60000);
const REWARD_PER_TASK = Number(process.env.REWARD_PER_TASK || 200);
const REFERRAL_REWARD = Number(process.env.REFERRAL_REWARD || 50);

/* ========== DB ========== */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

/* Safe DB initialization: create tables and add missing columns */
async function initDB() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE,
        username TEXT,
        coins BIGINT DEFAULT 0,
        balance_cash NUMERIC DEFAULT 0,
        referred_by BIGINT,
        bank_name TEXT,
        bank_account_number TEXT,
        bank_account_name TEXT,
        referral_credited BOOLEAN DEFAULT FALSE,
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

    // seed system_config defaults
    await pool.query(
      `INSERT INTO system_config (key, value) VALUES
        ('coin_to_usd', $1),
        ('reward_per_task', $2),
        ('referral_reward', $3),
        ('min_withdrawal_coins', $4)
       ON CONFLICT (key) DO NOTHING;`,
      [String(COIN_TO_USD), String(REWARD_PER_TASK), String(REFERRAL_REWARD), String(MIN_WITHDRAWAL_COINS)]
    );

    console.log("✅ DB initialized");
  } catch (err) {
    console.error("DB init error:", err);
    throw err;
  }
}

/* ========== Helper Utilities ========== */
const userState = new Map(); // { telegramId => { action: 'await_bank'|'await_change'|'await_withdraw'|'help', meta: {...} } }

function coinsToUSD(coins) {
  return Number(coins) * COIN_TO_USD;
}

async function getConfig(key, fallback) {
  const r = await pool.query("SELECT value FROM system_config WHERE key=$1", [key]);
  if (r.rows[0]) return r.rows[0].value;
  return fallback;
}

/* ========== Telegram Bot ========== */
if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing in .env — aborting");
  process.exit(1);
}
const bot = new Telegraf(BOT_TOKEN);

/* Helper: main menu keyboard */
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["💼 Wallet Balance", "🎯 Perform Task"],
    ["👥 Refer & Earn", "💸 Withdraw"],
    ["🆘 Get Help"]
  ]).resize();
}

/* On /start - handle referral payload */
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || "User";
  const payload = ctx.startPayload || null;
  try {
    await pool.query(
      `INSERT INTO users (telegram_id, username, referred_by) VALUES ($1,$2,$3) ON CONFLICT (telegram_id) DO NOTHING`,
      [telegramId, username, payload || null]
    );

    // If referred and not yet credited, credit referrer after first task completion (we will do that in postback)
    await ctx.reply(
      `👋 Hi ${username}! Welcome to Task-Earnings Bot.\nYou can earn by watching ads (10 ads per task).\n`,
      mainMenuKeyboard()
    );
    // show "Perform Task" hint
    await ctx.reply("To start, tap *🎯 Perform Task*.", { parse_mode: "Markdown" });
  } catch (err) {
    console.error("start error", err);
    await ctx.reply("⚠️ An error occurred while registering your account.");
  }
});

/* Menu button handlers */
bot.hears("💼 Wallet Balance", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const r = await pool.query("SELECT coins, balance_cash FROM users WHERE telegram_id=$1", [telegramId]);
    if (!r.rows[0]) {
      // create user record on-demand
      await pool.query("INSERT INTO users (telegram_id, username) VALUES ($1,$2) ON CONFLICT DO NOTHING", [telegramId, ctx.from.username || ctx.from.first_name]);
      return ctx.reply("💰 Wallet Balance: 0 coins ($0.00)", mainMenuKeyboard());
    }
    const { coins = 0, balance_cash = 0 } = r.rows[0];
    const usd = coinsToUSD(Number(coins)).toFixed(2);
    return ctx.reply(`💼 Wallet Balance:\n• ${coins} coins\n• ≈ $${usd}\n• Cash balance: ₦${balance_cash}\n\n#PayWithFonPayAndRelax`, mainMenuKeyboard());
  } catch (err) {
    console.error("wallet fetch error", err);
    return ctx.reply("⚠️ Error fetching wallet details. Try again later.", mainMenuKeyboard());
  }
});

bot.hears("🎯 Perform Task", async (ctx) => {
  // create a unique session, store in ad_sessions, then send ad-session URL
  const telegramId = ctx.from.id;
  try {
    const sessionId = crypto.randomUUID();
    await pool.query("INSERT INTO ad_sessions (id, telegram_id, completed) VALUES ($1,$2,FALSE)", [sessionId, telegramId]);

    // reset ad_watches for this session if any exist
    await pool.query("DELETE FROM ad_watches WHERE session_id=$1", [sessionId]);

    const adSessionUrl = `${BASE_URL}/ad-session/${sessionId}`;
    // show progress bar (0/10)
    const progress = "⚪".repeat(10);
    await ctx.replyWithMarkdown(`🎬 *Ad Task started*\nProgress: ${progress} (0/10)\n\nTap *Watch Next Ad* to open the ad viewer.`, {
      reply_markup: {
        inline_keyboard: [
          [{ text: "▶️ Watch Next Ad", url: adSessionUrl }],
          [{ text: "✅ I've Finished Watching (Submit)", callback_data: `submit_${sessionId}` }]
        ]
      }
    });
  } catch (err) {
    console.error("perform task error", err);
    await ctx.reply("⚠️ Error starting ad session. Try again later.");
  }
});

/* Inline handler when user clicks Submit (they may click after 10 ads) */
bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (!data) return ctx.answerCbQuery();

  if (data.startsWith("submit_")) {
    const sessionId = data.split("_")[1];
    try {
      const r = await pool.query("SELECT COUNT(*) AS c FROM ad_watches WHERE session_id=$1 AND validated=true", [sessionId]);
      const count = Number(r.rows[0].c || 0);
      if (count < 10) {
        await ctx.answerCbQuery(`You completed ${count}/10 ads. Please finish all 10 before claiming.`, { show_alert: true });
        return;
      }

      // credit only once: ensure session completed flag
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

      // credit referral reward if applicable and not yet credited
      const refRow = await pool.query("SELECT referred_by, referral_credited FROM users WHERE telegram_id=$1", [telegramId]);
      if (refRow.rows[0]) {
        const { referred_by, referral_credited } = refRow.rows[0];
        if (referred_by && !referral_credited) {
          const rr = Number(await getConfig("referral_reward", REFERRAL_REWARD));
          await pool.query("UPDATE users SET coins = COALESCE(coins,0) + $1 WHERE telegram_id=$2", [rr, referred_by]);
          await pool.query("UPDATE users SET referral_credited=TRUE WHERE telegram_id=$1", [telegramId]);
          // notify referrer
          try { await bot.telegram.sendMessage(referred_by, `🎉 You earned ${rr} coins from your referral!`); } catch(e) {}
        }
      }

      await pool.query("COMMIT");
      await ctx.answerCbQuery("Reward credited! 🎉", { show_alert: true });
      await bot.telegram.sendMessage(telegramId, `✅ Congratulations — ${reward} coins have been added to your wallet.`);

      // set next_task_available_at randomized offset (20m ±5m)
      const offset = Math.floor(Math.random() * 600) - 300; // seconds
      await pool.query("UPDATE users SET next_task_available_at = NOW() + INTERVAL '20 minutes' + ($1 || ' seconds')::interval WHERE telegram_id=$2", [offset, telegramId]);

    } catch (err) {
      try { await pool.query("ROLLBACK"); } catch(e){}
      console.error("submit error", err);
      await ctx.answerCbQuery("⚠️ Error claiming reward. Try again later.", { show_alert: true });
    }
    return;
  }

  // other callback types can be handled here
  await ctx.answerCbQuery();
});

/* Monetag postback endpoint - Monetag servers should POST here after each validated ad view.
   Monetag should include something like "custom":"sessionId=..." or you can pass sessionId in the zone call.
*/
app.post("/api/monetag/postback", async (req, res) => {
  // Monetag body example should be inspected; this code expects a `custom` field containing sessionId=...
  const payload = req.body || {};
  const custom = payload.custom || "";
  let sessionId = null;
  if (typeof custom === "string" && custom.includes("sessionId=")) {
    const m = custom.match(/sessionId=([a-zA-Z0-9-]+)/);
    if (m) sessionId = m[1];
  }
  // Fallback: monetag might provide a session_id field in body
  if (!sessionId && payload.sessionId) sessionId = payload.sessionId;

  if (!sessionId) {
    console.warn("postback: no sessionId", payload);
    return res.status(200).send("no-session");
  }

  try {
    // record ad watch (ad_index if present)
    const telegramId = payload.user_id || null;
    const adIndex = payload.ad_index ? Number(payload.ad_index) : null;
    await pool.query("INSERT INTO ad_watches (session_id, telegram_id, ad_index, validated) VALUES ($1,$2,$3,$4)", [sessionId, telegramId, adIndex, true]);

    // count validated ads
    const r = await pool.query("SELECT COUNT(*) as c FROM ad_watches WHERE session_id=$1 AND validated=true", [sessionId]);
    const count = Number(r.rows[0].c || 0);

    console.log(`postback session ${sessionId} count=${count}`);

    // If count >= 10 we will allow user to click Submit and claim reward (crediting done when user clicks Submit)
    return res.status(200).send("ok");
  } catch (err) {
    console.error("monetag postback error", err);
    return res.status(500).send("error");
  }
});

/* Ad session page served to the user (opens in browser) */
app.get("/ad-session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  // page loads monetag SDK and polls our session status
  res.send(`<!doctype html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ad Session</title></head>
<body style="font-family: system-ui; padding: 20px;">
  <h3>Watch Ads — Session</h3>
  <p id="status">Loading progress...</p>
  <div id="progress" style="font-size: 22px; margin: 10px 0;"></div>
  <button id="openAd">Open Ad (Monetag)</button>
  <script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script>
  <script>
    const sessionId = "${sessionId}";
    async function refresh(){
      const r = await fetch('/api/session/' + sessionId + '/status');
      const j = await r.json();
      const count = j.count || 0;
      const watched = '🔵'.repeat(count) + '⚪'.repeat(Math.max(0,10-count));
      document.getElementById('progress').innerText = watched + ' ('+count+'/10)';
      document.getElementById('status').innerText = count >= 10 ? 'Completed — return to Telegram and press Submit' : 'Watch ads and come back to submit when done';
    }
    document.getElementById('openAd').addEventListener('click', function(){
      try {
        // This triggers monetag ad display inside the page
        show_${MONETAG_ZONE}({
          type: 'inApp',
          inAppSettings: { frequency:2, capping:0.1, interval:30, timeout:5, everyPage:false },
          custom: 'sessionId=' + sessionId
        });
      } catch(e) { alert('Error launching ad SDK: '+e); }
    });
    setInterval(refresh, 3000);
    refresh();
  </script>
</body>
</html>`);
});

/* Session status endpoint */
app.get("/api/session/:sessionId/status", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const r = await pool.query("SELECT COUNT(*) as c FROM ad_watches WHERE session_id=$1 AND validated=true", [sessionId]);
    const count = Number(r.rows[0]?.c || 0);
    res.json({ count });
  } catch (err) {
    console.error("session status error", err);
    res.json({ count: 0 });
  }
});

/* ========== Withdraw flow & bank management ========== */

/* When user clicks Withdraw (menu) we set state to await bank/withdraw flow */
bot.hears("💸 Withdraw", async (ctx) => {
  const telegramId = ctx.from.id;
  // check user's coin balance
  try {
    const r = await pool.query("SELECT coins, bank_name, bank_account_number, bank_account_name FROM users WHERE telegram_id=$1", [telegramId]);
    const user = r.rows[0];
    const coins = Number(user?.coins || 0);
    if (coins < MIN_WITHDRAWAL_COINS) {
      return ctx.reply(`⚠️ Insufficient balance. Do more tasks today to increase your wallet balance. Minimum for withdrawal is ${MIN_WITHDRAWAL_COINS} coins.`, mainMenuKeyboard());
    }

    // check existing bank details
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

/* Handle incoming texts that correspond to awaited actions */
bot.on("text", async (ctx) => {
  const telegramId = ctx.from.id;
  const text = (ctx.message.text || "").trim();
  const state = userState.get(telegramId);

  // If not in a waiting state, and text is not a menu button, reply invalid
  const allowedButtons = ["💼 Wallet Balance","🎯 Perform Task","👥 Refer & Earn","💸 Withdraw","🆘 Get Help"];
  if (!state && !allowedButtons.includes(text) && !text.startsWith("/")) {
    return ctx.reply("❌ Invalid command. Please use the menu buttons to navigate.", mainMenuKeyboard());
  }

  if (!state) return; // no follow-up required

  // HANDLE awaiting bank first (first-time linking)
  if (state.action === "await_bank_first") {
    // expect: BankName,AccountName,AccountNumber
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

  // HANDLE awaiting withdraw amount (user has bank linked)
  if (state.action === "await_withdraw_amount") {
    const coins = Number(text.replace(/\D/g,""));
    if (!coins || coins <= 0) return ctx.reply("Please send a valid amount in coins (numbers only).");
    try {
      const r = await pool.query("SELECT coins, bank_name, bank_account_number, bank_account_name FROM users WHERE telegram_id=$1", [telegramId]);
      const user = r.rows[0];
      if (!user) return ctx.reply("User not found.");
      if (Number(user.coins) < coins) return ctx.reply("⚠️ Insufficient coins for that amount.");
      // create withdrawal
      const usd = coinsToUSD(coins);
      await pool.query("INSERT INTO withdrawals (telegram_id, amount_coins, amount_usd, bank_name, account_name, account_number, status) VALUES ($1,$2,$3,$4,$5,$6,$7)", [telegramId, coins, usd, user.bank_name, user.bank_account_name, user.bank_account_number, "pending"]);
      // deduct coins (or you can deduct only on approval — choose your policy; I'll deduct now)
      await pool.query("UPDATE users SET coins = coins - $1 WHERE telegram_id=$2", [coins, telegramId]);
      userState.delete(telegramId);
      await ctx.reply(`✅ Withdrawal requested for ${coins} coins (~$${usd.toFixed(2)}). Admin will review.`);
      // notify admins
      for (const aid of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(aid, `💸 Withdrawal request:\nUser: ${telegramId}\nAmount: ${coins} coins (~$${usd.toFixed(2)})\nAccount: ${user.bank_account_name} - ${user.bank_name} (${user.bank_account_number})`);
        } catch (e) {}
      }
    } catch (err) {
      console.error("withdraw request error", err);
      return ctx.reply("⚠️ Error creating withdrawal request.");
    }
    return;
  }

  // HANDLE change bank account flow: expecting "oldBank,oldAccNum, newBank,newAccNum"
  if (state.action === "await_change_bank") {
    // format: oldBank,oldAcc,oldName;newBank,newAcc,newName (or some agreed format). We'll expect old and new separated by '|'
    if (!text.includes("|")) {
      return ctx.reply("Invalid format. Please send: oldBank,oldAccNumber,oldName|newBank,newAccNumber,newName");
    }
    const [oldStr, newStr] = text.split("|").map(s =>
