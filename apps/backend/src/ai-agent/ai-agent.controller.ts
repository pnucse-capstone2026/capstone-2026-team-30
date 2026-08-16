import { Body, Controller, HttpCode, HttpStatus, Post } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { AiAgentService } from "./ai-agent.service";
import {
  ExplainKyvernoErrorDto,
  KyvernoErrorExplanationResultDto,
} from "./dto/explain-error.dto";

/**
 * Kyverno 오류 메시지 해설 AI 에이전트 API 컨트롤러
 */
@ApiTags("ai-agent")
@Controller("ai-agent")
export class AiAgentController {
  constructor(private readonly aiAgentService: AiAgentService) {}

  /**
   * Kyverno 정책 위반 메시지와 매니페스트/클러스터 상태를 분석하여 쉬운 가이드 리포트를 제공합니다.
   *
   * @param dto 오류 메시지 및 매니페스트/정책 정보
   * @returns 쉬운 언어로 변환된 원인, 조치 방법, 추천 YAML diff 및 정책 목적
   */
  @Post("explain-kyverno-error")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Kyverno 정책 위반 오류 해설 리포트 생성",
    description:
      "플랫폼 지식이 부족한 일반 팀을 위해 Kyverno 오류 메시지, 정책 YAML, 쿠버네티스 매니페스트, 클러스터 상태를 종합 분석하여 대화식 가이드를 생성합니다.",
  })
  @ApiResponse({
    status: 200,
    description: "오류 분석 및 가이드 생성 성공",
    type: KyvernoErrorExplanationResultDto,
  })
  async explainKyvernoError(
    @Body() dto: ExplainKyvernoErrorDto,
  ): Promise<KyvernoErrorExplanationResultDto> {
    return this.aiAgentService.explainKyvernoError(dto);
  }
}
