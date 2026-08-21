import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SEARCH_HTML = Path(r"D:\10.Project\Search\bom-model-lookup.html")
OUT_PATH = ROOT / "public-data" / "model-summary.json"


def main():
    source = SEARCH_HTML.read_text(encoding="utf-8")
    match = re.search(r"const\s+bomData\s*=\s*(\[.*?\]);", source, re.S)
    if not match:
        raise RuntimeError(f"Cannot find bomData in {SEARCH_HTML}")
    data = json.loads(match.group(1))
    OUT_PATH.parent.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(data)} summary rows")


if __name__ == "__main__":
    main()
