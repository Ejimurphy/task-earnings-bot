import express from "express";
import dotenv from "dotenv";
import { Telegraf, Markup, session } from "telegraf";
import { safeQuery } from "./src/utils.js";

let performTaskEnabled = true; // ✅ Default: ON

// ✅ Load environment variables
dotenv.config();

// ✅ Initialize bot first
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ==========================
// 🔐 ADMIN MANAGEMENT SYSTEM
// ==========================
let ADMINS = new Set([
  5236441213, // Existing main admin ID
  5725566044, // Secondary admin ID
]);

// ✅ Command for adding a new admin (only by existing admins)
bot.command("addadmin", async (ctx) => {
  const senderId = ctx.from.id;
  if (!ADMINS.has(senderId)) {
    return ctx.reply("❌ You are not authorized to add admins.");
  }

  const input = ctx.message.text.split(" ");
  if (input.length < 2) {
    return ctx.reply("⚠️ Usage: /addadmin <user_id>");
  }

  const newAdminId = parseInt(input[1]);
  if (isNaN(newAdminId)) {
    return ctx.reply("⚠️ Invalid user ID.");
  }

  ADMINS.add(newAdminId);
  await ctx.reply(`✅ Admin with ID ${newAdminId} added successfully.`);
});

// ---------- Admin Toggle Perform Task ----------
bot.command("toggle_tasks", async (ctx) => {
  const adminIds = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim());

  if (!adminIds.includes(String(ctx.from.id))) {
    return ctx.reply("⚠️ You are not authorized to use this command.");
  }

  performTaskEnabled = !performTaskEnabled;
  const status = performTaskEnabled ? "✅ ENABLED" : "⛔ DISABLED";

  await ctx.reply(`🎥 Perform Task feature is now *${status}*`, { parse_mode: "Markdown" });
});

bot.command("toggle_tasks", async (ctx) => {
  const adminIds = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim());

  if (!adminIds.includes(String(ctx.from.id))) {
    return ctx.reply("⚠️ You are not authorized to use this command.");
  }

  performTaskEnabled = !performTaskEnabled;
  const status = performTaskEnabled ? "enabled" : "disabled";

  await setSetting("perform_task", status);

  await ctx.reply(
    `🎥 Perform Task feature is now *${status.toUpperCase()}*`,
    { parse_mode: "Markdown" }
  );
});

// ---------- Admin Check Task Status ----------
bot.command("task_status", async (ctx) => {
  const adminIds = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim());

  if (!adminIds.includes(String(ctx.from.id))) {
    return ctx.reply("⚠️ You are not authorized to use this command.");
  }

  const status = performTaskEnabled ? "✅ Currently ENABLED" : "⛔ Currently DISABLED";
  await ctx.reply(`🎥 Perform Task Status: *${status}*`, { parse_mode: "Markdown" });
});

// ✅ Command for removing an admin
bot.command("removeadmin", async (ctx) => {
  const senderId = ctx.from.id;
  if (!ADMINS.has(senderId)) {
    return ctx.reply("❌ You are not authorized to remove admins.");
  }

  const input = ctx.message.text.split(" ");
  if (input.length < 2) {
    return ctx.reply("⚠️ Usage: /removeadmin <user_id>");
  }

  const removeId = parseInt(input[1]);
  if (ADMINS.has(removeId)) {
    ADMINS.delete(removeId);
    await ctx.reply(`✅ Admin with ID ${removeId} removed successfully.`);
  } else {
    await ctx.reply("⚠️ That user is not an admin.");
  }
});

// ✅ Show current admins
bot.command("admins", async (ctx) => {
  if (!ADMINS.has(ctx.from.id)) {
    return ctx.reply("❌ You are not authorized to view admins.");
  }

  const list = Array.from(ADMINS).join(", ");
  await ctx.reply(`👑 *Current Admins:*\n${list}`, { parse_mode: "Markdown" });
});

// ✅ Apply session middleware after bot initialization
bot.use(session());

// ✅ Initialize express app
const app = express();
app.use(express.json());


// ---------- Config ----------
const BOT_TOKEN = process.env.BOT_TOKEN; // required
const DATABASE_URL = process.env.DATABASE_URL; // required
const PORT = process.env.PORT || 10000;
const MONETAG_ZONE = process.env.MONETAG_ZONE || "10136395";
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_ID || "5236441213,5725566044")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean)
  .map((s) => s);

const COIN_TO_USD = Number(process.env.COIN_TO_USD || 0.00005); // default 0.00005 dollars per coin
const REWARD_PER_TASK_COINS = Number(process.env.REWARD_PER_TASK_COINS || 200);
const REFERRAL_REWARD_COINS = Number(process.env.REFERRAL_REWARD_COINS || 50);
const MIN_WITHDRAW_COINS = Number(process.env.MIN_WITHDRAW_COINS || 60000); // per your earlier requirement

if (!BOT_TOKEN) {
  console.error("BOT_TOKEN missing in .env");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("DATABASE_URL missing in .env");
  process.exit(1);
}

