import json
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DB_PATH = ROOT / "data" / "bom_index.sqlite3"
TERMINOLOGY_PATH = ROOT / "config" / "terminology.json"
OUT_DIR = ROOT / "public-data"
OUT_PATH = OUT_DIR / "bom-data.json"
HIDDEN_MODEL_NAMES = {"tonghopbom", "tonghopbomcapnhat"}
DEFAULT_BOM_DIR = Path(r"D:\10.Project\BOM")


def normalize_text(value):
    import re
    import unicodedata

    text = "".join(ch for ch in unicodedata.normalize("NFD", str(value or "")) if unicodedata.category(ch) != "Mn")
    return re.sub(r"[\s\-_./\\()（）[\]{}]+", "", text.lower())


def is_real_bom(row):
    path = Path(row["path"])
    if path.name.startswith("~$"):
        return False
    if normalize_text(row["model"]) in HIDDEN_MODEL_NAMES:
        return False
    return path.parent == DEFAULT_BOM_DIR


def main():
    OUT_DIR.mkdir(exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    raw_files = [dict(row) for row in conn.execute("SELECT id,path,name,model,row_count,indexed_at FROM files ORDER BY name")]
    real_files = [row for row in raw_files if is_real_bom(row)]
    file_ids = {row["id"] for row in real_files}
    files = [{key: row[key] for key in ("id", "name", "model", "row_count", "indexed_at")} for row in real_files]
    rows = [
        dict(row)
        for row in conn.execute(
            """
            SELECT
                file_id,
                model,
                file_name,
                sheet,
                row_number,
                bom_level,
                part_no,
                name_cn,
                quantity,
                specification
            FROM rows
            WHERE part_no IS NOT NULL
              AND part_no != ''
              AND name_cn IS NOT NULL
              AND name_cn != ''
            ORDER BY file_name,row_number
            """
        )
        if row["file_id"] in file_ids
    ]
    terminology = json.loads(TERMINOLOGY_PATH.read_text(encoding="utf-8"))
    payload = {"files": files, "rows": rows, "terminology": terminology}
    OUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUT_PATH} with {len(files)} files and {len(rows)} rows")


if __name__ == "__main__":
    main()
