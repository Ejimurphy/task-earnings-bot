import express from 'express';
import fetch from 'node-fetch';
import { Pool } from 'pg';

const app = express();
app.use(express.json());

const db = new Pool({ connectionString: process.env.DATABASE_URL || '' });

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;
const MONETAG_ZONE = process.env.MONETAG_ZONE || '10136395';

// Admin IDs: comma-separated in env, or defaults
const ADMIN_IDS = (process.env.ADMIN_TELEGRAM_IDS || '5236441213,5725566044').split(',').map(s=>s.trim()).filter(Boolean).map(s=>Number(s));

// Simple helper to send messages
async function sendMessage(chatId, text, extra = {}){
  const body = { chat_id: chatId, text, ...extra, parse_mode: 'HTML' };
  await fetch(`${TELEGRAM_API}/sendMessage`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
}

// Helper to answer callback_query
async function answerCallback(callbackQueryId, text=''){
  await fetch(`${TELEGRAM_API}/answerCallbackQuery`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ callback_query_id: callbackQueryId, text, show_alert:false }) });
}

// Build main user keyboard (inline)
function userMainKeyboard(){
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '🎯 Perform Task', callback_data: 'perform_task' }, { text: '💰 Withdraw', callback_data: 'withdraw' }],
        [{ text: '👥 Referral', callback_data: 'referral' }, { text: '📊 Balance', callback_data: 'balance' }],
        [{ text: '⚙️ Help', callback_data: 'help' }]
      ]
    }
  };
}

// Admin keyboard (only for admins)
function adminKeyboard(){
  return {
    reply_markup: {
      inline_keyboard: [
        [{ text: '👥 View Users', callback_data: 'admin_view_users' }],
        [{ text: '💸 Withdrawals', callback_data: 'admin_withdrawals' }],
        [{ text: '🧾 Export', callback_data: 'admin_export' }],
        [{ text: '🔒 Ban User', callback_data: 'admin_ban' }]
      ]
    }
  };
}

