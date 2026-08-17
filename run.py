#!/usr/bin/env python3
"""
myFinance — Interactive Local Investment & Portfolio Tracker
"""
import os
import sys
import uvicorn

def main():
    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "127.0.0.1")
    print(f"\n=======================================================")
    print(f"🚀 Starting myFinance Dashboard at: http://{host}:{port}")
    print(f"📁 Local Database: SQLite (data/myfinance.db)")
    print(f"🔒 100% Private & Self-Contained")
    print(f"=======================================================\n")
    uvicorn.run("backend.app:app", host=host, port=port, reload=True)

if __name__ == "__main__":
    main()
