import json
import re
import sys
from pathlib import Path

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")


ROOT = Path(__file__).resolve().parents[1]
BOM_ROOT = Path(r"D:\10.Project\BOM")
OUT_PATH = ROOT / "public-data" / "model-summary.json"
EXCEL_EXTENSIONS = {".xlsx", ".xlsm", ".xltx", ".xltm"}
SKIP_PREFIXES = ("~$",)
SKIP_STEMS = {"tonghopbom", "tonghopbomcapnhat"}


def normalize(value):
    return re.sub(r"[\s\-_./\\()（）]+", "", str(value or "").lower())


def is_real_bom_file(path):
    if path.suffix.lower() not in EXCEL_EXTENSIONS:
        return False
    if path.name.startswith(SKIP_PREFIXES):
        return False
    return normalize(path.stem) not in SKIP_STEMS


def customer_from_filename(path):
    match = re.search(r"\(([^()]+)\)$", path.stem)
    return match.group(1).strip() if match else ""


def model_from_filename(path):
    return re.sub(r"\([^()]+\)$", "", path.stem).strip()


def bom_file_rows():
    files = sorted((p for p in BOM_ROOT.glob("*") if p.is_file() and is_real_bom_file(p)), key=lambda p: p.name.lower())
    rows = []
    for path in files:
        rows.append({"path": path, "model": model_from_filename(path), "customerModel": customer_from_filename(path)})
    return rows


def find_summary_workbook():
    candidates = []
    summary_dir = BOM_ROOT / "Kết quả"
    if summary_dir.exists():
        candidates.extend(summary_dir.glob("*.xlsx"))
    outputs_dir = BOM_ROOT / "outputs"
    if outputs_dir.exists():
        candidates.extend(outputs_dir.rglob("Tổng hợp BOM*.xlsx"))
    candidates = [p for p in candidates if p.is_file() and not p.name.startswith(SKIP_PREFIXES)]
    if not candidates:
        return None
    return max(candidates, key=lambda p: p.stat().st_mtime)


def read_existing_rows():
    if not OUT_PATH.exists():
        return []
    return json.loads(OUT_PATH.read_text(encoding="utf-8"))


def read_summary_rows(path):
    if not path:
        return []
    wb = openpyxl.load_workbook(path, data_only=True, read_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return []
    headers = [str(cell or "").replace("\n", "").strip().lower() for cell in rows[0]]

    def idx(*needles):
        for needle in needles:
            for index, header in enumerate(headers):
                if needle.lower() in header:
                    return index
        return None

    columns = {
        "model": idx("model型號", "model"),
        "customerModel": idx("model khách hàng", "客戶型號"),
        "capacitor": idx("tụ điện", "電容器"),
        "motor": idx("loại mô tơ", "馬達類型"),
        "motorLabel": idx("tem mô tơ", "馬達識別標"),
        "powerCord": idx("dây nguồn", "電源線"),
        "powerCordLabel": idx("tem dây nguồn", "電源線標"),
    }
    result = []
    for raw in rows[1:]:
        item = {}
        for key, index in columns.items():
            item[key] = "" if index is None or index >= len(raw) or raw[index] is None else str(raw[index]).strip()
        if item["model"] or item["customerModel"]:
            result.append(item)
    return result


def lookup_key(row):
    return normalize(row.get("customerModel")) or normalize(row.get("model"))


def filename_customer(row, bom_rows):
    model_key = normalize(row.get("model"))
    model_without_customer = normalize(re.sub(r"\([^()]+\)$", "", str(row.get("model") or "")).strip())
    customer_key = normalize(row.get("customerModel"))
    for bom in bom_rows:
        if model_key and model_key == normalize(bom["model"]):
            return bom["customerModel"]
        if model_without_customer and model_without_customer == normalize(bom["model"]):
            return bom["customerModel"]
    for bom in bom_rows:
        if customer_key and customer_key == normalize(bom["customerModel"]):
            return bom["customerModel"]
    return row.get("customerModel", "")


def merge_rows(summary_rows, fallback_rows):
    bom_rows = bom_file_rows()
    by_key = {}
    for row in fallback_rows:
        key = lookup_key(row)
        if key:
            by_key[key] = row
    for row in summary_rows:
        row["customerModel"] = filename_customer(row, bom_rows)
        key = lookup_key(row)
        if key:
            by_key[key] = {**by_key.get(key, {}), **row}

    emitted = set()
    result = []
    for row in summary_rows:
        key = lookup_key(row)
        if key and key not in emitted:
            result.append({**by_key[key]})
            emitted.add(key)

    for bom in bom_rows:
        base = {"model": bom["model"], "customerModel": bom["customerModel"]}
        key = lookup_key(base)
        if key in emitted:
            continue
        result.append({**by_key.get(key, {}), **base})
        emitted.add(key)

    for index, row in enumerate(result, start=1):
        row["stt"] = index
        for field in ("model", "customerModel", "capacitor", "motor", "motorLabel", "powerCord", "powerCordLabel"):
            row.setdefault(field, "")
    return result


def main():
    summary_path = find_summary_workbook()
    summary_rows = read_summary_rows(summary_path)
    fallback_rows = read_existing_rows()
    data = merge_rows(summary_rows, fallback_rows)
    OUT_PATH.parent.mkdir(exist_ok=True)
    OUT_PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    source = summary_path if summary_path else BOM_ROOT
    print(f"Wrote {OUT_PATH} with {len(data)} summary rows from {source}")


if __name__ == "__main__":
    main()
