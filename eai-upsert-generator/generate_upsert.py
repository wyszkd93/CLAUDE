#!/usr/bin/env python3
"""
EAI 수신 UPSERT SQL 생성기

입력: TSV (name, pk, type) 컬럼 목록
출력: PostgreSQL INSERT ... ON CONFLICT DO UPDATE 문 (.sql)

고정 규칙은 README.md 참고.
"""
import argparse
import csv
import sys

EQ_COLUMN = 32  # DO UPDATE SET 절에서 '=' 정렬 위치


def read_columns(path):
    columns = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f, delimiter="\t")
        for row in reader:
            name = (row.get("name") or "").strip()
            if not name:
                continue
            pk = (row.get("pk") or "").strip().upper() == "Y"
            ctype = (row.get("type") or "").strip().upper()
            columns.append({"name": name.lower(), "pk": pk, "type": ctype})
    return columns


def build_sql(table, columns):
    pk_cols = [c["name"] for c in columns if c["pk"]]
    if not pk_cols:
        raise ValueError("PK로 지정된 컬럼이 없습니다 (pk 컬럼 값이 'Y'인 행이 필요합니다)")

    lines = []
    lines.append(f"INSERT INTO {table} (")
    for i, c in enumerate(columns):
        prefix = "     " if i == 0 else "    ,"
        lines.append(f"{prefix}{c['name']}")
    lines.append(") VALUES (")
    for i, c in enumerate(columns):
        prefix = "     " if i == 0 else "    ,"
        bind = f":{c['name'].upper()}"
        if c["type"] == "DATE":
            value = f"TO_TIMESTAMP({bind},'YYYYMMDDHH24MISS')"
        else:
            value = bind
        lines.append(f"{prefix}{value}")
    lines.append(f") ON CONFLICT ({', '.join(pk_cols)}) DO UPDATE SET")
    for i, c in enumerate(columns):
        prefix = "     " if i == 0 else "    ,"
        left = f"{prefix}{c['name']}"
        pad = max(1, EQ_COLUMN - len(left))
        lines.append(f"{left}{' ' * pad}= EXCLUDED.{c['name']}")

    return "\n".join(lines) + "\n"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--table", required=True, help="schema.table 형식의 대상 테이블명")
    ap.add_argument("--input", required=True, help="컬럼 목록 TSV 파일 (name, pk, type)")
    ap.add_argument("--out", required=True, help="생성된 SQL을 저장할 경로")
    args = ap.parse_args()

    columns = read_columns(args.input)
    if not columns:
        print("입력 파일에 컬럼이 없습니다.", file=sys.stderr)
        sys.exit(1)

    sql = build_sql(args.table, columns)

    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(sql)

    print(f"생성 완료: {args.out}")


if __name__ == "__main__":
    main()
