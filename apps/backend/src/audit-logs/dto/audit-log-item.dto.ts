import { ApiProperty } from "@nestjs/swagger";
import { AuditActorType, ExceptionStatus } from "@prisma/client";

/**
 * 감사 로그 단건 항목 DTO
 */
export class AuditLogItemDto {
  @ApiProperty({
    description: "감사 로그 고유 식별자",
    example: "550e8400-e29b-41d4-a716-446655440000",
  })
  id!: string;

  @ApiProperty({
    description: "감사 작업 유형",
    example: "EXCEPTION_REQUEST_APPROVED",
  })
  action!: string;

  @ApiProperty({
    description: "대상 엔티티 종류",
    example: "EXCEPTION_REQUEST",
  })
  entityType!: string;

  @ApiProperty({ description: "대상 엔티티 식별자", example: "req-12345" })
  entityId!: string;

  @ApiProperty({
    enum: AuditActorType,
    description: "행위자 유형 (USER | SYSTEM)",
    example: AuditActorType.USER,
  })
  actorType!: AuditActorType;

  @ApiProperty({
    description: "작업 수행자 이메일 (시스템인 경우 null)",
    example: "admin@example.com",
    nullable: true,
  })
  actorEmail!: string | null;

  @ApiProperty({
    description: "작업 수행자 역할 (시스템인 경우 null)",
    example: "ADMIN",
    nullable: true,
  })
  actorRole!: string | null;

  @ApiProperty({
    enum: ExceptionStatus,
    description: "변경 전 상태",
    nullable: true,
    example: ExceptionStatus.PENDING,
  })
  beforeStatus!: ExceptionStatus | null;

  @ApiProperty({
    enum: ExceptionStatus,
    description: "변경 후 상태",
    nullable: true,
    example: ExceptionStatus.APPLYING,
  })
  afterStatus!: ExceptionStatus | null;

  @ApiProperty({ description: "추가 메타데이터", nullable: true })
  metadata!: Record<string, unknown> | null;

  @ApiProperty({
    description: "사람이 읽을 수 있는 작업 요약 문장",
    example: "admin@example.com님이 예외 신청을 승인했습니다.",
  })
  summary!: string;

  @ApiProperty({
    description: "기록 일시",
    example: "2026-08-19T05:35:00.000Z",
  })
  createdAt!: string;
}
