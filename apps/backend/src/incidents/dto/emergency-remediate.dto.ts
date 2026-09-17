import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

/**
 * 긴급 운영자 모드(경로 B) 임시 예외 발행 요청 DTO
 *
 * 서비스 장애 등 긴급 상황 시 관리자가 사전 검토한 사유 및 유효시간(TTL)을 지정하여
 * 클러스터 런타임 적용과 GitOps PR 생성을 즉시 트리거합니다.
 */
export class EmergencyRemediateDto {
  @ApiPropertyOptional({
    description: "임시 예외 유효 시간 (시간 단위, 1~168시간 허용, 기본값 24)",
    example: 24,
    default: 24,
    minimum: 1,
    maximum: 168,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(168)
  ttlHours?: number = 24;

  @ApiProperty({
    description: "긴급 임시 예외 발행 사유 (감사 추적용 필수 항목)",
    example: "프로덕션 결제 모듈 배포 차단으로 인한 긴급 핫픽스 임시 통과 조치",
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;

  @ApiPropertyOptional({
    description: "GitOps 리포지토리에 PolicyException PR을 자동 생성할지 여부",
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  publishToGitOps?: boolean = true;
}
