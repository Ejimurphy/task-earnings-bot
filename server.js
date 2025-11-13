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

// ==========================
// server.js — PART 2 of 4
// (Paste this directly after Part 1 content)
// ==========================

/*
  NOTE:
  - Part 1 defined `bot`, `app`, `pool`, `safeQuery`, `mainMenuKeyboard`,
    `ADMIN_IDS`, `BASE_URL`, `performTaskEnabled`, etc.
  - This part uses those variables; do not re-declare them.
*/

// ----------------- Help / Support System -----------------

// Show help menu (keyboard)
bot.hears(["🆘 Get Help", "Get Help", "Help"], async (ctx) => {
  try {
    await ctx.reply(
      "🆘 How can we help you? Choose a topic from the keyboard below, or choose Other to type a custom message.",
      Markup.keyboard([
        ["💵 Withdraw Issue", "🧩 Task Issue"],
        ["💳 Bank/Account Issue", "🗣 Other"],
        ["🔙 Back to Menu"],
      ]).resize()
    );
  } catch (e) {
    console.error("Get help menu error:", e);
    await ctx.reply("⚠️ Error opening help menu.");
  }
});

// Help categories — prompt user to type their message
bot.hears(["💵 Withdraw Issue", "🧩 Task Issue", "💳 Bank/Account Issue"], async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.awaitingHelpMessage = ctx.message.text;
  await ctx.reply(
    `✅ You selected *${ctx.message.text}*.\nPlease type your message below and we'll notify an admin.`,
    { parse_mode: "Markdown", ...mainMenuKeyboard(ADMIN_IDS.includes(String(ctx.from.id))) }
  );
});

// Other / chat with admin — prompt
bot.hears(["🗣 Other"], async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.awaitingHelpMessage = "Other";
  await ctx.reply(
    "✍️ Please type your message for the admin. An acknowledgement will be sent and admins will be notified.",
    mainMenuKeyboard(ADMIN_IDS.includes(String(ctx.from.id)))
  );
});

// Capture help message and notify admins
bot.on("text", async (ctx, next) => {
  // This on("text") is shared with other handlers; ensure we don't block others.
  ctx.session = ctx.session || {};
  const awaiting = ctx.session.awaitingHelpMessage;

  // If it's a menu label or command, skip here (let other handlers handle)
  const text = (ctx.message.text || "").trim();
  const menuLabels = new Set([
    "💼 Wallet Balance","🎥 Perform Task","💸 Withdraw","👥 Refer & Earn",
    "🏦 Change Bank","🆘 Get Help","Done","Submit","🔙 Back to Menu",
    "💵 Withdraw Issue","🧩 Task Issue","💳 Bank/Account Issue","🗣 Other"
  ]);
  if (menuLabels.has(text) || text.startsWith("/")) {
    return next();
  }

  if (!awaiting) {
    // Not a support message, fall through to other handlers
    return next();
  }

  // It's a help message to forward to admins
  ctx.session.awaitingHelpMessage = null;
  const category = awaiting;
  const telegramId = String(ctx.from.id);
  const username = ctx.from.username || ctx.from.first_name || telegramId;

  try {
    // Save to DB for records
    await safeQuery(
      "INSERT INTO support_requests (telegram_id, help_topic, message, status, created_at) VALUES ($1,$2,$3,'pending',NOW())",
      [telegramId, category, text]
    );

    // Acknowledge user immediately
    await ctx.reply(
      "✅ Your message has been received. An agent will get back to you shortly.\nYou can also message us on WhatsApp if urgent.",
      mainMenuKeyboard(ADMIN_IDS.includes(telegramId))
    );

    // Notify admins
    for (const aid of ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(
          aid,
          `📩 *New Help Request*\n\n👤 From: ${username} (ID: ${telegramId})\n📂 Category: ${category}\n💬 Message:\n${text}\n\nReply using: /reply ${telegramId} <your message>`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("Failed to notify admin:", err?.description || err?.message || err);
      }
    }
  } catch (e) {
    console.error("Capture help message error:", e);
    await ctx.reply("⚠️ Failed to submit your request. Please try again.");
  }
});

