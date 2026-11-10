# 원장 확인 뒤 진행하는 계정 삭제 작업자

W14-C1 / REQ-010·NFR-001·NFR-004 / POL-DELETE-002·003 / TC-DELETE-WORKER-LOCAL-001

DB의 삭제 checkpoint와 실제 Auth 삭제를 연결하고 원장 완료 확인 전에는 재시도를 유지하는 작업자를 추가했다. 새 private lease/ACK 테이블과 service-only RPC는 예약 중복을 줄이고 완료 확인 누락을 복구한다. 일반 웹에는 관리 키나 작업자를 연결하지 않았다.

로컬 원장 어댑터는 DB 밖 파일에 최소 UUID 기록을 암호화하고 미완료 무기한·완료 후 최소 37일 보관을 검증한다. 운영 다중 프로세스 저장소·스케줄로 선택한 구현은 아니다. 로컬 실제 Auth 2명의 격리 검사 8개, 전체 DB 426개, 전체 단위 260개와 빌드를 확인한다. 기존 제품/인증 데이터·키·gate·내부 상태를 보존했다. Docker 포트 장애는 차곡찬 컨테이너만 볼륨을 보존해 재시작하여 복구했으며 다른 컨테이너를 재시작하지 않았다.

Codex 직접 검토에서 service-only 권한·고정 search_path·대상 UUID 결합·원장 선기록·Auth 404 확인·완료 확인 재시도·원문 없는 오류를 확인했다. 실제 Google·호스팅 원장·계정 외 삭제 원장·접수 직후 원장 장애 경계·전체 백업 복원·공개 배포는 미완료다. TC-DELETE-003/004 상태는 변경하지 않는다. [내부 계약](../development/deletion-worker.md) · [검사 증거](../quality/reports/w14-c1-deletion-worker-check-2026-11-10.json)
