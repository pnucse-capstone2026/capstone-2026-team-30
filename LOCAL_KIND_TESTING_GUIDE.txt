================================================================================
KYVERNO GOVERNANCE PLATFORM - LOCAL KIND E2E TESTING GUIDE
(로컬 Kind 클러스터 기반 사용자 시나리오 및 거버넌스 면밀 테스트 가이드)
================================================================================
문서 버전: v1.0.0
대상 시스템: PaC Kyverno Governance Platform (NestJS Backend + Next.js Frontend)
테스트 환경: 로컬 Docker / Kind (Kubernetes v1.36.1) / PostgreSQL
================================================================================

[ 목차 ]
1. 테스트 개요 및 사용자 계정 체계 (Overview & Personas)
2. 1단계: 로컬 테스트베드 인프라 셋업 (Infrastructure Bootstrapping)
3. 2단계: 유저 시나리오 기반 단계별 면밀 테스트 (Step-by-Step Test Scenarios)
   - 시나리오 1: 사용자 워크로드 배포 및 실시간 위반 감지
   - 시나리오 2: 사용자 정책 예외(PolicyException) 신청
   - 시나리오 3: 관리자 승인 및 GitHub 원격 GitOps PR 자동 발행
   - 시나리오 4: 실시간 관제실(/demo/cluster-live) 토폴로지 면제 확인
   - 시나리오 5: Enforce 강제 차단 및 예외 워크로드 허용 검증
   - 시나리오 6: MLOps Jupyter Notebook Hub 셀프서비스 검증
4. 3단계: 트러블슈팅 및 유용한 디버깅 명령어 (Troubleshooting & Tips)
5. 4단계: 테스트 완료 후 로컬 자원 완전 해체 (Teardown & Cleanup)

================================================================================
1. 테스트 개요 및 사용자 계정 체계 (Overview & Personas)
================================================================================
본 가이드는 실제 개발자/요청자(Requester)가 리소스를 배포하고 정책 위반이 감지되었을 때,
예외를 신청하고 플랫폼 관리자(Admin)가 이를 승인하여 GitHub PR이 자동으로 개설되고
클러스터에 런타임 면제가 적용되는 전체 End-to-End 라이프사이클을 테스트합니다.

[ 기본 제공 테스트 계정 ]
1) 플랫폼 관리자 (Admin Role)
   - 이메일: admin@test.com
   - 비밀번호: test1234!
   - 권한: 정책 생성/수정, 예외 최종 승인/반려, 전체 클러스터 및 감사로그 관제

2) 일반 개발자 / 데이터 사이언티스트 (Requester Role)
   - 이메일: user@test.com
   - 비밀번호: test1234!
   - 권한: 워크로드 배포, 위반 내역 조회, 정책 예외 신청, MLOps 노트북 셀프서비스

================================================================================
2. 1단계: 로컬 테스트베드 인프라 셋업 (Infrastructure Bootstrapping)
================================================================================

[2.1] PostgreSQL 컨테이너 기동 및 데이터베이스 준비
--------------------------------------------------------------------------------
# 1. PostgreSQL 도커 컨테이너 실행
docker run -d --name postgres-db \
  -e POSTGRES_USER=postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=kyverno_dashboard \
  -p 5432:5432 \
  postgres:16-alpine

# 2. Prisma 마이그레이션 및 시드 데이터 주입
cd apps/backend
pnpm prisma migrate deploy
pnpm prisma db seed
cd ../..
--------------------------------------------------------------------------------

[2.2] Kind Kubernetes 클러스터 생성 및 정책 배포
--------------------------------------------------------------------------------
# 1. Kind 클러스터 생성
kind create cluster --name k8s-lab

# 2. Kyverno v1.12.0 컨트롤러 설치
kubectl create -f https://github.com/kyverno/kyverno/releases/download/v1.12.0/install.yaml

# 3. Kubeflow Notebook CRD 배포
kubectl apply -f k8s-manifests/crds/kubeflow.org_notebooks.yaml

# 4. 테스트베드 네임스페이스 3종 생성
kubectl apply -f k8s-manifests/testbed/00-namespace.yaml

# 5. 거버넌스 및 MLOps 정책 7종 배포
kubectl apply -f k8s-manifests/policies/disallow-latest-tag.yaml \
  -f k8s-manifests/policies/disallow-privileged-containers.yaml \
  -f k8s-manifests/policies/require-resource-limits.yaml \
  -f k8s-manifests/policies/restrict-image-registries.yaml \
  -f k8s-manifests/policies/mlops/

# 6. 정상 클린 베이스라인 파드 3종 배포
kubectl apply -f k8s-manifests/testbed/01-clean-baseline.yaml

