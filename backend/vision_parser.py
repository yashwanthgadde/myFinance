import os
import json
import base64
import io
import re
from typing import List, Dict, Any, Optional
from PIL import Image
from .database import get_setting

EXTRACTION_SYSTEM_PROMPT = """
You are an expert financial transaction extraction system for an investment tracking dashboard.
Analyze the provided screenshot of a trade confirmation, brokerage order book, contract note, or portfolio transaction history.
Screenshots can be from any broker worldwide (e.g. Zerodha, Groww, Robinhood, Charles Schwab, Fidelity, Vanguard, Webull, CoinDCX, Binance, E*TRADE, Interactive Brokers, HDFC Securities, etc.).

Extract all transaction records found in the image and output strictly valid JSON in the following schema:
{
  "broker_detected": "Broker Name or Unknown",
  "confidence": "high" | "medium" | "low",
  "transactions": [
    {
      "ticker": "SYMBOL",              // Ticker symbol (e.g., AAPL, NVDA, RELIANCE.NS, TCS.NS, BTC-USD, VOO). If Indian stock, append .NS for NSE or .BO for BSE if known.
      "asset_name": "Full Asset Name",  // e.g. "Apple Inc.", "Reliance Industries Ltd"
      "asset_type": "EQUITY" | "ETF" | "MUTUALFUND" | "CRYPTOCURRENCY",
      "type": "BUY" | "SELL" | "DIVIDEND",
      "quantity": 10.0,                 // Number of shares/units (float)
      "price": 150.25,                  // Price per share/unit in the transaction currency (float)
      "fees": 0.0,                      // Brokerage, taxes, STT, commission (float, 0 if not listed)
      "date": "YYYY-MM-DD",             // Transaction date in YYYY-MM-DD format (use current year if year is omitted)
      "currency": "USD" | "INR" | "EUR" | "GBP", // Detected currency symbol (e.g., $, ₹, €, £)
      "notes": "Brief extra context e.g. Order ID, Exchange (NSE/NYSE)"
    }
  ],
  "raw_notes": "Optional short summary of what was detected"
}

Important Rules:
1. Ensure quantity and price are positive floating point numbers.
2. If there are multiple orders/fills in the screenshot, extract each as a separate item in the transactions list.
3. If the date format is DD/MM/YYYY or DD-Mon-YYYY, convert it to standard YYYY-MM-DD.
4. Output ONLY valid JSON, without any markdown backticks or commentary.
"""

def extract_transactions_from_image(image_bytes: bytes, mime_type: str = "image/png") -> Dict[str, Any]:
    """
    Parses a screenshot of transactions using Gemini or OpenAI vision models,
    falling back gracefully with actionable status.
    """
    gemini_key = get_setting("gemini_api_key") or os.environ.get("GEMINI_API_KEY")
    openai_key = get_setting("openai_api_key") or os.environ.get("OPENAI_API_KEY")

    # 1. Try Gemini Vision if key exists
    if gemini_key:
        try:
            return _parse_with_gemini(image_bytes, mime_type, gemini_key)
        except Exception as e:
            gemini_error = str(e)
    else:
        gemini_error = "Gemini API key not configured in Settings."

    # 2. Try OpenAI Vision if key exists
    if openai_key:
        try:
            return _parse_with_openai(image_bytes, mime_type, openai_key)
        except Exception as e:
            openai_error = str(e)
    else:
        openai_error = "OpenAI API key not configured in Settings."

    # 3. Fallback demo parser if no API key is configured yet
    return {
        "broker_detected": "Manual / Unconfigured Vision API",
        "confidence": "low",
        "requires_api_key": True,
        "error_message": f"To automatically parse real screenshots, please provide a free Google Gemini API Key in the Settings tab. (Gemini: {gemini_error})",
        "transactions": [
            {
                "ticker": "AAPL",
                "asset_name": "Apple Inc.",
                "asset_type": "EQUITY",
                "type": "BUY",
                "quantity": 10.0,
                "price": 185.50,
                "fees": 1.50,
                "date": datetime_today_str(),
                "currency": "USD",
                "notes": "Sample extracted template — edit values or add your Gemini API Key in Settings"
            }
        ],
        "raw_notes": "Sample trade generated. Please enter your Gemini API Key in Settings to extract live broker screenshots directly."
    }

def datetime_today_str() -> str:
    import datetime
    return datetime.date.today().strftime("%Y-%m-%d")

def _parse_with_gemini(image_bytes: bytes, mime_type: str, api_key: str) -> Dict[str, Any]:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=api_key)
    
    response = client.models.generate_content(
        model='gemini-2.5-flash',
        contents=[
            types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            EXTRACTION_SYSTEM_PROMPT
        ],
        config=types.GenerateContentConfig(
            response_mime_type="application/json"
        )
    )

    text_resp = response.text.strip()
    # Clean possible markdown wrap
    if text_resp.startswith("```json"):
        text_resp = text_resp[7:]
    if text_resp.startswith("```"):
        text_resp = text_resp[3:]
    if text_resp.endswith("```"):
        text_resp = text_resp[:-3]
    text_resp = text_resp.strip()

    parsed = json.loads(text_resp)
    return parsed

def _parse_with_openai(image_bytes: bytes, mime_type: str, api_key: str) -> Dict[str, Any]:
    import urllib.request
    
    b64_image = base64.b64encode(image_bytes).decode('utf-8')
    data_url = f"data:{mime_type};base64,{b64_image}"

    payload = {
        "model": "gpt-4o-mini",
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": EXTRACTION_SYSTEM_PROMPT},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": data_url
                        }
                    }
                ]
            }
        ],
        "max_tokens": 1500
    }

    req = urllib.request.Request(
        "https://api.openai.com/v1/chat/completions",
        data=json.dumps(payload).encode('utf-8'),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}"
        }
    )

    with urllib.request.urlopen(req) as resp:
        res_json = json.loads(resp.read().decode('utf-8'))
        content = res_json["choices"][0]["message"]["content"]
        return json.loads(content)
