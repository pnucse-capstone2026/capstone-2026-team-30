<a id="readme-top"></a>

<!-- PROJECT SHIELDS -->
<div align="center">

[![Kubernetes][Kubernetes-shield]][Kubernetes-url]
[![Kyverno][Kyverno-shield]][Kyverno-url]
[![Next.js][Next-shield]][Next-url]
[![NestJS][Nest-shield]][Nest-url]
[![PostgreSQL][Postgres-shield]][Postgres-url]
[![Redis][Redis-shield]][Redis-url]
[![AWS Bedrock][Bedrock-shield]][Bedrock-url]

</div>

<!-- PROJECT LOGO -->
<br />
<div align="center">
  <h1 align="center">PaC Kyverno 거버넌스 플랫폼</h1>

  <p align="center">
    <strong>엔터프라이즈 쿠버네티스 Policy-as-Code (PaC), 자율형 MLOps 거버넌스 및 AI 장애 진단 플랫폼</strong>
    <br />
    선언적 Kyverno 정책 관리, Dual-Path GitOps 예외 승인 파이프라인, 배포 전 정책 시뮬레이션, Admission 차단 AI 진단, MLOps GPU 워크로드 거버넌스 및 실시간 멀티클러스터 관제를 위한 통합 제어 플랫폼입니다.
    <br />
    <br />
    <a href="http://localhost:3000">대시보드 바로가기</a>
    &middot;
    <a href="http://localhost:3001/api/docs">Swagger API 문서</a>
  </p>
</div>

<!-- TABLE OF CONTENTS -->
<details open>
  <summary>목차 (Table of Contents)</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project (프로젝트 소개)</a>
      <ul>
        <li><a href="#built-with">Built With (기술 스택)</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started (시작하기)</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites (사전 요구사항)</a></li>
        <li><a href="#installation">Installation (설치 및 실행)</a></li>
      </ul>
    </li>
    <li><a href="#usage">Usage (사용 방법)</a></li>
  </ol>
</details>

<!-- ABOUT THE PROJECT -->
## About The Project

현대 엔터프라이즈 클라우드 네이티브 환경은 다음과 같은 3대 운영 병목에 직면해 있습니다:
1. **보안 컴플라이언스 딜레마**: 루트 권한 컨테이너, 변조 가능한 `:latest` 태그, 누락된 CPU/메모리 리소스 제한, 인가되지 않은 외부 레지스트리 이미지를 사용하는 워크로드가 클러스터에 무분별하게 유입됩니다.
2. **고비용 MLOps 자원 낭비**: 대화형 Jupyter 노트북, 학습 작업 및 모델 서빙 엔드포인트에 할당된 고비용 GPU 인스턴스(NVIDIA A10G, T4 등)가 네임스페이스별 쿼터 제한이나 유휴 자원 회수 없이 방치되어 막대한 클라우드 비용을 발생시킵니다.
3. **컨트롤 플레인 폴링 부하**: 기존의 정책 대시보드들이 PolicyReport 조회를 위해 `kube-apiserver`를 지속적으로 폴링함으로써 API Priority and Fairness(APF) 큐를 고갈시키고 etcd I/O 부하를 유발합니다.

**PaC Kyverno 거버넌스 플랫폼**은 이러한 문제를 해결하기 위한 프로덕션급 엔드투엔드 솔루션을 제공합니다:
* **CQRS Informer 아키텍처 기반 API 부하 제로화**: `@kubernetes/client-node`의 Informer와 DeltaFIFO 인메모리 캐시를 활용하여 클러스터 API 폴링을 배제하고 서브밀리초(Sub-millisecond) 단위의 초고속 조회를 보장합니다.
* **닫힌 루프(Closed-Loop) 정책 생명주기 관리**: 실시간 PolicyReport 수집, 승인 워크플로우, UUIDv7 분산 락, 임시 정책 예외 자동 만료(TTL)를 지원합니다.
* **Dual-Path GitOps 동기화 파이프라인**: 런타임 클러스터 즉시 완화(`PolicyException` CRD)와 비동기 GitHub Pull Request 자동 생성 및 자동 머지를 결합하여 개발 생산성과 보안 통제를 동시에 달성합니다.
* **자율형 MLOps 거버넌스 & 인앱 역방향 프록시**: 네임스페이스별 GPU 쿼터 강제, 유휴 리소스 자동 회수, Kubeflow 파이프라인 및 KServe 모델 서빙 관제와 함께 안전한 인앱 웹 프록시(`/notebook/*`)를 제공합니다.
* **배포 전 사전 시뮬레이션 및 AI 진단**: 배포 전 Dry-Run 모의 검증 샌드박스(`/simulation`)와 AWS Bedrock(Claude 3.5 Sonnet / Amazon Nova) 기반의 Admission Enforce 차단 원인 정밀 분석 및 자동 교정 패치(Diff) 생성을 지원합니다.

