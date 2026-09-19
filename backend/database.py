import sqlite3
import json
import os
from datetime import datetime
from typing import List, Dict, Any, Optional

DB_PATH = os.environ.get("MYFINANCE_DB_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "data", "myfinance.db"))

def get_db_connection() -> sqlite3.Connection:
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL;")
    conn.execute("PRAGMA foreign_keys=ON;")
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()

    # Portfolios table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS portfolios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        currency TEXT DEFAULT 'USD',
        benchmark TEXT DEFAULT '^GSPC',
        color TEXT DEFAULT '#10b981',
        is_default INTEGER DEFAULT 0,
        created_at TEXT NOT NULL
    );
    """)

    # Transactions table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        portfolio_id INTEGER NOT NULL,
        ticker TEXT NOT NULL,
        asset_name TEXT,
        asset_type TEXT DEFAULT 'EQUITY',
        type TEXT NOT NULL CHECK(type IN ('BUY', 'SELL', 'DIVIDEND')),
        quantity REAL NOT NULL,
        price REAL NOT NULL,
        fees REAL DEFAULT 0.0,
        date TEXT NOT NULL,
        currency TEXT DEFAULT 'USD',
        notes TEXT,
        screenshot_path TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (portfolio_id) REFERENCES portfolios(id) ON DELETE CASCADE
    );
    """)

    # Price & Metadata Cache table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS price_cache (
        ticker TEXT PRIMARY KEY,
        price REAL NOT NULL,
        change_24h REAL DEFAULT 0.0,
        change_24h_pct REAL DEFAULT 0.0,
        name TEXT,
        currency TEXT DEFAULT 'USD',
        asset_type TEXT,
        history_json TEXT,
        last_updated TEXT NOT NULL
    );
    """)

    # App Settings (API keys, preferences)
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    );
    """)

    # Check if any portfolio exists, if not create default ones
    cursor.execute("SELECT COUNT(*) as count FROM portfolios;")
    row = cursor.fetchone()
    if row["count"] == 0:
        now = datetime.utcnow().isoformat()
        cursor.execute("""
        INSERT INTO portfolios (name, description, currency, benchmark, color, is_default, created_at)
        VALUES 
        ('Core Equity', 'Long term stock and index holdings', 'USD', '^GSPC', '#10b981', 1, ?),
        ('Retirement & ETFs', 'Broad market ETFs and passive index funds', 'USD', '^GSPC', '#3b82f6', 0, ?),
        ('Tech & Growth', 'High growth technology equities and opportunities', 'USD', '^IXIC', '#8b5cf6', 0, ?);
        """, (now, now, now))

    conn.commit()
    conn.close()

# ----------------- Portfolio Operations ----------------- #

def get_all_portfolios() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM portfolios ORDER BY is_default DESC, id ASC;")
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def get_portfolio_by_id(portfolio_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM portfolios WHERE id = ?;", (portfolio_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def create_portfolio(name: str, description: str = "", currency: str = "USD", benchmark: str = "^GSPC", color: str = "#10b981") -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    cursor.execute("""
    INSERT INTO portfolios (name, description, currency, benchmark, color, is_default, created_at)
    VALUES (?, ?, ?, ?, ?, 0, ?);
    """, (name, description, currency, benchmark, color, now))
    pid = cursor.lastrowid
    conn.commit()
    conn.close()
    return pid

def update_portfolio(portfolio_id: int, name: str, description: str, currency: str, benchmark: str, color: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE portfolios 
    SET name = ?, description = ?, currency = ?, benchmark = ?, color = ?
    WHERE id = ?;
    """, (name, description, currency, benchmark, color, portfolio_id))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected

