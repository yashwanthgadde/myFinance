# 📈 myFinance — Private Multi-Portfolio Investment Tracker

> **A self-hosted, 100% private, and modern investment dashboard** with multimodal AI screenshot trade extraction, accurate financial math (XIRR, CAGR, FIFO Realized Gains), and Google Finance-style multi-portfolio management.

---

## ✨ Key Features

1. **📸 Multimodal AI Screenshot Ingestion**:
   - Drag & drop or **paste directly (`Ctrl+V` / `Cmd+V`)** trade confirmation screenshots from any broker worldwide (*Zerodha, Groww, Robinhood, Charles Schwab, Fidelity, Vanguard, Webull, CoinDCX, Binance, Interactive Brokers*, etc.).
   - AI extracts `Date`, `Ticker`, `Type (BUY/SELL/DIVIDEND)`, `Quantity`, `Execution Price`, `Fees`, and `Currency`.
   - Side-by-side interactive verification modal lets you review and tag trades to any portfolio before importing.

2. **📊 Google Finance-Style Multi-Portfolio Tabs**:
   - Organize assets across distinct portfolios (*Core Equity, Retirement / ETFs, Tech & Growth, Crypto, Speculative*).
   - Aggregated "All Portfolios" view alongside individual portfolio tabs.
   - Set custom benchmark indices (*S&P 500, NIFTY 50, NASDAQ, Dow Jones*).

3. **🧮 Precise Financial Math Engine**:
   - **XIRR (Extended Internal Rate of Return)**: Accurate annualized rate of return taking into account irregular cash flows (DCA buys, partial sells, dividends, and current terminal portfolio value) solved via Newton-Raphson & Brentq root finders.
   - **CAGR (Compound Annual Growth Rate)**: Holding-level and portfolio-level compound annual growth.
   - **FIFO Realized Gains**: Automatically tracks lots on sales to calculate realized vs unrealized P&L.
   - **Daily Gain / Loss**: Live tracking against previous market close.

4. **⚡ Live Market Data Sync**:
   - Automatic price and sparkline syncing via `yfinance` with local caching.
   - Supports Global Equities, ETFs, Mutual Funds, Cryptocurrencies, and Indices (`AAPL`, `MSFT`, `VOO`, `RELIANCE.NS`, `TCS.NS`, `BTC-USD`, etc.).

5. **🔒 100% Local & Private**:
   - Backed entirely by a local SQLite database (`data/myfinance.db`).
   - Zero telemetry, zero cloud lock-in, zero subscription fees.

---

## 🏗️ Architecture

```
myFinance/
├── backend/
│   ├── app.py                 # FastAPI REST API & static file server
│   ├── database.py            # SQLite schema migrations & CRUD
│   ├── financial_engine.py    # XIRR, CAGR, FIFO cost basis & portfolio math
│   ├── market_data.py         # yfinance live quote sync & caching
│   ├── vision_parser.py       # Multimodal screenshot trade extractor
│   └── test_backend.py        # Automated test suite
├── frontend/
│   ├── index.html             # Google Finance-style single page app
│   ├── styles.css             # Glassmorphism dark/light design system
│   ├── app.js                 # UI controllers, drag & drop, state management
│   └── charts.js              # Chart.js performance & allocation charts
├── requirements.txt           # Python dependencies
├── run.py                     # App launcher
├── start.sh                   # One-click startup script
└── .gitignore
```

---

## 🚀 Getting Started

### 1. Prerequisites
- **Python 3.10+**
- **Git**

### 2. Quick Launch
Clone the repository and run:
```bash
# Clone the repository
git clone <your-git-repo-url>
cd myFinance

# Install dependencies and start
./start.sh
```

Or manually:
```bash
python3 -m pip install -r requirements.txt
python3 run.py
```

Then open your browser at:
👉 **`http://127.0.0.1:8000`**

---

## 🔑 Setting up AI Screenshot Extraction (Optional but Recommended)

1. Get a free Google Gemini API Key at [Google AI Studio](https://aistudio.google.com/app/apikey).
2. In the myFinance web UI, click the **⚙️ Settings** icon in the top right.
3. Paste your API Key and click **Save Settings**.
4. Now you can drag-and-drop or `Ctrl+V` paste any broker screenshot into the dashboard for 1-click trade ingestion!

---

## 🧪 Running Tests

Verify all financial math and database operations:
```bash
python3 -m backend.test_backend
```

---

## 📦 Git Maintenance & Commits

To maintain your project on Git:
```bash
git add .
git commit -m "feat: initial commit of myFinance dashboard"
git remote add origin <your-git-remote-url>
git push -u origin main
```