// --- Unified Database Initialization ---
import pool from "./src/db.js";
async function initializeDatabase() {
  const sql = `
    -- 🧍 USERS TABLE
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT UNIQUE,
      username TEXT,
      coins BIGINT DEFAULT 0,
      balance NUMERIC DEFAULT 0,
      referred_by BIGINT,
      referral_credited BOOLEAN DEFAULT FALSE,
      bank_name TEXT,
      bank_account_number TEXT,
      bank_account_name TEXT,
      is_banned BOOLEAN DEFAULT FALSE,
      next_task_available_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 💰 TRANSACTIONS TABLE
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      amount NUMERIC,
      type TEXT CHECK (type IN ('credit', 'debit')) DEFAULT 'credit',
      status TEXT DEFAULT 'pending',
      description TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 💸 WITHDRAWALS TABLE
    CREATE TABLE IF NOT EXISTS withdrawals (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      amount NUMERIC,
      bank_name TEXT,
      account_number TEXT,
      account_name TEXT,
      status TEXT DEFAULT 'pending',
      processed_by BIGINT,
      processed_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 👥 REFERRALS TABLE
    CREATE TABLE IF NOT EXISTS referrals (
      id SERIAL PRIMARY KEY,
      referrer_id BIGINT,
      referred_id BIGINT UNIQUE,
      reward NUMERIC DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 🎬 AD SESSIONS TABLE
    CREATE TABLE IF NOT EXISTS ad_sessions (
    id UUID PRIMARY KEY,
    telegram_id BIGINT REFERENCES users(telegram_id),
    completed BOOLEAN DEFAULT FALSE,
    progress INT DEFAULT 0,
    last_view_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

    -- 👁️ AD VIEWS TABLE
    CREATE TABLE IF NOT EXISTS ad_views (
      id SERIAL PRIMARY KEY,
      session_id UUID REFERENCES ad_sessions(id) ON DELETE CASCADE,
      telegram_id BIGINT,
      viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 🆘 SUPPORT REQUESTS TABLE
    CREATE TABLE IF NOT EXISTS support_requests (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      help_topic TEXT,
      message TEXT,
      status TEXT DEFAULT 'pending',
      admin_reply TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- ⚙️ SETTINGS TABLE
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );

    -- 🪙 REWARD LOG TABLE
    CREATE TABLE IF NOT EXISTS reward_logs (
      id SERIAL PRIMARY KEY,
      telegram_id BIGINT,
      task_id UUID,
      reward_amount NUMERIC DEFAULT 0,
      credited BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;

  await pool.query(sql);
  console.log("✅ All database tables created successfully!");
}

await initializeDatabase();


// ---------- Utilities ----------
// Convert coins → USD
function coinsToUSD(coins) {
  return (coins * 0.001).toFixed(2);  // 60000 coins = $4
}

bot.hears("🔙 Back to Menu", async (ctx) => {
  const adminList = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim());

  const isAdmin = adminList.includes(String(ctx.from.id));

  const keyboard = [
    ["💼 Wallet Balance", "🎥 Perform Task"],
    ["💸 Withdraw", "👥 Refer & Earn"],
    ["🏦 Change Bank", "🆘 Get Help"],
  ];

  // Add admin panel button ONLY for admins
  if (isAdmin) {
    keyboard.push(["🛠 Admin Panel"]);
  }

  await ctx.reply("🏠 *Main Menu*\nSelect an option:", {
    parse_mode: "Markdown",
    reply_markup: {
      keyboard,
      resize_keyboard: true,
    },
  });
});


// ---------- Bot: /start with referral ----------
bot.start(async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || "User";
  const payload = ctx.startPayload || null; // telegraf sets ctx.startPayload when user opens /start payload
  const referredBy = payload && /^\d+$/.test(payload) ? Number(payload) : null;

  try {
    const r = await safeQuery("SELECT * FROM users WHERE telegram_id=$1", [
      telegramId,
    ]);
    if (r.rows.length === 0) {
      await safeQuery(
        "INSERT INTO users (telegram_id, username, referred_by, next_task_available_at) VALUES ($1,$2,$3,NOW())",
        [telegramId, username, referredBy]
      );
      // referral credit (first time) if referredBy exists
      if (referredBy) {
        await safeQuery(
          "UPDATE users SET coins = coins + $1 WHERE telegram_id=$2",
          [REFERRAL_REWARD_COINS, referredBy]
        );
        await safeQuery(
          "INSERT INTO transactions (telegram_id, type, coins, meta) VALUES ($1,'referral_credit',$2,$3)",
          [referredBy, REFERRAL_REWARD_COINS, JSON.stringify({ from: telegramId })]
        );
        try {
          await bot.telegram.sendMessage(
            referredBy,
            `🎉 You earned ${REFERRAL_REWARD_COINS} coins for referring ${username}!`
          );
        } catch (e) {}
      }
      await ctx.reply(
        `🎉 Welcome, ${username}! Your FonPay Task account is created.\nUse /menu to open the dashboard.`
      );
    } else {
      await ctx.reply(`👋 Welcome back, ${username}! Use /menu to continue.`);
    }
  } catch (e) {
    console.error("start error:", e);
    await ctx.reply("⚠️ Error while starting. Try again later.");
  }
});

// ---------- Menu keyboard helper ----------
function mainMenuKeyboard() {
  return Markup.keyboard([
    ["💼 Wallet Balance", "🎥 Perform Task"],
    ["💸 Withdraw", "👥 Refer & Earn"],
    ["🏦 Change Bank", "🆘 Get Help"],
  ]).resize();
}

// ---------- /menu ----------
bot.command("menu", async (ctx) => {
  await ctx.reply("📍 Choose an option:", mainMenuKeyboard());
});

// ---------- Wallet balance (coins + USD + cash) ----------
bot.hears("💼 Wallet Balance", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const r = await safeQuery(
      "SELECT coins, balance, bank_name FROM users WHERE telegram_id=$1",
      [telegramId]
    );
    if (!r.rows[0]) return ctx.reply("⚠️ No wallet found. Send /start to register.");
    const { coins, balance, bank_name } = r.rows[0];
    const usd = coinsToUSD(coins);
    await ctx.reply(
      `💰 Wallet Summary\nCoins: ${coins} 🪙\nEquivalent: $${usd}\nCash balance: ₦${Number(balance || 0)}\nBank: ${bank_name || "Not set"}`,
      { parse_mode: "Markdown" }
    );
  } catch (e) {
    console.error("wallet error", e);
    await ctx.reply("⚠️ Error fetching wallet details.");
  }
});

// Perform Task — create session and send a card-like message with inline "Open Ads" button
bot.hears(["🎥 Perform Task", "Perform Task", "Watch Ads", "Start Task"], async (ctx) => {
  const telegramId = ctx.from.id;

  try {
    // 🔹 Step 1: Check if Perform Task feature is enabled
    const performTaskEnabled = await getSetting("perform_task_enabled");
    if (performTaskEnabled === "off") {
      await ctx.reply("⚠️ The Perform Task feature is temporarily disabled. Please try again later.");
      return; // ✅ Now valid because it's inside the async block
    }

    // 🔹 Step 2: Check if user is banned
    const u = await safeQuery("SELECT is_banned FROM users WHERE telegram_id=$1", [telegramId]);
    if (u.rows[0] && u.rows[0].is_banned) {
      await ctx.reply("🚫 Your account is banned. Contact support.");
      return;
    }

    // 🔹 Step 3: Create a session
    const sessionId = crypto.randomUUID();
    await safeQuery(
      "INSERT INTO ad_sessions (id, telegram_id, completed) VALUES ($1,$2,false)",
      [sessionId, telegramId]
    );

    // 🔹 Step 4: Send start message
    await ctx.reply(
      "🎬 Your task session has started! Click the button below to watch ads and earn coins.",
      Markup.inlineKeyboard([
        [Markup.button.url("▶️ Open Ads", `${process.env.BASE_URL}/ads/${sessionId}`)],
      ])
    );

    // session URL (uses BASE_URL env if set)
    const base = process.env.BASE_URL || `https://${process.env.RENDER_EXTERNAL_URL || process.env.HOSTNAME || "your-app-url.example"}`;
    const sessionUrl = `${base.replace(/\/$/, "")}/ad-session/${sessionId}`;

    // Send a card-style message via Markdown + inline keyboard
    const msg = `🎬 *Task Created*\nSession: \`${sessionId}\`\nProgress: 0/10\n\nOpen the session below to watch ads and track progress.`;

    await ctx.reply(msg, {
      parse_mode: "Markdown",
      reply_markup: {
        inline_keyboard: [
          [
            { text: "▶️ Open Ads", url: sessionUrl },
            { text: "🔁 Refresh Progress", callback_data: `refresh:${sessionId}` }
          ]
        ]
      }
    });
  } catch (err) {
    console.error("perform task error", e);
    await ctx.reply("❌ error creating task session");
  }
});