def delete_portfolio(portfolio_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM portfolios WHERE id = ?;", (portfolio_id,))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected

# ----------------- Transaction Operations ----------------- #

def get_transactions(portfolio_id: Optional[int] = None, ticker: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    query = """
    SELECT t.*, p.name as portfolio_name, p.color as portfolio_color
    FROM transactions t
    JOIN portfolios p ON t.portfolio_id = p.id
    WHERE 1=1
    """
    params = []
    if portfolio_id is not None:
        query += " AND t.portfolio_id = ?"
        params.append(portfolio_id)
    if ticker is not None:
        query += " AND t.ticker = ?"
        params.append(ticker.upper())
    
    query += " ORDER BY t.date DESC, t.id DESC;"
    cursor.execute(query, params)
    rows = cursor.fetchall()
    conn.close()
    return [dict(r) for r in rows]

def create_transaction(portfolio_id: int, ticker: str, asset_name: str, asset_type: str, 
                       tx_type: str, quantity: float, price: float, fees: float, 
                       date: str, currency: str = "USD", notes: str = "", screenshot_path: str = "") -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    ticker_clean = ticker.strip().upper()
    cursor.execute("""
    INSERT INTO transactions (portfolio_id, ticker, asset_name, asset_type, type, quantity, price, fees, date, currency, notes, screenshot_path, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    """, (portfolio_id, ticker_clean, asset_name, asset_type, tx_type.upper(), quantity, price, fees, date, currency, notes, screenshot_path, now))
    tx_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return tx_id

def create_transactions_batch(transactions: List[Dict[str, Any]]) -> List[int]:
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    created_ids = []
    for tx in transactions:
        cursor.execute("""
        INSERT INTO transactions (portfolio_id, ticker, asset_name, asset_type, type, quantity, price, fees, date, currency, notes, screenshot_path, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
        """, (
            tx.get("portfolio_id", 1),
            tx.get("ticker", "").strip().upper(),
            tx.get("asset_name", ""),
            tx.get("asset_type", "EQUITY"),
            tx.get("type", "BUY").upper(),
            float(tx.get("quantity", 0)),
            float(tx.get("price", 0)),
            float(tx.get("fees", 0.0)),
            tx.get("date", datetime.utcnow().strftime("%Y-%m-%d")),
            tx.get("currency", "USD"),
            tx.get("notes", ""),
            tx.get("screenshot_path", ""),
            now
        ))
        created_ids.append(cursor.lastrowid)
    conn.commit()
    conn.close()
    return created_ids

def update_transaction(tx_id: int, portfolio_id: int, ticker: str, asset_name: str, asset_type: str,
                       tx_type: str, quantity: float, price: float, fees: float, date: str, 
                       currency: str, notes: str) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    UPDATE transactions
    SET portfolio_id = ?, ticker = ?, asset_name = ?, asset_type = ?, type = ?, quantity = ?, price = ?, fees = ?, date = ?, currency = ?, notes = ?
    WHERE id = ?;
    """, (portfolio_id, ticker.strip().upper(), asset_name, asset_type, tx_type.upper(), quantity, price, fees, date, currency, notes, tx_id))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected

def delete_transaction(tx_id: int) -> bool:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM transactions WHERE id = ?;", (tx_id,))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected

# ----------------- Price Cache Operations ----------------- #

def get_cached_price(ticker: str) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM price_cache WHERE ticker = ?;", (ticker.upper(),))
    row = cursor.fetchone()
    conn.close()
    if row:
        data = dict(row)
        if data.get("history_json"):
            try:
                data["history"] = json.loads(data["history_json"])
            except Exception:
                data["history"] = []
        return data
    return None

def get_all_cached_prices() -> Dict[str, Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM price_cache;")
    rows = cursor.fetchall()
    conn.close()
    result = {}
    for r in rows:
        d = dict(r)
        if d.get("history_json"):
            try:
                d["history"] = json.loads(d["history_json"])
            except Exception:
                d["history"] = []
        result[d["ticker"]] = d
    return result

def set_cached_price(ticker: str, price: float, change_24h: float, change_24h_pct: float, 
                     name: str, currency: str, asset_type: str, history: Optional[List[Dict[str, Any]]] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.utcnow().isoformat()
    history_json = json.dumps(history) if history else None
    cursor.execute("""
    INSERT INTO price_cache (ticker, price, change_24h, change_24h_pct, name, currency, asset_type, history_json, last_updated)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(ticker) DO UPDATE SET
        price = excluded.price,
        change_24h = excluded.change_24h,
        change_24h_pct = excluded.change_24h_pct,
        name = COALESCE(excluded.name, price_cache.name),
        currency = COALESCE(excluded.currency, price_cache.currency),
        asset_type = COALESCE(excluded.asset_type, price_cache.asset_type),
        history_json = COALESCE(excluded.history_json, price_cache.history_json),
        last_updated = excluded.last_updated;
    """, (ticker.upper(), price, change_24h, change_24h_pct, name, currency, asset_type, history_json, now))
    conn.commit()
    conn.close()

# ----------------- Settings Operations ----------------- #

def get_settings() -> Dict[str, str]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT key, value FROM settings;")
    rows = cursor.fetchall()
    conn.close()
    return {r["key"]: r["value"] for r in rows}

def get_setting(key: str, default: str = "") -> str:
    # 1. Check local config.json file for hardcoded overrides
    try:
        import os, json
        config_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
        if os.path.exists(config_path):
            with open(config_path, "r") as f:
                cfg = json.load(f)
                if key in cfg and cfg[key]:
                    return str(cfg[key])
    except Exception:
        pass

    # 2. Check Database settings
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM settings WHERE key = ?;", (key,))
    row = cursor.fetchone()
    conn.close()
    return row["value"] if row else default

def set_setting(key: str, value: str):
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("""
    INSERT INTO settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value;
    """, (key, value))
    conn.commit()
    conn.close()
