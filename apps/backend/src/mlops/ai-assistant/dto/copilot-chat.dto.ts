import { IsNotEmpty, IsOptional, IsObject, IsString } from "class-validator";

/**
 * MLOps Copilot 채팅 요청 DTO
 */
export class CopilotChatRequestDto {
  @IsString()
  @IsNotEmpty()
  message!: string;

  @IsObject()
  @IsOptional()
  context?: {
    page?: string;
    activeResource?: Record<string, unknown>;
  };
}

export type ActionType =
  | "CREATE_NOTEBOOK"
  | "DEPLOY_SERVED_MODEL"
  | "RUN_PIPELINE"
  | "FINOPS_OPTIMIZE"
  | "GENERAL_CHAT";

export interface ProposedAction {
  actionType: ActionType;
  title: string;
  description: string;
  payload: Record<string, unknown>;
}

/**
 * MLOps Copilot 채팅 응답 DTO
 */
export class CopilotChatResponseDto {
  replyText!: string;
  intent!: string;
  proposedAction?: ProposedAction;
  recommendations?: string[];
  provider?: "BEDROCK" | "RULE_ENGINE_FALLBACK";
}