<p align="right">(<a href="#readme-top">맨 위로 이동</a>)</p>

### Built With

본 프로젝트는 다음과 같은 핵심 기술 스택을 기반으로 구축되었습니다:

* [![Next.js][Next-badge]][Next-url]
* [![React][React-badge]][React-url]
* [![NestJS][Nest-badge]][Nest-url]
* [![Kubernetes][Kubernetes-badge]][Kubernetes-url]
* [![Kyverno][Kyverno-badge]][Kyverno-url]
* [![PostgreSQL][Postgres-badge]][Postgres-url]
* [![Redis][Redis-badge]][Redis-url]
* [![AWS Bedrock][Bedrock-badge]][Bedrock-url]
* [![Tailwind CSS][Tailwind-badge]][Tailwind-url]
* [![TypeScript][TypeScript-badge]][TypeScript-url]

<p align="right">(<a href="#readme-top">맨 위로 이동</a>)</p>

<!-- GETTING STARTED -->
## Getting Started

로컬 개발 환경에서 프로젝트를 설정하고 구동하기 위한 가이드입니다.

### Prerequisites

프로젝트 실행을 위해 로컬 머신에 다음 도구들이 설치되어 있어야 합니다:
* **Node.js**: `>= 22.x LTS`
* **pnpm**: `>= 9.x`
  ```sh
  npm install -g pnpm@latest
  ```
* **Docker Engine** 및 **Docker Compose**: `>= 24.x+`
* **kubectl**: `>= v1.28+`
* **Kind**: `>= v0.22+` (로컬 쿠버네티스 테스트 시 필요)

### Installation

1. **저장소 클론**:
   ```sh
   git clone https://github.com/YeongrimGo/PaC-KyvernoDashboard.git
   cd PaC-KyvernoDashboard
   ```

2. **모노레포 패키지 의존성 설치**:
   ```sh
   pnpm install
   ```

3. **환경 변수 파일 구성**:
   ```sh
   cp apps/backend/.env.example apps/backend/.env
   cp apps/frontend/.env.example apps/frontend/.env.local
   ```

4. **로컬 백엔드 인프라 실행 (PostgreSQL 및 Redis)**:
   ```sh
   docker compose up -d postgres redis
   ```

5. **데이터베이스 스키마 마이그레이션 및 시드 데이터 주입**:
   ```sh
   pnpm --filter backend prisma:migrate:dev
   ```

