import db from "./db.js";

export async function getUser(userId) {
  const res = await db.query("SELECT * FROM users WHERE telegram_id=$1", [userId]);
  return res.rows[0];
}

export async function startTaskSession(userId) {
  const session = await db.query(
    "INSERT INTO sessions (user_telegram_id, completed) VALUES ($1, false) RETURNING id",
    [userId]
  );
  return session.rows[0].id;
}

export async function completeAdView(sessionId) {
  await db.query("UPDATE sessions SET completed=true WHERE id=$1", [sessionId]);
}
