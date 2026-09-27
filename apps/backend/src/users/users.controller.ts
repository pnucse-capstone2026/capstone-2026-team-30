import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Put,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { CreateUserDto } from "./dto/create-user.dto";
import { ResetUserPasswordDto } from "./dto/reset-user-password.dto";
import { SetUserClustersDto } from "./dto/set-user-clusters.dto";
import { SetUserDisabledDto } from "./dto/set-user-disabled.dto";
import { UpdateUserRoleDto } from "./dto/update-user-role.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@ApiBearerAuth()
@Controller("users")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions("users.read")
  list() {
    return this.usersService.list();
  }

  @Post()
  @RequirePermissions("users.create")
  create(@Body() dto: CreateUserDto) {
    return this.usersService.create(dto);
  }

  @Patch(":id/role")
  @RequirePermissions("users.update_role")
  updateRole(@Param("id") id: string, @Body() dto: UpdateUserRoleDto) {
    return this.usersService.updateRole(id, dto);
  }

  @Patch(":id/password")
  @RequirePermissions("users.reset_password")
  resetPassword(@Param("id") id: string, @Body() dto: ResetUserPasswordDto) {
    return this.usersService.resetPassword(id, dto);
  }

  @Patch(":id/disabled")
  @RequirePermissions("users.disable")
  setDisabled(@Param("id") id: string, @Body() dto: SetUserDisabledDto) {
    return this.usersService.setDisabled(id, dto);
  }

  @Put(":id/clusters")
  @RequirePermissions("users.assign_clusters")
  setClusters(
    @Param("id") id: string,
    @Body() dto: SetUserClustersDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.usersService.setClusters(id, dto, user);
  }
}
