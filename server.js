
// Task Earnings Bot — Monetag Integration Scaffold
import express from 'express';
import { Pool } from 'pg';
const app = express();
const db = new Pool({ connectionString: process.env.DATABASE_URL });

app.use(express.json());

// --- Monetag Postback Route ---
app.post('/api/monetag/postback', async (req, res) => {
  const payload = req.body;
  console.log('Monetag Postback:', payload);

  try {
    if (String(payload.zone) !== String(process.env.MONETAG_ZONE)) {
      console.warn('Zone mismatch');
      return res.status(400).send('zone mismatch');
    }

    let taskId = null;
    let userId = null;
    if (payload.custom) {
      const parts = String(payload.custom).split(/[;,&]/);
      for (const p of parts) {
        if (p.includes('=')) {
          const [k, v] = p.split('=');
          if (k === 'taskId') taskId = v;
          if (k === 'userId') userId = v;
        }
      }
    }

    if (!taskId || !userId) {
      console.log('Missing identifiers');
      return res.status(200).send('ignored');
    }

    const monetagEventId = payload.event_id || payload.transaction_id || null;
    if (monetagEventId) {
      const exists = await db.query(`SELECT 1 FROM ad_watches WHERE monetag_receipt=$1`, [monetagEventId]);
      if (exists.rowCount > 0) return res.status(200).send('duplicate');
    }

    await db.query('BEGIN');
    try {
      await db.query(
        `INSERT INTO ad_watches (user_id, task_id, validated, monetag_receipt)
         VALUES ($1,$2,true,$3)`,
        [userId, taskId, monetagEventId]
      );
      await db.query(`UPDATE tasks SET ads_watched_count=ads_watched_count+1 WHERE id=$1`, [taskId]);
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    const { rows } = await db.query(`SELECT ads_watched_count, status, user_id FROM tasks WHERE id=$1`, [taskId]);
    if (rows[0] && rows[0].ads_watched_count >= 10 && rows[0].status !== 'completed') {
      const reward = parseInt(process.env.REWARD_PER_TASK || '200', 10);
      await db.query('BEGIN');
      try {
        await db.query(`UPDATE tasks SET status='completed' WHERE id=$1`, [taskId]);
        await db.query(`UPDATE users SET wallet_coins=wallet_coins+$1 WHERE id=$2`, [reward, userId]);
        await db.query('COMMIT');
        console.log(`Task ${taskId} completed for user ${userId}, +${reward} coins.`);
      } catch (e) {
        await db.query('ROLLBACK');
        throw e;
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Postback error', err);
    res.status(500).send('error');
  }
});

// --- Monetag Ad Webview Page ---
app.get('/ad/:taskId', (req, res) => {
  const { taskId } = req.params;
  const userId = req.query.userId || 'unknown';
  res.send(`<!doctype html>
<html><head><title>Watch Ads — Earn</title></head>
<body>
<h3>Watch ads to earn 200 coins</h3>
<script src='//libtl.com/sdk.js' data-zone='10136395
' data-sdk='show_10136395
'></script>
<script>
const TASK_ID = '${taskId}';
const USER_ID = '${userId}';
show_10136395
({
  type: 'inApp',
  inAppSettings: { frequency: 2, capping: 0.1, interval: 30, timeout: 5, everyPage: false }
});
fetch('/api/task/session-start', {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({taskId:TASK_ID,userId:USER_ID})});
</script>
</body></html>`);
});

// --- Telegram webhook handler ---
// Requires: axios and process.env.TELEGRAM_BOT_TOKEN set
import axios from "axios";

const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TG_TOKEN) {
  console.warn("WARNING: TELEGRAM_BOT_TOKEN not set in env");
}
const TG_API = `https://api.telegram.org/bot${TG_TOKEN}`;

async function sendTelegram(chatId, text, extra = {}) {
  try {
    await axios.post(`${TG_API}/sendMessage`, {
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      ...extra
    });
  } catch (e) {
    console.error("Failed to send Telegram message", e?.response?.data || e.message);
  }
}

// Basic command handler
app.post("/telegram/webhook", async (req, res) => {
  try {
    const update = req.body;
    // Accept message or callback_query
    const message = update.message || (update.callback_query && update.callback_query.message);
    if (!message) {
      res.status(200).send("no message");
      return;
    }
    const chatId = message.chat.id;
    const text = (message.text || "").trim();
    const from = message.from || {};
    const userId = from.id;

    console.log("Telegram update:", { chatId, userId, text });

    // Parse commands
    const parts = text.split(" ").filter(Boolean);
    const command = parts[0]?.toLowerCase();

    // Helper: Reply keyboard (inline) example
    const mainMenuKeyboard = {
      reply_markup: {
        inline_keyboard: [
          [{ text: "🎯 Perform Task", callback_data: "TASK" }],
          [{ text: "💰 Withdraw", callback_data: "WITHDRAW" }, { text: "👥 Referral", callback_data: "REFERRAL" }],
          [{ text: "📊 Balance", callback_data: "BALANCE" }, { text: "ℹ️ Help", callback_data: "HELP" }]
        ]
      }
    };

    // Admin ID check
    const ADMIN_ID = String(process.env.ADMIN_TELEGRAM_ID || "");

    // Simple command handling
    if (command === "/start") {
      await sendTelegram(chatId, `Welcome! Use /help to see commands.\n\nClick the menu:`, mainMenuKeyboard);
    } else if (command === "/help") {
      const helpText = [
        "<b>Available Commands</b>",
        "/start - Start bot & show menu",
        "/help - Show this help",
        "/task - Open task dashboard",
        "/balance - Show your coins balance",
        "/withdraw - Request withdrawal",
        "/referral - Show referral link",
        "/history - Recent activity",
      ].join("\n");
      await sendTelegram(chatId, helpText);
    } else if (command === "/task") {
      // Placeholder: in production call your API to get task availability
      await sendTelegram(chatId, "Open the task dashboard: https://" + (process.env.BASE_URL || req.headers.host) + `/ad/TEST_TASK?userId=${userId}`, { disable_web_page_preview: true });
    } else if (command === "/balance") {
      // Example: query DB for user balance (replace with real query)
      try {
        const { rows } = await db.query("SELECT wallet_coins FROM users WHERE telegram_id=$1", [userId]);
        const balance = rows[0] ? Number(rows[0].wallet_coins) : 0;
        const rate = Number(process.env.COIN_TO_USD_RATE || 0.00005);
        const usd = (balance * rate).toFixed(4);
        await sendTelegram(chatId, `Your balance: ${balance} coins (≈ $${usd})`);
      } catch (e) {
        console.error("Balance lookup error", e);
        await sendTelegram(chatId, "Unable to fetch balance right now. Try again later.");
      }
    } else if (command === "/withdraw") {
      await sendTelegram(chatId, "To request withdrawal, reply with `/withdraw <coins> <bank_name> <account_number> <account_name>`\nExample:\n/withdraw 60000 Moniepoint 0123456789 \"John Doe\"");
    } else if (command === "/referral") {
      // Generate referral link using telegram id
      const base = process.env.BASE_URL ? process.env.BASE_URL.replace(/https?:\/\//, "") : req.headers.host;
      const link = `https://${base}/r/${userId}`;
      await sendTelegram(chatId, `Share this link to invite friends and earn 50 coins:\n${link}`, { disable_web_page_preview: true });
    } else if (command === "/history") {
      // Placeholder: query recent tasks / withdrawals
      await sendTelegram(chatId, "Recent activity:\n1) Task +200 coins\n2) Withdrawal pending");
    } else if (command && command.startsWith("/approve") && String(userId) === ADMIN_ID) {
      // Admin example: /approve <withdrawal_id>
      await sendTelegram(chatId, "Approval command received (admin).");
    } else {
      // Unknown command — show menu
      await sendTelegram(chatId, "Unknown command. Use /help or tap the menu below.", mainMenuKeyboard);
    }

    res.status(200).send("ok");
  } catch (err) {
    console.error("Telegram webhook error:", err);
    res.status(500).send("error");
  }
});

// --- Start Server ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