app.get("/ad-session/:sessionId", async (req, res) => {
  const { sessionId } = req.params;
  try {
    // check count and last validated timestamp
    const lastRow = await safeQuery(
      `SELECT COUNT(*)::int AS cnt, MAX(created_at) AS last_valid
       FROM ad_views WHERE session_id=$1 AND validated=true`,
      [sessionId]
    );
    const cnt = Number(lastRow.rows[0]?.cnt || 0);
    const lastValid = lastRow.rows[0]?.last_valid ? new Date(lastRow.rows[0].last_valid) : null;
    const now = new Date();

    // if lastValid exists and more than 2 minutes ago -> reset session ad_views
    if (lastValid && (now - lastValid) > 2 * 60 * 1000) {
      // delete previous ad_views for this session
      try {
        await safeQuery("DELETE FROM ad_views WHERE session_id=$1", [sessionId]);
        await safeQuery("UPDATE ad_sessions SET completed=false WHERE id=$1", [sessionId]);
      } catch (e) {
        console.error("reset session err", e);
      }
    }

    // get updated count after possible reset
const updatedRow = await safeQuery(
  `SELECT COUNT(*)::int AS cnt FROM ad_views WHERE session_id=$1 AND validated=true`,
  [sessionId]
);
const updatedCount = Number(updatedRow.rows[0]?.cnt || 0);

    // Serve a simple card-style HTML page with SDK, progress and an "Open Ad" button
    res.send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Ad Session</title>
  <style>
    body { font-family: system-ui, Roboto, Arial; background:#f4f6fb; padding:20px; }
    .card { max-width:720px; margin:0 auto; background:#fff; border-radius:12px; box-shadow:0 6px 20px rgba(20,20,50,0.08); padding:20px; }
    .title { font-size:20px; margin-bottom:6px; }
    .progress { font-size:18px; margin:14px 0; }
    .btn { display:inline-block; padding:10px 14px; border-radius:10px; text-decoration:none; background:#2563eb; color:#fff; font-weight:600; }
    .note { color:#6b7280; font-size:13px; margin-top:12px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="title">🎬 Watch Ads — Session</div>
    <div id="progress" class="progress">Progress: ${updatedCount}/10</div>
    <div>
      <button id="openAd" class="btn">▶️ Open Ad</button>
      <button id="refreshBtn" class="btn" style="background:#10b981; margin-left:8px;">🔄 Refresh</button>
    </div>
    <div class="note" id="noteArea">Close this page and re-open within 2 minutes to resume progress. After 2 minutes of inactivity the progress resets.</div>
  </div>

  <script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script>
  <script>
    const sessionId = '${sessionId}';
    async function refresh() {
      try {
        const r = await fetch('/api/session/' + sessionId + '/status');
        const j = await r.json();
        document.getElementById('progress').innerText = 'Progress: ' + (j.count || 0) + '/10';
        document.getElementById('noteArea').innerText = j.count >= 10 ? 'Completed — return to Telegram and submit the session.' : 'Close this page and re-open within 2 minutes to resume progress. After 2 minutes of inactivity the progress resets.';
      } catch (e) {
        document.getElementById('noteArea').innerText = 'Error getting progress';
      }
    }

    document.getElementById('openAd').addEventListener('click', function() {
      try {
        // call Monetag SDK to show an ad; include sessionId in custom for server-side validation
        show_${MONETAG_ZONE}({
          type: 'inApp',
          inAppSettings: { frequency:2, capping:0.1, interval:30, timeout:5, everyPage:false },
          custom: 'sessionId=' + sessionId
        });
      } catch (e) {
        alert('Ad SDK error: ' + e);
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

// ---------- Session status endpoint ----------
app.get("/api/session/:sessionId/status", async (req, res) => {
  const { sessionId } = req.params;
  try {
    const r = await safeQuery(
      `SELECT COUNT(*)::int AS c, MAX(created_at) AS last_valid
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


// ---------- Monetag server-side postback (validate ad events) ----------
app.post("/api/monetag/postback", express.json(), async (req, res) => {
  // Monetag will post validation events here with custom sessionId or other identifiers
  const payload = req.body || {};
  try {
    // Monetag custom may include sessionId=xxxx
    let sessionId = null;
    if (payload.custom && typeof payload.custom === "string") {
      const m = payload.custom.match(/sessionId=([a-zA-Z0-9-]+)/);
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
      "INSERT INTO ad_views (session_id, telegram_id, ad_index, validated) VALUES ($1,$2,$3,$4)",
      [sessionId, telegramId, adIndex, true]
    );
    // If 10 validated reached, optionally auto-credit (we won't auto-credit here; admin or user submit will credit)
    return res.status(200).send("ok");
  } catch (e) {
    console.error("monetag postback error", e);
    return res.status(500).send("error");
  }
});

// ---------- Submit session (user requests reward after 10 validated ads) ----------
bot.command("submit_session", async (ctx) => {
  // Usage: /submit_session <sessionId>
  const parts = (ctx.message.text || "").split(" ").filter(Boolean);
  const sessionId = parts[1];
  if (!sessionId) return ctx.reply("Usage: /submit_session <sessionId>");
  try {
    // check validated count
    const r = await safeQuery("SELECT COUNT(*) as c, telegram_id FROM ad_views JOIN ad_sessions ON ad_views.session_id = ad_sessions.id WHERE ad_views.session_id=$1 AND ad_views.validated=true GROUP BY ad_sessions.telegram_id", [sessionId]);
    const cnt = Number(r.rows[0]?.c || 0);
    const telegramId = r.rows[0]?.telegram_id;
    if (cnt < 10) return ctx.reply(`You completed ${cnt}/10 ads. Finish them before submitting.`);
    // check session completed
    const sess = await safeQuery("SELECT completed, telegram_id FROM ad_sessions WHERE id=$1", [sessionId]);
    if (!sess.rows[0]) return ctx.reply("Session not found.");
    if (sess.rows[0].completed) return ctx.reply("Reward already claimed for this session.");
    // credit reward: coins
    await pool.query("BEGIN");
    await safeQuery("UPDATE users SET coins = coins + $1 WHERE telegram_id=$2", [REWARD_PER_TASK_COINS, telegramId]);
    await safeQuery("UPDATE ad_sessions SET completed=true WHERE id=$1", [sessionId]);
    await safeQuery("INSERT INTO transactions (telegram_id, type, coins, meta) VALUES ($1,'ad_reward',$2,$3)", [telegramId, REWARD_PER_TASK_COINS, JSON.stringify({ sessionId })]);
    // referral handling (first-time credit check is simpler: no multi-level here unless you want)
    const ref = await safeQuery("SELECT referred_by, referral_credited FROM users WHERE telegram_id=$1", [telegramId]);
    if (ref.rows[0] && ref.rows[0].referred_by && !ref.rows[0].referral_credited) {
      await safeQuery("UPDATE users SET coins = coins + $1 WHERE telegram_id = $2", [REFERRAL_REWARD_COINS, ref.rows[0].referred_by]);
      await safeQuery("UPDATE users SET referral_credited = TRUE WHERE telegram_id=$1", [telegramId]);
      // notify referrer
      try { await bot.telegram.sendMessage(ref.rows[0].referred_by, `🎉 You earned ${REFERRAL_REWARD_COINS} coins from a referral!`); } catch(e){}
    }
    await pool.query("COMMIT");
    await ctx.reply(`✅ Reward credited: ${REWARD_PER_TASK_COINS} coins added to your wallet.`);
    // set next_task_available_at with random offset (20 minutes ±5min)
    const offsetSeconds = Math.floor(Math.random() * 600) - 300;
    await safeQuery("UPDATE users SET next_task_available_at = NOW() + INTERVAL '20 minutes' + ($1 || ' seconds')::interval WHERE telegram_id=$1", [offsetSeconds, telegramId]);
  } catch (e) {
    try { await pool.query("ROLLBACK"); } catch(_) {}
    console.error("submit_session error", e);
    await ctx.reply("⚠️ Error processing submission. Try again later.");
  }
});

// ---------- Withdraw flow with bank details and checks ----------
bot.hears("💸 Withdraw", async (ctx) => {
  const telegramId = ctx.from.id;
  try {
    const r = await safeQuery("SELECT coins, bank_name, bank_account_number, bank_account_name FROM users WHERE telegram_id=$1", [telegramId]);
    const user = r.rows[0];
    if (!user) return ctx.reply("⚠️ You don't have an account. Send /start.");
    const coins = Number(user.coins || 0);
    if (coins < MIN_WITHDRAW_COINS) return ctx.reply(`❌ Insufficient balance. Minimum withdrawal is ${MIN_WITHDRAW_COINS} coins (~$${coinsToUSD(MIN_WITHDRAW_COINS)}). Do more tasks to increase your balance.`);
    if (!user.bank_account_number) {
      // ask user to send bank details
      await ctx.reply("🏦 Please add your bank details in this format:\nBankName,AccountNumber,AccountName");
      // set simple state in-memory via DB-less approach: we will expect the next message matching format to be bank add
      return;
    }
    // create withdraw request
    const usd = coinsToUSD(coins);
    await safeQuery("INSERT INTO withdrawals (telegram_id, coins, usd, bank_name, account_name, account_number, status) VALUES ($1,$2,$3,$4,$5,$6,'pending')", [telegramId, coins, usd, user.bank_name, user.bank_account_name, user.bank_account_number]);
    await safeQuery("UPDATE users SET coins=0 WHERE telegram_id=$1", [telegramId]);
    await safeQuery("INSERT INTO transactions (telegram_id, type, coins, amount, meta) VALUES ($1,'withdraw_request',$2,$3,$4)", [telegramId, coins, usd, JSON.stringify({ bank: user.bank_name })]);
    await ctx.reply(`✅ Withdrawal requested: ${coins} coins (~$${usd}). Admin will review.`);
    // notify admins
    for (const aid of ADMIN_IDS) {
      try {
        await bot.telegram.sendMessage(aid, `📢 Withdrawal Request\nUser: ${telegramId}\nCoins: ${coins}\nUSD: $${usd}\nBank: ${user.bank_account_name} ${user.bank_account_number} (${user.bank_name})\nUse /pending_withdrawals to view.`);
      } catch (e) {}
    }
  } catch (e) {
    console.error("withdraw error", e);
    await ctx.reply("⚠️ Error processing withdrawal.");
  }
});

// ---------- Save bank details when user sends BankName,AccountNumber,AccountName ----------
bot.on("text", async (ctx, next) => {
  const text = (ctx.message.text || "").trim();
  const telegramId = ctx.from.id;
  // bank add pattern
  if (text.includes(",") && text.split(",").length === 3) {
    const [bankName, accountNumber, accountName] = text.split(",").map(s => s.trim());
    // simple validation accountNumber digits
    if (!/^\d+$/.test(accountNumber)) {
      return ctx.reply("⚠️ Invalid account number. Use digits only.");
    }
    try {
      // check if user has existing bank
      const r = await safeQuery("SELECT bank_account_number FROM users WHERE telegram_id=$1", [telegramId]);
      if (r.rows[0] && r.rows[0].bank_account_number) {
        // this is a bank change request — require old|new? we implemented change flow via Change Bank option below
        await safeQuery("UPDATE users SET bank_name=$1, bank_account_number=$2, bank_account_name=$3 WHERE telegram_id=$4", [bankName, accountNumber, accountName, telegramId]);
        await ctx.reply("✅ Bank account updated successfully.");
        return;
      } else {
        // first time add
        await safeQuery("UPDATE users SET bank_name=$1, bank_account_number=$2, bank_account_name=$3 WHERE telegram_id=$4", [bankName, accountNumber, accountName, telegramId]);
        await ctx.reply("✅ Bank account saved. You can now request withdrawals.");
        return;
      }
    } catch (e) {
      console.error("save bank err", e);
      return ctx.reply("⚠️ Error saving bank details.");
    }
  }

  // Accept multiple label variants for Refer
bot.hears(["👥 Refer & Earn", "Refer & Earn", "Refer and Earn", "Refer"], async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || telegramId;
  const link = `https://t.me/${ctx.botInfo.username}?start=${telegramId}`;
  await ctx.reply(
    `👥 *Refer & Earn*\nShare your link and earn ${REFERRAL_REWARD_COINS} coins when someone signs up using your link:\n\n${link}`,
    { parse_mode: "Markdown", reply_markup: mainMenuKeyboard() }
  );
});


bot.hears(["🏦 Change Bank", "Change Bank", "Change bank"], async (ctx) => {
  await ctx.reply(
    "To change bank account, send the details in this format:\n\noldBank,oldAccNumber,oldName|newBank,newAccNumber,newName\n\nOr send new details if you don't have a previous one: BankName,AccountNumber,AccountName",
    { reply_markup: mainMenuKeyboard() }
  );
});


  // ---------- Change bank flow: old|new format ----------
  if (text.includes("|") && text.split("|").length === 2 && text.split("|")[0].includes(",") && text.split("|")[1].includes(",")) {
    // oldBank,oldAcc,oldName|newBank,newAcc,newName
    const [oldStr, newStr] = text.split("|").map(s => s.trim());
    const [oldBank, oldAcc, oldName] = oldStr.split(",").map(s => s.trim());
    const [newBank, newAcc, newName] = newStr.split(",").map(s => s.trim());
    try {
      const r = await safeQuery("SELECT bank_name, bank_account_number FROM users WHERE telegram_id=$1", [telegramId]);
      const user = r.rows[0];
      if (!user || !user.bank_account_number) {
        return ctx.reply("⚠️ No existing bank on record. Use BankName,AccountNumber,AccountName to add first.");
      }
      if ((user.bank_name || "").toLowerCase() !== (oldBank || "").toLowerCase() || (user.bank_account_number || "") !== (oldAcc || "")) {
        return ctx.reply("🚫 Old bank details do not match our records. New account not updated.");
      }
      await safeQuery("UPDATE users SET bank_name=$1, bank_account_number=$2, bank_account_name=$3 WHERE telegram_id=$4", [newBank, newAcc, newName || user.bank_account_name, telegramId]);
      return ctx.reply("✅ Bank account changed successfully.");
    } catch (e) {
      console.error("change bank err", e);
      return ctx.reply("⚠️ Error changing bank details.");
    }
  }
  // If not matched, pass to next() so other handlers can process (e.g., unknown command)
  return next();
});

// ---------- Get Help ----------
bot.hears("🆘 Get Help", async (ctx) => {
  try {
    await ctx.reply(
      "🆘 *Need assistance?* Choose a help category below:",
      {
        parse_mode: "Markdown",
        reply_markup: {
          keyboard: [
            ["💵 Withdraw Issue", "🧩 Task Issue"],
            ["💳 Bank/Account Issue", "🗣 Other"],
            ["🔙 Back to Menu"],
          ],
          resize_keyboard: true,
        },
      }
    );
  } catch (e) {
    console.error("Get help menu error:", e);
  }
});

// ---------- Help Category Handlers ----------
bot.hears(["💵 Withdraw Issue", "🧩 Task Issue", "💳 Bank/Account Issue"], async (ctx) => {
  const topic = ctx.message.text;
  ctx.session = ctx.session || {};
  ctx.session.awaitingHelpMessage = topic;

  await ctx.reply(
    `✅ You selected *${topic}*\nPlease describe your issue briefly below 👇`,
    { parse_mode: "Markdown" }
  );
});

// ---------- Other / Chat with Admin ----------
bot.hears("🗣 Other", async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.awaitingHelpMessage = "Other";

  await ctx.reply(
    "✍️ Please type your message for the admin.\n💬 Our support team will respond shortly after receiving it."
  );
});

bot.hears("🔙 Back to Menu", async (ctx) => {
  const adminList = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim());

  const isAdmin = adminList.includes(String(ctx.from.id));

  const keyboard = [
    ["💼 Wallet Balance", "🎥 Perform Task"],
    ["💸 Withdraw", "👥 Refer & Earn"],
    ["🏦 Change Bank", "🆘 Get Help"],
  ];

  // Add admin panel button ONLY for admins
  if (isAdmin) {
    keyboard.push(["🛠 Admin Panel"]);
  }

  await ctx.reply("🏠 *Main Menu*\nSelect an option:", {
    parse_mode: "Markdown",
    reply_markup: {
      keyboard,
      resize_keyboard: true,
    },
  });
});


// ---------- Capture Help Message and Notify Admin ----------
bot.on("text", async (ctx) => {
  const telegramId = ctx.from.id;
  const username = ctx.from.username || ctx.from.first_name || "User";
  const text = ctx.message.text;

  // Ignore standard menu buttons
  const ALLOWED_TEXTS = new Set([
    "💼 Wallet Balance",
    "🎥 Perform Task",
    "💸 Withdraw",
    "👥 Refer & Earn",
    "🏦 Change Bank",
    "🆘 Get Help",
    "Done",
    "Submit",
    "🔙 Back to Menu",
    "💵 Withdraw Issue",
    "🧩 Task Issue",
    "💳 Bank/Account Issue",
    "🗣 Other",
  ]);
  if (ALLOWED_TEXTS.has(text)) return;

  if (ctx.session && ctx.session.awaitingHelpMessage) {
    const category = ctx.session.awaitingHelpMessage;
    ctx.session.awaitingHelpMessage = null;

    // Confirmation message to user
    await ctx.reply(
      "✅ Your message has been sent to admin.\nPlease wait while our support team reviews and responds shortly."
    );

    // Notify admin(s)
    const admins = (process.env.ADMIN_TELEGRAM_ID || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);

    for (const adminId of admins) {
      try {
        await bot.telegram.sendMessage(
          adminId,
          `📩 *New Help Request*\n\n👤 From: ${username} (ID: ${telegramId})\n📂 Category: ${category}\n💬 Message:\n${text}\n\nReply directly with:\n/reply ${telegramId} <your message>`,
          { parse_mode: "Markdown" }
        );
      } catch (err) {
        console.error("Failed to notify admin:", err.message);
      }
    }
  }
});

// ---------- Admin Reply Command ----------
bot.command("reply", async (ctx) => {
  try {
    const parts = ctx.message.text.split(" ");
    if (parts.length < 3)
      return ctx.reply("Usage: /reply <user_id> <message>");

    const userId = parts[1];
    const message = parts.slice(2).join(" ");

    console.log(`Attempting to send message to user ${userId}`);

    try {
      await bot.telegram.sendMessage(
        userId,
        `📩 *Admin Reply:*\n${message}`,
        { parse_mode: "Markdown" }
      );
      await ctx.reply(`✅ Message sent to user ${userId} successfully.`);
    } catch (err) {
      console.error("Reply error:", err);

      // handle specific Telegram restrictions
      if (err.description?.includes("bot was blocked by the user")) {
        await ctx.reply("⚠️ Cannot deliver: user has blocked the bot.");
      } else if (err.description?.includes("chat not found")) {
        await ctx.reply("⚠️ Cannot deliver: user has not started the bot yet.");
      } else {
        await ctx.reply("⚠️ Failed to send message to user.");
      }
    }
  } catch (e) {
    console.error("Reply command crash:", e);
    await ctx.reply("⚠️ Unexpected error while sending reply.");
  }
});

// ---------- ADMIN PANEL (Using reply keyboard) ----------
bot.hears("/admin", async (ctx) => {
  const adminList = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim());

  if (!adminList.includes(String(ctx.from.id))) {
    return ctx.reply("❌ You are not authorized to access the admin panel.");
  }

  const text = `
🛠️ *FonPay Task-Earnings Admin Panel*

Welcome, *Admin* 👑  
Manage system settings and monitor platform activities.

Choose an option below:
`;

  await ctx.replyWithPhoto(
    { url: "https://i.ibb.co/4d1w2kD/fonpay-logo.png" },
    {
      caption: text,
      parse_mode: "Markdown",
      reply_markup: {
        keyboard: [
          ["🟢 Enable Perform Task", "🔴 Disable Perform Task"],
          ["📢 Broadcast Message", "📊 View Stats"],
          ["🚫 Ban User", "✅ Unban User"],
          ["🔙 Back to Menu"],
        ],
        resize_keyboard: true,
      },
    }
  );
});

// Enable Perform Task
bot.hears("🟢 Enable Perform Task", async (ctx) => {
  await setSetting("perform_task_enabled", "on");
  await ctx.reply("✅ Perform Task feature has been ENABLED.");
});

// Disable Perform Task
bot.hears("🔴 Disable Perform Task", async (ctx) => {
  await setSetting("perform_task_enabled", "off");
  await ctx.reply("🚫 Perform Task feature has been DISABLED.");
});

// Broadcast Message
bot.hears("📢 Broadcast Message", async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.awaitingBroadcast = true;
  await ctx.reply("📢 Send the message to broadcast to all users.");
});

// Ban User
bot.hears("🚫 Ban User", async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.awaitingBan = true;
  await ctx.reply("🚫 Send the Telegram ID of the user you want to ban.");
});

// Unban User
bot.hears("✅ Unban User", async (ctx) => {
  ctx.session = ctx.session || {};
  ctx.session.awaitingUnban = true;
  await ctx.reply("✅ Send the Telegram ID to unban.");
});

// View Stats
bot.hears("📊 View Stats", async (ctx) => {
  const users = await safeQuery("SELECT COUNT(*) FROM users");
  const views = await safeQuery("SELECT COUNT(*) FROM ad_views");

  await ctx.replyWithMarkdown(
    `📊 *Platform Stats:*\n\n👥 Users: ${users.rows[0].count}\n🎥 Ad Views: ${views.rows[0].count}`
  );
});

// ---------- Admin: list pending withdrawals ----------
bot.command("pending_withdrawals", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ You are not authorized.");
  try {
    const r = await safeQuery("SELECT id, telegram_id, coins, usd, bank_name, account_name, account_number, status FROM withdrawals WHERE status='pending' ORDER BY requested_at DESC");
    if (r.rows.length === 0) return ctx.reply("No pending withdrawals.");
    let msg = "📥 Pending Withdrawals:\n\n";
    for (const w of r.rows) {
      msg += `ID:${w.id} User:${w.telegram_id} Coins:${w.coins} USD:${w.usd} Bank:${w.bank_name} ${w.account_number}\n\n`;
    }
    await ctx.reply(msg);
  } catch (e) {
    console.error("pending_withdrawals err", e);
    await ctx.reply("Error fetching pending withdrawals.");
  }
});

// ---------- Admin approve/decline ----------
bot.command("approve_withdraw", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ You are not authorized.");
  const parts = (ctx.message.text || "").split(" ").filter(Boolean);
  const id = parts[1];
  if (!id) return ctx.reply("Usage: /approve_withdraw <withdrawal_id>");
  try {
    const r = await safeQuery("UPDATE withdrawals SET status='paid', processed_at=NOW() WHERE id=$1 AND status='pending' RETURNING *", [id]);
    if (r.rowCount === 0) return ctx.reply("Withdrawal not found or already processed.");
    const w = r.rows[0];
    await safeQuery("INSERT INTO transactions (telegram_id, type, coins, amount, meta) VALUES ($1,'withdraw_paid',$2,$3,$4)", [w.telegram_id, w.coins, w.usd, JSON.stringify({ withdrawalId: id })]);
    try { await bot.telegram.sendMessage(w.telegram_id, `✅ Your withdrawal #${id} of ${w.coins} coins (~$${w.usd}) has been approved and paid.`); } catch (e) {}
    return ctx.reply(`✅ Withdrawal ${id} marked as paid.`);
  } catch (e) {
    console.error("approve withdraw err", e);
    return ctx.reply("Error approving withdrawal.");
  }
});

bot.command("decline_withdraw", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ You are not authorized.");
  const parts = (ctx.message.text || "").split(" ").filter(Boolean);
  const id = parts[1];
  const reason = parts.slice(2).join(" ") || "No reason provided";
  if (!id) return ctx.reply("Usage: /decline_withdraw <withdrawal_id> <reason>");
  try {
    const r = await safeQuery("UPDATE withdrawals SET status='declined', admin_note=$1, processed_at=NOW() WHERE id=$2 AND status='pending' RETURNING *", [reason, id]);
    if (r.rowCount === 0) return ctx.reply("Withdrawal not found or already processed.");
    const w = r.rows[0];
    // refund coins to user
    await safeQuery("UPDATE users SET coins = coins + $1 WHERE telegram_id=$2", [w.coins, w.telegram_id]);
    await safeQuery("INSERT INTO transactions (telegram_id, type, coins, meta) VALUES ($1,'withdraw_declined',$2,$3)", [w.telegram_id, w.coins, JSON.stringify({ withdrawalId: id, reason })]);
    try { await bot.telegram.sendMessage(w.telegram_id, `❌ Your withdrawal #${id} was declined. Reason: ${reason}`); } catch (e) {}
    return ctx.reply(`✅ Withdrawal ${id} declined and coins refunded to user.`);
  } catch (e) {
    console.error("decline withdraw err", e);
    return ctx.reply("Error declining withdrawal.");
  }
});

// ---------- Admin: export withdrawals CSV ----------
bot.command("export_withdrawals", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ You are not authorized.");
  try {
    const r = await safeQuery("SELECT * FROM withdrawals ORDER BY requested_at DESC");
    // build CSV
    const header = Object.keys(r.rows[0] || {}).join(",");
    const lines = [header];
    for (const row of r.rows) lines.push(Object.values(row).join(","));
    const csv = lines.join("\n");
    await ctx.replyWithDocument({ source: Buffer.from(csv, "utf8"), filename: "withdrawals.csv" });
  } catch (e) {
    console.error("export err", e);
    await ctx.reply("Error exporting withdrawals.");
  }
});

// ---------- Transactions last 7 days for a user ----------
bot.command("transactions", async (ctx) => {
  if (!isAdmin(ctx.from.id)) return ctx.reply("❌ You are not authorized.");
  const parts = (ctx.message.text || "").split(" ").filter(Boolean);
  const target = parts[1];
  if (!target) return ctx.reply("Usage: /transactions <telegram_id>");
  try {
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const ads = await safeQuery("SELECT * FROM ad_views WHERE telegram_id=$1 AND created_at >= $2 ORDER BY created_at DESC LIMIT 200", [target, since]);
    const w = await safeQuery("SELECT * FROM withdrawals WHERE telegram_id=$1 AND requested_at >= $2 ORDER BY requested_at DESC LIMIT 50", [target, since]);
    let msg = `Transactions for ${target} (7 days)\n\nAds watched: ${ads.rowCount}\nWithdrawals: ${w.rowCount}\n\nRecent withdrawals:\n`;
    for (const row of w.rows) msg += `${row.id} - ${row.status} - ${row.coins} coins - ${row.requested_at}\n`;
    await ctx.reply(msg);
  } catch (e) {
    console.error("transactions err", e);
    await ctx.reply("Error fetching transactions.");
  }
});

// ---------- Invalid text handler: restrict to allowed texts or commands ----------
bot.on("text", async (ctx) => {
  const text = (ctx.message.text || "").trim();
  const isCommand = text.startsWith("/");
  const allowed = ALLOWED_TEXTS.has(text) || isCommand;
  if (!allowed) {
    return ctx.reply("❌ Invalid text. Please use the menu buttons or valid commands. Use /menu to see options.", mainMenuKeyboard());
  }
  // otherwise ignore (other handlers earlier may have processed)
});

// ---------- Express & Health ----------
app.get("/", (req, res) => res.send("FonPay Task-Earnings Bot is running."));
app.get("/health", (req, res) => res.send("OK"));

// ... earlier handlers like:
/*
bot.hears("🎥 Perform Task", ...)
bot.hears("💳 Withdraw", ...)
bot.hears("💬 Get Help", ...)
etc...
*/
bot.command("admin", async (ctx) => {
  const telegramId = String(ctx.from.id);
  if (!ADMIN_IDS.includes(telegramId)) return ctx.reply("❌ You are not authorized.");
  await ctx.reply("Admin panel:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "View Pending Withdrawals", callback_data: "admin:pending_withdrawals" }],
        [{ text: "Export Withdrawals", callback_data: "admin:export_withdrawals" }],
        [{ text: "View Recent Users", callback_data: "admin:recent_users" }]
      ]
    }
  });
});

bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery.data || "";
  const fromId = ctx.from.id;
  try {
    if (data.startsWith("help:")) {
      const topic = data.split(":")[1] || "other";
      // Save request to DB
      await safeQuery(
        "INSERT INTO support_requests (telegram_id, help_topic, message) VALUES ($1,$2,$3)",
        [fromId, topic, "User selected quick help topic: " + topic]
      );

      // Notify admins
      for (const aid of ADMIN_IDS) {
        try {
          await bot.telegram.sendMessage(
            aid,
            `🆘 Support request\nUser: ${fromId}\nTopic: ${topic}\nUse /startchat ${fromId} to begin chat.`
          );
        } catch (e) {}
      }

      // Acknowledge user
      await ctx.answerCbQuery(); // remove loader
      await ctx.reply(
        "✅ Complaint received. An agent will get back to you shortly. You can also contact us on WhatsApp if urgent."
      );
      return;
    }

    // Handle refresh buttons etc
    if (data.startsWith("refresh:")) {
      const sessionId = data.split(":")[1];
      await ctx.answerCbQuery("Progress refreshed — open session page to see updates.");
      return;
    }
  } catch (e) {
    console.error("callback err", e);
    try {
      await ctx.answerCbQuery("Error processing your request");
    } catch (e2) {}
  }
});

      // Admin menu Activate 
bot.hears("🛠 Admin Panel", async (ctx) => {
  const adminList = (process.env.ADMIN_TELEGRAM_ID || "")
    .split(",")
    .map((x) => x.trim());

  if (!adminList.includes(String(ctx.from.id))) {
    return ctx.reply("❌ You are not authorized to access the admin panel.");
  }

  // Trigger the admin panel (same as /admin)
  return bot.emit("text", { ...ctx.update, message: { ...ctx.message, text: "/admin" } });
});

// Start the bot and server safely

async function startBot() {
  try {
    // Start express server only once
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });

    // Webhook configuration for Render (use BASE_URL)
    const webhookUrl = `${process.env.BASE_URL}/bot${process.env.TELEGRAM_BOT_TOKEN}`;
    await bot.telegram.setWebhook(webhookUrl);
    app.use(bot.webhookCallback(`/bot${process.env.TELEGRAM_BOT_TOKEN}`));

    console.log(`🚀 Bot running in webhook mode at: ${webhookUrl}`);
  } catch (err) {
    console.error("Bot launch error:", err);
  }
}

startBot();

// Graceful shutdown
process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

                                                                                                                                                                
