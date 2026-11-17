#!/usr/bin/env python3
"""
EAI 송수신 SQL 생성기 (이기종 DB)

입력: TSV (name, pk, type) 컬럼 목록 한 장
출력: 수신(UPSERT) · 송신(SELECT) SQL을 DB 종류별로 생성

- mode=recv (수신): 외부 → 우리 DB 적재. DB별 UPSERT 방식
    postgres : INSERT ... ON CONFLICT (pk) DO UPDATE SET ...
    oracle   : BEGIN  UPDATE ...; IF SQL%NOTFOUND THEN INSERT ...; END IF;  END;
    mysql    : INSERT ... ON DUPLICATE KEY UPDATE ...
- mode=send (송신): 우리 DB → 외부 추출. SELECT
    DATE 컬럼은 외부 전송용 문자열(YYYYMMDDHH24MISS)로 변환

- DATE 변환은 DB마다 다르다 (수신: 문자→날짜 / 송신: 날짜→문자)
- 컬럼은 Oracle 대문자 관례, PostgreSQL·MySQL 소문자. 바인드 변수는 대문자(:COL)
- 입력의 컬럼명/타입만으로 생성한다. 값·업무 규칙은 포함하지 않는다.

고정 규칙은 README.md 참고.
"""
import argparse
import csv
import sys

DBS = ("postgres", "oracle", "mysql")
MODES = ("recv", "send")

# DATE 변환: 수신은 문자열→날짜, 송신은 날짜→문자열
RECV_DATE = {
    "postgres": lambda b: f"TO_TIMESTAMP({b},'YYYYMMDDHH24MISS')",
    "oracle": lambda b: f"TO_DATE({b},'YYYYMMDDHH24MISS')",
    "mysql": lambda b: f"STR_TO_DATE({b},'%Y%m%d%H%i%s')",
}
SEND_DATE = {
    "postgres": lambda c: f"TO_CHAR({c},'YYYYMMDDHH24MISS')",
    "oracle": lambda c: f"TO_CHAR({c},'YYYYMMDDHH24MISS')",
    "mysql": lambda c: f"DATE_FORMAT({c},'%Y%m%d%H%i%s')",
}


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
            columns.append({"name": name, "pk": pk, "type": ctype})
    return columns


def col_ident(name, db):
    """컬럼 식별자 표기 (Oracle 대문자, 그 외 소문자)."""
    return name.upper() if db == "oracle" else name.lower()


def bind(name):
    return ":" + name.upper()


def leading(i):
    """선행 콤마 4칸 들여쓰기 (첫 줄은 콤마 없이)."""
    return "     " if i == 0 else "    ,"


def recv_value(col, db):
    b = bind(col["name"])
    return RECV_DATE[db](b) if col["type"] == "DATE" else b


# ---------------------------------------------------------------- 수신(UPSERT)

def build_recv_postgres(table, columns):
    pk = [col_ident(c["name"], "postgres") for c in columns if c["pk"]]
    lines = [f"INSERT INTO {table} ("]
    for i, c in enumerate(columns):
        lines.append(f"{leading(i)}{col_ident(c['name'], 'postgres')}")
    lines.append(") VALUES (")
    for i, c in enumerate(columns):
        lines.append(f"{leading(i)}{recv_value(c, 'postgres')}")
    lines.append(f") ON CONFLICT ({', '.join(pk)}) DO UPDATE SET")
    for i, c in enumerate(columns):
        name = col_ident(c["name"], "postgres")
        left = f"{leading(i)}{name}"
        pad = max(1, 32 - len(left))
        lines.append(f"{left}{' ' * pad}= EXCLUDED.{name}")
    return "\n".join(lines) + "\n"


def build_recv_mysql(table, columns):
    lines = [f"INSERT INTO {table} ("]
    for i, c in enumerate(columns):
        lines.append(f"{leading(i)}{col_ident(c['name'], 'mysql')}")
    lines.append(") VALUES (")
    for i, c in enumerate(columns):
        lines.append(f"{leading(i)}{recv_value(c, 'mysql')}")
    lines.append(") ON DUPLICATE KEY UPDATE")
    # PK는 갱신하지 않는다 (MySQL 관례)
    upd = [c for c in columns if not c["pk"]] or columns
    for i, c in enumerate(upd):
        name = col_ident(c["name"], "mysql")
        left = f"{leading(i)}{name}"
        pad = max(1, 32 - len(left))
        lines.append(f"{left}{' ' * pad}= VALUES({name})")
    return "\n".join(lines) + "\n"


def build_recv_oracle(table, columns):
    pk = [c for c in columns if c["pk"]]
    non_pk = [c for c in columns if not c["pk"]]
    if not pk:
        raise ValueError("PK로 지정된 컬럼이 없습니다 (pk 값이 'Y'인 행 필요)")

    def ident(c):
        return col_ident(c["name"], "oracle")

    lines = ["BEGIN", f"  UPDATE {table} SET"]
    for i, c in enumerate(non_pk or columns):
        lines.append(f"  {leading(i)}{ident(c)} = {recv_value(c, 'oracle')}")
    where = " AND ".join(f"{ident(c)} = {bind(c['name'])}" for c in pk)
    lines.append(f"   WHERE {where};")
    lines.append("")
    lines.append("  IF SQL%NOTFOUND THEN")
    lines.append(f"    INSERT INTO {table} (")
    for i, c in enumerate(columns):
        lines.append(f"    {leading(i)}{ident(c)}")
    lines.append("    ) VALUES (")
    for i, c in enumerate(columns):
        lines.append(f"    {leading(i)}{recv_value(c, 'oracle')}")
    lines.append("    );")
    lines.append("  END IF;")
    lines.append("END;")
    return "\n".join(lines) + "\n"


RECV = {
    "postgres": build_recv_postgres,
    "oracle": build_recv_oracle,
    "mysql": build_recv_mysql,
}


# ---------------------------------------------------------------- 송신(SELECT)

def build_send(table, columns, db):
    lines = ["SELECT"]
    for i, c in enumerate(columns):
        name = col_ident(c["name"], db)
        if c["type"] == "DATE":
            expr = f"{SEND_DATE[db](name)} AS {name}"
        else:
            expr = name
        lines.append(f"{leading(i)}{expr}")
    lines.append(f"FROM {table}")
    return "\n".join(lines) + "\n"


# ---------------------------------------------------------------- main

def build_sql(table, columns, db, mode):
    if not columns:
        raise ValueError("입력 파일에 컬럼이 없습니다.")
    if mode == "send":
        return build_send(table, columns, db)
    return RECV[db](table, columns)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--table", required=True, help="schema.table 형식의 대상 테이블명")
    ap.add_argument("--input", required=True, help="컬럼 목록 TSV 파일 (name, pk, type)")
    ap.add_argument("--out", required=True, help="생성된 SQL을 저장할 경로")
    ap.add_argument("--db", choices=DBS, default="postgres", help="대상 DB 종류 (기본: postgres)")
    ap.add_argument("--mode", choices=MODES, default="recv", help="recv=수신(UPSERT) / send=송신(SELECT) (기본: recv)")
    args = ap.parse_args()

    columns = read_columns(args.input)
    if not columns:
        print("입력 파일에 컬럼이 없습니다.", file=sys.stderr)
        sys.exit(1)

    try:
        sql = build_sql(args.table, columns, args.db, args.mode)
    except ValueError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        f.write(sql)

    print(f"생성 완료: {args.out}  (db={args.db}, mode={args.mode})")


if __name__ == "__main__":
    main()