# 7. DB에 k8s-lab 클러스터 접근 권한 매핑
docker exec -i postgres-db psql -U postgres -d kyverno_dashboard -c \
  "INSERT INTO \"UserCluster\" (\"userId\", \"clusterId\", \"createdAt\") SELECT id, 'k8s-lab', NOW() FROM \"User\" ON CONFLICT DO NOTHING;"
--------------------------------------------------------------------------------

[2.3] 백엔드 및 프론트엔드 개발 서버 기동
--------------------------------------------------------------------------------
# 터미널 1: NestJS 백엔드 실행 (Port: 4000)
pnpm --filter @kyverno-platform/backend dev

# 터미널 2: Next.js 프론트엔드 실행 (Port: 3000)
pnpm --filter @kyverno-platform/frontend dev
--------------------------------------------------------------------------------

[2.4] 초기 정상 상태(Zero-Violation Clean State) 검증
브라우저에서 http://localhost:3000/demo/cluster-live 에 접속하여 확인:
- Ready Nodes: 1/1
- Total Policies: 7개 (모두 Enforce 또는 Audit 상태)
- Total Violations: 0건 (완전한 클린 상태)

================================================================================
3. 2단계: 유저 시나리오 기반 단계별 면밀 테스트
================================================================================

--------------------------------------------------------------------------------
시나리오 1: 사용자 워크로드 배포 및 실시간 위반 감지 (User Workload)
--------------------------------------------------------------------------------
[목적] 일반 개발자(user@test.com)가 배포한 파드에서 정책 위반이 발생하고,
       대시보드에 본인의 위반 내역으로 실시간 포착되는지 검증합니다.

1. 리소스 한도 정책을 Audit 모드로 설정 (배포 허용 후 리포트 수집용):
   $ kubectl apply -f k8s-manifests/policies/require-resource-limits.yaml

2. user@test.com 소유의 위반 파드 배포:
   $ kubectl apply -f k8s-manifests/testbed/15-user-violation-workload.yaml

3. 브라우저에서 user@test.com으로 로그인 및 확인:
   - 로그인 URL: http://localhost:3000/login (user@test.com / test1234!)
   - 위반 목록 URL: http://localhost:3000/violations
   - [결과 확인]: 'user-payment-batch-worker' 파드가 [require-resource-limits]
     위반 카드로 빨간색 뱃지와 함께 실시간 표출되는지 확인.

--------------------------------------------------------------------------------
시나리오 2: 사용자 정책 예외(PolicyException) 신청
--------------------------------------------------------------------------------
[목적] 위반을 확인한 사용자가 정당한 업무 사유로 임시 예외를 신청합니다.

1. 위반 카드에서 [예외 요청 (Request Exception)] 버튼을 클릭하거나
   직접 URL: http://localhost:3000/exceptions/new 로 이동
2. 폼 입력:
   - 대상 클러스터: Local Kind Lab (k8s-lab)
   - 대상 정책: require-resource-limits
   - 대상 규칙: validate-resource-requests-limits
   - 리소스 종류 / 명칭: Pod / user-payment-batch-worker
   - 네임스페이스: governance-testbed
   - 예외 만료일: 향후 날짜 선택 (예: 1개월 뒤)
   - 신청 사유: "결제 배치 성능 튜닝 작업 완료 전까지 임시 자원 한도 유예 요청"
