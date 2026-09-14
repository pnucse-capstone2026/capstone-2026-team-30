/**
 * LLM 호출 시 선택적으로 적용되는 옵션 규격
 */
export interface LlmOptions {
  maxTokens?: number;
  temperature?: number;
}

/**
 * LLM(Large Language Model) 연동 공급자 추상화 인터페이스 (SPI)
 *
 * AWS Bedrock, OpenAI, Azure OpenAI, 로컬 LLM(Ollama/vLLM) 등
 * 다양한 생성형 AI 엔진을 플랫폼 코어 서비스와 디커플링하여 교체 가능하도록 정의합니다.
 */
export interface LlmProvider {
  /** 공급자 고유 식별자 (예: 'BEDROCK', 'OPENAI', 'NONE') */
  readonly providerId: string;

  /** 공급자 사용 가능 여부 (API 키, 인증 자격 증명 설정 여부 등) */
  isAvailable(): boolean;

  /**
   * 대화형 프롬프트(System/User)를 기반으로 텍스트 완성을 요청합니다.
   *
   * @param systemPrompt 시스템 프롬프트 (페르소나 및 응답 지침)
   * @param userPrompt 사용자 입력 프롬프트 (질의 내용 및 컨텍스트)
   * @param options 선택적 모델 파라미터
   * @returns 모델 생성 텍스트 응답
   */
  chatCompletion(
    systemPrompt: string,
    userPrompt: string,
    options?: LlmOptions,
  ): Promise<string>;
}

/**
 * NestJS Dependency Injection을 위한 LlmProvider 토큰
 */
export const LLM_PROVIDER_TOKEN = "LLM_PROVIDER_TOKEN";
