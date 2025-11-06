import pkg from "pg";
const { Pool } = pkg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

export default pool;

// --- AUTO CREATE TABLES ---
const initTables = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        telegram_id BIGINT UNIQUE NOT NULL,
        wallet_coins BIGINT DEFAULT 0,
        referred_by BIGINT,
        created_at TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id SERIAL PRIMARY KEY,
        user_telegram_id BIGINT NOT NULL,
        completed BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT NOW(),
        completed_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS ad_watches (
        id SERIAL PRIMARY KEY,
        session_id INTEGER REFERENCES sessions(id),
        user_telegram_id BIGINT NOT NULL,
        watched_count INTEGER DEFAULT 0,
        last_updated TIMESTAMP DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS withdrawals (
        id SERIAL PRIMARY KEY,
        user_telegram_id BIGINT NOT NULL,
        amount BIGINT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        bank_name VARCHAR(100),
        account_number VARCHAR(20),
        account_name VARCHAR(100),
        requested_at TIMESTAMP DEFAULT NOW(),
        approved_at TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS system_config (
        key VARCHAR(50) PRIMARY KEY,
        value TEXT
      );
    `);
    console.log("✅ Database tables checked and initialized successfully!");
  } catch (err) {
    console.error("❌ Error initializing database:", err);
  }
};

// Initialize tables automatically
initTables();

export default pool;
