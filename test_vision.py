import sys
sys.path.append('.')
from backend.vision_parser import _parse_with_gemini
from backend.database import get_setting
with open("/home/yashwanthg/Pictures/INDMoney.png", "rb") as f:
    img_bytes = f.read()

try:
    res = _parse_with_gemini(img_bytes, "image/png", get_setting("gemini_api_key"))
    print("Success:", res)
except Exception as e:
    print("Error:", e)
