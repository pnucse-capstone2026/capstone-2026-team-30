import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { ClusterMetadata, ClusterProvider } from "./cluster-provider";

@ApiTags("clusters")
@ApiBearerAuth()
@Controller("clusters")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClustersController {
  constructor(private readonly clusters: ClusterProvider) {}

  /** 역할과 무관하게 명시적으로 배정된 클러스터만 노출한다. */
  @Get()
  @RequirePermissions("exception_requests.read")
  list(@CurrentUser() user: AuthenticatedUser): ClusterMetadata[] {
    return this.clusters
      .list()
      .filter((cluster) => user.clusterIds.includes(cluster.id));
  }

  @Get("catalog")
  @RequirePermissions("users.assign_clusters")
  catalog(): ClusterMetadata[] {
    return this.clusters.list();
  }
}