// Admin reply command — reply to user directly
bot.command("reply", async (ctx) => {
  const parts = (ctx.message.text || "").split(" ").filter(Boolean);
  if (parts.length < 3) return ctx.reply("Usage: /reply <user_id> <message>");

  const userId = parts[1];
  const message = parts.slice(2).join(" ");

  try {
    await bot.telegram.sendMessage(userId, `📩 *Admin Reply:*\n${message}`, { parse_mode: "Markdown" });
    await ctx.reply("✅ Message sent to user.");
  } catch (err) {
    console.error("Reply error:", err);
    // Handle common Telegram errors
    if (String(err).includes("bot was blocked")) {
      await ctx.reply("⚠️ Cannot deliver: user has blocked the bot.");
    } else if (String(err).includes("chat not found") || String(err).includes("Bad Request: chat not found")) {
      await ctx.reply("⚠️ Cannot deliver: user has not started the bot yet.");
    } else {
      await ctx.reply("⚠️ Failed to send message to user.");
    }
  }
});

// ----------------- Ad session pages & Monetag postback -----------------

// Ad session web page — shows progress and an Open Ad button (card-style)
app.get("/ad-session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  try {
    // Count validated ad_views for this session
    const lastRow = await safeQuery(
      `SELECT COUNT(*)::int AS cnt, MAX(viewed_at) AS last_valid
       FROM ad_views WHERE session_id=$1 AND validated=true`,
      [sessionId]
    );
    const cnt = Number(lastRow.rows[0]?.cnt || 0);
    const lastValid = lastRow.rows[0]?.last_valid ? new Date(lastRow.rows[0].last_valid) : null;
    const now = new Date();

    // if lastValid exists and older than 2 minutes => reset session views
    if (lastValid && now - lastValid > 2 * 60 * 1000) {
      // reset progress for this session
      try {
        await safeQuery("DELETE FROM ad_views WHERE session_id=$1", [sessionId]);
        await safeQuery("UPDATE ad_sessions SET progress=0, completed=false WHERE session_id=$1", [sessionId]);
      } catch (e) {
        console.error("reset session err:", e);
      }
    }

    // get updated count after reset
    const updatedRow = await safeQuery(
      `SELECT COUNT(*)::int AS cnt FROM ad_views WHERE session_id=$1 AND validated=true`,
      [sessionId]
    );
    const updatedCount = Number(updatedRow.rows[0]?.cnt || 0);

    // Serve card-style HTML (Monetag SDK included)
    res.send(`<!doctype html>
<html>
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /><title>Ad Session</title>
<style>
  body{font-family:Inter, system-ui, Arial; background:#f5f7fb; padding:20px}
  .card{max-width:720px;margin:0 auto;background:#fff;border-radius:12px;padding:20px;box-shadow:0 6px 20px rgba(10,10,30,0.06)}
  .title{font-size:20px;margin-bottom:6px}
  .progress{font-size:18px;margin:14px 0}
  .btn{display:inline-block;padding:10px 14px;border-radius:10px;text-decoration:none;background:#2563eb;color:#fff;font-weight:600;border:none;cursor:pointer}
  .note{color:#6b7280;font-size:13px;margin-top:12px}
</style>
</head>
<body>
  <div class="card">
    <div class="title">🎬 Watch Ads — Session</div>
    <div id="progress" class="progress">Progress: ${updatedCount}/10</div>
    <div>
      <button id="openAd" class="btn">▶️ Open Ad</button>
      <button id="refreshBtn" class="btn" style="background:#10b981;margin-left:8px">🔄 Refresh</button>
    </div>
    <div id="note" class="note">Close this page and re-open within 2 minutes to resume progress. After 2 minutes inactivity progress resets.</div>
  </div>

  <script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script>
  <script>
    const sessionId='${sessionId}';
    async function refresh(){
      try{
        const r=await fetch('/api/session/'+sessionId+'/status');
        const j=await r.json();
        document.getElementById('progress').innerText='Progress: '+(j.count||0)+'/10';
        document.getElementById('note').innerText = j.count>=10 ? 'Completed — return to Telegram and submit your session.' : 'Close and re-open within 2 minutes to resume.';
      }catch(e){ document.getElementById('note').innerText='Error getting progress'; }
    }

    document.getElementById('openAd').addEventListener('click', function(){
      try{
        show_${MONETAG_ZONE}({
          type:'inApp',
          custom: 'sessionId=' + sessionId
        });
      }catch(e){
        alert('Ad SDK error: '+e);
      }
    });
    document.getElementById('refreshBtn').addEventListener('click', refresh);
    setInterval(refresh, 3000);
    refresh();
  </script>
</body>
</html>`);
  } catch (e) {
    console.error("ad-session page error", e);
    res.status(500).send("Session error");
  }
});

