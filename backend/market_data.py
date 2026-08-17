import yfinance as yf
import datetime
from typing import List, Dict, Any, Optional
from .database import get_cached_price, set_cached_price, get_all_cached_prices

CACHE_EXPIRY_MINUTES = 15

def get_quote_for_ticker(ticker: str, force_refresh: bool = False) -> Dict[str, Any]:
    """
    Fetches real-time / EOD quote for a ticker with smart caching.
    """
    ticker_clean = ticker.strip().upper()
    
    if not force_refresh:
        cached = get_cached_price(ticker_clean)
        if cached:
            last_updated = datetime.datetime.fromisoformat(cached["last_updated"])
            age = (datetime.datetime.utcnow() - last_updated).total_seconds() / 60.0
            if age < CACHE_EXPIRY_MINUTES:
                return cached

    try:
        t = yf.Ticker(ticker_clean)
        info = t.fast_info
        
        # Extract price and change
        price = getattr(info, "last_price", None)
        prev_close = getattr(info, "previous_close", None)
        currency = getattr(info, "currency", "USD")

        # If fast_info doesn't have price, try regular history
        if price is None or price <= 0:
            hist = t.history(period="5d")
            if not hist.empty:
                price = float(hist["Close"].iloc[-1])
                if len(hist) > 1:
                    prev_close = float(hist["Close"].iloc[-2])
                else:
                    prev_close = price

        if price is None:
            # Fallback to last cached if available
            cached = get_cached_price(ticker_clean)
            if cached:
                return cached
            return {
                "ticker": ticker_clean,
                "price": 0.0,
                "change_24h": 0.0,
                "change_24h_pct": 0.0,
                "name": ticker_clean,
                "currency": "USD",
                "asset_type": "EQUITY",
                "history": []
            }

        price = float(price)
        prev_close = float(prev_close) if prev_close else price
        change_24h = price - prev_close
        change_24h_pct = (change_24h / prev_close * 100.0) if prev_close > 0 else 0.0

        # Try to get detailed metadata
        name = ticker_clean
        asset_type = "EQUITY"
        try:
            full_info = t.info
            name = full_info.get("shortName") or full_info.get("longName") or ticker_clean
            quote_type = full_info.get("quoteType", "EQUITY")
            if quote_type in ("ETF", "MUTUALFUND", "CRYPTOCURRENCY", "INDEX"):
                asset_type = quote_type
        except Exception:
            pass

        # Fetch recent 1-month sparkline history
        history_points = []
        try:
            hist_1m = t.history(period="1mo", interval="1d")
            for dt, row in hist_1m.iterrows():
                history_points.append({
                    "date": dt.strftime("%Y-%m-%d"),
                    "close": round(float(row["Close"]), 2)
                })
        except Exception:
            pass

        set_cached_price(
            ticker=ticker_clean,
            price=round(price, 4),
            change_24h=round(change_24h, 4),
            change_24h_pct=round(change_24h_pct, 2),
            name=name,
            currency=currency,
            asset_type=asset_type,
            history=history_points
        )

        return {
            "ticker": ticker_clean,
            "price": round(price, 4),
            "change_24h": round(change_24h, 4),
            "change_24h_pct": round(change_24h_pct, 2),
            "name": name,
            "currency": currency,
            "asset_type": asset_type,
            "history": history_points
        }
    except Exception as e:
        # Graceful fallback to cache
        cached = get_cached_price(ticker_clean)
        if cached:
            return cached
        return {
            "ticker": ticker_clean,
            "price": 0.0,
            "change_24h": 0.0,
            "change_24h_pct": 0.0,
            "name": ticker_clean,
            "currency": "USD",
            "asset_type": "EQUITY",
            "history": []
        }

def refresh_quotes_for_tickers(tickers: List[str]) -> Dict[str, Dict[str, Any]]:
    """
    Refreshes prices for a list of tickers in bulk.
    """
    unique_tickers = list(set(t.strip().upper() for t in tickers if t and t.strip()))
    results = {}
    for ticker in unique_tickers:
        results[ticker] = get_quote_for_ticker(ticker, force_refresh=True)
    return results

