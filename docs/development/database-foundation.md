# DB 물리 설계와 로컬 가상 데이터

기준: ERD v0.3 · 제품 정책 0.2.0 · PostgreSQL 17.11. W05 구현 범위이며 업무 RPC·현재 세션·관계 권한·집계 동시성은 W06에서 검증한다.

## 스키마와 제약

제품 테이블 13개와 운영 보조 테이블 5개를 `public`에 생성한다. Supabase가 관리하는 `auth.users/identities/sessions`는 생성·변경하지 않는다. [논리 ERD](../data-erd.md)의 속성·NULL 가능 여부를 유지하고 UUID·UTC `timestamptz`·명시적인 상태 CHECK·필수 FK를 적용한다. 초기 물리 스키마는 [마이그레이션](../../supabase/migrations/20261008013000_product_schema.sql)에 기록한다.

| 영역 | DB에서 강제하는 내용 | 후속 업무 검사 |
| --- | --- | --- |
| 목표·판 | 목표와 판의 소유자 복합 FK, 목표당 종류별 판 1개, 삭제 시각·파기 기한 | 개인판 필수 생성, 사용자별 개수 상한, 상태 전이 |
| 회차·칭찬 | 현재 포인터/칭찬의 판·회차 일치, 수신자=판 주인, 회차 번호 유일, 개수/완성 일관성 | 첫 칭찬 회차 생성, 집계·완성 소식·잠금, 판 종류와 source |
| 작성자·정리 | self 당사자 일치, peer 실천일 금지, 취소/작성자 제거 때 본문 제거 | 현재 권한·시간대/과거 날짜 검증, 작성자 정리 트랜잭션 |
| 관계·초대 | 정규화 사용자 쌍, 두 해시 필수·유일, 초대당 요청 1개, 관계당 pending 1개 | 당사자와 연결 쌍 일치, 만료·수락·차단·회차 갱신 |
| 판 권한 | 판·사용자 유일, 주인에 의한 grant, 부여 당시 연결 generation 보존 | shared 판 한정, 현재 연결·차단·generation 일치 |
| 소식·중복 | 종류에 맞는 단일 대상, 수신자·dedupe 유일, 사용자·작업·요청 키 유일 | 응답 최소화, 재시도 입력 해시·현재 접근 재검사 |
| 삭제·운영 | FK RESTRICT/NO ACTION, 열린 삭제 작업 1개, 시간창·요청 버킷 유일 | 의존 순서 파기, 재인증 소비, 업무별 요청 제한 |

순환 포인터 `boards(current_bunch_id,id) → bunches(id,board_id)`는 DEFERRABLE NO ACTION이다. 생성 때 NULL로 두고, 정리 때 먼저 포인터를 비운 뒤 자식을 삭제한다. 다른 FK도 자동 CASCADE를 사용하지 않는다. 정책의 삭제 순서와 본문 제거를 SQL 파기 작업에서 명시해야 한다.

UUID 생성은 PostgreSQL의 `gen_random_uuid()`를 사용한다. `varchar` 길이만으로 UTF-16 길이를 판정하지 않고 `char_length`로 Unicode 코드 포인트를 검사한다. 서버/RPC의 NFC·공백 정규화는 후속 구현이다. 목표 개수·인원 상한이나 현재 시각·다른 테이블의 활성 여부는 행 CHECK로 대체하지 않는다.

초대와 정규화 입력의 해시는 소문자 64자리 SHA-256 표현으로 저장한다. 미래의 규칙/역할은 CHECK·RPC·정책을 함께 바꾸는 마이그레이션으로 추가한다. 테마 이름을 목표·칭찬의 집계 규칙으로 사용하지 않는다.

모든 앱 테이블은 RLS ENABLE/FORCE와 anon/authenticated/service_role 직접 권한 회수를 적용한다. `private`에는 API 역할의 USAGE/EXECUTE를 주지 않는다. W06의 최소 권한 RPC 소유자·정책을 설치하기 전에는 API 역할이 데이터를 읽거나 쓰지 못한다. 로컬 SQL 적용·테스트·가상 데이터 준비는 별도의 명시적인 관리자 개발 작업이다.

