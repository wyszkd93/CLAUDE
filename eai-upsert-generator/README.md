# EAI 수신 UPSERT SQL 생성기

EAI 연동으로 수신되는 데이터를 PostgreSQL `INSERT ... ON CONFLICT DO UPDATE` (UPSERT) 문으로
자동 생성하는 스크립트입니다. 컬럼이 수백 개인 인터페이스도 실수 없이 생성합니다.

## 고정 포맷 규칙

- `INSERT INTO <schema.table> ( ... ) VALUES ( ... ) ON CONFLICT (<PK 컬럼들>) DO UPDATE SET ...`
- 컬럼 구분자는 선행 콤마(leading comma), 4칸 들여쓰기
- **문 끝에 세미콜론(;) 없음** (EAI 툴에서 세미콜론 없이 등록)
- 컬럼명은 소문자, `VALUES` 절의 바인드 변수는 **대문자** (`:CMP_CD`)
- **PK 컬럼도 `DO UPDATE SET`에 포함**
- 사용자가 명시적으로 DATE라고 지정한 컬럼만 `TO_TIMESTAMP(:COLUMN,'YYYYMMDDHH24MISS')`로 변환
  (`_dt`로 끝나도 실제로 varchar인 경우가 많으므로 임의 추측 금지)
- `DO UPDATE SET`은 `= EXCLUDED.<column>` 형태, `=` 위치를 32칸으로 정렬

## 사용법

### 1. 입력 파일 준비 (TSV)

`examples/sample_input.tsv` 형식을 참고해 컬럼 목록을 작성합니다.

컬럼: `name`(필드명) / `pk`(Y/N) / `type`(DATE 인 경우만 `DATE`, 나머지는 빈 값)

### 2. 실행

```bash
python generate_upsert.py --table public.eai_recv_sample --input examples/sample_input.tsv --out output/eai_recv_sample.sql
```

### 3. 결과

`output/` 폴더에 `.sql` 파일로 생성됩니다 (마크다운 이탤릭 변환으로 `_`가 깨지는 문제 회피).

## 규칙 출처

작성 규칙은 사용자 피드백 기반으로 고정되었으며, Claude 메모리
(`eai-upsert-sql-format`)에도 동일하게 기록되어 있습니다.
