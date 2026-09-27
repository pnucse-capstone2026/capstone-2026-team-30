import {
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import type { AuthenticatedUser } from "../auth/auth.types";
import { ListNotificationsQueryDto } from "./dto/list-notifications-query.dto";
import { NotificationItemDto } from "./dto/notification-item.dto";
import { NotificationsService } from "./notifications.service";

/**
 * 플랫폼 사용자 알림 API 컨트롤러
 */
@ApiTags("notifications")
@ApiBearerAuth()
@Controller("notifications")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private readonly service: NotificationsService) {}

  /**
   * 로그인 사용자의 역할과 계정에 맞춘 알림 목록을 조회합니다.
   *
   * @param user 요청자 인증 컨텍스트
   * @param query 조회 쿼리 파라미터 DTO
   * @returns 알림 목록
   */
  @Get()
  @RequirePermissions("notifications.read")
  @ApiOperation({ summary: "사용자 알림 목록 조회" })
  @ApiResponse({
    status: 200,
    description: "알림 목록 조회 성공",
    type: [NotificationItemDto],
  })
  getNotifications(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<NotificationItemDto[]> {
    return this.service.getNotifications(user, query);
  }

  /**
   * 특정 알림 항목을 읽음 처리합니다.
   *
   * @param id 알림 식별자
   * @param user 요청자 인증 컨텍스트
   */
  @Post(":id/read")
  @Patch(":id/read")
  @RequirePermissions("notifications.read")
  @ApiOperation({ summary: "알림 읽음 처리" })
  @ApiResponse({
    status: 200,
    description: "알림 읽음 처리 성공",
  })
  markAsRead(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    return this.service.markAsRead(id, user);
  }

  /**
   * 사용자의 모든 알림을 읽음 처리합니다.
   *
   * @param user 요청자 인증 컨텍스트
   */
  @Post("read-all")
  @Patch("read-all")
  @RequirePermissions("notifications.read")
  @ApiOperation({ summary: "전체 알림 읽음 처리" })
  @ApiResponse({
    status: 200,
    description: "전체 알림 읽음 처리 성공",
  })
  markAllAsRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ success: boolean }> {
    return this.service.markAllAsRead(user);
  }
}
