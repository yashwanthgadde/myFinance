#!/usr/bin/env bash
set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" >/dev/null 2>&1 && pwd )"
cd "$DIR"

echo "Checking Python dependencies..."
python3 -m pip install -r requirements.txt --quiet --user || true

echo "Launching myFinance..."
python3 run.py
