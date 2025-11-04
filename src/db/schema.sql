-- === USERS TABLE ===
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    telegram_id BIGINT UNIQUE NOT NULL,
    wallet_coins BIGINT DEFAULT 0,
    referred_by BIGINT,
    created_at TIMESTAMP DEFAULT NOW()
);

-- === SESSIONS TABLE ===
CREATE TABLE IF NOT EXISTS sessions (
    id SERIAL PRIMARY KEY,
    user_telegram_id BIGINT NOT NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP
);

-- === AD WATCHES (for 10 ads progress) ===
CREATE TABLE IF NOT EXISTS ad_watches (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES sessions(id),
    user_telegram_id BIGINT NOT NULL,
    watched_count INTEGER DEFAULT 0,
    last_updated TIMESTAMP DEFAULT NOW()
);

-- === WITHDRAWALS TABLE ===
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

-- === SYSTEM CONFIG TABLE ===
CREATE TABLE IF NOT EXISTS system_config (
    key VARCHAR(50) PRIMARY KEY,
    value TEXT
);