// Session status endpoint (used by page polling)
app.get("/api/session/:sessionId/status", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const r = await safeQuery(
      `SELECT COUNT(*)::int AS c, MAX(viewed_at) AS last_valid
       FROM ad_views WHERE session_id=$1 AND validated=true`,
      [sessionId]
    );
    const cnt = Number(r.rows[0]?.c || 0);
    const lastValid = r.rows[0]?.last_valid ? new Date(r.rows[0].last_valid).toISOString() : null;
    res.json({ count: cnt, last_valid: lastValid });
  } catch (e) {
    console.error("session status err", e);
    res.json({ count: 0, last_valid: null });
  }
});

// Monetag server-side postback (Monetag will call this to validate ad events)
app.post("/api/monetag/postback", express.json(), async (req, res) => {
  const payload = req.body || {};
  try {
    // Monetag may send `custom` containing "sessionId=..."
    let sessionId = null;
    if (payload.custom && typeof payload.custom === "string") {
      const m = payload.custom.match(/sessionId=([a-zA-Z0-9-_.]+)/);
      if (m) sessionId = m[1];
    }
    if (!sessionId && payload.sessionId) sessionId = payload.sessionId;

    if (!sessionId) {
      console.warn("postback missing sessionId", payload);
      return res.status(400).send("missing-session");
    }

    const telegramId = payload.user_id || null;
    const adIndex = payload.ad_index ? Number(payload.ad_index) : null;

    await safeQuery(
      "INSERT INTO ad_views (session_id, telegram_id, ad_index, validated, viewed_at) VALUES ($1,$2,$3,$4,NOW())",
      [sessionId, telegramId, adIndex, true]
    );

    // Update session progress count
    await safeQuery(
      `UPDATE ad_sessions SET progress = COALESCE(
         (SELECT COUNT(*) FROM ad_views WHERE session_id = $1 AND validated = true), 0
       ) WHERE session_id = $1`,
      [sessionId]
    );

    return res.status(200).send("ok");
  } catch (e) {
    console.error("monetag postback error", e);
    return res.status(500).send("error");
  }
});

// Submit session command: user asks for reward credit after reaching 10 validated ads
bot.command("submit_session", async (ctx) => {
  const parts = (ctx.message.text || "").split(" ").filter(Boolean);
  const sessionId = parts[1];
  if (!sessionId) return ctx.reply("Usage: /submit_session <sessionId>");

  try {
    // count validated
    const r = await safeQuery(
      `SELECT COUNT(*)::int AS c, a.telegram_id FROM ad_views v
       JOIN ad_sessions a ON v.session_id = a.session_id
       WHERE v.session_id=$1 AND v.validated=true GROUP BY a.telegram_id`,
      [sessionId]
    );
    const cnt = Number(r.rows[0]?.c || 0);
    const telegramId = r.rows[0]?.telegram_id;
    if (cnt < 10) return ctx.reply(`You completed ${cnt}/10 ads. Finish them before submitting.`);

    // ensure session exists and not already credited
    const sess = await safeQuery("SELECT completed, telegram_id FROM ad_sessions WHERE session_id=$1", [sessionId]);
    if (!sess.rows[0]) return ctx.reply("Session not found.");
    if (sess.rows[0].completed) return ctx.reply("Reward already claimed for this session.");

    // credit reward (coins)
    await safeQuery("BEGIN");
    await safeQuery("UPDATE users SET coins = coins + $1 WHERE telegram_id=$2", [REWARD_PER_TASK_COINS, telegramId]);
    await safeQuery("UPDATE ad_sessions SET completed=true WHERE session_id=$1", [sessionId]);
    await safeQuery("INSERT INTO transactions (telegram_id, amount, type, description, created_at) VALUES ($1,$2,'credit',$3,NOW())", [telegramId, REWARD_PER_TASK_COINS, `ad reward ${sessionId}`]);
    await safeQuery("COMMIT");

    await ctx.reply(`✅ Reward credited: ${REWARD_PER_TASK_COINS} coins added to your wallet.`, mainMenuKeyboard(ADMIN_IDS.includes(String(ctx.from.id))));
  } catch (e) {
    try { await safeQuery("ROLLBACK"); } catch (_) {}
    console.error("submit_session error", e);
    await ctx.reply("⚠️ Error processing submission. Try again later.");
  }
});

