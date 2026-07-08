# Kyverno Governance Platform 개발 환경 및 CI/CD 제안 가이드

이 브랜치는 Kyverno Governance Platform 프로젝트의 협업 체계 표준화 및 AWS 프리티어 환경 배포 최적화를 위한 CI/CD 인프라 구축을 제안하는 브랜치(cicd-proposal)입니다.

기존 로컬 개발 가이드에 더해, 이번 제안을 통해 새로 도입되는 핵심 아키텍처 변경 사항 및 기대 효과를 설명합니다.

---

## 1. CI/CD 및 인프라 주요 제안 사항 (Proposals)

본 제안은 제한적인 클라우드 자원 환경에서 서비스 안정성을 유지하고 다수의 개발자가 일관된 코드 품질을 유지할 수 있도록 설계되었습니다.

### 1.1. 로컬 검증 자동화 (Husky & lint-staged)
* 목적: 결함이 있거나 스타일 규칙이 깨진 코드가 원격 저장소에 병합되는 것을 사전에 예방합니다.
* 동작: 개발자가 로컬에서 `git commit` 명령을 내릴 때마다 변경 대상 파일만 선별하여 아래의 작업을 자동으로 수행합니다:
  * 프론트엔드/백엔드: ESLint 규칙 검사 및 Prettier 자동 정렬 실행.
  * 쿠버네티스 매니페스트: `k8s-manifests/policies` 경로 아래의 Kyverno 정책 파일에 대해 `kyverno validate` 유효성 검사 실행.

### 1.2. 경량화 및 최적화된 도커 이미지 빌드 (node:22-slim)
* 목적: 컨테이너 이미지 크기를 줄여 전송 트래픽 비용을 절감하고 네이티브 라이브러리와의 호환성을 보장합니다.
* 설계:
  * 백엔드: Prisma 쿼리 엔진 등 네이티브 모듈과의 안전한 통신을 위해 glibc 표준 라이브러리가 포함된 `node:22-slim`을 베이스로 지정했습니다.
  * 프론트엔드: Next.js 15의 독립 실행형(Standalone Output) 모드를 활성화하여 런타임 번들 크기를 기존 대비 약 80% 이상 축소했습니다.
  * 다중 단계 빌드(Multi-stage build) 기법을 적용하여 최종 이미지에 불필요한 빌드 도구가 포함되지 않도록 차단했습니다.

### 1.3. 인프라 부하 최소화를 위한 빌드 오프로딩 (Build Offloading)
* 배경: 현재 운영용 호스트 서버는 AWS 프리티어인 `m7i-flex.large`(2 vCPU, 8 GiB RAM)의 제한적인 하드웨어 자원을 사용하고 있습니다.
* 설계: 메모리 부족(OOM)으로 서버 인스턴스가 중단되는 것을 막기 위해 컴파일 및 컨테이너 빌드 등의 고부하 연산은 전적으로 외부 GitHub Actions 호스트에서 수행합니다. 운영 서버는 완성된 이미지를 내려받아(`docker pull`) 실행하는 역할만 담당합니다.

### 1.4. 협업 서식 표준화 (Pull Request Template)
* 목적: 변경 목적과 작업 내용, 자가 체크리스트를 통일성 있게 문서화하여 리뷰의 신뢰성을 높입니다.
* 동작: GitHub에 PR을 생성할 때 설정된 템플릿 서식이 자동으로 노출되며, Angular 커밋 컨벤션 규칙을 적용하도록 안내합니다.

---

## 2. 개발 환경 구성 요소 구조 (기본 사양)

