# Task Earnings Bot (Updated)

This version includes inline buttons, admin access control (two admin IDs), Monetag postback route and a demo ad webview.

## Admins
Admins are set by the environment variable `ADMIN_TELEGRAM_IDS` (comma-separated). By default it includes `5236441213` and `5725566044`.

## Deployment
1. Push to GitHub and connect to Render.
2. Set environment variables in Render (see .env.example).
3. Set Telegram webhook to: `https://<YOUR_RENDER_URL>/telegram/webhook`
4. Set Monetag postback to: `https://<YOUR_RENDER_URL>/api/monetag/postback`