// ----------------- Admin actions (keyboard-driven) -----------------

// Admin can toggle performTaskEnabled via a keyboard button in admin panel
bot.hears(["🛠️ Admin Panel"], async (ctx) => {
  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender)) {
    return ctx.reply("⛔ You don't have permission to access admin controls.", mainMenuKeyboard(false));
  }

  await ctx.reply(
    "🛠️ Admin Panel — Use keyboard below:",
    Markup.keyboard([
      ["🔁 Toggle Perform Task", "📊 View Stats"],
      ["📢 Broadcast Message", "🧾 Pending Withdrawals"],
      ["🔙 Back to Menu"],
    ]).resize()
  );
});

// Toggle Perform Task (admin)
bot.hears("🔁 Toggle Perform Task", async (ctx) => {
  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender)) {
    return ctx.reply("⛔ Unauthorized.", mainMenuKeyboard(false));
  }
  performTaskEnabled = !performTaskEnabled;
  await ctx.reply(`🎬 Perform Task is now ${performTaskEnabled ? "✅ ENABLED" : "⛔ DISABLED"}`, mainMenuKeyboard(true));
});

// View Stats (admin)
bot.hears("📊 View Stats", async (ctx) => {
  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender)) return ctx.reply("⛔ Unauthorized.", mainMenuKeyboard(false));

  try {
    const users = await safeQuery("SELECT COUNT(*)::int AS c FROM users");
    const views = await safeQuery("SELECT COUNT(*)::int AS c FROM ad_views");
    await ctx.reply(`📊 Platform Stats\n\nUsers: ${users.rows[0]?.c || 0}\nAd Views: ${views.rows[0]?.c || 0}`, mainMenuKeyboard(true));
  } catch (e) {
    console.error("admin stats err", e);
    await ctx.reply("⚠️ Unable to fetch stats.");
  }
});

// Broadcast message (admin begins flow)
bot.hears("📢 Broadcast Message", async (ctx) => {
  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender)) return ctx.reply("⛔ Unauthorized.", mainMenuKeyboard(false));
  ctx.session = ctx.session || {};
  ctx.session.awaitingBroadcast = true;
  await ctx.reply("📢 Please type the message to broadcast to all users.", mainMenuKeyboard(true));
});

// Pending Withdrawals (admin)
bot.hears("🧾 Pending Withdrawals", async (ctx) => {
  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender)) return ctx.reply("⛔ Unauthorized.", mainMenuKeyboard(false));
  try {
    const r = await safeQuery("SELECT id, telegram_id, amount, account_name, account_number, bank_name, status FROM withdrawals WHERE status='pending' ORDER BY created_at DESC LIMIT 50");
    if (!r.rows.length) return ctx.reply("No pending withdrawals.", mainMenuKeyboard(true));
    let msg = "📥 Pending Withdrawals:\n\n";
    r.rows.forEach((w) => {
      msg += `ID:${w.id} User:${w.telegram_id} Amount:${w.amount} Bank:${w.bank_name} ${w.account_number}\n\n`;
    });
    await ctx.reply(msg, mainMenuKeyboard(true));
  } catch (e) {
    console.error("pending withdraws err", e);
    await ctx.reply("⚠️ Error fetching pending withdrawals.");
  }
});

// ----------------- End of Part 2 -----------------
        
// ==========================
// server.js — PART 3 of 4
// ==========================

