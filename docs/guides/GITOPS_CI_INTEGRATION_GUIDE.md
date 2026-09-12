# GitOps Shift-Left PR 거버넌스 게이트 및 CI 연동 가이드

본 문서는 GitHub Actions 및 외부 CI/CD 파이프라인에서 Kyverno Governance Platform의 Shift-Left PR Gate API(`POST /api/v1/gitops/pr-review`)를 호출하고 이중 인증을 구성하는 방법을 안내합니다.

---

## 1. 개요 및 핵심 아키텍처

개발자가 쿠버네티스 워크로드 매니페스트(Deployment, Service 등)를 변경하는 GitHub PR을 생성할 때, CI 파이프라인에서 실제 쿠버네티스 클러스터의 Kyverno 정책을 **Server-Side Dry-Run (`dryRun: ['All']`)** 방식으로 100% 결정론적으로 사전 검증합니다.

```
+------------------+          +------------------------+          +-------------------------+
| GitHub PR Action |  ----->  | POST /v1/gitops/pr-    |  ----->  | Target K8s Cluster      |
| (CI Pipeline)    |          | review API             |          | (Server-Side Dry-Run)   |
+------------------+          +------------------------+          +-------------------------+
        ^                                 |                                    |
        | [Commit Status & Inline Comment]| Kyverno Admission Webhook          |
        +---------------------------------+ <----------------------------------+
```

---

## 2. 이중 인증 (Dual Authentication) 구성

`POST /api/v1/gitops/pr-review` 엔드포인트는 개발자 포털 UI뿐만 아니라 외부 CI/CD 자동화 환경에서도 유연하게 호출될 수 있도록 **이중 인증(Dual Authentication Guard)**을 지원합니다.

### 2.1. 인증 방식별 우선순위

| 인증 방식 | 전달 헤더 | 사용 주체 | 인증 메커니즘 |
| :--- | :--- | :--- | :--- |
| **CI Secret API Key** | `X-CI-Token: <token>` 또는<br/>`X-API-Key: <token>` | GitHub Actions, GitLab CI 등 | 서버 환경변수 `GITOPS_CI_TOKEN` 또는 `CI_API_KEY`와 타이밍 공격 방지 상수 시간 비교 |
| **JWT Bearer Token** | `Authorization: Bearer <jwt>` | 플랫폼 UI, 대시보드 사용자 | Passport JWT 서명 및 만료 검증 |

> 💡 **주의**: CI Secret 전달 시 플랫폼 내부적으로 `ci-bot` 가상 사용자(`role: ADMIN`, 전체 클러스터 접근 권한)가 자동 주입됩니다.

---

## 3. GitHub Actions 워크플로 연동 예제

아래는 저장소의 `.github/workflows/kyverno-governance-gate.yml` 예시입니다:

```yaml
name: Kyverno Governance PR Gate

on:
  pull_request:
    paths:
      - 'k8s/**.yaml'
      - 'deploy/**.yaml'

jobs:
  governance-review:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR Code
        uses: actions/checkout@v4

      - name: Combine Manifests
        id: manifests
        run: |
          # PR에서 변경된 YAML 파일들을 취합
          MANIFEST=$(cat k8s/*.yaml)
          echo "manifest<<EOF" >> $GITHUB_OUTPUT
          echo "$MANIFEST" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Call Kyverno Governance PR Review API
        run: |
          curl -X POST "${{ secrets.KYVERNO_PLATFORM_URL }}/api/v1/gitops/pr-review" \
            -H "Content-Type: application/json" \
            -H "X-CI-Token: ${{ secrets.GITOPS_CI_TOKEN }}" \
            -d '{
              "repository": "${{ github.repository }}",
              "pullNumber": ${{ github.event.pull_request.number }},
              "commitSha": "${{ github.event.pull_request.head.sha }}",
              "clusterId": "default",
              "targetNamespace": "payment-prod",
              "manifestYaml": '"$(jq -Rs . < k8s/deployment.yaml)"'
            }'
```

---

## 4. API 명세 (`POST /api/v1/gitops/pr-review`)

### 요청 본문 (JSON)
* `repository`: GitHub 저장소 전체 명칭 (예: `acme-corp/payment-service`)
* `pullNumber`: Pull Request 번호 (예: `42`)
* `commitSha`: PR 대상 최신 커밋 SHA
* `clusterId`: 대상 클러스터 식별자 (선택, 기본값: `default`)
* `targetNamespace`: 배포 대상 네임스페이스
* `manifestYaml`: 검증 대상 YAML 원문 (다중 리소스 `---` 구분 지원)

### 응답 결과 및 GitHub 피드백
1. **GitHub Commit Status**:
   - `enforce` 정책 위반 리소스가 존재하는 경우: `failure` 전송 (PR 머지 차단)
   - 위반이 없거나 `audit` 경고만 존재하는 경우: `success` 전송
2. **GitHub PR 코멘트**:
   - 정책 위반 테이블 (리소스, 정책명, 규칙명, 상세 사유)
   - AI 자가 재검증을 통과한 YAML 교정 패치
   - 플랫폼 정책 예외 신청 딥링크(`/exceptions/new?repo=...&pr=...`)

---

## 5. 프론트엔드 정책 예외 신청 딥링크 자동완성

PR 코멘트에 포함된 딥링크를 클릭하여 접속하면 `/exceptions/new` 페이지에서 아래 정보가 자동으로 채워집니다:
* **안내 배너**: `GitHub PR #42 (org/repo) 검증 결과로부터 자동 입력됨`
* **자동 채움 필드**: 대상 클러스터, 네임스페이스, 정책명, 규칙명, 리소스 종류/이름, 신청 사유 및 PR 링크
