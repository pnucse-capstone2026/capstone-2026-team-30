# Phase 3: 프론트엔드 동적 UX 및 라우트 보호 테스트 설계서

## 1. 개요 (Overview)
* **테스트 대상**:
  * `apps/frontend/src/lib/system-modules.ts`
  * `apps/frontend/src/components/dashboard/dashboard-sidebar.tsx`
  * `apps/frontend/src/components/ui/module-disabled-notice.tsx`
  * `apps/frontend/src/app/mlops/layout.tsx`
* **테스트 프레임워크/스크립트**: `Next.js Build Pipeline`, `scripts/tests/test-frontend-modular-ux.sh`
* **목적**:
  1. 프론트엔드 런타임에서 백엔드 시스템 모듈 상태(`/api/system/modules`)를 조회하여 모듈별 활성화 여부를 전역 공유하는지 검증.
  2. 비활성화된 모듈(MLOps, Simulation, AI Agent 등)이 사용자 및 관리자 사이드바 네비게이션에서 자동으로 제외(은닉)되는지 확인.
  3. 브라우저 주소창 직접 입력을 통해 비활성화된 라우트(`/mlops/*`)로 접근 시 친절한 안내 컴포넌트(`ModuleDisabledNotice`)가 렌더링되고 하위 리소스 요청이 차단되는지 확인.
  4. Next.js 15 App Router 정적 빌드(`next build`)와의 완벽한 컴파일 및 렌더링 무결성 검증.

---

## 2. 테스트 케이스 명세 (Test Cases)

### 2.1. 시스템 모듈 클라이언트 스토어 명세 (`system-modules.ts`)
| 번호 | 테스트 케이스 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- |
| **TC-3.1.1** | 타입 선언 무결성 | `PlatformModuleId` 유니온 타입 및 `ModuleMetadata` 인터페이스 수출 | PASS |
| **TC-3.1.2** | Fallback 기본값 보장 | 네트워크 지연/오프라인 시 사용할 `DEFAULT_MODULES` 선언 및 Core 필수 설정 | PASS |
| **TC-3.1.3** | 활성화 여부 판별 헬퍼 | `isModuleEnabled(moduleId)` 함수가 캐시된 모듈 상태의 불리언 값 반환 | PASS |
| **TC-3.1.4** | 커스텀 훅 수출 | `useSystemModules()` 훅을 통한 자동 fetch 및 라이프사이클 바인딩 | PASS |

### 2.2. 사이드바 네비게이션 동적 필터링 (`dashboard-sidebar.tsx`)
| 번호 | 테스트 케이스 | 대상 메뉴 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-3.2.1** | MLOps 모듈 태깅 | MLOps 노트북, MLOps 노트북 관리, MLOps 거버넌스 | `moduleId: "mlops"` 속성 부여 | PASS |
| **TC-3.2.2** | 정책 시뮬레이션 태깅 | 정책 테스트 랩 (`/simulation`) | `moduleId: "simulation"` 속성 부여 | PASS |
| **TC-3.2.3** | AI 어시스턴트 태깅 | Enforce 차단 AI 진단 (`/diagnostics`) | `moduleId: "aiAgent"` 속성 부여 | PASS |
| **TC-3.2.4** | 동적 렌더링 필터 | `items = navigation[variant].filter(...)` | `!isModuleEnabled(item.moduleId)` 조건으로 비활성 메뉴 제거 | PASS |

### 2.3. 비활성화 안내 컴포넌트 (`module-disabled-notice.tsx`)
| 번호 | 테스트 케이스 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- |
| **TC-3.3.1** | 안내 문구 및 카드 레이아웃 | 모듈명, 비활성화 안내 문구 표출 | PASS |
| **TC-3.3.2** | 환경 변수 설정 가이드 | `MODULE_<NAME>_ENABLED=true` 가이드 출력 | PASS |
| **TC-3.3.3** | 대시보드 바로가기 링크 | `/dashboard` 복귀 CTA 버튼 제공 | PASS |

### 2.4. MLOps 라우트 가드 레이아웃 (`mlops/layout.tsx`)
| 번호 | 테스트 케이스 | 검증 내용 | 기대 결과 |
| :--- | :--- | :--- | :--- |
| **TC-3.4.1** | 활성화 상태 검사 | `useSystemModules()`의 `isModuleEnabled('mlops')` 검사 | PASS |
| **TC-3.4.2** | 조건부 렌더링 가드 | 비활성화 시 `children` 대신 `ModuleDisabledNotice` 렌더링 | PASS |

---

## 3. 실행 방법 및 결과
```bash
# 1. 정적 빌드 및 컴파일 무결성 검증
pnpm --filter @kyverno-platform/frontend build

# 2. 모듈 UX 무결성 자동 검증 스위트 실행
./scripts/tests/test-frontend-modular-ux.sh
```
* **결과**:
  * Next.js App Router 31개 전체 라우트 정적 빌드 성공 (exit code 0)
  * UX 무결성 테스트: 17 Passed / 0 Failed (100% 통과)
