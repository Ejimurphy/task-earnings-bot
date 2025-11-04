import db from "./db.js";
import { completeAdView } from "./utils.js";

export async function handleMonetagPostback(req, res) {
  try {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).send("Missing sessionId");
    await completeAdView(sessionId);
    res.send("OK");
  } catch (e) {
    console.error("Postback error:", e);
    res.status(500).send("Error");
  }
}
