# 4. GitHub Actions 및 AWS 연동 기반의 CI/CD 파이프라인 구축

## Status

Proposed ( Yeongrim Go )<br>
Under consideration<br>
`See also : CI/CD branch README.md`
## Context

본 프로젝트는 pnpm workspaces 기반의 모노레포 구조를 취하고 있으며, 실제 구동 인프라는 AWS(EKS/ECS) 환경에서 호스팅하는 것을 상정하고 있습니다.
CI/CD 파이프라인을 구축하는 과정에서 다음과 같은 기술적 제약과 보안 요구사항이 존재했습니다.

1. 빌드 및 배포 비효율성 해소:
   * 모노레포 내의 특정 애플리케이션에 수정이 생겼을 때, 변경되지 않은 프론트엔드까지 매번 새로 빌드하고 배포하는 것은 비효율적입니다
   * 이에 따라 변경된 패키지만 선별하는 최적화 프로세스가 필요했습니다.

2. AWS 연동의 보안 강화:
   * 파이프라인의 러너 역할을 하게 될 GitHub Actions가 ECR에 이미지를 푸시하고 EKS/ECS 클러스터에 배포 명령을 내리려면 AWS 권한이 필요합니다
   * 기존의 AWS IAM Access Key/Secret Key를 GitHub에 직접 저장하는 방식은 위험이 크므로, 임시 자격 증명 기반의 인증이 요구되었습니다

3. 자동화된 코드 검증:
   * 코드 병합(PR) 전에 단순 컴파일 성공뿐만 아니라, 백엔드/프론트엔드 테스트 코드의 통과 여부 및 새로 작성된 Kyverno YAML 정책 파일의 문법 유효성 검사가 사용자의 개입 없이 자동 실행되어야 했습니다

4. 제한적인 클라우드 리소스 및 인프라 비용 제약:
   * 현재 개발 AWS 환경은 프리티어로 운영 중이며, 타겟 호스트는 m7i-flex.large(2 vCPU, 8 GiB Memory) 수준의 비교적 제한적인 컴퓨팅 자원으로 구성되어 있습니다.
   * 이 제약 조건 하에서 서버 인스턴스가 빌드 오버헤드로 인해 다운되는 현상을 방지해야 합니다. 따라서 무거운 컴파일 및 도커 이미지 빌드 작업은 외부 자원인 GitHub Actions로 위임하고, 
   운영 서버에는 가볍게 패키징된 프로덕션 이미지 및 최소한의 리소스만 전달하여 원활하게 기동되도록 설계해야 합니다

## Proposal(Decision)

1. GitHub Actions 및 AWS ECR 기반 파이프라인 통합:
   * CI/CD 플랫폼으로 GitHub Actions를 채택하고 배포 파이프라인을 구축합니다
2. AWS IAM OIDC(OpenID Connect) 연동을 통한 보안 강화:
   * GitHub Actions Secrets에 영구적인 AWS Access Key / Secret Key를 저장하지 않고, AWS IAM Identity Provider와 GitHub OIDC 연동을 통해 빌드 시점에 유효 기간이 매우 짧은 임시 보안토큰을 부여받아 ECR/EKS에 접근하도록 설계합니다
3. 인프라 자원 분리 및 외부 빌드(Build Offloading) 전략:
   * 컴파일, 패키징, 도커 이미지 빌드와 같은 컴퓨팅 집약적 연산은 GitHub Actions에서 실행합니다
   * 타겟 서버(m7i-flex.large)는 이미 빌드가 끝난 가벼운 standalone 컨테이너 이미지의 단순 실행 및 롤링 업데이트 작업만 전담시켜 런타임 호스트의 CPU/메모리 부하를 방지합니다
4. 모노레포 변경 감지 기반 배포 최적화:
   * GitHub Actions 내에서 파일 변경 감지 액션을 활용하여 실제 소스 코드 변경이 발생한 부분만 선별하여 도커 이미지 빌드 및 ECR 푸시를 유기적으로 조절합니다
5. 통합 테스트 및 Kyverno 정책 검증 파이프라인 구성:
   * PR(Pull Request) 및 커밋 발생 시 백엔드 단위 테스트(pnpm test) 실행 및 kyverno validate k8s-manifests/policies/를 검증 단계에 기본 실행 명령어로 추가합니다.

## Consequences

* 얻을 수 있는 이점:
  * 프리티어 서버 자원의 안정적인 유지: m7i-flex.large 호스트의 제한된 리소스를 낭비하지 않고 오직 런타임 서버 구동에만 온전히 집중시킬 수 있어, 빌드 도중 겪을 수 있는 Out of Memory(OOM) 오류 및 인스턴스 멈춤 현상을 미연에 차단합니다.
  * 보안 위협 최소화: OIDC 신뢰 설정 덕분에 외부 저장소에 고정 자격 증명이 유출될 수 있는 가능성이 기술적으로 차단됩니다.
  * 통신 및 전송 비용 효율화: 변경 감지를 통해 필요한 시점에 이미지만 ECR로 전송하므로 네트워크 비용 및 저장 비용을 절약합니다
  * 지속적인 정적 보안 강화: Merge 전 Kyverno 정책 파일의 정합성이 완전 무결한 상태에서만 배포되도록 보장합니다

* 감수해야 할 제약 사항:
  * 초기 인프라 보안 셋업 복잡성: AWS IAM 역할 관계 설정 및 GitHub 레포지토리 정보 매핑을 위한 초기 구성 공수가 요구됩니다.
  * 모노레포 워크플로우 제어 비용: 특정 모듈의 경우(예: packages/shared 등), 수정되었을 때 프론트와 백엔드 모두를 재빌드하도록 흐름 제어 조건(Paths Filter Dependency)을 관리해야 합니다
