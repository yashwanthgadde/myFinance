import os
import io
import json
import base64
from typing import List, Dict, Any, Optional
from datetime import datetime, date

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, FileResponse
from pydantic import BaseModel, Field

from .database import (
    init_db, get_all_portfolios, get_portfolio_by_id, create_portfolio,
    update_portfolio, delete_portfolio, get_transactions, create_transaction,
    create_transactions_batch, update_transaction, delete_transaction,
    get_all_cached_prices, get_settings, set_setting
)
from .financial_engine import calculate_portfolio_summary
from .market_data import (
    get_quote_for_ticker, refresh_quotes_for_tickers, search_symbols, get_historical_data
)
from .vision_parser import extract_transactions_from_image

app = FastAPI(title="myFinance Portfolio Tracker API", version="1.0.0")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize Database on Startup
@app.on_event("startup")
def startup_event():
    init_db()

# ----------------- Request Models ----------------- #

class PortfolioCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    currency: Optional[str] = "USD"
    benchmark: Optional[str] = "^GSPC"
    color: Optional[str] = "#10b981"

class PortfolioUpdate(BaseModel):
    name: str
    description: Optional[str] = ""
    currency: Optional[str] = "USD"
    benchmark: Optional[str] = "^GSPC"
    color: Optional[str] = "#10b981"

class TransactionCreate(BaseModel):
    portfolio_id: int
    ticker: str
    asset_name: Optional[str] = ""
    asset_type: Optional[str] = "EQUITY"
    type: str = "BUY"
    quantity: float
    price: float
    fees: Optional[float] = 0.0
    date: str
    currency: Optional[str] = "USD"
    notes: Optional[str] = ""
    screenshot_path: Optional[str] = ""

class TransactionBatchCreate(BaseModel):
    transactions: List[TransactionCreate]

class SettingsUpdate(BaseModel):
    gemini_api_key: Optional[str] = None
    openai_api_key: Optional[str] = None
    base_currency: Optional[str] = None
    default_benchmark: Optional[str] = None

# ----------------- Portfolio Endpoints ----------------- #

@app.get("/api/portfolios")
def list_portfolios():
    return get_all_portfolios()

@app.post("/api/portfolios")
def add_portfolio(item: PortfolioCreate):
    pid = create_portfolio(
        name=item.name,
        description=item.description or "",
        currency=item.currency or "USD",
        benchmark=item.benchmark or "^GSPC",
        color=item.color or "#10b981"
    )
    return {"id": pid, "status": "success"}

