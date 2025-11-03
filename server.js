
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

// --- Start Server ---
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