// ----------------- Admin: Approve / Decline Withdrawals -----------------

bot.command("approve", async (ctx) => {
  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender))
    return ctx.reply("⛔ Unauthorized.", mainMenuKeyboard(false));

  const parts = ctx.message.text.split(" ");
  if (parts.length < 2)
    return ctx.reply("Usage: /approve <withdrawal_id>", mainMenuKeyboard(true));

  const wid = parts[1];
  try {
    await safeQuery("UPDATE withdrawals SET status='approved', reviewed_at=NOW() WHERE id=$1", [wid]);
    await ctx.reply(`✅ Withdrawal ${wid} marked as approved.`, mainMenuKeyboard(true));

    // Notify user if possible
    const w = await safeQuery("SELECT telegram_id, amount FROM withdrawals WHERE id=$1", [wid]);
    if (w.rows[0]) {
      const u = w.rows[0];
      try {
        await bot.telegram.sendMessage(
          u.telegram_id,
          `💵 Your withdrawal of ₦${u.amount} has been approved and processed.`,
          mainMenuKeyboard(false)
        );
      } catch (_) {}
    }
  } catch (e) {
    console.error("approve err", e);
    await ctx.reply("⚠️ Failed to approve withdrawal.");
  }
});

bot.command("decline", async (ctx) => {
  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender))
    return ctx.reply("⛔ Unauthorized.", mainMenuKeyboard(false));

  const parts = ctx.message.text.split(" ");
  if (parts.length < 2)
    return ctx.reply("Usage: /decline <withdrawal_id>", mainMenuKeyboard(true));

  const wid = parts[1];
  try {
    await safeQuery("UPDATE withdrawals SET status='declined', reviewed_at=NOW() WHERE id=$1", [wid]);
    await ctx.reply(`❌ Withdrawal ${wid} declined.`, mainMenuKeyboard(true));
  } catch (e) {
    console.error("decline err", e);
    await ctx.reply("⚠️ Failed to decline withdrawal.");
  }
});

// ----------------- Admin: Export Withdrawals -----------------
bot.command("export", async (ctx) => {
  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender))
    return ctx.reply("⛔ Unauthorized.", mainMenuKeyboard(false));

  try {
    const r = await safeQuery("SELECT * FROM withdrawals ORDER BY created_at DESC LIMIT 200");
    if (!r.rows.length)
      return ctx.reply("No withdrawal data to export.", mainMenuKeyboard(true));

    let csv = "id,telegram_id,amount,status,created_at\n";
    r.rows.forEach(
      (x) =>
        (csv += `${x.id},${x.telegram_id},${x.amount},${x.status},${x.created_at}\n`)
    );

    const fs = await import("fs");
    const path = "./withdrawals.csv";
    fs.writeFileSync(path, csv);
    await ctx.replyWithDocument({ source: path });
  } catch (e) {
    console.error("export err", e);
    await ctx.reply("⚠️ Failed to export withdrawals.");
  }
});

// ----------------- Broadcast Message Handler -----------------

bot.on("text", async (ctx, next) => {
  ctx.session = ctx.session || {};
  const awaiting = ctx.session.awaitingBroadcast;
  if (!awaiting) return next();

  const sender = String(ctx.from.id);
  if (!ADMIN_IDS.includes(sender)) return next();

  ctx.session.awaitingBroadcast = false;
  const message = ctx.message.text;

  try {
    const users = await safeQuery("SELECT telegram_id FROM users");
    let count = 0;
    for (const row of users.rows) {
      try {
        await bot.telegram.sendMessage(row.telegram_id, `📢 *Broadcast:*\n${message}`, {
          parse_mode: "Markdown",
          ...mainMenuKeyboard(false),
        });
        count++;
      } catch (_) {}
    }
    await ctx.reply(`✅ Broadcast delivered to ${count} users.`, mainMenuKeyboard(true));
  } catch (e) {
    console.error("broadcast err", e);
    await ctx.reply("⚠️ Failed to broadcast.");
  }
});

// ----------------- User: Wallet Balance -----------------