6. **로컬 개발 서버 실행**:
   ```sh
   pnpm dev
   ```
   * 웹 대시보드 (Frontend): [http://localhost:3000](http://localhost:3000)
   * 백엔드 REST API: [http://localhost:3001](http://localhost:3001)

> 💡 **원클릭 자동 구성 스크립트**: 로컬 Kind 클러스터 생성, Kyverno 설치 및 데이터베이스 부트스트랩을 한 번에 실행하려면 `./scripts/setup-local-cluster.sh` 스크립트를 사용할 수 있습니다.

<p align="right">(<a href="#readme-top">맨 위로 이동</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

### 1. 웹 대시보드 접속 및 기본 계정 정보
로컬 개발 서버 또는 컨테이너가 정상 구동되면 웹 브라우저에서 [http://localhost:3000](http://localhost:3000)으로 접속합니다.

* **플랫폼 관리자 (Platform Administrator)**:
  * 이메일: `admin@test.com`
  * 비밀번호: `test1234!`
  * 권한: 클러스터 등록/관리, Kyverno 정책 등록 및 편집, 예외 신청 승인/반려, 시스템 감사 로그 열람
* **일반 개발자 (Application Developer)**:
  * 이메일: `dev@test.com`
  * 비밀번호: `test1234!`
  * 권한: 정책 위반 내역 조회, 임시 정책 예외 신청, MLOps Jupyter 노트북 생성 및 인앱 접속

### 2. 대화형 Swagger API 문서
백엔드가 제공하는 전체 REST API 명세는 [http://localhost:3001/api/docs](http://localhost:3001/api/docs)에서 Swagger UI를 통해 실시간으로 확인하고 테스트할 수 있습니다.

### 3. 핵심 운영 워크플로우

* **배포 전 정책 시뮬레이션 랩 (`/simulation`)**:
  * Git 커밋을 푸시하거나 실제 클러스터에 배포하기 전에 쿠버네티스 리소스 매니페스트(YAML)를 입력하여 활성화된 Kyverno 정책에 대한 위반 여부를 사전 검증합니다.
* **Dual-Path 정책 예외 라이프사이클 (`/exceptions`)**:
  * 보안 규정상 부득이하게 위반이 발생하는 워크로드에 대해 임시 예외를 신청합니다.
  * 관리자가 승인하면 클러스터 런타임에 `PolicyException` CRD가 즉시 반영됨과 동시에 사내 GitOps 저장소로 Pull Request가 비동기 생성 및 자동 머지됩니다.
* **Admission Enforce 차단 AI 진단 (`/diagnostics`)**:
  * 배포 시점에 Kyverno Admission Webhook에 의해 차단된 이벤트를 감지하고, AWS Bedrock을 통해 근본 원인(RCA) 분석 및 검증을 통과한 YAML 교정 패치(Diff)를 제공받습니다.
* **MLOps GPU 거버넌스 및 인앱 웹 프록시 (`/notebooks`)**:
  * 네임스페이스별 GPU 쿼터 정책이 적용된 Kubeflow 대화형 Jupyter 노트북 인스턴스를 생성하고, 별도의 포트포워딩 없이 플랫폼 웹 콘솔 내에서 안전한 역방향 프록시를 통해 즉시 작업 공간에 접속합니다.

<p align="right">(<a href="#readme-top">맨 위로 이동</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[Kubernetes-shield]: https://img.shields.io/badge/Kubernetes-v1.28+-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white
[Kubernetes-url]: https://kubernetes.io/
[Kyverno-shield]: https://img.shields.io/badge/Kyverno-v1.12+-0080FF?style=for-the-badge&logo=kyverno&logoColor=white
[Kyverno-url]: https://kyverno.io/
[Next-shield]: https://img.shields.io/badge/Next.js-15.0_App_Router-black?style=for-the-badge&logo=nextdotjs&logoColor=white
[Next-url]: https://nextjs.org/
[Nest-shield]: https://img.shields.io/badge/NestJS-11.0-E0234E?style=for-the-badge&logo=nestjs&logoColor=white
[Nest-url]: https://nestjs.com/
[Postgres-shield]: https://img.shields.io/badge/PostgreSQL-17-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[Postgres-url]: https://www.postgresql.org/
[Redis-shield]: https://img.shields.io/badge/Redis-7.0-DC382D?style=for-the-badge&logo=redis&logoColor=white
[Redis-url]: https://redis.io/
[Bedrock-shield]: https://img.shields.io/badge/AWS_Bedrock-Converse_API-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white
[Bedrock-url]: https://aws.amazon.com/bedrock/

[Next-badge]: https://img.shields.io/badge/Next.js_15-000000?style=for-the-badge&logo=nextdotjs&logoColor=white
[React-badge]: https://img.shields.io/badge/React_19-20232A?style=for-the-badge&logo=react&logoColor=61DAFB
[React-url]: https://react.dev/
[Nest-badge]: https://img.shields.io/badge/NestJS_11-E0234E?style=for-the-badge&logo=nestjs&logoColor=white
[Kubernetes-badge]: https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white
[Kyverno-badge]: https://img.shields.io/badge/Kyverno-0080FF?style=for-the-badge&logo=kyverno&logoColor=white
[Postgres-badge]: https://img.shields.io/badge/PostgreSQL_17-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[Redis-badge]: https://img.shields.io/badge/Redis_7-DC382D?style=for-the-badge&logo=redis&logoColor=white
[Bedrock-badge]: https://img.shields.io/badge/AWS_Bedrock-FF9900?style=for-the-badge&logo=amazon-aws&logoColor=white
[Tailwind-badge]: https://img.shields.io/badge/Tailwind_CSS-38B2AC?style=for-the-badge&logo=tailwind-css&logoColor=white
[Tailwind-url]: https://tailwindcss.com/
[TypeScript-badge]: https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white
[TypeScript-url]: https://www.typescriptlang.org/
