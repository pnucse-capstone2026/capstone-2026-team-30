# Kyverno 거버넌스 테스트베드 실습 및 검증 가이드

본 디렉토리는 **초기 클린 상태(0 위반)에서 시작하여, 사용자가 직접 위반 파드를 배포하고, 예외를 적용하며 플랫폼 대시보드의 실시간 반응을 검증**할 수 있도록 구성된 단계별 테스트베드 매니페스트 모음입니다.

---

## 1. 매니페스트 구성 목록

| 파일명 | 역할 및 설명 | 기대 결과 |
| :--- | :--- | :--- |
| **`00-namespace.yaml`** | 격리 테스트 네임스페이스 3개 생성 | `governance-testbed`, `production`, `mlops-workspace` |
| **`01-clean-baseline.yaml`** | 정책 100% 준수 표준 워크로드 3종 | **위반 0건 (Clean State)** |
| **`11-violation-disallow-latest-tag.yaml`** | `:latest` 태그 및 태그 생략 파드 2종 | `disallow-latest-tag` 정책 위반 2건 발생 |
| **`12-violation-privileged-container.yaml`** | 특권 모드(`privileged: true`) 파드 2종 | `disallow-privileged-containers` 정책 위반 2건 발생 |
| **`13-violation-missing-limits.yaml`** | 자원 requests/limits 누락 파드 2종 | `require-resource-limits` 정책 위반 2건 발생 |
| **`14-violation-mlops-root-jupyter.yaml`** | MLOps root 실행 노트북 파드 1종 | MLOps 거버넌스 위반 1건 발생 |
| **`21-exception-sample.yaml`** | 특정 파드 대상 PolicyException CRD | 해당 파드의 위반 해제 및 정상 통과 |

---

## 2. 단계별 직접 배포 실습 시나리오

### 1단계: 클린 베이스라인 배포 (위반 0건 확인)
```bash
# 1. 테스트 네임스페이스 생성
kubectl apply -f k8s-manifests/testbed/00-namespace.yaml

# 2. 정상 파드 배포
kubectl apply -f k8s-manifests/testbed/01-clean-baseline.yaml
```
* **확인**: 웹 대시보드(`http://localhost:3000/violations`)에서 위반 수가 **0건(Clean)**임을 확인합니다.

---

### 2단계: 특정 정책 위반 파드 직접 배포 테스트

#### (A) 태그 위반 파드 배포
```bash
kubectl apply -f k8s-manifests/testbed/11-violation-disallow-latest-tag.yaml
```
* **결과**: `tag-violation-latest`, `tag-violation-no-tag` 위반 2건이 대시보드에 실시간 수집됩니다.

#### (B) 특권 모드(루트) 위반 파드 배포
```bash
kubectl apply -f k8s-manifests/testbed/12-violation-privileged-container.yaml
```
* **결과**: `priv-violation-main`, `priv-violation-prod-debugger` 위반 2건이 대시보드에 추가됩니다.

#### (C) MLOps root 노트북 배포
```bash
kubectl apply -f k8s-manifests/testbed/14-violation-mlops-root-jupyter.yaml
```

---

### 3단계: 정책 예외(PolicyException) 적용 검증
```bash
kubectl apply -f k8s-manifests/testbed/21-exception-sample.yaml
```
* **결과**: `test-tag-violation-latest` 파드가 예외 규칙에 매칭되어 정책 검사를 통과합니다.

---

### 4단계: 테스트 완료 후 클린 상태로 원복 (초기화)
```bash
# 위반 파드 및 예외 일괄 삭제
kubectl delete -f k8s-manifests/testbed/11-violation-disallow-latest-tag.yaml --ignore-not-found
kubectl delete -f k8s-manifests/testbed/12-violation-privileged-container.yaml --ignore-not-found
kubectl delete -f k8s-manifests/testbed/13-violation-missing-limits.yaml --ignore-not-found
kubectl delete -f k8s-manifests/testbed/14-violation-mlops-root-jupyter.yaml --ignore-not-found
kubectl delete -f k8s-manifests/testbed/21-exception-sample.yaml --ignore-not-found
```
