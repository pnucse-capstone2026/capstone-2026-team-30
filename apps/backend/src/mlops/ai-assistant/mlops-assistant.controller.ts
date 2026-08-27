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
import { MlopsAssistantService } from "./mlops-assistant.service";
import { WorkloadDiagnosticService } from "./workload-diagnostic.service";
import {
  CopilotChatRequestDto,
  CopilotChatResponseDto,
} from "./dto/copilot-chat.dto";
import {
  DiagnoseWorkloadRequestDto,
  DiagnoseWorkloadResponseDto,
} from "./dto/diagnose-workload.dto";

/**
 * MLOps AI Copilot 어시스턴트 및 워크로드 실패 진단을 처리하는 컨트롤러입니다.
 */
@ApiTags("MLOps AI Assistant")
@Controller("api/v1/mlops/assistant")
@UseGuards(JwtAuthGuard)
export class MlopsAssistantController {
  constructor(
    private readonly assistantService: MlopsAssistantService,
    private readonly diagnosticService: WorkloadDiagnosticService,
  ) {}

  /**
   * MLOps 대화형 Copilot 채팅 및 의도 분석/액션 카드를 생성합니다.
   *
   * @param dto 사용자의 자연어 프롬프트 및 UI 컨텍스트
   * @returns Copilot 응답 및 제안 액션 카드
   */
  @Post("chat")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "MLOps Copilot 대화 및 자연어 액션 생성",
    description:
      "사용자 질의를 파싱하여 MLOps 프로비저닝/서빙 액션 카드를 생성합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "성공적으로 Copilot 대화 응답 및 액션을 생성함",
    type: CopilotChatResponseDto,
  })
  async chat(
    @Body() dto: CopilotChatRequestDto,
  ): Promise<CopilotChatResponseDto> {
    return this.assistantService.processChat(dto);
  }

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