3. [신청서 제출] 클릭
4. [결과 확인]: 예외 목록(http://localhost:3000/exceptions)에서 상태가
   'PENDING' (검토 대기 중)으로 정상 등록되었는지 확인.

--------------------------------------------------------------------------------
시나리오 3: 관리자 승인 및 GitHub 원격 GitOps PR 자동 발행
--------------------------------------------------------------------------------
[목적] 관리자가 요청을 검토 후 승인하면 K8s PolicyException 배포 및
       실제 GitHub 원격 저장소에 GitOps PR이 자동 개설되는지 검증합니다.

1. 관리자 계정으로 전환 로그인:
   - URL: http://localhost:3000/login (admin@test.com / test1234!)
2. 관리자 예외 승인 관리 페이지로 이동:
   - URL: http://localhost:3000/admin/exceptions
3. 'user-payment-batch-worker' 신청 건의 상세 모달 열기
4. 검토 의견 입력 (예: "배치 튜닝 기간 30일간 임시 면제 승인") 후 [승인 (Approve)] 클릭
5. [백엔드 로그 및 GitOps 결과 확인]:
   - 백엔드 터미널에 아래와 같은 성공 로그 출력:
     [GitOps PR Created] Pull Request successfully opened: https://github.com/YeongrimGo/PaC-KyvernoDashboard/pull/...
   - Kubernetes 클러스터 확인:
     $ kubectl get policyexceptions.kyverno.io -n kyverno
     (pac-exception-<UUID> 리소스가 생성되어 런타임 면제 적용됨)

--------------------------------------------------------------------------------
시나리오 4: 실시간 관제실(/demo/cluster-live) 토폴로지 면제 확인
--------------------------------------------------------------------------------
[목적] 승인된 예외가 클러스터 라이브 토폴로지에 즉시 시각적으로 반영되는지 확인합니다.

1. 브라우저에서 http://localhost:3000/demo/cluster-live 접속
2. 우측 상단 [새로고침] 클릭
3. [결과 확인]:
   - 'governance-testbed' 네임스페이스의 'user-payment-batch-worker' 파드에
     보라색 방패 아이콘과 함께 "🛡️ 정책 예외 승인됨" 뱃지가 실시간으로 부착됨.
   - 파드를 클릭하면 우측 슬라이드 패널에 승인된 PolicyException CRD 명칭과
     만료 일시가 상세하게 표시됨.

--------------------------------------------------------------------------------
시나리오 5: Enforce 강제 차단 및 예외 워크로드 허용 검증
--------------------------------------------------------------------------------
[목적] Enforce 모드에서 일반 위반 파드는 차단되고, 예외를 받은 파드는 배포되는지 검증.

1. 모든 정책을 Enforce 모드로 전환:
   $ kubectl apply -f k8s-manifests/policies/
2. 예외가 없는 새로운 위반 파드 배포 시도:
   $ kubectl apply -f k8s-manifests/testbed/11-violation-disallow-latest-tag.yaml
   --> [결과]: Kyverno Admission Webhook에 의해 즉각 배포 거부(Denied) 에러 발생!
3. 이미 예외를 승인받은 'user-payment-batch-worker' 파드는 클러스터 내에서
   정상적으로 Running 상태를 유지하며 동작함을 확인.

--------------------------------------------------------------------------------
시나리오 6: MLOps Jupyter Notebook Hub 셀프서비스 검증
--------------------------------------------------------------------------------
[목적] 데이터 사이언티스트 전용 화면에서 머신러닝 개발 환경을 안전하게 프로비저닝.

1. 브라우저에서 http://localhost:3000/mlops/notebooks 접속
2. [새 노트북 생성] 클릭:
   - 노트북 이름: my-pytorch-lab
   - 네임스페이스: mlops-workspace
   - 프레임워크 이미지: PyTorch 2.1 + CUDA 12.1
   - 하드웨어 사양: Small CPU (1 Core / 2GB RAM)
   - 영구 스토리지: 5GB
3. [생성하기] 클릭
4. [결과 확인]:
   - $ kubectl get notebooks.kubeflow.org -n mlops-workspace
   - $ kubectl get pvc -n mlops-workspace
   - Kubeflow Notebook CRD 및 5GB 영구 홈 디렉토리 PVC가 즉시 프로비저닝됨.
   - UI에서 [중지 (Stop)] / [시작 (Start)] / [삭제 (Delete)] 생명주기 제어가 완벽히 동작.

================================================================================
4. 3단계: 트러블슈팅 및 유용한 디버깅 명령어 (Troubleshooting & Tips)
================================================================================

[Q1] 정책 위반이 대시보드에 즉시 반영되지 않을 때:
  - Kyverno의 PolicyReport 생성 주기(약 3~5초)를 기다린 후 대시보드에서 [새로고침] 클릭
  - 수동 리포트 조회: kubectl get policyreport,clusterpolicyreport -A

[Q2] GitHub PR이 열리지 않고 로컬에만 파일이 생성될 때:
  - apps/backend/.env 파일에 GITOPS_GITHUB_TOKEN="ghp_실제토큰" 이 설정되어 있는지 확인
  - GITOPS_STRATEGY="GITHUB_PR", GITOPS_GITHUB_REPO="YeongrimGo/PaC-KyvernoDashboard" 확인

[Q3] "Cluster 'default' is not configured" 오류가 발생할 때:
  - 프론트엔드 상단 클러스터 선택기에서 'Local Kind Lab (k8s-lab)'을 선택하거나
    백엔드의 KUBERNETES_CLUSTER_ID=k8s-lab 설정을 확인

================================================================================
5. 4단계: 테스트 완료 후 로컬 자원 완전 해체 (Teardown & Cleanup)
================================================================================
모든 시나리오 테스트가 완료되면 아래 단일 명령어로 깨끗하게 자원을 회수할 수 있습니다:

--------------------------------------------------------------------------------
# 1. Kind 클러스터 완전 삭제
kind delete cluster --name k8s-lab

# 2. PostgreSQL 컨테이너 중지 및 삭제
docker stop postgres-db && docker rm postgres-db

# 3. 백그라운드 프로세스(프론트엔드/백엔드) 종료 (터미널에서 Ctrl+C)
--------------------------------------------------------------------------------

이제 시스템이 초기 무점유(Clean State) 상태로 완벽하게 복구됩니다.
================================================================================
