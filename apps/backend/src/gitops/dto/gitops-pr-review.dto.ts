import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { IsInt, IsNotEmpty, IsOptional, IsString } from "class-validator";
import { KyvernoViolationDetail } from "../../simulation/dto/dry-run-validation.dto";

/**
 * GitOps PR 검증 요청 DTO
 */
export class GitOpsPrReviewDto {
  @ApiProperty({
    description: "GitHub 저장소 전체 이름 (예: org/repo)",
    example: "acme-corp/payment-service",
  })
  @IsString()
  @IsNotEmpty()
  repository: string;

  @ApiProperty({
    description: "Pull Request 번호",
    example: 42,
  })
  @IsInt()
  pullNumber: number;

  @ApiProperty({
    description: "PR 대상 최신 커밋 SHA",
    example: "7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1f",
  })
  @IsString()
  @IsNotEmpty()
  commitSha: string;

  @ApiPropertyOptional({
    description: "타겟 클러스터 식별자",
    default: "default",
    example: "default",
  })
  @IsOptional()
  @IsString()
  clusterId?: string;

  @ApiProperty({
    description: "배포 대상 네임스페이스",
    example: "payment-prod",
  })
  @IsString()
  @IsNotEmpty()
  targetNamespace: string;

  @ApiProperty({
    description: "변경 또는 추가된 쿠버네티스 매니페스트 YAML 원문",
    example: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-api
  namespace: payment-prod
spec:
  replicas: 2
  template:
    spec:
      containers:
        - name: app
          image: payment:latest
`,
  })
  @IsString()
  @IsNotEmpty()
  manifestYaml: string;
}

/**
 * AI Self-Correction 실행 결과 상세 DTO
 */
export class SelfCorrectionResultDto {
  @ApiProperty({ description: "자가 교정 및 dry-run 재검증 통과 여부" })
  corrected: boolean;

  @ApiProperty({ description: "자가 교정 시도 횟수" })
  attempts: number;

  @ApiPropertyOptional({ description: "자가 교정된 YAML 패치" })
  suggestedPatch?: string;

  @ApiPropertyOptional({ description: "안전 조치 권장 가이드" })
  guidance?: string;
}

/**
 * GitOps PR 검증 결과 응답 DTO
 */
export class GitOpsPrReviewResultDto {
  @ApiProperty({ description: "전체 매니페스트 유효성 통과 여부" })
  valid: boolean;

  @ApiProperty({ description: "Server-Side Dry-Run 어드미션 통과 여부" })
  dryRunPassed: boolean;

  @ApiProperty({ description: "Kyverno Enforce 정책에 의한 배포 차단 여부" })
  blocked: boolean;

  @ApiProperty({ description: "검증된 총 리소스 수" })
  totalResources: number;

  @ApiProperty({ description: "차단된 리소스 수" })
  blockedCount: number;

  @ApiProperty({
    description: "최종 검증 상태",
    enum: ["PASSED", "BLOCKED", "ERROR"],
  })
  status: "PASSED" | "BLOCKED" | "ERROR";

  @ApiPropertyOptional({ description: "등록된 GitHub PR 코멘트 URL" })
  commentUrl?: string;

  @ApiPropertyOptional({ description: "생성된 PR Bot 마크다운 코멘트 전문" })
  commentMarkdown?: string;

  @ApiPropertyOptional({
    description: "GitHub Commit Status 전송 상태",
    enum: ["success", "failure", "skipped"],
  })
  commitStatus?: string;

  @ApiPropertyOptional({
    description: "AI 자동 교정 제안 diff 또는 가이드라인 (통과 시 생략)",
  })
  suggestedDiff?: string;

  @ApiPropertyOptional({
    description: "AI Self-Correction 실행 결과 상세",
    type: SelfCorrectionResultDto,
  })
  selfCorrectionResult?: SelfCorrectionResultDto;

  @ApiPropertyOptional({
    description: "원클릭 정책 예외 신청 딥링크 URL",
  })
  exceptionDeepLink?: string;

  @ApiProperty({
    description: "발견된 모든 정책 위반 상세 목록",
    type: [Object],
  })
  violations: KyvernoViolationDetail[];
}

/**
 * GitOps PR 검증 비동기 수신 응답 DTO
 */
export class GitOpsPrReviewAsyncResponseDto {
  @ApiProperty({
    description: "발행된 BullMQ 비동기 작업 식별자",
    example: "pr-acme-corp-payment-service-42-a1b2c3d4",
  })
  jobId: string;

  @ApiProperty({
    description: "큐 작업 상태",
    example: "queued",
    enum: ["queued"],
  })
  status: "queued";

  @ApiPropertyOptional({
    description: "생성된 GitHub Check Run 식별자 (Check Run 연동 시)",
    example: 123456789,
  })
  checkRunId?: number | string;
}
