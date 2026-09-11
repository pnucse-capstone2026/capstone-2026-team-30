# Phase 1: K8s 매니페스트 모듈화 무결성 테스트 설계서

## 1. 개요 (Overview)
* **테스트 대상**: K8s 베이스 매니페스트(`k8s-manifests/base`), MLOps 모듈 매니페스트(`k8s-manifests/modules/mlops`), 환경별 오버레이(`overlays/eks`, `overlays/onprem`), 정책 디렉터리(`policies/`, `policies/mlops/`)
* **테스트 스크립트**: `scripts/tests/test-k8s-modular-manifests.sh`
* **목적**:
  1. Base 매니페스트에서 MLOps 컴포넌트(Notebook Controller, Kubeflow CRD, Namespace)가 완전히 제거되어 단독 배포 시 제로 리소스를 유지하는지 검증.
  2. MLOps 모듈이 Core 컴포넌트 없이 독립적으로 완전하게 빌드되는지 검증.
  3. 기존 EKS 및 On-Premise 오버레이가 MLOps 리소스 혼입 없이 정상 렌더링되는지 회귀 검증.
  4. Core 정책과 MLOps 전용 정책의 파일 시스템 경로 격리 보장.

---

## 2. 테스트 케이스 명세 (Test Cases)

| 번호 | 테스트 케이스 | 대상 경로 | 검증 조건 | 기대 결과 |
| :--- | :--- | :--- | :--- | :--- |
| **TC-1.1** | Base 네임스페이스 격리 | `k8s-manifests/base` | `name: kyverno-platform` 존재, `name: kubeflow` 부재 | PASS |
| **TC-1.2** | Base Core 워크로드 보존 | `k8s-manifests/base` | `backend`, `frontend`, `postgres` 배포 매니페스트 포함 | PASS |
| **TC-1.3** | Base MLOps 리소스 누출 방지 | `k8s-manifests/base` | `notebook-controller`, `notebooks.kubeflow.org` 미포함 | PASS |
| **TC-2.1** | MLOps 독립 빌드 및 CRD 포함 | `k8s-manifests/modules/mlops` | `notebooks.kubeflow.org` CRD 정의 포함 | PASS |
| **TC-2.2** | MLOps 전용 네임스페이스 및 컨트롤러 | `k8s-manifests/modules/mlops` | `name: kubeflow`, `notebook-controller-deployment` 포함 | PASS |
| **TC-2.3** | MLOps 내 Core 리소스 중복 배제 | `k8s-manifests/modules/mlops` | `backend`, `frontend`, `postgres` 미포함 | PASS |
| **TC-3.1** | EKS 오버레이 호환성 및 격리 | `k8s-manifests/overlays/eks` | Core 정상 렌더링 및 `notebook-controller` 미포함 | PASS |
| **TC-3.2** | On-Prem 오버레이 호환성 및 격리 | `k8s-manifests/overlays/onprem` | Core 정상 렌더링 및 `notebook-controller` 미포함 | PASS |
| **TC-4.1** | 정책 디렉터리 분리 무결성 | `k8s-manifests/policies/` | Core 기본 정책 및 `policies/mlops/` 전용 정책 분리 유지 | PASS |

---

## 3. 실행 방법 및 결과
```bash
./scripts/tests/test-k8s-modular-manifests.sh
```
* **결과**: 22개 검증 항목 전체 PASS (0 Failed)
