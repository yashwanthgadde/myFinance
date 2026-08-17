import os
import sys
from datetime import date, timedelta
from backend.database import (
    init_db, get_all_portfolios, create_portfolio, create_transaction, 
    get_transactions, get_all_cached_prices, set_cached_price
)
from backend.financial_engine import (
    calculate_xirr, calculate_cagr, calculate_portfolio_summary, calculate_holding_metrics
)

def test_financial_math():
    print("Testing XIRR and CAGR Engine...")

    # Case 1: Simple 1-year 10% return
    # Buy $1000 on 2023-01-01, worth $1100 on 2024-01-01
    cfs = [
        (date(2023, 1, 1), -1000.0),
        (date(2024, 1, 1), 1100.0)
    ]
    xirr = calculate_xirr(cfs)
    assert xirr is not None, "XIRR should not be None"
    assert abs(xirr - 0.10) < 0.01, f"Expected ~10%, got {xirr * 100}%"
    print(f"  ✓ 1-Year Simple XIRR: {round(xirr * 100, 2)}% (Expected 10.0%)")

    # Case 2: Irregular cash flows with multiple DCA buys + dividend + sell
    cfs_irregular = [
        (date(2022, 1, 15), -5000.0),  # Buy 1
        (date(2022, 7, 1), -2500.0),   # Buy 2
        (date(2023, 3, 15), 200.0),    # Dividend
        (date(2023, 9, 1), -2000.0),   # Buy 3
        (date(2024, 1, 15), 12000.0)   # Current value terminal flow
    ]
    xirr_irr = calculate_xirr(cfs_irregular)
    assert xirr_irr is not None, "Irregular XIRR should be computable"
    print(f"  ✓ Multi-year DCA XIRR: {round(xirr_irr * 100, 2)}%")

    # Case 3: CAGR
    cagr = calculate_cagr(10000, 15000, 3.0)
    assert cagr is not None
    # 15000/10000^(1/3) - 1 = ~14.47%
    assert abs(cagr - 0.1447) < 0.01
    print(f"  ✓ 3-Year CAGR: {round(cagr * 100, 2)}% (Expected 14.47%)")

def test_database_and_summary():
    print("\nTesting Database & Summary Aggregation...")
    init_db()
    
    ports = get_all_portfolios()
    assert len(ports) >= 3, f"Expected default portfolios, got {len(ports)}"
    print(f"  ✓ Portfolios found: {[p['name'] for p in ports]}")

    pid = ports[0]["id"]
    # Add dummy transactions
    create_transaction(
        portfolio_id=pid,
        ticker="AAPL",
        asset_name="Apple Inc.",
        asset_type="EQUITY",
        tx_type="BUY",
        quantity=10,
        price=150.0,
        fees=0.0,
        date="2023-01-15",
        currency="USD"
    )
    
    # Set mock cached price
    set_cached_price("AAPL", 185.0, 2.5, 1.37, "Apple Inc.", "USD", "EQUITY")
    
    price_cache = get_all_cached_prices()
    all_txs = get_transactions()
    summary = calculate_portfolio_summary(ports, all_txs, price_cache, selected_portfolio_id=pid)
    
    assert summary["total_cost_basis"] == 1500.0
    assert summary["total_current_value"] == 1850.0
    assert summary["total_unrealized_pnl"] == 350.0
    assert summary["xirr"] is not None
    print(f"  ✓ Total Value: ${summary['total_current_value']}, Unrealized PnL: ${summary['total_unrealized_pnl']}, XIRR: {summary['xirr']}%")

if __name__ == "__main__":
    try:
        test_financial_math()
        test_database_and_summary()
        print("\n🎉 ALL TESTS PASSED SUCCESSFULLY!")
    except Exception as e:
        print(f"\n❌ TEST FAILED: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
