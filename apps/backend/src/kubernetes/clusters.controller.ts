import { Controller, Get, Param, UseGuards } from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { AuthenticatedUser } from "../auth/auth.types";
import { CurrentUser } from "../auth/decorators/current-user.decorator";
import { RequirePermissions } from "../auth/decorators/require-permissions.decorator";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../auth/guards/permissions.guard";
import { BusinessException } from "../common/errors/business.exception";
import { ClusterMetadata, ClusterProvider } from "./cluster-provider";
import { KUBERNETES_ERROR } from "./kubernetes.errors";

/**
 * Kubernetes 클러스터 목록 및 메타데이터 조회를 담당하는 컨트롤러입니다.
 */
@ApiTags("clusters")
@ApiBearerAuth()
@Controller("clusters")
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ClustersController {
  constructor(private readonly clusters: ClusterProvider) {}

  /**
   * 사용자가 접근 가능한 배정 클러스터 목록을 조회합니다.
   *
   * @param user 현재 인증된 사용자 정보
   * @returns 사용자가 접근 권한을 가진 클러스터 메타데이터 목록
   */
  @Get()
  @RequirePermissions("exception_requests.read")
  @ApiOperation({ summary: "배정된 클러스터 목록 조회" })
  @ApiResponse({ status: 200, description: "클러스터 목록 반환" })
  list(@CurrentUser() user: AuthenticatedUser): ClusterMetadata[] {
    return this.clusters
      .list()
      .filter((cluster) => user.clusterIds.includes(cluster.id));
  }

  /**
   * 시스템에 등록된 전체 클러스터 카탈로그를 조회합니다. (어드민/권한 보유자 전용)
   *
   * @returns 전체 클러스터 메타데이터 목록
   */
  @Get("catalog")
  @RequirePermissions("users.assign_clusters")
  @ApiOperation({ summary: "전체 클러스터 카탈로그 조회" })
  @ApiResponse({ status: 200, description: "전체 클러스터 목록 반환" })
  catalog(): ClusterMetadata[] {
    return this.clusters.list();
  }

  /**
   * 지정된 ID의 클러스터 메타데이터를 단일 조회합니다.
   *
   * @param id 조회할 클러스터 ID
   * @param user 현재 인증된 사용자 정보
   * @returns 클러스터 메타데이터
   */
  @Get(":id")
  @RequirePermissions("exception_requests.read")
  @ApiOperation({ summary: "단일 클러스터 상세 조회" })
  @ApiResponse({ status: 200, description: "클러스터 메타데이터 반환" })
  @ApiResponse({
    status: 404,
    description: "클러스터 미존재 또는 접근 권한 없음",
  })
  get(
    @Param("id") id: string,
    @CurrentUser() user: AuthenticatedUser,
  ): ClusterMetadata {
    const isAssigned = user.clusterIds.includes(id);
    const isAdmin = user.role === "ADMIN";

    if (!isAssigned && !isAdmin) {
      throw new BusinessException(KUBERNETES_ERROR.CLUSTER_NOT_CONFIGURED, {
        message: `Cluster '${id}' is not accessible or not configured.`,
        context: { clusterId: id },
      });
    }

    return this.clusters.getMetadata(id);
  }
}
