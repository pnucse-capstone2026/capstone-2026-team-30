import { ApiPropertyOptional } from "@nestjs/swagger";
import { IsOptional, IsString, MaxLength } from "class-validator";

/**
 * 개발자 핫픽스(Hotfix) 조치 완료(경로 C) 종결 요청 DTO
 *
 * 개발자가 매니페스트 오류를 수정하여 Git에 커밋했거나 정상 반영되었음을 마킹하여
 * 인시던트를 RESOLVED_BY_HOTFIX 상태로 종결합니다.
 */
export class ResolveHotfixDto {
  @ApiPropertyOptional({
    description: "수정 사항이 반영된 Git 커밋 해시 (SHA)",
    example: "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b",
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  commitSha?: string;

  @ApiPropertyOptional({
    description: "핫픽스 조치 내용에 대한 부가 설명 또는 메모",
    example: "deployment.yaml의 securityContext runAsNonRoot: true 수정 완료",
  })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}
