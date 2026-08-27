import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import { AuthenticatedUser } from "../../auth/auth.types";
import { PipelinesService } from "./pipelines.service";
import { CreateRunDto } from "./dto/create-run.dto";
import {
  PipelineRunDto,
  PipelineTemplateDto,
} from "./dto/pipeline-response.dto";
import { RunLogQueryDto } from "./dto/run-log-query.dto";

/**
 * Kubeflow Pipelines (KFP) execution and log inspection endpoints.
 */
@ApiTags("MLOps Pipelines")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("mlops/pipelines")
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  /**
   * 등록된 KFP 파이프라인 템플릿 목록을 조회합니다.
   */
  @Get("templates")
  @RequirePermissions("mlops.pipelines")
  @ApiOperation({
    summary: "Kubeflow 파이프라인 템플릿 목록 조회",
    description:
      "데이터 학습 및 전처리에 사용 가능한 템플릿 명세 및 파라미터를 조회합니다.",
  })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiResponse({ status: 200, type: [PipelineTemplateDto] })
  async getTemplates(
    @Query("clusterId") clusterId: string = "default",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PipelineTemplateDto[]> {
    return this.pipelinesService.getPipelineTemplates(clusterId, user);
  }

  /**
   * 파이프라인 트리거/실행(Run)을 제출합니다.
   */
  @Post("runs")
  @RequirePermissions("mlops.pipelines")
  @ApiOperation({
    summary: "파이프라인 실행(Run) 제출",
    description:
      "하이퍼파라미터 및 S3 데이터 경로를 지정하여 신규 KFP 파이프라인 실행을 제출합니다.",
  })
  @ApiResponse({ status: 201, type: PipelineRunDto })
  async createRun(
    @Body() dto: CreateRunDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PipelineRunDto> {
    return this.pipelinesService.createRun(dto, user);
  }

  /**
   * 지정된 클러스터/네임스페이스의 파이프라인 Run 목록을 조회합니다.
   */
  @Get("runs")
  @RequirePermissions("mlops.pipelines")
  @ApiOperation({
    summary: "파이프라인 실행(Run) 이력 목록 조회",
    description: "진행 중이거나 완료된 KFP 파이프라인 실행 이력을 조회합니다.",
  })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiQuery({ name: "namespace", required: false, example: "kubeflow" })
  @ApiResponse({ status: 200, type: [PipelineRunDto] })
  async getRuns(
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "kubeflow",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PipelineRunDto[]> {
    return this.pipelinesService.getRuns(clusterId, namespace, user);
  }

  /**
   * 단일 파이프라인 Run 상세 및 DAG 스텝 상태를 조회합니다.
   */
  @Get("runs/:runId")
  @RequirePermissions("mlops.pipelines")
  @ApiOperation({
    summary: "파이프라인 Run 상세 및 DAG 상태 조회",
    description:
      "파이프라인 실행 단계별 DAG 노드 상태 및 Pod 정보를 조회합니다.",
  })
  @ApiParam({ name: "runId", description: "파이프라인 Run 식별자" })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiQuery({ name: "namespace", required: false, example: "kubeflow" })
  @ApiResponse({ status: 200, type: PipelineRunDto })
  async getRunDetail(
    @Param("runId") runId: string,
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "kubeflow",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PipelineRunDto> {
    return this.pipelinesService.getRunDetail(
      clusterId,
      namespace,
      runId,
      user,
    );
  }

  /**
   * 특정 파이프라인 스텝 Pod의 컨테이너 로그를 출력합니다.
   */
  @Get("runs/:runId/logs")
  @RequirePermissions("mlops.pipelines")
  @ApiOperation({
    summary: "파이프라인 스텝 Pod 실시간 컨테이너 로그 조회",
    description:
      "DAG 스텝 실행 Pod의 stdout/stderr 컨테이너 로그를 조회합니다.",
  })
  @ApiParam({ name: "runId", description: "파이프라인 Run 식별자" })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiQuery({ name: "namespace", required: false, example: "kubeflow" })
  @ApiResponse({ status: 200, type: String })
  async getRunLogs(
    @Param("runId") _runId: string,
    @Query() query: RunLogQueryDto,
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "kubeflow",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ logs: string }> {
    const logs = await this.pipelinesService.getPodLogs(
      clusterId,
      namespace,
      query.podName,
      query.containerName,
      query.tailLines ?? 200,
      user,
    );
    return { logs };
  }
}
