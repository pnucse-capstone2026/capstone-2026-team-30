# Phase 2: 백엔드 SystemModule 및 동적 모듈 로딩 테스트 설계서

## 1. 개요 (Overview)
* **테스트 대상**:
  * `apps/backend/src/system/system.service.ts`
  * `apps/backend/src/system/system.controller.ts`
  * `apps/backend/src/app.module.ts` (`getOptionalModules`)
* **테스트 프레임워크**: Jest (`ts-jest`), NestJS TestingModule
* **목적**:
  1. 런타임 환경 변수(`MODULE_*_ENABLED`)에 따라 모듈 활성화 상태가 올바르게 판별되는지 검증.
  2. 하위 호환성을 위해 환경 변수 미지정 시 기본값(`true`)으로 정상 초기화되는지 확인.
  3. REST API 엔드포인트(`GET /api/system/modules`)가 Swagger 규격에 맞는 메타데이터를 클라이언트에 정확히 전달하는지 확인.
  4. 루트 `AppModule`에서 비활성화된 확장 모듈(`MlopsModule` 등)이 의존성 주입 트리에서 완전히 제외되어 불필요한 백그라운드 Cron이나 리소스 낭비가 발생하지 않는지 검증.

---

## 2. 테스트 케이스 명세 (Test Cases)

### 2.1. SystemService 단위 테스트 (`system.service.spec.ts`)
| 번호 | 테스트 케이스 | 입력 조건 | 검증 항목 | 기대 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-2.1.1** | Core 모듈 필수성 보장 | 환경 변수 없음 | `core.enabled === true`, `core.required === true` | PASS |
| **TC-2.1.2** | 기본값 하위 호환성 | 환경 변수 없음 | `mlops`, `aiAgent`, `simulation`, `gitops` 모두 `enabled: true` | PASS |
| **TC-2.1.3** | MLOps 모듈 비활성화 격리 | `MODULE_MLOPS_ENABLED="false"` | `mlops.enabled === false`, `isModuleEnabled('mlops') === false`, 타 모듈 영향 없음 | PASS |
| **TC-2.1.4** | 대소문자 무관 파싱 | `MODULE_AI_AGENT_ENABLED="False"`, `MODULE_SIMULATION_ENABLED="FALSE"` | 대소문자 관계없이 `enabled === false` 정상 파싱 | PASS |

### 2.2. SystemController 단위 테스트 (`system.controller.spec.ts`)
| 번호 | 테스트 케이스 | 입력 조건 | 검증 항목 | 기대 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-2.2.1** | 모듈 목록 조회 API 호출 | `GET /system/modules` | `SystemService.getModules()` 호출 및 DTO 응답 일치 | PASS |

### 2.3. AppModule 동적 모듈 로딩 테스트 (`app.module.spec.ts`)
| 번호 | 테스트 케이스 | 환경 변수 조건 | 검증 항목 | 기대 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-2.3.1** | 기본 로딩 | 환경 변수 없음 | `MlopsModule`, `SimulationModule`, `AiAgentModule`, `GitOpsModule` 전체 포함 | PASS |
| **TC-2.3.2** | MLOps 제외 로딩 | `MODULE_MLOPS_ENABLED="false"` | `MlopsModule` 제외, 타 선택 모듈 유지 | PASS |
| **TC-2.3.3** | 전체 확장 모듈 비활성화 | 전체 `MODULE_*_ENABLED="false"` | `getOptionalModules()` 빈 배열 반환 | PASS |

---

## 3. 실행 방법 및 결과
```bash
cd apps/backend && pnpm test system
```
* **결과**:
  * Test Suites: 3 passed, 3 total
  * Tests: 8 passed, 8 total
  * Snapshots: 0 total
  * Time: 4.358 s
