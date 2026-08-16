import { Module } from "@nestjs/common";
import { KubernetesModule } from "../kubernetes/kubernetes.module";
import { PrismaModule } from "../prisma/prisma.module";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [PrismaModule, KubernetesModule],
  controllers: [UsersController],
  providers: [UsersService, PermissionsGuard],
})
export class UsersModule {}
