import sys
sys.path.append('.')
from backend.vision_parser import _parse_with_gemini
from backend.database import get_setting

with open("/home/yashwanthg/Pictures/INDMoney.png", "rb") as f:
    img_bytes = f.read()

gemini_key = get_setting("gemini_api_key")
print(f"Key loaded: {gemini_key[:5]}...")

try:
    res = _parse_with_gemini(img_bytes, "image/png", gemini_key)
    print("Success:", res)
except Exception as e:
    import traceback
    traceback.print_exc()
