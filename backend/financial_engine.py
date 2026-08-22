import math
from datetime import datetime, date
from typing import List, Dict, Any, Optional, Tuple
import numpy as np
from scipy import optimize

def parse_date(date_val: Any) -> date:
    if isinstance(date_val, (datetime, date)):
        return date_val.date() if isinstance(date_val, datetime) else date_val
    if isinstance(date_val, str):
        # Handle 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM:SS'
        clean = date_val.split("T")[0].split(" ")[0]
        return datetime.strptime(clean, "%Y-%m-%d").date()
    raise ValueError(f"Unknown date format: {date_val}")

def calculate_xirr(cash_flows: List[Tuple[date, float]], guess: float = 0.1) -> Optional[float]:
    """
    Calculates the Extended Internal Rate of Return (XIRR) for irregular cash flows.
    cash_flows: List of (date, amount). Outflows (investments) are negative, inflows (sells/current val) are positive.
    Returns annualized rate as a decimal (e.g., 0.152 for 15.2%), or None if not computable.
    """
    if not cash_flows or len(cash_flows) < 2:
        return None

    # Filter zero cash flows and sort by date
    clean_flows = [(parse_date(d), float(amt)) for d, amt in cash_flows if abs(amt) > 1e-6]
    clean_flows.sort(key=lambda x: x[0])

    if len(clean_flows) < 2:
        return None

    # Check if there is at least one negative and one positive cash flow
    has_positive = any(amt > 0 for _, amt in clean_flows)
    has_negative = any(amt < 0 for _, amt in clean_flows)
    if not (has_positive and has_negative):
        return None

    d0 = clean_flows[0][0]
    dates = [(cf[0] - d0).days / 365.0 for cf in clean_flows]
    amounts = [cf[1] for cf in clean_flows]

    # Total days span
    total_days = (clean_flows[-1][0] - d0).days
    if total_days <= 0:
        return None

    def npv(rate: float) -> float:
        if rate <= -0.99999:
            return float('inf')
        val = 0.0
        for t, amt in zip(dates, amounts):
            val += amt / ((1.0 + rate) ** t)
        return val

    def npv_prime(rate: float) -> float:
        if rate <= -0.99999:
            return float('inf')
        val = 0.0
        for t, amt in zip(dates, amounts):
            val -= t * amt / ((1.0 + rate) ** (t + 1.0))
        return val

    # Attempt 1: Newton-Raphson
    try:
        rate = optimize.newton(npv, guess, fprime=npv_prime, maxiter=100, tol=1e-5)
        if -0.99 < rate < 100.0 and not math.isnan(rate) and not math.isinf(rate):
            return float(rate)
    except Exception:
        pass

    # Attempt 2: Brentq root finding over bracketing interval
    try:
        # Search range from -0.95 to 10.0 (up to 1000% annualized return)
        r_min, r_max = -0.95, 10.0
        f_min, f_max = npv(r_min), npv(r_max)
        if f_min * f_max <= 0:
            rate = optimize.brentq(npv, r_min, r_max, maxiter=200)
            return float(rate)
        # Wider search
        r_max = 50.0
        f_max = npv(r_max)
        if f_min * f_max <= 0:
            rate = optimize.brentq(npv, r_min, r_max, maxiter=200)
            return float(rate)
    except Exception:
        pass

    # Attempt 3: Simple annualized return approximation
    try:
        total_in = sum(-amt for amt in amounts if amt < 0)
        total_out = sum(amt for amt in amounts if amt > 0)
        if total_in > 0 and total_days > 0:
            years = total_days / 365.25
            if years >= 0.05:
                rate = (total_out / total_in) ** (1.0 / years) - 1.0
                if -0.99 < rate < 100.0:
                    return float(rate)
    except Exception:
        pass

    return None

def calculate_cagr(start_val: float, end_val: float, years: float) -> Optional[float]:
    """
    Calculates Compound Annual Growth Rate.
    CAGR = (End Value / Start Value)^(1/years) - 1
    """
    if start_val <= 0 or end_val <= 0 or years <= 0.05:
        return None
    try:
        cagr = (end_val / start_val) ** (1.0 / years) - 1.0
        if -0.99 < cagr < 100.0:
            return float(cagr)
    except Exception:
        pass
    return None

