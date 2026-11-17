# EAI 송수신 SQL 생성기 (이기종 DB)

EAI 연동 인터페이스의 **송신(SELECT) · 수신(UPSERT)** SQL을, 컬럼 목록 한 장(TSV)만으로
**DB 종류별로** 자동 생성하는 스크립트입니다. 컬럼이 수백 개인 인터페이스도 실수 없이 만듭니다.

입력은 `name / pk / type` 세 칸뿐이고, DB 방언·날짜 변환·UPSERT 방식의 차이는 스크립트가 알아서 맞춥니다.

## 무엇을 만드나

| mode | 방향 | 생성물 |
|---|---|---|
| `recv` (수신) | 외부 → 우리 DB 적재 | DB별 UPSERT (있으면 UPDATE, 없으면 INSERT) |
| `send` (송신) | 우리 DB → 외부 추출 | SELECT (DATE는 전송용 문자열로 변환) |

### 수신(UPSERT)은 DB마다 방식이 다릅니다

| DB | 방식 |
|---|---|
| PostgreSQL | `INSERT ... ON CONFLICT (pk) DO UPDATE SET ...` |
| Oracle | `BEGIN  UPDATE ...; IF SQL%NOTFOUND THEN INSERT ...; END IF;  END;` (MERGE 없이 블록으로) |
| MySQL | `INSERT ... ON DUPLICATE KEY UPDATE ...` |

### 날짜 변환도 DB·방향마다 다릅니다

| | PostgreSQL | Oracle | MySQL |
|---|---|---|---|
| 수신(문자→날짜) | `TO_TIMESTAMP(:C,'YYYYMMDDHH24MISS')` | `TO_DATE(:C,'YYYYMMDDHH24MISS')` | `STR_TO_DATE(:C,'%Y%m%d%H%i%s')` |
| 송신(날짜→문자) | `TO_CHAR(c,'YYYYMMDDHH24MISS')` | `TO_CHAR(c,'YYYYMMDDHH24MISS')` | `DATE_FORMAT(c,'%Y%m%d%H%i%s')` |

- 컬럼명은 Oracle 대문자 관례, PostgreSQL·MySQL 소문자. 바인드 변수는 대문자(`:CMP_CD`)
- 선행 콤마(leading comma) · 4칸 들여쓰기
- `DATE`로 **명시한 컬럼만** 날짜 변환 (`_dt`로 끝나도 실제 varchar인 경우가 많아 임의 추측 금지)
- 값·업무 규칙(처리 플래그 등)은 넣지 않습니다. 컬럼 구조만으로 틀을 만드는 것이 목적입니다

## 사용법

### 1. 입력 파일 준비 (TSV)

`examples/sample_input.tsv` 형식. 컬럼: `name`(필드명) / `pk`(Y·N) / `type`(DATE인 경우만 `DATE`)

### 2. 실행

```bash
# 수신(UPSERT) — DB별
python generate_sql.py --db postgres --mode recv --table public.eai_sample --input examples/sample_input.tsv --out output/recv_postgres.sql
python generate_sql.py --db oracle   --mode recv --table IF_SAMPLE         --input examples/sample_input.tsv --out output/recv_oracle.sql
python generate_sql.py --db mysql    --mode recv --table eai_sample        --input examples/sample_input.tsv --out output/recv_mysql.sql

# 송신(SELECT)
python generate_sql.py --db oracle   --mode send --table IF_SAMPLE         --input examples/sample_input.tsv --out output/send_oracle.sql
```

옵션: `--db postgres|oracle|mysql` (기본 postgres), `--mode recv|send` (기본 recv)

### 3. 결과

`output/` 폴더에 `.sql` 파일로 생성됩니다. `output/` 아래에 DB·방향별 예시가 들어 있습니다.

## 메모

- 예시의 테이블·컬럼명은 모두 일반화한 가짜 값입니다.
- 작성 규칙은 사용자 피드백 기반으로 고정했으며 Claude 메모리(`eai-upsert-sql-format`)에도 기록되어 있습니다.
