import express from "express";
import dotenv from "dotenv";
import { Telegraf, Markup } from "telegraf";
import db from "./src/db.js";
import { handleMonetagPostback } from "./src/monetag.js";
import { getUser, startTaskSession, completeAdView } from "./src/utils.js";

dotenv.config();

const app = express();
app.use(express.json());

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

// ---- Inline keyboards ----
const userKeyboard = (userId) =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🎬 Perform Task", `perform_${userId}`)],
    [Markup.button.callback("💰 Wallet Balance", `wallet_${userId}`)],
    [Markup.button.callback("👫 Invite Friends", `invite_${userId}`)],
    [Markup.button.callback("💸 Withdraw", `withdraw_${userId}`)]
  ]);

const adminKeyboard = Markup.inlineKeyboard([
  [Markup.button.callback("📊 View Users", "admin_users")],
  [Markup.button.callback("💳 View Withdrawals", "admin_withdrawals")],
  [Markup.button.callback("📤 Broadcast Message", "admin_broadcast")]
]);

// ---- User Start ----
bot.start(async (ctx) => {
  const userId = ctx.from.id;
  await db.query(
    "INSERT INTO users (telegram_id, wallet_coins) VALUES ($1, $2) ON CONFLICT (telegram_id) DO NOTHING",
    [userId, 0]
  );
  ctx.reply(
    `👋 Welcome ${ctx.from.first_name}!\n\nEarn by watching ads every 20 minutes.\n\n💰 200 coins per completed task!`,
    userKeyboard(userId)
  );
});

// ---- Inline button handlers ----
bot.on("callback_query", async (ctx) => {
  const data = ctx.callbackQuery.data;
  const userId = ctx.from.id;

  if (data.startsWith("perform_")) {
    const sessionId = await startTaskSession(userId);
    const adLink = `${process.env.BASE_URL}/ad-session/${sessionId}`;
    await ctx.reply(
      `🎬 Click below to watch your 10 ads:\n\nProgress will update automatically.`,
      Markup.inlineKeyboard([[Markup.button.url("▶️ Open Ad Viewer", adLink)]])
    );
  } else if (data.startsWith("wallet_")) {
    const user = await getUser(userId);
    ctx.reply(`💰 Your balance: ${user.wallet_coins} coins`);
  } else if (data.startsWith("invite_")) {
    const refLink = `https://t.me/${ctx.botInfo.username}?start=${userId}`;
    ctx.reply(`👫 Invite friends with this link:\n${refLink}`);
  } else if (data.startsWith("withdraw_")) {
    ctx.reply("💸 Send your bank details (Bank, Account Number, Name).");
  } else if (data.startsWith("admin_")) {
    const adminIds = process.env.ADMIN_TELEGRAM_IDS.split(",");
    if (!adminIds.includes(userId.toString())) {
      return ctx.reply("⛔ Unauthorized access.");
    }
    if (data === "admin_users") ctx.reply("📊 Users data coming soon...");
    if (data === "admin_withdrawals") ctx.reply("💳 Withdrawal requests...");
    if (data === "admin_broadcast") ctx.reply("📤 Send broadcast message now.");
  }
  ctx.answerCbQuery();
});

// ---- Monetag Ad Progress API ----
app.post("/api/monetag/postback", handleMonetagPostback);

// ---- Ad viewer ----
app.get("/ad-session/:sessionId", (req, res) => {
  const { sessionId } = req.params;
  res.send(`
<!DOCTYPE html>
<html>
<head>
<title>Ad Viewer</title>
<script src="//libtl.com/sdk.js" data-zone="${process.env.MONETAG_ZONE}" data-sdk="show_${process.env.MONETAG_ZONE}"></script>
</head>
<body>
<h3>Ad Session</h3>
<p id="progress">Progress: 0/10</p>
<script>
let count = 0;
function showAd() {
  show_${process.env.MONETAG_ZONE}({
    type: 'inApp',
    inAppSettings: {frequency:2, capping:0.1, interval:30, timeout:5, everyPage:false}
  });
  count++;
  document.getElementById('progress').innerText = 'Progress: ' + count + '/10';
  if(count < 10) setTimeout(showAd, 60000);
  else fetch('${process.env.BASE_URL}/api/monetag/postback', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({sessionId})
  });
}
showAd();
</script>
</body>
</html>`);
});

// ---- Start Server ----
app.listen(10000, () =>
  console.log("Server running on port 10000")
);

// ---- Telegram webhook ----
app.post("/telegram/webhook", (req, res) => {
  bot.handleUpdate(req.body, res);
});

export default app;