def calculate_holding_metrics(transactions: List[Dict[str, Any]], current_price: float,
                              price_change_24h: float = 0.0, price_change_24h_pct: float = 0.0,
                              as_of_date: Optional[date] = None,
                              portfolio: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Calculates detailed metrics for a single security/holding using FIFO lot matching.
    """
    if as_of_date is None:
        as_of_date = date.today()

    sorted_txs = sorted(transactions, key=lambda x: (parse_date(x["date"]), x.get("id", 0)))
    
    total_bought_qty = 0.0
    total_bought_cost = 0.0
    total_sold_qty = 0.0
    total_sold_proceeds = 0.0
    total_dividends = 0.0
    total_fees = 0.0
    
    # FIFO Lots: list of {"qty": float, "price": float, "date": date}
    open_lots = []
    realized_pnl = 0.0
    cash_flows = []
    first_buy_date = None
    last_tx_date = None

    for tx in sorted_txs:
        t_type = tx["type"].upper()
        t_date = parse_date(tx["date"])
        t_qty = float(tx.get("quantity", 0))
        t_price = float(tx.get("price", 0))
        t_fees = float(tx.get("fees", 0))
        total_fees += t_fees
        last_tx_date = t_date

        if t_type == "BUY":
            if first_buy_date is None:
                first_buy_date = t_date
            total_bought_qty += t_qty
            total_bought_cost += (t_qty * t_price) + t_fees
            open_lots.append({"qty": t_qty, "price": t_price, "date": t_date})
            cash_flows.append((t_date, -(t_qty * t_price + t_fees)))

        elif t_type == "SELL":
            total_sold_qty += t_qty
            proceeds = (t_qty * t_price) - t_fees
            total_sold_proceeds += proceeds
            cash_flows.append((t_date, proceeds))

            # FIFO Match
            qty_to_match = t_qty
            while qty_to_match > 1e-6 and open_lots:
                lot = open_lots[0]
                if lot["qty"] <= qty_to_match + 1e-6:
                    # Entire lot matched
                    matched_qty = lot["qty"]
                    cost = matched_qty * lot["price"]
                    realized_pnl += (matched_qty * t_price) - cost
                    qty_to_match -= matched_qty
                    open_lots.pop(0)
                else:
                    # Partial lot matched
                    matched_qty = qty_to_match
                    cost = matched_qty * lot["price"]
                    realized_pnl += (matched_qty * t_price) - cost
                    lot["qty"] -= matched_qty
                    qty_to_match = 0.0

        elif t_type == "DIVIDEND":
            div_amount = (t_qty * t_price) if t_qty > 0 else t_price
            div_amount -= t_fees
            total_dividends += div_amount
            cash_flows.append((t_date, div_amount))

    # Remaining active position
    current_qty = sum(lot["qty"] for lot in open_lots)
    
    # Calculate Cost Basis of remaining shares
    if current_qty > 1e-6:
        cost_basis = sum(lot["qty"] * lot["price"] for lot in open_lots)
        avg_buy_price = cost_basis / current_qty
    else:
        current_qty = 0.0
        cost_basis = 0.0
        avg_buy_price = 0.0

    current_value = current_qty * current_price
    unrealized_pnl = current_value - cost_basis if current_qty > 0 else 0.0
    unrealized_pnl_pct = (unrealized_pnl / cost_basis * 100.0) if cost_basis > 0 else 0.0
    total_pnl = unrealized_pnl + realized_pnl + total_dividends
    
    daily_pnl = current_qty * price_change_24h
    daily_pnl_pct = price_change_24h_pct

    # Add terminal current value cash flow for XIRR
    xirr_flows = list(cash_flows)
    if current_value > 1e-6:
        xirr_flows.append((as_of_date, current_value))

    xirr_val = calculate_xirr(xirr_flows)
    
    # Calculate CAGR if holding > 0
    cagr_val = None
    if first_buy_date and cost_basis > 0 and current_value > 0:
        holding_years = (as_of_date - first_buy_date).days / 365.25
        if holding_years >= 0.08: # ~30 days minimum
            cagr_val = calculate_cagr(cost_basis, current_value, holding_years)

    return {
        "ticker": transactions[0]["ticker"].upper(),
        "asset_name": transactions[0].get("asset_name") or transactions[0]["ticker"],
        "asset_type": transactions[0].get("asset_type", "EQUITY"),
        "currency": portfolio.get("currency", "INR") if portfolio else transactions[0].get("currency", "INR"),
        "quantity": round(current_qty, 6),
        "avg_buy_price": round(avg_buy_price, 4),
        "current_price": round(current_price, 4),
        "cost_basis": round(cost_basis, 2),
        "current_value": round(current_value, 2),
        "unrealized_pnl": round(unrealized_pnl, 2),
        "unrealized_pnl_pct": round(unrealized_pnl_pct, 2),
        "realized_pnl": round(realized_pnl, 2),
        "total_dividends": round(total_dividends, 2),
        "total_pnl": round(total_pnl, 2),
        "daily_pnl": round(daily_pnl, 2),
        "daily_pnl_pct": round(daily_pnl_pct, 2),
        "xirr": round(xirr_val * 100.0, 2) if xirr_val is not None else None,
        "cagr": round(cagr_val * 100.0, 2) if cagr_val is not None else None,
        "first_buy_date": first_buy_date.isoformat() if first_buy_date else None,
        "transactions_count": len(transactions),
        "is_closed": current_qty <= 1e-6
    }

def calculate_portfolio_summary(portfolios: List[Dict[str, Any]], 
                                all_transactions: List[Dict[str, Any]], 
                                price_cache: Dict[str, Dict[str, Any]],
                                selected_portfolio_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Computes aggregated summary, holding breakdown, asset allocation, and overall XIRR/CAGR.
    """
    today = date.today()

    # Filter transactions if a specific portfolio is selected
    if selected_portfolio_id is not None:
        target_txs = [t for t in all_transactions if t["portfolio_id"] == selected_portfolio_id]
        active_portfolios = [p for p in portfolios if p["id"] == selected_portfolio_id]
    else:
        target_txs = all_transactions
        active_portfolios = portfolios

    # Group transactions by ticker
    txs_by_ticker: Dict[str, List[Dict[str, Any]]] = {}
    for tx in target_txs:
        tick = tx["ticker"].upper()
        if tick not in txs_by_ticker:
            txs_by_ticker[tick] = []
        txs_by_ticker[tick].append(tx)

    holdings = []
    portfolio_cash_flows = []
    total_cost_basis = 0.0
    total_current_value = 0.0
    total_realized_pnl = 0.0
    total_unrealized_pnl = 0.0
    total_dividends = 0.0
    total_daily_pnl = 0.0
    earliest_date = None

    for ticker, txs in txs_by_ticker.items():
        # Get cached price or fallback to last transaction price
        cached = price_cache.get(ticker, {})
        current_price = cached.get("price")
        if current_price is None or current_price <= 0:
            current_price = float(txs[-1].get("price", 0))

        change_24h = float(cached.get("change_24h", 0.0))
        change_24h_pct = float(cached.get("change_24h_pct", 0.0))

        # Find portfolio this ticker belongs to
        tx_portfolio_id = txs[0].get("portfolio_id")
        tx_portfolio = next((p for p in portfolios if p["id"] == tx_portfolio_id), None)

        m = calculate_holding_metrics(txs, current_price, change_24h, change_24h_pct, as_of_date=today, portfolio=tx_portfolio)
        
        # Merge latest name & asset_type from cache if available
        if cached.get("name"):
            m["asset_name"] = cached["name"]
        if cached.get("asset_type"):
            m["asset_type"] = cached["asset_type"]

        holdings.append(m)

        total_cost_basis += m["cost_basis"]
        total_current_value += m["current_value"]
        total_realized_pnl += m["realized_pnl"]
        total_unrealized_pnl += m["unrealized_pnl"]
        total_dividends += m["total_dividends"]
        total_daily_pnl += m["daily_pnl"]

        if m["first_buy_date"]:
            fb_date = parse_date(m["first_buy_date"])
            if earliest_date is None or fb_date < earliest_date:
                earliest_date = fb_date

    # Calculate portfolio weights
    for h in holdings:
        if total_current_value > 0 and h["current_value"] > 0:
            h["weight_pct"] = round((h["current_value"] / total_current_value) * 100.0, 2)
        else:
            h["weight_pct"] = 0.0

    # Sort holdings: active holdings first by value descending, then closed positions
    active_holdings = [h for h in holdings if not h["is_closed"]]
    closed_holdings = [h for h in holdings if h["is_closed"]]
    active_holdings.sort(key=lambda x: x["current_value"], reverse=True)
    closed_holdings.sort(key=lambda x: x["realized_pnl"], reverse=True)
    sorted_holdings = active_holdings + closed_holdings

    # Portfolio-wide Cash Flows for overall XIRR
    for tx in target_txs:
        t_type = tx["type"].upper()
        t_date = parse_date(tx["date"])
        t_qty = float(tx.get("quantity", 0))
        t_price = float(tx.get("price", 0))
        t_fees = float(tx.get("fees", 0))

        if t_type == "BUY":
            portfolio_cash_flows.append((t_date, -(t_qty * t_price + t_fees)))
        elif t_type == "SELL":
            portfolio_cash_flows.append((t_date, (t_qty * t_price - t_fees)))
        elif t_type == "DIVIDEND":
            div = (t_qty * t_price) if t_qty > 0 else t_price
            portfolio_cash_flows.append((t_date, div - t_fees))

    # Add terminal current value cash flow
    if total_current_value > 1e-6:
        portfolio_cash_flows.append((today, total_current_value))

    portfolio_xirr = calculate_xirr(portfolio_cash_flows)
    
    # Portfolio CAGR
    portfolio_cagr = None
    if earliest_date and total_cost_basis > 0 and total_current_value > 0:
        total_years = (today - earliest_date).days / 365.25
        if total_years >= 0.08:
            portfolio_cagr = calculate_cagr(total_cost_basis, total_current_value, total_years)

    total_return = total_unrealized_pnl + total_realized_pnl + total_dividends
    total_return_pct = (total_return / total_cost_basis * 100.0) if total_cost_basis > 0 else 0.0
    daily_pnl_pct = (total_daily_pnl / (total_current_value - total_daily_pnl) * 100.0) if (total_current_value - total_daily_pnl) > 0 else 0.0

    # Asset Allocation Breakdown
    allocation_by_type: Dict[str, float] = {}
    for h in active_holdings:
        atype = h["asset_type"].capitalize()
        allocation_by_type[atype] = allocation_by_type.get(atype, 0.0) + h["current_value"]

    allocation_list = []
    for atype, val in allocation_by_type.items():
        pct = (val / total_current_value * 100.0) if total_current_value > 0 else 0.0
        allocation_list.append({"name": atype, "value": round(val, 2), "percentage": round(pct, 2)})
    allocation_list.sort(key=lambda x: x["value"], reverse=True)

    return {
        "portfolio_id": selected_portfolio_id,
        "portfolio_name": active_portfolios[0]["name"] if (selected_portfolio_id and active_portfolios) else "All Portfolios",
        "currency": active_portfolios[0]["currency"] if (selected_portfolio_id and active_portfolios) else (active_portfolios[0]["currency"] if len(set(p["currency"] for p in active_portfolios)) == 1 else "INR"),
        "benchmark": active_portfolios[0]["benchmark"] if (selected_portfolio_id and active_portfolios) else "^GSPC",
        "total_current_value": round(total_current_value, 2),
        "total_cost_basis": round(total_cost_basis, 2),
        "total_unrealized_pnl": round(total_unrealized_pnl, 2),
        "total_realized_pnl": round(total_realized_pnl, 2),
        "total_dividends": round(total_dividends, 2),
        "total_return": round(total_return, 2),
        "total_return_pct": round(total_return_pct, 2),
        "daily_pnl": round(total_daily_pnl, 2),
        "daily_pnl_pct": round(daily_pnl_pct, 2),
        "xirr": round(portfolio_xirr * 100.0, 2) if portfolio_xirr is not None else None,
        "cagr": round(portfolio_cagr * 100.0, 2) if portfolio_cagr is not None else None,
        "earliest_date": earliest_date.isoformat() if earliest_date else None,
        "holdings_count": len(active_holdings),
        "holdings": sorted_holdings,
        "allocations": allocation_list
    }
