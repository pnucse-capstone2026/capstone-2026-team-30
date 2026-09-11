# Phase 4: 배포 스크립트 CLI/대화형 옵션 및 K8s 시크릿 연동 테스트 설계서

## 1. 개요 (Overview)
* **테스트 대상**:
  * `scripts/deploy.sh` (및 `install.sh` 심볼릭 링크)
  * `redeploy.sh`
* **테스트 프레임워크/스크립트**: `scripts/tests/test-deploy-modular-flags.sh`
* **목적**:
  1. 배포 스크립트의 도움말(`--help`)에 신규 모듈 플래그(`--enable-mlops`, `--disable-mlops`, `--modules` 등)가 올바르게 문서화되었는지 확인.
  2. `--disable-mlops` 옵션 적용 시 Dry-run 모드에서 MLOps 매니페스트(`notebook-controller`, CRD) 렌더링이 완전하게 건너뛰어지는지 검증.
  3. `--enable-mlops`(기본값) 실행 시 MLOps 확장 매니페스트가 정상적으로 포함되어 렌더링되는지 확인.
  4. `--modules <list>` 콤마 분리 플래그(예: `--modules core,simulation`) 파싱 로직의 정합성 검증.
  5. 플랫폼 Secret(`kyverno-platform-secret`)에 `MODULE_MLOPS_ENABLED`, `MODULE_AI_AGENT_ENABLED`, `MODULE_SIMULATION_ENABLED`, `MODULE_GITOPS_ENABLED` 리터럴이 동적으로 주입되는지 무결성 검증.
  6. MLOps 전용 정책(`policies/mlops/*.yaml`)이 모듈 활성화 여부에 따라 조건부로 적용되는지 확인.

---

## 2. 테스트 케이스 명세 (Test Cases)

### 2.1. CLI 사용법 및 옵션 명세 (`deploy.sh --help`)
| 번호 | 테스트 케이스 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- |
| **TC-4.1.1** | MLOps 활성화 플래그 명세 | `--enable-mlops` 옵션 안내 출력 | PASS |
| **TC-4.1.2** | MLOps 비활성화 플래그 명세 | `--disable-mlops` 옵션 안내 출력 | PASS |
| **TC-4.1.3** | AI 진단 플래그 명세 | `--enable-ai` 옵션 안내 출력 | PASS |
| **TC-4.1.4** | 정책 시뮬레이션 플래그 명세 | `--enable-simulation` 옵션 안내 출력 | PASS |
| **TC-4.1.5** | 모듈 목록 명시 플래그 명세 | `--modules <list>` 옵션 안내 출력 | PASS |

### 2.2. MLOps 비활성화 Dry-run 동작 검증 (`--disable-mlops`)
| 번호 | 테스트 케이스 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- |
| **TC-4.2.1** | Core 매니페스트 정상 렌더링 | Backend, Frontend, Postgres, RBAC 매니페스트 출력 | PASS |
| **TC-4.2.2** | MLOps 모듈 렌더링 스킵 | MLOps 건너뜀 안내 로그 표출 | PASS |
| **TC-4.2.3** | MLOps 리소스 누출 방지 | `notebook-controller-deployment` 미출력 확인 | PASS |

### 2.3. MLOps 활성화 Dry-run 동작 검증 (`--enable-mlops`)
| 번호 | 테스트 케이스 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- |
| **TC-4.3.1** | Core 매니페스트 정상 렌더링 | Core Kustomize 매니페스트 출력 | PASS |
| **TC-4.3.2** | MLOps 확장 매니페스트 렌더링 | MLOps Kustomize 렌더링 로그 표출 | PASS |
| **TC-4.3.3** | Notebook Controller 포함 | `notebook-controller-deployment` 정상 출력 | PASS |

### 2.4. `--modules` 콤마 분리 파라미터 처리 검증
| 번호 | 테스트 케이스 | 입력 조건 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-4.4.1** | 미지정 모듈 비활성화 | `--modules core,simulation` | `ENABLE_MLOPS=false` 처리로 MLOps 렌더링 스킵 | PASS |
| **TC-4.4.2** | 명시된 모듈 활성화 | `--modules core,mlops` | `ENABLE_MLOPS=true` 처리로 MLOps 렌더링 포함 | PASS |

### 2.5. K8s Secret 주입 및 정책 조건부 적용 코드 무결성
| 번호 | 테스트 케이스 | 검증 대상 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-4.5.1** | MLOps 환경 변수 주입 | `kyverno-platform-secret` | `MODULE_MLOPS_ENABLED="${ENABLE_MLOPS}"` 리터럴 포함 | PASS |
| **TC-4.5.2** | AI Agent 환경 변수 주입 | `kyverno-platform-secret` | `MODULE_AI_AGENT_ENABLED="${ENABLE_AI}"` 리터럴 포함 | PASS |
| **TC-4.5.3** | Simulation 환경 변수 주입 | `kyverno-platform-secret` | `MODULE_SIMULATION_ENABLED="${ENABLE_SIMULATION}"` 리터럴 포함 | PASS |
| **TC-4.5.4** | GitOps 환경 변수 주입 | `kyverno-platform-secret` | `MODULE_GITOPS_ENABLED="${ENABLE_GITOPS}"` 리터럴 포함 | PASS |
| **TC-4.5.5** | MLOps 정책 조건부 적용 | 정책 배포 루프 | `ENABLE_MLOPS=true`일 때만 `policies/mlops/` apply | PASS |

---

## 3. 실행 방법 및 결과
```bash
./scripts/tests/test-deploy-modular-flags.sh
```
* **결과**: 18 Passed / 0 Failed (100% 통과)