def get_historical_data(ticker: str, period: str = "1y", interval: str = "1d") -> List[Dict[str, Any]]:
    """
    Fetches historical price chart data.
    Valid periods: 1d, 5d, 1mo, 6mo, 1y, 5y, max.
    """
    try:
        t = yf.Ticker(ticker.strip().upper())
        df = t.history(period=period, interval=interval)
        if df.empty:
            return []
        
        points = []
        for dt, row in df.iterrows():
            points.append({
                "date": dt.strftime("%Y-%m-%d"),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row["Volume"]) if "Volume" in row else 0
            })
        return points
    except Exception:
        return []

def search_symbols(query: str) -> List[Dict[str, Any]]:
    """
    Searches matching symbols/companies using yfinance search.
    """
    query = query.strip()
    if not query:
        return []
    
    # Common curated tickers for quick instant matches
    COMMON_TICKERS = [
        {"symbol": "AAPL", "name": "Apple Inc.", "exchange": "NASDAQ", "type": "EQUITY"},
        {"symbol": "MSFT", "name": "Microsoft Corporation", "exchange": "NASDAQ", "type": "EQUITY"},
        {"symbol": "GOOGL", "name": "Alphabet Inc. (Google)", "exchange": "NASDAQ", "type": "EQUITY"},
        {"symbol": "AMZN", "name": "Amazon.com Inc.", "exchange": "NASDAQ", "type": "EQUITY"},
        {"symbol": "NVDA", "name": "NVIDIA Corporation", "exchange": "NASDAQ", "type": "EQUITY"},
        {"symbol": "META", "name": "Meta Platforms Inc.", "exchange": "NASDAQ", "type": "EQUITY"},
        {"symbol": "TSLA", "name": "Tesla, Inc.", "exchange": "NASDAQ", "type": "EQUITY"},
        {"symbol": "VOO", "name": "Vanguard S&P 500 ETF", "exchange": "NYSEARCA", "type": "ETF"},
        {"symbol": "SPY", "name": "SPDR S&P 500 ETF Trust", "exchange": "NYSEARCA", "type": "ETF"},
        {"symbol": "QQQ", "name": "Invesco QQQ Trust", "exchange": "NASDAQ", "type": "ETF"},
        {"symbol": "VTI", "name": "Vanguard Total Stock Market ETF", "exchange": "NYSEARCA", "type": "ETF"},
        {"symbol": "RELIANCE.NS", "name": "Reliance Industries Ltd", "exchange": "NSE", "type": "EQUITY"},
        {"symbol": "TCS.NS", "name": "Tata Consultancy Services Ltd", "exchange": "NSE", "type": "EQUITY"},
        {"symbol": "HDFCBANK.NS", "name": "HDFC Bank Limited", "exchange": "NSE", "type": "EQUITY"},
        {"symbol": "INFY.NS", "name": "Infosys Limited", "exchange": "NSE", "type": "EQUITY"},
        {"symbol": "BTC-USD", "name": "Bitcoin USD", "exchange": "CCC", "type": "CRYPTOCURRENCY"},
        {"symbol": "ETH-USD", "name": "Ethereum USD", "exchange": "CCC", "type": "CRYPTOCURRENCY"},
        {"symbol": "^GSPC", "name": "S&P 500 Index", "exchange": "SNP", "type": "INDEX"},
        {"symbol": "^NSEI", "name": "NIFTY 50", "exchange": "NSE", "type": "INDEX"},
        {"symbol": "^IXIC", "name": "NASDAQ Composite", "exchange": "NASDAQ", "type": "INDEX"}
    ]

    results = []
    q_lower = query.lower()
    for item in COMMON_TICKERS:
        if q_lower in item["symbol"].lower() or q_lower in item["name"].lower():
            results.append(item)

    # Also attempt yfinance search if available
    try:
        search = yf.Search(query, max_results=8)
        quotes = search.quotes
        if quotes:
            for q in quotes:
                sym = q.get("symbol")
                if sym and not any(r["symbol"] == sym for r in results):
                    results.append({
                        "symbol": sym,
                        "name": q.get("shortname") or q.get("longname") or sym,
                        "exchange": q.get("exchange", ""),
                        "type": q.get("quoteType", "EQUITY")
                    })
    except Exception:
        pass

    return results[:10]
