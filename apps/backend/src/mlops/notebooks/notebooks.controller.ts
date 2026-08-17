import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
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
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { PermissionsGuard } from "../../auth/guards/permissions.guard";
import { RequirePermissions } from "../../auth/decorators/require-permissions.decorator";
import { CurrentUser } from "../../auth/decorators/current-user.decorator";
import type { AuthenticatedUser } from "../../auth/auth.types";
import { NotebooksService } from "./notebooks.service";
import { CreateNotebookDto } from "./dto/create-notebook.dto";
import { NotebookListQueryDto } from "./dto/notebook-list-query.dto";
import { NotebookPresetsResponseDto } from "./dto/notebook-preset.dto";
import { NotebookResponseDto } from "./dto/notebook-response.dto";

/**
 * 데이터 사이언티스트를 위한 Kubeflow Notebook 생명주기 관리 REST API 컨트롤러입니다.
 */
@ApiTags("MLOps Notebooks")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller("mlops/notebooks")
export class NotebooksController {
  constructor(private readonly notebooksService: NotebooksService) {}

  /**
   * 이용 가능한 하드웨어 및 ML 프레임워크 이미지 프리셋 카탈로그를 조회합니다.
   */
  @Get("presets")
  @ApiOperation({
    summary: "MLOps 노트북 프리셋 카탈로그 조회",
    description:
      "생성 시 선택 가능한 CPU/GPU 하드웨어 티어 및 프레임워크 런타임 이미지 목록을 조회합니다.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: NotebookPresetsResponseDto,
    description: "프리셋 카탈로그 응답",
  })
  getPresets(): NotebookPresetsResponseDto {
    return this.notebooksService.getPresets();
  }

  /**
   * 지정된 클러스터 및 네임스페이스의 Notebook 인스턴스 목록을 조회합니다.
   */
  @Get()
  @ApiOperation({
    summary: "Notebook 인스턴스 목록 조회",
    description:
      "사용자가 접근 권한을 가진 클러스터 내의 Kubeflow Notebook 목록을 조회합니다.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: [NotebookResponseDto],
    description: "Notebook 목록",
  })
  async listNotebooks(
    @Query() query: NotebookListQueryDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotebookResponseDto[]> {
    return this.notebooksService.listNotebooks(
      query.clusterId,
      query.namespace || "default",
      user,
    );
  }

  /**
   * 단일 Notebook 상세 정보를 조회합니다.
   */
  @Get(":name")
  @ApiOperation({
    summary: "Notebook 상세 정보 조회",
    description:
      "단일 Kubeflow Notebook 인스턴스의 상세 상태 및 자원 정보를 조회합니다.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: NotebookResponseDto,
    description: "Notebook 상세 정보",
  })
  async getNotebook(
    @Param("name") name: string,
    @Query("clusterId") clusterId: string,
    @Query("namespace") namespace: string = "default",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotebookResponseDto> {
    return this.notebooksService.getNotebook(
      clusterId,
      namespace || "default",
      name,
      user,
    );
  }

  /**
   * 신규 Notebook 인스턴스를 프로비저닝합니다.
   */
  @Post()
  @RequirePermissions("mlops.notebooks")
  @ApiOperation({
    summary: "신규 Notebook 프로비저닝",
    description:
      "프리셋 자원 스펙 및 런타임 이미지를 기반으로 Kubeflow Notebook을 새로 프로비저닝합니다.",
  })
  @ApiResponse({
    status: HttpStatus.CREATED,
    type: NotebookResponseDto,
    description: "프로비저닝 완료된 Notebook 상세 정보",
  })
  async createNotebook(
    @Body() dto: CreateNotebookDto,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotebookResponseDto> {
    return this.notebooksService.createNotebook(dto, user);
  }

  /**
   * 실행 중인 Notebook 인스턴스를 중지합니다.
   */
  @Post(":name/stop")
  @RequirePermissions("mlops.notebooks")
  @ApiOperation({
    summary: "Notebook 인스턴스 중지",
    description:
      "실행 중인 Kubeflow Notebook의 리소스 할당을 해제하고 중지합니다.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: NotebookResponseDto,
    description: "중지 처리된 Notebook 상세 정보",
  })
  async stopNotebook(
    @Param("name") name: string,
    @Query("clusterId") clusterId: string,
    @Query("namespace") namespace: string = "default",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotebookResponseDto> {
    return this.notebooksService.stopNotebook(
      clusterId,
      namespace || "default",
      name,
      user,
    );
  }

  /**
   * 중지된 Notebook 인스턴스를 재시작합니다.
   */
  @Post(":name/start")
  @RequirePermissions("mlops.notebooks")
  @ApiOperation({
    summary: "Notebook 인스턴스 재시작",
    description: "중지 상태의 Kubeflow Notebook 인스턴스를 재시작합니다.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    type: NotebookResponseDto,
    description: "재시작 처리된 Notebook 상세 정보",
  })
  async startNotebook(
    @Param("name") name: string,
    @Query("clusterId") clusterId: string,
    @Query("namespace") namespace: string = "default",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<NotebookResponseDto> {
    return this.notebooksService.startNotebook(
      clusterId,
      namespace || "default",
      name,
      user,
    );
  }

  /**
   * Notebook 인스턴스를 삭제합니다.
   */
  @Delete(":name")
  @RequirePermissions("mlops.notebooks")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Notebook 인스턴스 삭제",
    description:
      "지정된 Kubeflow Notebook 인스턴스 및 관련 K8s 자원을 삭제합니다.",
  })
  @ApiResponse({
    status: HttpStatus.NO_CONTENT,
    description: "삭제 완료",
  })
  async deleteNotebook(
    @Param("name") name: string,
    @Query("clusterId") clusterId: string,
    @Query("namespace") namespace: string = "default",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<void> {
    await this.notebooksService.deleteNotebook(
      clusterId,
      namespace || "default",
      name,
      user,
    );
  }

  /**
   * Notebook 직접 접속 URL을 반환합니다.
   */
  @Get(":name/url")
  @ApiOperation({
    summary: "Notebook JupyterLab 접속 URL 조회",
    description:
      "해당 Notebook 인스턴스의 웹 브라우저 접속 엔드포인트 URL을 제공합니다.",
  })
  @ApiResponse({
    status: HttpStatus.OK,
    schema: { properties: { url: { type: "string" } } },
    description: "접속 URL",
  })
  async getNotebookUrl(
    @Param("name") name: string,
    @Query("clusterId") clusterId: string,
    @Query("namespace") namespace: string = "default",
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ url: string }> {
    return this.notebooksService.getNotebookUrl(
      clusterId,
      namespace || "default",
      name,
      user,
    );
  }
}