| 분류 | 구성 요소 | 역할 및 설명 | 기술 스택 / 상세 버전 | 네트워크 / 볼륨 마운트 경로 |
| :--- | :--- | :--- | :--- | :--- |
| **Host OS** | VSCode | 개발용 IDE 및 DevContainer 원격 접속 제어 | VSCode `Dev Containers` 확장 기능 | - |
| **Host OS** | Docker Daemon | 컨테이너 가상화 플랫폼 | Docker Desktop / Docker Engine | `/var/run/docker.sock` 마운트 |
| **Host OS** | Kubeconfig | 로컬 쿠버네티스 접근 설정 정보 공유 | kubectl 설정 | `~/.kube` -> `/home/vscode/.kube` |
| **Network** | Docker Bridge (`kind`) | Kind 클러스터와 컨테이너 간의 통신망 | Docker Bridge Network | `--network=kind` 연동 |
| **K8s Cluster** | Kind Cluster (`k8s-lab`) | 로컬 쿠버네티스 개발 환경 | Kind (Kubernetes in Docker) | `https://k8s-lab-control-plane:6443` |
| **Database** | PostgreSQL DB | 플랫폼 서비스 메타데이터 저장소 | postgres:17-alpine (Docker Compose) | `5432:5432` / `postgres_data` 볼륨 |
| **DevContainer**| Frontend Runtime | 웹 브라우저 UI 구동 엔진 | Node.js v22 (Next.js 15) | Host 포트 `3000`으로 자동 포워딩 |
| **DevContainer**| Backend Runtime | 플랫폼 비즈니스 API 구동 엔진 | Node.js v22 (NestJS 11) | Host 포트 `4000`으로 자동 포워딩 |
| **DevContainer**| Shared Module | 공통 모듈 및 타입 정보 공유 | TypeScript | 모노레포 내부 의존성 패키지 |
| **DevContainer**| CLI & Tools | 개발/운영 및 정책 검증을 위한 CLI 도구 | kubectl, helm, gh CLI, kyverno CLI (v1.12.0), pnpm, Node.js 22 | 컨테이너 내부 자동 설치 |

---

## 3. 기술 스택 및 패키지 의존성

프로젝트 내 각 패키지별 주요 기술 스택과 채택 배경 및 의존성 리스트입니다.

### 3.1. 프론트엔드 (apps/frontend/package.json)

* **Next.js (v15.0.0)**: React 기반 웹 애플리케이션 프레임워크 (App Router를 통한 라우팅 및 최적화 제공)
* **React (v19.0.0)**: 고성능 사용자 인터페이스 구축 라이브러리
* **Tailwind CSS (v4.0.0)**: 유틸리티 퍼스트 기반 신속한 스타일링 작성 도구
* **@tanstack/react-query (v5.0.0)**: 서버 상태 관리 라이브러리 (Kubernetes API 연동 비동기 데이터 캐싱, 동기화)
* **Zustand (v5.0.0)**: 상태 공유를 위한 가볍고 간결한 전역 상태 관리 저장소

### 3.2. 백엔드 (apps/backend/package.json)

* **NestJS (v11.0.0)**: 의존성 주입(DI)과 아키텍처 구조를 보장하는 강력한 Node.js 서버 프레임워크
* **Prisma ORM (v6.0.0)**: 데이터베이스 조작을 돕고 TypeScript 타입 안전성을 보장하는 ORM
* **@kubernetes/client-node (v0.22.0)**: Node.js 환경에서 Kubernetes API Server에 접속하고 제어하는 공식 SDK
* **Passport & JWT (v0.7.0/v11.0.0)**: 토큰 기반 사용자 인증 및 권한 부여 기능

---

## 4. 로컬 개발 환경 구축 단계

### 1단계: 저장소 복제 (Clone)
```bash
git clone <repository-url> kyverno-governance-platform
cd kyverno-governance-platform
```

### 2단계: Host OS에 Kind 설치 및 클러스터 생성
```bash
# Kind CLI 설치 (Linux / WSL2 기준)
[ $(uname -m) = x86_64 ] && curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.32.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind

# 클러스터 생성
kind create cluster --name k8s-lab
```

### 3단계: VSCode DevContainer 접속 및 초기 설정
* 복제된 폴더를 VSCode로 열고, 화면 우측 하단의 "Reopen in Container" 알림 팝업을 클릭하여 접속합니다.
* 컨테이너 로드 시 포스트 스크립트 실행으로 모노레포 의존성 설치(`pnpm install`) 및 Prisma Client 코드 생성이 자동으로 진행됩니다.

### 4단계: 개발 서버 구동
구축이 완료되면 컨테이너 내부 터미널에서 아래 명령을 실행합니다.
```bash
pnpm dev
```
* 프론트엔드: `http://localhost:3000`
* 백엔드 API: `http://localhost:4000`

---

## 5. 도커 이미지 빌드 방법 (제안 사항 테스트)

모노레포의 최상위 루트 디렉토리에서 공유 패키지 참조를 정상 확인하기 위해 아래 명령어를 사용하여 빌드를 실행합니다.

* **백엔드 빌드**:
  ```bash
  docker build -t kyverno-backend -f apps/backend/Dockerfile .
  ```
* **프론트엔드 빌드**:
  ```bash
  docker build -t kyverno-frontend -f apps/frontend/Dockerfile .
  ```
