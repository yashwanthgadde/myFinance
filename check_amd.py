import sqlite3

conn = sqlite3.connect('data/myfinance.db')
conn.row_factory = sqlite3.Row

print('--- AMD Price in Cache ---')
row = conn.execute("SELECT * FROM price_cache WHERE ticker = 'AMD'").fetchone()
if row:
    print(f"Ticker: {row['ticker']}")
    print(f"Price: {row['price']} {row['currency']}")
    print(f"Last Updated: {row['last_updated']}")
else:
    print('AMD is not in the price cache yet! (Will be fetched on next dashboard load)')

print('\n--- AMD Transactions ---')
txs = conn.execute("SELECT date, type, quantity, price FROM transactions WHERE ticker = 'AMD'").fetchall()
total_qty = 0
total_cost = 0
for t in txs:
    print(dict(t))
    if t['type'] == 'BUY':
        total_qty += t['quantity']
        total_cost += t['quantity'] * t['price']

print(f'\nTotal Qty: {total_qty}')
print(f'Total Cost Basis: ${total_cost:.2f}')
if row:
    print(f"Calculated Current Value: ${total_qty * row['price']:.2f}")

conn.close()
