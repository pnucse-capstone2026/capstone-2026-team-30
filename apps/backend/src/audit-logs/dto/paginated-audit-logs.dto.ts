import { ApiProperty } from "@nestjs/swagger";
import { AuditLogItemDto } from "./audit-log-item.dto";

/**
 * 페이징 처리된 감사 로그 목록 DTO
 */
export class PaginatedAuditLogsDto {
  @ApiProperty({ type: [AuditLogItemDto], description: "감사 로그 항목 목록" })
  items!: AuditLogItemDto[];

  @ApiProperty({ description: "총 항목 수", example: 42 })
  total!: number;

  @ApiProperty({ description: "현재 페이지", example: 1 })
  page!: number;

  @ApiProperty({ description: "페이지당 항목 수", example: 20 })
  limit!: number;

  @ApiProperty({ description: "전체 페이지 수", example: 3 })
  totalPages!: number;
}
