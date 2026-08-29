import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  MessageEvent,
  Param,
  Patch,
  Post,
  Query,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { Observable } from "rxjs";
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
import { ServingService } from "./serving.service";
import { DeployModelDto } from "./dto/deploy-model.dto";
import { UpdateTrafficSplitDto } from "./dto/update-traffic.dto";
import {
  InferenceServiceResponseDto,
  PredictPayloadTestDto,
  PredictResultDto,
} from "./dto/serving-endpoint-response.dto";

/**
 * KServe InferenceService model deployment and traffic governance endpoints.
 */
@ApiTags("MLOps Model Serving")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("mlops/serving")
export class ServingController {
  constructor(private readonly servingService: ServingService) {}

  /**
   * KServe InferenceService 서빙 엔드포인트 목록을 조회합니다.
   */
  @Get("endpoints")
  @RequirePermissions("mlops.serving")
  @ApiOperation({
    summary: "KServe 서빙 엔드포인트 목록 조회",
    description:
      "배포된 InferenceService 모델 엔드포인트, 상태 및 Canary 트래픽 상태를 조회합니다.",
  })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiQuery({ name: "namespace", required: false, example: "kserve-test" })
  @ApiResponse({ status: 200, type: [InferenceServiceResponseDto] })
  async getEndpoints(
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "kserve-test",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InferenceServiceResponseDto[]> {
    return this.servingService.getEndpoints(clusterId, namespace, user);
  }

  /**
   * KServe InferenceService 실시간 상태 변경 SSE 이벤트를 스트리밍합니다.
   */
  @Sse("events")
  @RequirePermissions("mlops.serving")
  @ApiOperation({
    summary: "KServe 서빙 이벤트 실시간 스트리밍 (SSE)",
    description:
      "KServe InferenceService 상태 변화 및 Canary 트래픽 조정 시 serving-updated 이벤트를 실시간 발송합니다.",
  })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiQuery({ name: "namespace", required: false, example: "kserve-test" })
  getEvents(
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "kserve-test",
    @CurrentUser() user: AuthenticatedUser,
  ): Observable<MessageEvent> {
    return this.servingService.subscribeEvents(clusterId, namespace, user);
  }

  /**
   * 신규 KServe 모델 배포를 제출합니다.
   */
  @Post("deploy")
  @RequirePermissions("mlops.serving")
  @ApiOperation({
    summary: "KServe 모델 배포 (InferenceService 생성)",
    description:
      "S3 모델 경로, 프레임워크 및 Scale-to-Zero 설정을 지정하여 KServe 서빙 엔드포인트를 구축합니다.",
  })
  @ApiResponse({ status: 201, type: InferenceServiceResponseDto })
  async deployModel(
    @Body() dto: DeployModelDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InferenceServiceResponseDto> {
    return this.servingService.deployModel(dto, user);
  }

  /**
   * Canary 트래픽 비율을 조절합니다.
   */
  @Patch("endpoints/:name/traffic")
  @RequirePermissions("mlops.serving")
  @ApiOperation({
    summary: "Canary 배포 트래픽 비율 변경",
    description:
      "InferenceService의 Canary 트래픽 분할 비율(0 ~ 100%)을 업데이트합니다.",
  })
  @ApiParam({ name: "name", description: "엔드포인트 명칭" })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiQuery({ name: "namespace", required: false, example: "kserve-test" })
  @ApiResponse({ status: 200, type: InferenceServiceResponseDto })
  async updateTraffic(
    @Param("name") name: string,
    @Body() dto: UpdateTrafficSplitDto,
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "kserve-test",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<InferenceServiceResponseDto> {
    return this.servingService.updateTrafficSplit(
      clusterId,
      namespace,
      name,
      dto.canaryTrafficPercent,
      user,
    );
  }

  /**
   * KServe 모델 배포 엔드포인트를 삭제합니다.
   */
  @Delete("endpoints/:name")
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions("mlops.serving")
  @ApiOperation({
    summary: "KServe 서빙 엔드포인트 삭제",
    description: "배포된 KServe InferenceService 리소스를 완전 삭제합니다.",
  })
  @ApiParam({ name: "name", description: "엔드포인트 명칭" })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiQuery({ name: "namespace", required: false, example: "kserve-test" })
  @ApiResponse({ status: 204, description: "성공적으로 삭제됨" })
  async deleteEndpoint(
    @Param("name") name: string,
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "kserve-test",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    return this.servingService.deleteEndpoint(clusterId, namespace, name, user);
  }

  /**
   * 배포된 서빙 엔드포인트 예측 API 시뮬레이션 테스트
   */
  @Post("endpoints/:name/test")
  @RequirePermissions("mlops.serving")
  @ApiOperation({
    summary: "모델 서빙 엔드포인트 대화형 예측 테스트",
    description:
      "입력 텐서 JSON 데이터를 전송하여 모델의 예측 출력과 지연 시간을 실시간 확인합니다.",
  })
  @ApiParam({ name: "name", description: "엔드포인트 명칭" })
  @ApiQuery({ name: "clusterId", required: false, example: "default" })
  @ApiQuery({ name: "namespace", required: false, example: "kserve-test" })
  @ApiResponse({ status: 200, type: PredictResultDto })
  async testPrediction(
    @Param("name") name: string,
    @Body() body: PredictPayloadTestDto,
    @Query("clusterId") clusterId: string = "default",
    @Query("namespace") namespace: string = "kserve-test",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PredictResultDto> {
    return this.servingService.testPrediction(
      clusterId,
      namespace,
      name,
      body.payload,
      user,
    );
  }
}