bot.hears(["💼 Wallet Balance", "Wallet Balance"], async (ctx) => {
  const telegramId = String(ctx.from.id);
  try {
    const r = await safeQuery(
      "SELECT coins FROM users WHERE telegram_id=$1",
      [telegramId]
    );
    const coins = r.rows[0]?.coins || 0;
    await ctx.reply(
      `💼 Your wallet balance is ₦${coins}`,
      mainMenuKeyboard(ADMIN_IDS.includes(telegramId))
    );
  } catch (e) {
    console.error("wallet err", e);
    await ctx.reply("⚠️ Unable to fetch wallet balance.");
  }
});

// ----------------- User: Transaction History -----------------
bot.hears(["📜 Transactions", "Transactions"], async (ctx) => {
  const telegramId = String(ctx.from.id);
  try {
    const r = await safeQuery(
      "SELECT amount, type, description, created_at FROM transactions WHERE telegram_id=$1 ORDER BY created_at DESC LIMIT 10",
      [telegramId]
    );
    if (!r.rows.length)
      return ctx.reply("📭 No transactions yet.", mainMenuKeyboard(false));

    let msg = "📜 *Recent Transactions:*\n\n";
    r.rows.forEach((t) => {
      msg += `${t.type === "credit" ? "➕" : "➖"} ₦${t.amount} — ${t.description}\n(${t.created_at.toLocaleString()})\n\n`;
    });
    await ctx.reply(msg, { parse_mode: "Markdown", ...mainMenuKeyboard(false) });
  } catch (e) {
    console.error("tx history err", e);
    await ctx.reply("⚠️ Failed to fetch transactions.");
  }
});

// ----------------- Express Health & Home Routes -----------------
app.get("/", (req, res) => res.send("FonPay Task-Earnings Bot is running."));
app.get("/health", (req, res) => res.send("OK"));

// ----------------- Start Bot with Webhook -----------------
async function startBot() {
  try {
    const webhookUrl = `${process.env.BASE_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    await bot.telegram.setWebhook(webhookUrl);
    app.use(bot.webhookCallback(`/bot${process.env.TELEGRAM_BOT_TOKEN}`));
    console.log(`🚀 Bot running in webhook mode at: ${webhookUrl}`);
  } catch (err) {
    console.error("Bot launch error:", err);
  }
}
startBot();

// ----------------- Express Listener -----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));

// ----------------- Graceful Shutdown -----------------
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

// ----------------- End of Part 3 -----------------
      
// ==========================
// server.js — PART 4 of 4 (Final Section)
// ==========================

// ----------------- Safe Query Helper -----------------
/**
 * Executes a parameterized SQL query safely.
 * Automatically catches and logs errors without breaking execution.
 * @param {string} text SQL query text
 * @param {Array} params Query parameters
 * @returns {Promise<object>} Query result
 */
async function safeQuery(text, params = []) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error("Database query error:", err);
    throw err;
  }
}

// ----------------- Error Handling Middleware -----------------
bot.catch((err, ctx) => {
  console.error(`Bot Error for ${ctx.updateType}:`, err);
  try {
    ctx.reply("⚠️ Oops! Something went wrong. Please try again later.", mainMenuKeyboard(false));
  } catch (_) {}
});

// ----------------- Session Management -----------------
import session from "telegraf/session.js";
bot.use(session());

// ----------------- Fallback Command -----------------
bot.on("message", async (ctx) => {
  const text = ctx.message.text;
  const sender = String(ctx.from.id);
  const isAdmin = ADMIN_IDS.includes(sender);

  if (
    [
      "🏠 Home",
      "Menu",
      "menu",
      "/menu",
      "start",
      "/home",
      "back",
      "Back",
    ].includes(text)
  ) {
    return ctx.reply(
      "🏠 Welcome back to FonPay Task-Earnings bot! Choose an option below:",
      mainMenuKeyboard(isAdmin)
    );
  }

  return ctx.reply(
    "🤖 I didn't understand that command. Please use the menu below.",
    mainMenuKeyboard(isAdmin)
  );
});

// ----------------- Final Console Output -----------------
console.log("✅ All handlers loaded successfully. FonPay Task-Earnings bot is ready!");

// ==========================
// END OF server.js
// ==========================
