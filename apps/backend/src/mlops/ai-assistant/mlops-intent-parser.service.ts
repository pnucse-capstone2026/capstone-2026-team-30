import { Injectable, Logger } from "@nestjs/common";

/**
 * LLM 응답 텍스트로부터 구조화된 JSON 데이터를 정제/파싱하는 서비스
 */
@Injectable()
export class MlopsIntentParserService {
  private readonly logger = new Logger(MlopsIntentParserService.name);

  /**
   * LLM이 출력한 JSON 문자열 또는 텍스트 블록에서 JSON 데이터를 안전하게 정제/파싱합니다.
   *
   * @param rawText LLM 모델이 반환한 원본 텍스트
   * @returns 파싱된 객체 또는 null
   */
  parseJsonFromLlmOutput<T = unknown>(rawText: string): T | null {
    try {
      // ```json ... ``` 코드 블록 처리
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      const textToParse = jsonMatch ? jsonMatch[1].trim() : rawText.trim();
      return JSON.parse(textToParse) as T;
    } catch (error) {
      // JSON 파싱 실패 시 예외 로깅 후 null 반환
      this.logger.warn(
        `Failed to parse JSON from LLM output: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
