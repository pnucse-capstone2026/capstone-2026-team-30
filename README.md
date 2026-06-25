# Kyverno Governance Platform 개발 환경 및 기술 스택 가이드

이 문서는 **Kyverno Governance Platform**의 개발 환경 구성 요소, 채택된 기술 스택, 프로젝트 의존성 정보 및 로컬 개발 환경 구축 방법을 안내합니다.

---

## 1. 개발 환경 구성 요소 구조 (Table)

현재 구성된 개발 환경의 물리적/논리적 인프라 구성 요소를 정리한 표입니다.

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

## 2. 기술 스택 및 패키지 의존성

프로젝트 내 각 패키지([package.json](file:///home/asdf/kyverno-governance-platform/package.json))별 주요 기술 스택과 채택 배경 및 의존성 리스트입니다.

### 1) 프론트엔드 ([apps/frontend/package.json](file:///home/asdf/kyverno-governance-platform/apps/frontend/package.json))

| 핵심 기술 스택 | 버전 | 설명 및 용도 |
| :--- | :--- | :--- |
| **Next.js** | `^15.0.0` | React 기반 웹 애플리케이션 프레임워크 (App Router를 통한 라우팅 및 최적화 제공) |
| **React** | `^19.0.0` | 고성능 사용자 인터페이스 구축 라이브러리 |
| **Tailwind CSS** | `^4.0.0` | 유틸리티 퍼스트 기반 신속한 스타일링 작성 도구 |
| **@tanstack/react-query**| `^5.0.0` | 서버 상태 관리 라이브러리 (Kubernetes API 연동 비동기 데이터 캐싱, 동기화) |
| **@tanstack/react-table**| `^8.0.0` | 대규모 리스트 데이터를 정렬, 필터링하여 유연하게 표현할 수 있는 테이블 엔진 |
| **Zustand** | `^5.0.0` | 상태 공유를 위한 가볍고 간결한 전역 상태 관리 저장소 |
| **React Hook Form** | `^7.0.0` | 폼 구성 요소의 성능 최적화 및 유효성 검사 매핑 |
| **Zod** | `^3.0.0` | 스키마 기반 유효성 검증 및 타입 추론 도구 |
| **Lucide React** | `^0.400.0` | 모던 UI용 벡터 아이콘 팩 |

### 2) 백엔드 ([apps/backend/package.json](file:///home/asdf/kyverno-governance-platform/apps/backend/package.json))

| 핵심 기술 스택 | 버전 | 설명 및 용도 |
| :--- | :--- | :--- |
| **NestJS** | `^11.0.0` | 의존성 주입(DI)과 아키텍처 구조를 보장하는 강력한 Node.js 서버 프레임워크 |
| **Prisma ORM** | `^6.0.0` | 데이터베이스 조작을 돕고 TypeScript 타입 안전성을 보장하는 ORM |
| **@kubernetes/client-node** | `^0.22.0` | Node.js 환경에서 Kubernetes API Server에 접속하고 제어하는 공식 SDK |
| **Passport & JWT** | `^0.7.0`/`^11.0.0` | 토큰 기반 사용자 인증 및 권한 부여 기능 |
| **class-validator / transformer** | `^0.14.0`/`^0.5.0` | DTO 데이터 정합성 검증 및 객체 변환 데코레이터 제공 |
| **nestjs-pino / pino-http** | `^4.0.0`/`^10.0.0` | 고성능 JSON 포맷 로거 (서버 디버깅 및 트래킹 성능 보장) |

---

## 3. 개발 환경 구축 단계

### 1단계: 저장소 복제 (Clone)
터미널에서 저장소를 복제합니다.
```bash
git clone <repository-url> kyverno-governance-platform
cd kyverno-governance-platform
```

### 2단계: Host OS에 Kind 설치 및 클러스터 생성
개발 환경의 스크립트([.devcontainer/scripts/setup.sh](file:///home/asdf/kyverno-governance-platform/.devcontainer/scripts/setup.sh)) 설정과 연동되도록 클러스터 이름을 `k8s-lab`으로 지정하여 생성합니다.
See also : https://kind.sigs.k8s.io/docs/user/quick-start/#installing-from-release-binaries
```bash
# 1. Kind CLI 설치 (Linux / WSL2 기준)
# For AMD64 / x86_64
[ $(uname -m) = x86_64 ] && curl -Lo ./kind https://kind.sigs.k8s.io/dl/v0.32.0/kind-linux-amd64
chmod +x ./kind
sudo mv ./kind /usr/local/bin/kind
# 2. 클러스터 생성 (이때 Docker 'kind' 네트워크가 자동 구성됩니다)
kind create cluster --name k8s-lab
```

### 3단계: VSCode DevContainer 접속
1. 복제된 폴더를 VSCode로 열고, 화면 우측 하단의 **"Reopen in Container"** 알림 팝업을 클릭합니다.
2. 컨테이너 빌드 후 포스트 생성 단계([.devcontainer/scripts/setup.sh](file:///home/asdf/kyverno-governance-platform/.devcontainer/scripts/setup.sh))를 통해 아래 프로세스가 자동 진행됩니다:
   - 전역 도구 및 `Kyverno CLI` (v1.12.0) 다운로드/설치
   - Kubeconfig의 API 주소를 DevContainer 내부 통신을 위한 엔드포인트(`https://k8s-lab-control-plane:6443`)로 자동 매핑
   - PostgreSQL DB 컨테이너 기동 및 환경변수 템플릿 복사
   - Prisma Client 코드 생성 및 모노레포 의존성 설치 (`pnpm install`)

### 4단계: 개발 서버 구동
구축이 완료되면 컨테이너 내부 터미널에서 아래 명령을 실행합니다.
```bash
pnpm dev
```
* **프론트엔드**: `http://localhost:3000`
* **백엔드 API**: `http://localhost:4000`
