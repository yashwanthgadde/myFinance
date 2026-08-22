#!/usr/bin/env python3
"""
import_csv.py — Import transactions from portfolio CSV files into myFinance DB

Usage:
    python3 import_csv.py                          # imports ALL CSVs in portfolios/
    python3 import_csv.py "Amma_India_Stocks.csv"  # imports a specific file

Each CSV filename (without .csv) becomes the portfolio name.
The script creates the portfolio if it doesn't exist, then inserts transactions.
Duplicate rows (same date + ticker + type + quantity + price) are skipped.
"""

import csv
import os
import sys
import sqlite3
from datetime import datetime

DB_PATH       = os.path.join(os.path.dirname(__file__), "data", "myfinance.db")
PORTFOLIO_DIR = os.path.join(os.path.dirname(__file__), "portfolios")

PORTFOLIO_COLORS = [
    "#4c8dff", "#00d68f", "#a78bfa", "#fbbf24",
    "#fb7185", "#22d3ee", "#f97316", "#84cc16"
]

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    return conn

def get_or_create_portfolio(conn, name: str) -> int:
    """Returns portfolio ID, creating it if it doesn't exist."""
    row = conn.execute("SELECT id FROM portfolios WHERE name = ?", (name,)).fetchone()
    if row:
        return row["id"]

    # Pick a color based on how many portfolios exist
    count = conn.execute("SELECT COUNT(*) FROM portfolios").fetchone()[0]
    color = PORTFOLIO_COLORS[count % len(PORTFOLIO_COLORS)]

    # Default to INR / NIFTY 50 for all CSV-imported portfolios
    currency  = "INR"
    benchmark = "^NSEI"

    cur = conn.execute(
        """INSERT INTO portfolios (name, description, currency, benchmark, color, created_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (name, f"Imported from {name}.csv", currency, benchmark, color, datetime.now().isoformat())
    )
    conn.commit()
    print(f"  ✓ Created portfolio: '{name}' (ID={cur.lastrowid}, currency={currency}, benchmark={benchmark})")
    return cur.lastrowid

def already_exists(conn, portfolio_id: int, date: str, ticker: str,
                   tx_type: str, quantity: float, price: float) -> bool:
    row = conn.execute(
        """SELECT id FROM transactions
           WHERE portfolio_id=? AND date=? AND ticker=? AND type=?
             AND ABS(quantity-?)< 0.0001 AND ABS(price-?)<0.01""",
        (portfolio_id, date, ticker, tx_type, quantity, price)
    ).fetchone()
    return row is not None

def import_csv(filepath: str):
    filename    = os.path.basename(filepath)
    portfolio_name = os.path.splitext(filename)[0].replace("_", " ")

    print(f"\n📂 Importing: {filename}  →  Portfolio: '{portfolio_name}'")

    conn = get_db()
    portfolio_id = get_or_create_portfolio(conn, portfolio_name)

    inserted = skipped = errors = 0

    with open(filepath, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for i, row in enumerate(reader, start=2):
            # Skip comment lines (rows where Date starts with #)
            date_val = (row.get("Date") or "").strip()
            if not date_val or date_val.startswith("#"):
                continue

            try:
                ticker     = (row.get("Ticker") or "").strip().upper()
                company    = (row.get("Stock Name") or ticker or "").strip()
                tx_type    = (row.get("Type") or "BUY").strip().upper()
                quantity   = float(row.get("Quantity") or 0)
                buy_price  = float(row.get("Buy Price") or 0)
                sell_price = float(row.get("Sell Price") or 0)

                # Determine price and transaction type
                if sell_price > 0 and buy_price <= 0:
                    tx_type = "SELL"
                    price   = sell_price
                elif tx_type == "SELL" and sell_price > 0:
                    price = sell_price
                else:
                    price = buy_price

                fees     = 0.0
                currency = "INR"
                notes    = f"Imported from {filename}"

                # Derive ticker from Stock Name if blank
                if not ticker and company:
                    ticker = company.upper().replace(" ", "")[:12]

                # Validate
                if not ticker:
                    print(f"  ⚠  Row {i}: skipped — missing Ticker")
                    errors += 1
                    continue
                if quantity <= 0:
                    print(f"  ⚠  Row {i}: skipped — Quantity must be > 0 (got: {quantity})")
                    errors += 1
                    continue
                if tx_type not in ("BUY", "SELL", "DIVIDEND"):
                    print(f"  ⚠  Row {i}: unknown Type '{tx_type}', defaulting to BUY")
                    tx_type = "BUY"

                # Skip duplicates
                if already_exists(conn, portfolio_id, date_val, ticker, tx_type, quantity, price):
                    skipped += 1
                    continue

                conn.execute(
                    """INSERT INTO transactions
                       (portfolio_id, ticker, asset_name, asset_type, type,
                        quantity, price, fees, date, currency, notes, screenshot_path, created_at)
                       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                    (portfolio_id, ticker, company, "EQUITY", tx_type,
                     quantity, price, fees, date_val, currency,
                     notes or f"Imported from {filename}",
                     "", datetime.now().isoformat())
                )
                inserted += 1

            except Exception as e:
                print(f"  ✗  Row {i}: error — {e}")
                errors += 1

    conn.commit()
    conn.close()

    print(f"  ✅  Done — {inserted} inserted, {skipped} duplicates skipped, {errors} errors")
    return inserted

def main():
    if not os.path.exists(DB_PATH):
        print(f"✗ Database not found at: {DB_PATH}")
        print("  Start the app once with `python3 run.py` to initialise it, then re-run this script.")
        sys.exit(1)

    if len(sys.argv) > 1:
        # Specific file(s) passed as arguments
        files = [os.path.join(PORTFOLIO_DIR, a) if not os.path.isabs(a) else a
                 for a in sys.argv[1:]]
    else:
        # All CSVs in portfolios/
        if not os.path.isdir(PORTFOLIO_DIR):
            print(f"✗ No portfolios/ directory found at {PORTFOLIO_DIR}")
            sys.exit(1)
        files = sorted(
            os.path.join(PORTFOLIO_DIR, f)
            for f in os.listdir(PORTFOLIO_DIR)
            if f.endswith(".csv") and not f.startswith(".")
        )

    if not files:
        print("No CSV files found. Add a file like:\n  portfolios/Amma_India_Stocks.csv")
        sys.exit(0)

    total = 0
    for f in files:
        if not os.path.exists(f):
            print(f"✗ File not found: {f}")
            continue
        total += import_csv(f)

    print(f"\n🎉 Import complete — {total} transaction(s) added across {len(files)} file(s).")
    print("   Restart the app (python3 run.py) or refresh the browser to see them.\n")

if __name__ == "__main__":
    main()