// Telegram webhook endpoint: set your webhook to https://<YOUR_URL>/telegram/webhook
app.post('/telegram/webhook', async (req, res) => {
  const update = req.body;

  try {
    // Handle messages
    if (update.message) {
      const msg = update.message;
      const chatId = msg.chat.id;
      const fromId = msg.from.id;
      const text = msg.text || '';

      if (text.startsWith('/start')) {
        const welcome = `Welcome to Task Earnings Bot!\nUse the buttons below to interact.`;
        // send keyboard (if admin, include admin button)
        if (ADMIN_IDS.includes(fromId)) {
          await fetch(`${TELEGRAM_API}/sendMessage`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text: welcome, reply_markup: adminKeyboard().reply_markup }) });
        } else {
          await fetch(`${TELEGRAM_API}/sendMessage`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text: welcome, ...userMainKeyboard() }) });
        }
      } else if (text === '/help') {
        await sendMessage(chatId, 'Help: Use the inline buttons to perform tasks, withdraw and invite friends.');
      } else if (text === '/admin') {
        if (!ADMIN_IDS.includes(fromId)) {
          await sendMessage(chatId, '🚫 Access Denied: You are not authorized to view the admin panel.');
        } else {
          await fetch(`${TELEGRAM_API}/sendMessage`, { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ chat_id: chatId, text: 'Admin Panel', ...adminKeyboard() }) });
        }
      } else {
        await sendMessage(chatId, 'Unknown command. Use /help or the buttons below.', userMainKeyboard());
      }
    }

    // Handle callback queries (inline buttons)
    if (update.callback_query) {
      const cb = update.callback_query;
      const data = cb.data;
      const fromId = cb.from.id;
      const chatId = cb.message.chat.id;

      // User actions
      if (data === 'perform_task') {
        // Here you would check DB if task is available; for demo we open ad page link
        const adUrl = `${process.env.BASE_URL || ''}/ad/demo_task?userId=${fromId}`;
        await answerCallback(cb.id, 'Opening ad session...');
        await sendMessage(chatId, `Click to watch ads: ${adUrl}`);
      } else if (data === 'withdraw') {
        await answerCallback(cb.id, 'Withdraw selected');
        await sendMessage(chatId, 'To request a withdrawal, reply with /withdraw');
      } else if (data === 'referral') {
        await answerCallback(cb.id, 'Referral info');
        const refLink = `${process.env.BASE_URL || ''}/r/${fromId}`;
        await sendMessage(chatId, `Share this link to invite: ${refLink}`);
      } else if (data === 'balance') {
        await answerCallback(cb.id, 'Balance');
        // Fetch balance from DB (demo shows placeholder)
        const res = await db.query('SELECT wallet_coins FROM users WHERE telegram_id=$1', [fromId]);
        const coins = (res.rows[0] && res.rows[0].wallet_coins) || 0;
        await sendMessage(chatId, `Your balance: ${coins} coins`);
      } else if (data === 'help') {
        await answerCallback(cb.id, 'Help');
        await sendMessage(chatId, 'Help: Use the buttons to navigate.');
      }

      // Admin actions (require admin check)
      else if (data.startsWith('admin_')) {
        if (!ADMIN_IDS.includes(fromId)) {
          await answerCallback(cb.id, 'Access denied');
          await sendMessage(chatId, '🚫 Access Denied: Admins only.');
        } else {
          if (data === 'admin_view_users') {
            await answerCallback(cb.id, 'Fetching users...');
            const users = await db.query('SELECT telegram_id, wallet_coins FROM users ORDER BY created_at DESC LIMIT 50');
            const lines = users.rows.map(u => `@${u.telegram_id} — ${u.wallet_coins} coins`).join('\n') || 'No users';
            await sendMessage(chatId, `<b>Users</b>\n${lines}`);
          } else if (data === 'admin_withdrawals') {
            await answerCallback(cb.id, 'Withdrawals');
            const w = await db.query('SELECT id, user_id, coins_requested, status FROM withdrawals WHERE status=$1', ['pending']);
            const lines = w.rows.map(r => `ID:${r.id} user:${r.user_id} coins:${r.coins_requested}`).join('\n') || 'No pending';
            await sendMessage(chatId, `<b>Pending Withdrawals</b>\n${lines}`);
          } else if (data === 'admin_export') {
            await answerCallback(cb.id, 'Exporting...');
            await sendMessage(chatId, 'Export created. (Use the admin web panel to download)');
          } else if (data === 'admin_ban') {
            await answerCallback(cb.id, 'Ban user');
            await sendMessage(chatId, 'Reply with /ban <telegram_id> to ban a user.');
          }
        }
      } else {
        await answerCallback(cb.id, 'Unknown action');
      }
    }

    res.status(200).send('ok');
  } catch (err) {
    console.error('Webhook error', err);
    res.status(500).send('err');
  }
});

// Monetag postback route (same as before)
app.post('/api/monetag/postback', async (req, res) => {
  console.log('Monetag payload', req.body);
  res.status(200).send('ok');
});

// Ad page for demo
app.get('/ad/:taskId', (req, res) => {
  const { taskId } = req.params;
  const userId = req.query.userId || 'unknown';
  res.send(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Watch Ads</title></head><body><h3>Watch ads to earn 200 coins</h3><script src='//libtl.com/sdk.js' data-zone='${MONETAG_ZONE}' data-sdk='show_${MONETAG_ZONE}'></script><script>const TASK_ID='${taskId}';const USER_ID='${userId}';show_${MONETAG_ZONE}({type:'inApp',inAppSettings:{frequency:2,capping:0.1,interval:30,timeout:5,everyPage:false}});fetch('/api/task/session-start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({taskId:TASK_ID,userId:USER_ID})});</script></body></html>`);
});

// Simple root
app.get('/', (req, res) => res.send('✅ Task Earnings Bot API Running Successfully!'));

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
