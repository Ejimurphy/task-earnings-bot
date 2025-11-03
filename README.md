# Task Earnings Bot

Telegram bot that allows users to perform ad-watching tasks and earn coins.
Integrated with Monetag In-App Ads SDK.

## Deployment

1. Push to GitHub.
2. Connect to Render as a Node.js web service.
3. Add the following environment variables:
   - TELEGRAM_BOT_TOKEN
   - MONETAG_ZONE
   - DATABASE_URL
   - REWARD_PER_TASK
   - MIN_WITHDRAWAL_COINS
   - ADMIN_TELEGRAM_ID
4. Set Monetag Postback URL to:
   https://<YOUR_RENDER_URL>/api/monetag/postback

## Run locally

```bash
npm install
npm start
```