@app.put("/api/portfolios/{portfolio_id}")
def edit_portfolio(portfolio_id: int, item: PortfolioUpdate):
    ok = update_portfolio(
        portfolio_id=portfolio_id,
        name=item.name,
        description=item.description or "",
        currency=item.currency or "USD",
        benchmark=item.benchmark or "^GSPC",
        color=item.color or "#10b981"
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return {"status": "success"}

@app.delete("/api/portfolios/{portfolio_id}")
def remove_portfolio(portfolio_id: int):
    ok = delete_portfolio(portfolio_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Portfolio not found")
    return {"status": "success"}

@app.get("/api/portfolios/overview")
def get_portfolio_overview(auto_sync: bool = False):
    portfolios = get_all_portfolios()
    all_txs = get_transactions()
    
    if auto_sync and all_txs:
        unique_tickers = list(set(t["ticker"] for t in all_txs))
        refresh_quotes_for_tickers(unique_tickers)

    price_cache = get_all_cached_prices()
    summary = calculate_portfolio_summary(portfolios, all_txs, price_cache, selected_portfolio_id=None)
    return summary

@app.get("/api/portfolios/{portfolio_id}/summary")
def get_single_portfolio_summary(portfolio_id: int, auto_sync: bool = False):
    portfolios = get_all_portfolios()
    p = get_portfolio_by_id(portfolio_id)
    if not p:
        raise HTTPException(status_code=404, detail="Portfolio not found")

    all_txs = get_transactions()
    if auto_sync and all_txs:
        unique_tickers = list(set(t["ticker"] for t in all_txs if t["portfolio_id"] == portfolio_id))
        if unique_tickers:
            refresh_quotes_for_tickers(unique_tickers)

    price_cache = get_all_cached_prices()
    summary = calculate_portfolio_summary(portfolios, all_txs, price_cache, selected_portfolio_id=portfolio_id)
    return summary

# ----------------- Transaction Endpoints ----------------- #

@app.get("/api/transactions")
def list_transactions(portfolio_id: Optional[int] = Query(None), ticker: Optional[str] = Query(None)):
    return get_transactions(portfolio_id=portfolio_id, ticker=ticker)

@app.post("/api/transactions")
def add_transaction(item: TransactionCreate):
    tx_id = create_transaction(
        portfolio_id=item.portfolio_id,
        ticker=item.ticker,
        asset_name=item.asset_name or item.ticker,
        asset_type=item.asset_type or "EQUITY",
        tx_type=item.type,
        quantity=item.quantity,
        price=item.price,
        fees=item.fees or 0.0,
        date=item.date,
        currency=item.currency or "USD",
        notes=item.notes or "",
        screenshot_path=item.screenshot_path or ""
    )
    # Fetch initial quote in background
    try:
        get_quote_for_ticker(item.ticker)
    except Exception:
        pass
    return {"id": tx_id, "status": "success"}

@app.post("/api/transactions/batch")
def add_transactions_batch(batch: TransactionBatchCreate):
    tx_dicts = [t.model_dump() for t in batch.transactions]
    created_ids = create_transactions_batch(tx_dicts)
    
    # Auto-fetch quotes for new tickers
    for t in batch.transactions:
        try:
            get_quote_for_ticker(t.ticker)
        except Exception:
            pass
            
    return {"created_count": len(created_ids), "ids": created_ids, "status": "success"}

@app.put("/api/transactions/{tx_id}")
def edit_transaction(tx_id: int, item: TransactionCreate):
    ok = update_transaction(
        tx_id=tx_id,
        portfolio_id=item.portfolio_id,
        ticker=item.ticker,
        asset_name=item.asset_name or item.ticker,
        asset_type=item.asset_type or "EQUITY",
        tx_type=item.type,
        quantity=item.quantity,
        price=item.price,
        fees=item.fees or 0.0,
        date=item.date,
        currency=item.currency or "USD",
        notes=item.notes or ""
    )
    if not ok:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"status": "success"}

@app.delete("/api/transactions/{tx_id}")
def remove_transaction(tx_id: int):
    ok = delete_transaction(tx_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Transaction not found")
    return {"status": "success"}

# ----------------- Vision / Screenshot Parser ----------------- #

@app.post("/api/vision/parse-screenshot")
async def parse_screenshot(file: UploadFile = File(...)):
    contents = await file.read()
    mime = file.content_type or "image/png"
    
    # Save a copy locally in uploads/
    uploads_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads")
    os.makedirs(uploads_dir, exist_ok=True)
    filename = f"screenshot_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}_{file.filename}"
    filepath = os.path.join(uploads_dir, filename)
    with open(filepath, "wb") as f:
        f.write(contents)

    # Run AI Vision extraction
    parsed_result = extract_transactions_from_image(contents, mime_type=mime)
    parsed_result["saved_image_path"] = filename

    # Pre-fetch ticker quotes for all extracted items so prices are ready
    if "transactions" in parsed_result:
        for tx in parsed_result["transactions"]:
            sym = tx.get("ticker")
            if sym:
                try:
                    q = get_quote_for_ticker(sym)
                    if q and q.get("name") and not tx.get("asset_name"):
                        tx["asset_name"] = q["name"]
                except Exception:
                    pass

    return parsed_result

# ----------------- Market Data Endpoints ----------------- #

@app.get("/api/market/quote/{ticker}")
def get_quote(ticker: str, force: bool = False):
    quote = get_quote_for_ticker(ticker, force_refresh=force)
    return quote

@app.post("/api/market/refresh")
def refresh_all_prices():
    all_txs = get_transactions()
    unique_tickers = list(set(t["ticker"] for t in all_txs))
    if unique_tickers:
        results = refresh_quotes_for_tickers(unique_tickers)
        return {"refreshed_count": len(results), "tickers": list(results.keys())}
    return {"refreshed_count": 0, "tickers": []}

@app.get("/api/market/search")
def search_market_symbols(q: str = Query(..., min_length=1)):
    return search_symbols(q)

@app.get("/api/market/history")
def get_history(ticker: str, period: str = "1y"):
    return get_historical_data(ticker, period=period)

# ----------------- Settings Endpoints ----------------- #

@app.get("/api/settings")
def read_settings():
    settings = get_settings()
    # Mask API keys for security in UI
    gemini_key = settings.get("gemini_api_key", "")
    openai_key = settings.get("openai_api_key", "")
    
    masked_gemini = f"••••••••{gemini_key[-4:]}" if len(gemini_key) > 4 else ("Configured" if gemini_key else "")
    masked_openai = f"••••••••{openai_key[-4:]}" if len(openai_key) > 4 else ("Configured" if openai_key else "")

    return {
        "has_gemini_key": bool(gemini_key),
        "has_openai_key": bool(openai_key),
        "gemini_api_key_masked": masked_gemini,
        "openai_api_key_masked": masked_openai,
        "base_currency": settings.get("base_currency", "USD"),
        "default_benchmark": settings.get("default_benchmark", "^GSPC")
    }

@app.post("/api/settings")
def update_settings(item: SettingsUpdate):
    if item.gemini_api_key is not None:
        set_setting("gemini_api_key", item.gemini_api_key.strip())
    if item.openai_api_key is not None:
        set_setting("openai_api_key", item.openai_api_key.strip())
    if item.base_currency is not None:
        set_setting("base_currency", item.base_currency.strip().upper())
    if item.default_benchmark is not None:
        set_setting("default_benchmark", item.default_benchmark.strip().upper())
    return {"status": "success"}

# ----------------- Seed Demo Data Endpoint ----------------- #

@app.post("/api/seed-demo")
def seed_demo_data():
    """Populates realistic multi-year sample transactions across portfolios for immediate visualization of XIRR & CAGR."""
    portfolios = get_all_portfolios()
    if not portfolios:
        init_db()
        portfolios = get_all_portfolios()

    p_core = portfolios[0]["id"]
    p_etf = portfolios[1]["id"] if len(portfolios) > 1 else p_core
    p_growth = portfolios[2]["id"] if len(portfolios) > 2 else p_core

    sample_trades = [
        # Core Equity
        {"portfolio_id": p_core, "ticker": "AAPL", "asset_name": "Apple Inc.", "asset_type": "EQUITY", "type": "BUY", "quantity": 15, "price": 145.30, "fees": 0.0, "date": "2023-01-15", "currency": "USD", "notes": "Initial position"},
        {"portfolio_id": p_core, "ticker": "AAPL", "asset_name": "Apple Inc.", "asset_type": "EQUITY", "type": "BUY", "quantity": 10, "price": 172.00, "fees": 0.0, "date": "2023-09-10", "currency": "USD", "notes": "Dip buy"},
        {"portfolio_id": p_core, "ticker": "MSFT", "asset_name": "Microsoft Corp", "asset_type": "EQUITY", "type": "BUY", "quantity": 12, "price": 240.50, "fees": 0.0, "date": "2023-02-01", "currency": "USD", "notes": "Cloud & AI play"},
        {"portfolio_id": p_core, "ticker": "GOOGL", "asset_name": "Alphabet Inc.", "asset_type": "EQUITY", "type": "BUY", "quantity": 20, "price": 95.00, "fees": 0.0, "date": "2023-03-20", "currency": "USD", "notes": "Search moat"},
        {"portfolio_id": p_core, "ticker": "MSFT", "asset_name": "Microsoft Corp", "asset_type": "EQUITY", "type": "DIVIDEND", "quantity": 12, "price": 0.75, "fees": 0.0, "date": "2023-12-14", "currency": "USD", "notes": "Q4 Dividend"},

        # Retirement / ETFs
        {"portfolio_id": p_etf, "ticker": "VOO", "asset_name": "Vanguard S&P 500 ETF", "asset_type": "ETF", "type": "BUY", "quantity": 15, "price": 365.00, "fees": 0.0, "date": "2022-10-15", "currency": "USD", "notes": "DCA S&P 500"},
        {"portfolio_id": p_etf, "ticker": "VOO", "asset_name": "Vanguard S&P 500 ETF", "asset_type": "ETF", "type": "BUY", "quantity": 10, "price": 405.00, "fees": 0.0, "date": "2023-06-20", "currency": "USD", "notes": "DCA tranche 2"},
        {"portfolio_id": p_etf, "ticker": "QQQ", "asset_name": "Invesco QQQ Trust", "asset_type": "ETF", "type": "BUY", "quantity": 12, "price": 280.00, "fees": 0.0, "date": "2022-11-05", "currency": "USD", "notes": "Nasdaq 100 allocation"},
        {"portfolio_id": p_etf, "ticker": "QQQ", "asset_name": "Invesco QQQ Trust", "asset_type": "ETF", "type": "SELL", "quantity": 4, "price": 440.00, "fees": 1.0, "date": "2024-03-01", "currency": "USD", "notes": "Rebalancing profit take"},

        # Tech & Growth
        {"portfolio_id": p_growth, "ticker": "NVDA", "asset_name": "NVIDIA Corporation", "asset_type": "EQUITY", "type": "BUY", "quantity": 25, "price": 45.00, "fees": 0.0, "date": "2023-01-10", "currency": "USD", "notes": "Split-adjusted entry"},
        {"portfolio_id": p_growth, "ticker": "TSLA", "asset_name": "Tesla, Inc.", "asset_type": "EQUITY", "type": "BUY", "quantity": 15, "price": 180.00, "fees": 0.0, "date": "2023-04-12", "currency": "USD", "notes": "EV growth"},
        {"portfolio_id": p_growth, "ticker": "BTC-USD", "asset_name": "Bitcoin USD", "asset_type": "CRYPTOCURRENCY", "type": "BUY", "quantity": 0.15, "price": 27000.0, "fees": 10.0, "date": "2023-05-15", "currency": "USD", "notes": "Crypto allocation"}
    ]

    create_transactions_batch(sample_trades)
    
    # Pre-populate price cache for smooth instant rendering
    unique_ticks = ["AAPL", "MSFT", "GOOGL", "VOO", "QQQ", "NVDA", "TSLA", "BTC-USD"]
    try:
        refresh_quotes_for_tickers(unique_ticks)
    except Exception:
        pass

    return {"status": "success", "message": f"Successfully seeded {len(sample_trades)} sample trades across 3 portfolios."}

# ----------------- Frontend Static Files Mount ----------------- #

frontend_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")
if os.path.exists(frontend_dir):
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")

@app.get("/")
def serve_index():
    index_file = os.path.join(frontend_dir, "index.html")
    if os.path.exists(index_file):
        return FileResponse(index_file)
    return {"message": "myFinance backend running. Frontend directory not found."}
