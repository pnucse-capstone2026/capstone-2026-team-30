import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Role } from "@prisma/client";

export type NotificationType =
  | "exception"
  | "violation"
  | "cluster"
  | "audit"
  | "policy"
  | "incident";

export type NotificationSeverity = "info" | "warning" | "critical" | "success";

/**
 * 알림 응답 DTO
 */
export class NotificationItemDto {
  @ApiProperty({ description: "알림 식별자", example: "noti-001" })
  id: string;

  @ApiProperty({
    description: "알림 제목",
    example: "승인 대기 예외가 있습니다",
  })
  title: string;

  @ApiProperty({
    description: "알림 내용 상세 메시지",
    example: "require-resource-limits 예외 신청 검토가 필요합니다.",
  })
  message: string;

  @ApiProperty({
    description: "알림 유형",
    example: "exception",
    enum: ["exception", "violation", "cluster", "audit", "policy"],
  })
  type: NotificationType;

  @ApiProperty({
    description: "알림 심각도 / 중요도",
    example: "warning",
    enum: ["info", "warning", "critical", "success"],
  })
  severity: NotificationSeverity;

  @ApiProperty({ description: "읽음 여부", example: false })
  read: boolean;

  @ApiProperty({
    description: "생성 일시",
    example: "2026-08-30 10:00",
  })
  createdAt: string;

  @ApiProperty({
    description: "이동 대상 경로 (URL / Router Path)",
    example: "/admin/exceptions/EXC-2026-0012",
  })
  href: string;

  @ApiPropertyOptional({
    description: "대상 사용자 역할 목록",
    enum: Role,
    isArray: true,
  })
  targetRoles?: Role[];

  @ApiPropertyOptional({
    description: "대상 사용자 이메일 목록",
    type: [String],
  })
  targetUserEmails?: string[];
}