인덱스는 소유자/상태/날짜+ID 목록, 회차·수신자·작성자 기록, 연결 양쪽 당사자, 권한 회수, 소식·삭제·만료 정리 경로에 둔다. PK/UNIQUE의 인덱스와 동일한 모양은 추가하지 않는다. 실제 업무 조회가 구현되면 EXPLAIN과 예상 규모를 기준으로 조정한다.

## 로컬 실행

고정 Node·Docker·로컬 Supabase가 실행 중이고 `.env.development.local`이 준비되어 있어야 한다. [환경 준비](runtime-setup.md)를 먼저 따른다.

```powershell
.\scripts\project.ps1 -Task db:migrate
.\scripts\project.ps1 -Task db:seed
.\scripts\project.ps1 -Task db:test
```

- `db:migrate`: `supabase migration up --local`. 적용한 SQL 파일을 수정하지 않고 새 파일을 추가한다.
- `db:seed`: 관리 API로 표시된 합성 Auth A/B/C를 준비한 뒤 앱 초기 데이터를 한 번 생성한다. 이메일은 `.invalid`, 비밀번호는 무작위다. 사람의 로그인·성인 동의를 실행한 결과가 아니다.
- `db:test`: pgTAP의 물리 제약·직접 접근 거절 검사. 테스트 데이터·임시 권한·확장은 트랜잭션 안에서 만들고 ROLLBACK한다. 실제 로그인 제공자 수락이나 전체 업무 RPC 검사를 대신하지 않는다.

초기 A는 목표 주인, B는 A와 연결되어 공유판 권한을 받은 지인, C는 관계 없는 사용자다. 개인판·공유판은 각각 목표 개수 20, 현재 회차 NULL로 시작하며 최초 칭찬에서 회차를 만드는 정책을 유지한다. 공유 제목/설명은 개인 메모와 별도 값이다. 연결만 있는 B·해제·재연결 상태는 W06/W09에서 각각 준비해 검증한다.

`private-data/local-fixtures.json`은 Git 제외 파일이며 Auth UUID·로컬 합성 계정 자격증명을 보관한다. Windows에서는 현재 사용자와 SYSTEM에만 새 파일의 접근을 부여하고, 다른 OS는 디렉터리 0700/파일 0600으로 제한한다. 토큰을 보관하거나 출력하지 않는다. 관리 키는 로컬 CLI 상태에서 설정 작업 중에만 얻으며 일반 앱 환경에 저장하지 않는다.

준비 중단 후 같은 표시 계정을 확인해 이어갈 수 있다. 이미 준비한 계정이 사라졌거나 삭제 중이면 실패하고 자동 복구하지 않는다. 초기 데이터 완료 표시 후 재실행은 목표·관계·권한을 다시 쓰지 않는다. 앱 시작 때 자동 seed를 실행하지 않고 `db.seed.enabled=false`를 유지한다. 계정 삭제 기능을 시험한 후 새 데이터가 필요하다면 별도로 폐기 가능한 DB를 준비하는 절차를 기록한다.

Auth의 개발용 관리 메타데이터에는 프로젝트·A/B/C 표식과 무작위 자격증명의 SHA-256 지문을 둔다. 준비가 중단되었을 때 동일한 비공개 준비 기록인지 확인하는 용도다. 준비 파일을 잃어 새 비밀번호를 만들면 기존 계정을 자동 인계하지 않는다. 비밀번호·세션을 앱 테이블에 복제하지 않는다.

명령은 로컬 개발 모드·고정 Node·프로젝트 ID·loopback API/DB 포트·로컬 Docker 소켓을 검사한다. 원격 Supabase/Docker로 연결하는 설정에서는 실행하지 않는다. 이 준비 도구는 브라우저나 서버 API 경로에서 호출하지 않는다.

## 범위와 증거

진행 상태는 [작업 표](backlog.md)의 W05를 기준으로 갱신한다. 실행한 DB 제약/접근 검사 수와 소스 해시는 검사 보고서에 기록한다. 완성된 업무 RPC·세션·공유 접근·동시성·삭제/복원·실제 Google/OTP 검증은 후속 행의 완료 조건으로 남긴다.

참고: [PostgreSQL 17 제약](https://www.postgresql.org/docs/17/ddl-constraints.html), [Supabase 관리 API](https://supabase.com/docs/reference/javascript/auth-admin-createuser), [pgTAP 검사 함수](https://pgtap.org/documentation.html#throws_ok).
