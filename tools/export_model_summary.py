import json
import re
import sqlite3
import sys
from pathlib import Path

import openpyxl

sys.stdout.reconfigure(encoding="utf-8")


ROOT = Path(__file__).resolve().parents[1]
BOM_ROOT = Path(r"D:\10.Project\BOM")
OUT_PATH = ROOT / "public-data" / "model-summary.json"
DB_PATH = ROOT / "data" / "bom_index.sqlite3"
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


def format_capacitor(text):
    cap = re.search(r"(\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)?)\s*U?F\s*[-/]?\s*(\d{3})\s*V", text, re.I)
    if not cap:
        return ""
    extra = ""
    tail = text[cap.end() : cap.end() + 30]
    plus = re.search(r"\+(\d+(?:\.\d+)?(?:\+\d+(?:\.\d+)?)?)", tail)
    grade = re.search(r"([A-Z]{1,3}|[IVX]{1,4})\s*級", tail, re.I)
    if plus:
        extra += f" {plus.group(1)}"
    if grade:
        extra += f" cấp {grade.group(1).upper()}"
    return f"{cap.group(1)} µF {cap.group(2)}V{extra}"


def clean_motor_label(text):
    match = re.search(r"(?i)impedance\s*-?\s*protected\s*[-'\" ]*\s*([A-Z]{1,3})\s*[-'\" ]*\s*([0-9A-Z]+(?:[-'\"]\d+)*)?", text)
    if not match:
        return ""
    suffix = match.group(1).upper()
    if match.group(2):
        extra = match.group(2).replace("'", "").replace('"', "")
        if extra.upper() != "UL" and not extra.upper().startswith("UL-"):
            suffix += f"-{extra}"
    return f"ImpedanceProtected-{suffix}"


def build_motor_lookup(rows):
    lookup = {}
    for row in rows:
        label = row.get("motorLabel") or ""
        motor = row.get("motor") or ""
        if label and motor:
            lookup.setdefault(label, motor)
    return lookup


def row_text(row):
    return " ".join(str(row.get(key) or "") for key in ("name_cn", "quantity", "specification", "search_text"))


def has_light_wire_label(row):
    text = row_text(row)
    return "燈線標" in text or "灯线标" in text


def load_index_rows(customer_model):
    if not DB_PATH.exists():
        return []
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        file_row = conn.execute("SELECT id FROM files WHERE name LIKE ? ORDER BY indexed_at DESC", (f"%({customer_model}).%",)).fetchone()
        if not file_row:
            return []
        return [
            dict(row)
            for row in conn.execute(
                """
                SELECT row_number,bom_level,part_no,name_cn,quantity,specification,search_text
                FROM rows
                WHERE file_id=?
                ORDER BY row_number
                """,
                (file_row["id"],),
            )
        ]


def derive_row_fields(row, motor_lookup):
    rows = load_index_rows(row.get("customerModel", ""))
    derived = {}
    for item in rows:
        text = row_text(item)
        if not derived.get("capacitor") and ("電容" in text or "电容" in text):
            derived["capacitor"] = format_capacitor(text)
        if not derived.get("motorLabel"):
            derived["motorLabel"] = clean_motor_label(text)
        if not derived.get("powerCord") and ("電源線組" in text or "电源线组" in text):
            match = re.search(r"(101[05])\s*#?\s*18.*?(\d{2,3})\s*cm", text, re.I | re.S)
            if match:
                derived["powerCord"] = f"{match.group(1)}#18 - {match.group(2)}cm"
            label_count = len(re.findall(r"標|标", item.get("specification") or ""))
            if label_count:
                derived["powerCordLabel"] = f"{label_count} tem"
    if not derived.get("powerCordLabel") and any(has_light_wire_label(item) for item in rows):
        derived["powerCordLabel"] = "1 tem"
    label = derived.get("motorLabel") or row.get("motorLabel")
    if label and not derived.get("motor"):
        derived["motor"] = motor_lookup.get(label, "")
    return {key: value for key, value in derived.items() if value}


def filename_customer(row, bom_rows):
    model_key = normalize(row.get("model"))
    model_without_customer = normalize(re.sub(r"\([^()]+\)$", "", str(row.get("model") or "")).strip())
    customer_key = normalize(row.get("customerModel"))
    for bom in bom_rows:
        if customer_key and customer_key == normalize(bom["customerModel"]):
            return bom["customerModel"]
    for bom in bom_rows:
        if model_key and model_key == normalize(bom["model"]):
            return bom["customerModel"]
        if model_without_customer and model_without_customer == normalize(bom["model"]):
            return bom["customerModel"]
    return row.get("customerModel", "")


def merge_rows(summary_rows, fallback_rows):
    bom_rows = bom_file_rows()
    motor_lookup = build_motor_lookup([*fallback_rows, *summary_rows])
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
        base = {"model": bom["model"], "customerModel": bom["customerModel"], "_fromBomOnly": True}
        key = lookup_key(base)
        if key in emitted:
            continue
        result.append({**by_key.get(key, {}), **base})
        emitted.add(key)

    for index, row in enumerate(result, start=1):
        row["stt"] = index
        for field in ("model", "customerModel", "capacitor", "motor", "motorLabel", "powerCord", "powerCordLabel"):
            row.setdefault(field, "")
        if row.get("_fromBomOnly") or any(not row.get(field) for field in ("capacitor", "motor", "motorLabel", "powerCord", "powerCordLabel")):
            derived = derive_row_fields(row, motor_lookup)
            for field, value in derived.items():
                if row.get("_fromBomOnly") or not row.get(field):
                    row[field] = value
        row.pop("_fromBomOnly", None)
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
