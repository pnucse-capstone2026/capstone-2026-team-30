import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../../auth/guards/jwt-auth.guard";
import { WorkloadDiagnosticService } from "./workload-diagnostic.service";
import {
  DiagnoseWorkloadRequestDto,
  DiagnoseWorkloadResponseDto,
} from "./dto/diagnose-workload.dto";

/**
 * MLOps 워크로드 실패 진단을 처리하는 컨트롤러입니다.
 */
@ApiTags("MLOps AI Assistant")
@Controller("api/v1/mlops/assistant")
@UseGuards(JwtAuthGuard)
export class MlopsAssistantController {
  constructor(private readonly diagnosticService: WorkloadDiagnosticService) {}

  /**
   * 실패한 Notebook, Pipeline Run, KServe Pod의 로그 및 이벤트를 수집/분석하여 원인 보고서를 생성합니다.
   *
   * @param dto 워크로드 식별자 및 로그/이벤트
   * @returns 원인 진단 및 권장 조치 보고서
   */
  @Post("diagnose")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "MLOps 워크로드 실패 원인 진단",
    description:
      "CUDA OOM, Exit Code 137, Driver Mismatch 등의 오류 로그를 종합 진단합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "성공적으로 워크로드 실패 진단 보고서를 생성함",
    type: DiagnoseWorkloadResponseDto,
  })
  async diagnose(
    @Body() dto: DiagnoseWorkloadRequestDto,
  ): Promise<DiagnoseWorkloadResponseDto> {
    return this.diagnosticService.diagnoseWorkload(dto);
  }
}
