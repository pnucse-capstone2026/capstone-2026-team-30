import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Patch,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { ExceptionStatus } from "@prisma/client";
import { Response } from "express";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ApproveExceptionRequestDto } from "./dto/approve-exception-request.dto";
import { CancelExceptionRequestDto } from "./dto/cancel-exception-request.dto";
import { CreateExceptionRequestDto } from "./dto/create-exception-request.dto";
import { RejectExceptionRequestDto } from "./dto/reject-exception-request.dto";
import { ExceptionRequestsService } from "./exception-requests.service";

@ApiTags("exception-requests")
@ApiBearerAuth()
@Controller("exception-requests")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ExceptionRequestsController {
  constructor(private readonly service: ExceptionRequestsService) {}

  @Get()
  @RequirePermissions("exception_requests.read")
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.service.list(user);
  }

  @Get(":id")
  @RequirePermissions("exception_requests.read")
  get(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.get(id, user);
  }

  @Post()
  @RequirePermissions("exception_requests.create")
  create(
    @Body() dto: CreateExceptionRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.create(dto, user);
  }

  @Patch(":id/approve")
  @Post(":id/approve")
  @RequirePermissions("exception_requests.approve")
  approve(
    @Param("id") id: string,
    @Body() dto: ApproveExceptionRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.approve(id, dto, user);
  }

  @Patch(":id/reject")
  @Post(":id/reject")
  @RequirePermissions("exception_requests.reject")
  reject(
    @Param("id") id: string,
    @Body() dto: RejectExceptionRequestDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.service.reject(id, dto, user);
  }

  @Patch(":id/retry")
  @RequirePermissions("exception_requests.retry")
  retry(@Param("id") id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.service.retry(id, user);
  }

  @Patch(":id/cancel")
  @Post(":id/cancel")
  @RequirePermissions("exception_requests.cancel")
  async cancel(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
    @Body() dto?: CancelExceptionRequestDto,
  ) {
    const request = await this.service.cancel(id, user, dto);
    if (
      request.status === ExceptionStatus.CANCELLING ||
      (request.status === ExceptionStatus.CANCELLED && request.decidedAt)
    ) {
      response.status(HttpStatus.ACCEPTED);
    }
    return request;
  }
}
