import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { DeploymentIncidentDto } from "./incident-response.dto";

/**
 * 인시던트 해결 보조 초안(Remediation Draft) 응답 DTO
 *
 * 운영자 및 개발자가 즉시 검토할 수 있도록 자동 생성된 PolicyException YAML 초안과
 * 정식 예외 신청 페이지로 바로 이동할 수 있는 프리필 URL 및 조치 가이드를 제공합니다.
 */
export class RemediationDraftDto {
  @ApiProperty({
    description: "자동 생성된 Kyverno PolicyException YAML 매니페스트 초안",
    example: "apiVersion: kyverno.io/v2\nkind: PolicyException\n...",
  })
  suggestedExceptionYaml: string;

  @ApiProperty({
    description:
      "정식 정책 예외 신청서(/exceptions/new)로 연결되는 파라미터 프리필 URL",
    example:
      "/exceptions/new?cluster=production-us-east-1&namespace=mlops&resource=serving-api&kind=Deployment&policy=disallow-privileged&rule=require-non-root",
  })
  autoFillUrl: string;

  @ApiProperty({
    description: "인시던트 차단 원인 분석 및 해결 가이드라인",
    example:
      "해당 워크로드가 'disallow-privileged' 정책의 'require-non-root' 규칙에 의해 배포 차단되었습니다. 정식 거버넌스 절차를 권장하며 긴급 시 관리자 임시 발행을 사용할 수 있습니다.",
  })
  remediationGuide: string;

  @ApiPropertyOptional({
    description: "기본 권장 긴급 예외 만료 시간 (시간 단위)",
    example: 24,
    default: 24,
  })
  defaultTtlHours: number;

  @ApiProperty({
    description: "대상 배포 차단 인시던트 상세 정보",
    type: () => DeploymentIncidentDto,
  })
  incident: DeploymentIncidentDto;
}
