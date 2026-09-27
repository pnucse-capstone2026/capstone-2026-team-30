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
  <h1 align="center">PaC Kyverno 대시보드</h1>

  <p align="center">
    <strong>쿠버네티스 Kyverno 기반 Policy-as-Code(PaC) 및 MLOps 거버넌스 대시보드</strong>
    <br />
    쿠버네티스 환경에서 Kyverno 정책 관리, 정책 예외 워크플로우, 배포 전 모의 검사, LLM 기반 위반 분석, 주피터 노트북 관리를 웹 인터페이스로 검증하기 위해 시작된 프로젝트입니다.
    <br />
    <br />
    <a href="http://localhost:3000">대시보드 접속</a>
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
        <li><a href="#limitations">Limitations (한계 및 안내)</a></li>
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

본 프로젝트는 쿠버네티스 환경에서 **Policy-as-Code(PaC) 엔진인 Kyverno**와 MLOps 작업 환경을 연계하여 관리할 수 있는 웹 기반 통합 제어 도구입니다.

클라우드 네이티브 환경에서 발생할 수 있는 보안 정책 위반, 자원 관리, 그리고 정책 적용으로 인한 배포 차단 문제를 해결해보고자 실무적 표준을 최대한 참고하여 구현했습니다.

### 주요 구현 기능

* **정책 예외(PolicyException) 신청 및 승인 워크플로우**: 부득이하게 정책을 우회해야 하는 워크로드를 위해 대시보드에서 임시 예외를 신청하고, 관리자 승인 시 클러스터에 `PolicyException` CRD를 반영하고 Git 저장소에 PR을 생성하는 흐름을 구현했습니다.
* **매니페스트 사전 검사 (Dry-Run)**: 클러스터 배포 전 YAML 매니페스트를 대시보드에 입력하여 등록된 Kyverno 정책에 위반되는지 미리 확인해보는 테스트 도구(`/simulation`)를 제공합니다.
* **LLM 기반 차단 원인 분석 실험**: Admission Webhook 차단 이벤트 발생 시 AWS Bedrock 모델을 호출하여 차단 원인을 요약하고 수정 가이드(YAML Diff)를 제안받는 실험적 기능(`/diagnostics`)을 포함했습니다.
* **Informer 기반 리소스 캐싱 및 조회**: `@kubernetes/client-node`의 Informer와 인메모리 캐시를 구성하여 `kube-apiserver` 직접 폴링 빈도를 낮추고 대시보드 응답성을 개선하도록 설계했습니다.
* **간이 주피터 노트북 관리 및 프록시**: 네임스페이스별 리소스 제한을 고려하여 대화형 Jupyter 노트북 파드를 생성하고, 웹 UI에서 인앱 역방향 프록시(`/notebooks`)를 통해 접근할 수 있도록 구성했습니다.

### Limitations

* 본 프로젝트는 학부 졸업 연구 목적으로 제작된 프로토타입(Proof of Concept)입니다.
* 상용 프로덕션 환경의 엄격한 보안 요구사항, 고가용성(HA), 대규모 트래픽 부하 검증 등은 완벽히 충족되지 않았을 수 있습니다.

<p align="right">(<a href="#readme-top">맨 위로 이동</a>)</p>

### Built With

본 프로젝트에서 사용된 주요 기술 스택입니다:

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

4. **로컬 백엔드 인프라 실행 (PostgreSQL 17 및 Redis 7)**:
   ```sh
   docker compose up -d
   ```

5. **데이터베이스 스키마 마이그레이션 및 기본 계정 시딩**:
   ```sh
   pnpm db:migrate
   pnpm db:seed
   ```

6. **로컬 개발 서버 실행**:
   ```sh
   pnpm dev
   ```
   * 웹 대시보드 (Frontend): [http://localhost:3000](http://localhost:3000)
   * 백엔드 REST API (Swagger): [http://localhost:3001/api/docs](http://localhost:3001/api/docs)

> 💡 **로컬 Kind 클러스터 연동**: 실제 로컬 쿠버네티스 환경에서 Kyverno 어드미션 제어 및 정책 위반을 테스트하려면 `./scripts/setup-local-cluster.sh`로 경량 클러스터를 구동할 수 있습니다. (정리 시 `./scripts/cleanup-local-cluster.sh` 실행)
>
> 💡 **AWS EKS 클러스터 구축**: 실제 AWS EKS에 배포하고자 하는 경우 `./scripts/setup-eks-cluster.sh [클러스터명] [리전]` 또는 멀티클러스터 `./scripts/setup-multicluster-eks.sh`를 사용할 수 있습니다.

<p align="right">(<a href="#readme-top">맨 위로 이동</a>)</p>

<!-- USAGE EXAMPLES -->
## Usage

### 1. 웹 대시보드 접속 및 테스트 계정
로컬 개발 서버가 구동되면 웹 브라우저에서 [http://localhost:3000](http://localhost:3000)으로 접속합니다.

* **관리자 계정 (Platform Admin)**:
  * 이메일: `admin@test.com`
  * 비밀번호: `test1234!`
  * 역할: 클러스터/정책 관리, 예외 신청 승인 및 반려, 감사 로그 확인
* **일반 개발자 계정 (Developer)**:
  * 이메일: `dev@test.com`
  * 비밀번호: `test1234!`
  * 역할: 정책 위반 내역 확인, 임시 정책 예외 신청, Jupyter 노트북 생성 및 접속

### 2. API 문서 (Swagger)
백엔드 REST API 명세는 [http://localhost:3001/api/docs](http://localhost:3001/api/docs)의 Swagger UI를 통해 확인할 수 있습니다.

### 3. 주요 기능 둘러보기

* **정책 시뮬레이션 (`/simulation`)**:
  * YAML 매니페스트를 입력하여 클러스터 배포 전 활성화된 Kyverno 정책에 걸리는 부분이 있는지 사전 검증합니다.
* **정책 예외 관리 (`/exceptions`)**:
  * 특정 워크로드에 대한 예외 신청을 등록하고, 관리자 승인 시 `PolicyException` CRD 생성 및 Git PR 생성을 연동합니다.
* **차단 원인 진단 (`/diagnostics`)**:
  * Admission Webhook에 의해 차단된 이벤트를 확인하고, AWS Bedrock을 통해 원인 설명 및 수정 예시 매니페스트(Diff)를 제안받습니다.
* **주피터 노트북 환경 (`/notebooks`)**:
  * 리소스 제한이 적용된 Jupyter 파드를 생성하고, 웹 콘솔 내 리버스 프록시를 통해 접속할 수 있습니다.

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
