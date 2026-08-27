"use client";

import { useState } from "react";
import {
  Bot,
  Send,
  Sparkles,
  Zap,
  Edit3,
  CheckCircle2,
  X,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  CopilotChatResponse,
  CopilotProposedAction,
  sendCopilotMessage,
} from "@/lib/mlops-assistant-api";
import { createNotebook } from "@/lib/notebooks-api";
import { createPipelineRun } from "@/lib/pipelines-api";
import { deployModelEndpoint } from "@/lib/serving-api";

type Message = {
  id: string;
  sender: "user" | "ai";
  text: string;
  proposedAction?: CopilotProposedAction;
  recommendations?: string[];
  provider?: "BEDROCK" | "RULE_ENGINE_FALLBACK";
  timestamp: string;
};

type CopilotDrawerProps = {
  activePageName?: string;
  onOpenCreateNotebookModal?: (prefill: Record<string, any>) => void;
  onRefreshList?: () => void;
};

/**
 * MLOps AI Copilot 전역 대화형 슬라이딩 Drawer 컴포넌트입니다.
 * 하이브리드 원클릭 액션(즉시 실행 및 폼 자동입력 Pre-fill)을 지원합니다.
 */
export function CopilotDrawer({
  activePageName = "MLOps Workspace",
  onOpenCreateNotebookModal,
  onRefreshList,
}: CopilotDrawerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [inputMessage, setInputMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [actionExecuting, setActionExecuting] = useState<string | null>(null);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const [messages, setMessages] = useState<Message[]>([
    {
      id: "welcome",
      sender: "ai",
      text: `안녕하세요! MLOps Bedrock AI Copilot입니다.\n노트북 생성, 모델 서빙 배포, 파이프라인 연동 질의나 에러 원인을 질문해 주세요.`,
      recommendations: [
        "PyTorch 2.3 노트북 1개 생성해줘",
        "KServe에 ResNet50 모델 배포해줘",
      ],
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  const handleSend = async (textToSend?: string) => {
    const query = textToSend || inputMessage;
    if (!query.trim() || loading) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: "user",
      text: query,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputMessage("");
    setLoading(true);

    try {
      const res: CopilotChatResponse = await sendCopilotMessage({
        message: query,
        context: { page: activePageName },
      });

      const aiMsg: Message = {
        id: `ai-${Date.now()}`,
        sender: "ai",
        text: res.replyText,
        proposedAction: res.proposedAction,
        recommendations: res.recommendations,
        provider: res.provider,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          sender: "ai",
          text: `오류가 발생했습니다: ${(err as Error).message}`,
          timestamp: new Date().toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * 하이브리드 옵션 1: 액션 즉시 실행 [⚡ 즉시 생성]
   */
  const handleDirectExecute = async (
    msgId: string,
    action: CopilotProposedAction,
  ) => {
    setActionExecuting(msgId);
    setActionSuccess(null);

    try {
      if (action.actionType === "CREATE_NOTEBOOK") {
        await createNotebook({
          name: action.payload.name,
          namespace: action.payload.namespace || "default",
          clusterId: action.payload.clusterId || "cluster-us-east-1a",
          hardwareTier: action.payload.hardwareTier || "CPU_MEDIUM",
          frameworkImage: action.payload.frameworkImage || "JUPYTER_PYTORCH",
          storageGb: action.payload.storageGb || 20,
        });
      } else if (action.actionType === "DEPLOY_SERVED_MODEL") {
        await deployModelEndpoint({
          name: action.payload.name,
          namespace: action.payload.namespace || "default",
          clusterId: action.payload.clusterId || "cluster-us-east-1a",
          framework: action.payload.framework || "pytorch",
          storageUri: action.payload.storageUri || "s3://mlops-models/v1",
          minReplicas: action.payload.minReplicas || 1,
          maxReplicas: action.payload.maxReplicas || 3,
        });
      } else if (action.actionType === "RUN_PIPELINE") {
        await createPipelineRun({
          pipelineId: action.payload.pipelineId,
          runName: action.payload.runName,
          clusterId: action.payload.clusterId || "cluster-us-east-1a",
          namespace: action.payload.namespace || "default",
          parameters: action.payload.parameters || {},
        });
      }

      setActionSuccess(msgId);
      if (onRefreshList) onRefreshList();
    } catch (err) {
      alert(`액션 실행 중 오류가 발생했습니다: ${(err as Error).message}`);
    } finally {
      setActionExecuting(null);
    }
  };

  /**
   * 하이브리드 옵션 2: 폼 자동입력 후 생성 [✏️ 설정 수정 후 생성]
   */
  const handleFormPrefill = (action: CopilotProposedAction) => {
    if (onOpenCreateNotebookModal) {
      onOpenCreateNotebookModal(action.payload);
      setIsOpen(false);
    } else {
      alert(
        `수정 폼 자동 입력을 준비했습니다: ${JSON.stringify(action.payload, null, 2)}`,
      );
    }
  };

  return (
    <>
      {/* 화면 우하단 Floating Copilot 버튼 */}
      {!isOpen && (
        <Button
          onClick={() => setIsOpen(true)}
          className="fixed bottom-6 right-6 z-50 flex h-14 items-center gap-3 rounded-full bg-gradient-to-r from-blue-600 to-cyan-500 px-5 text-white shadow-xl transition-all hover:scale-105 hover:from-blue-700 hover:to-cyan-600"
        >
          <Sparkles className="size-5 animate-pulse text-cyan-200" />
          <span className="font-semibold">MLOps Copilot</span>
        </Button>
      )}

      {/* Slide-in Chat Drawer */}
      {isOpen && (
        <div className="fixed bottom-6 right-6 z-50 flex h-[620px] w-[420px] flex-col rounded-2xl border border-slate-700 bg-slate-900 text-slate-100 shadow-2xl backdrop-blur-lg">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-5 py-4 rounded-t-2xl">
            <div className="flex items-center gap-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-blue-500/20 text-cyan-400 border border-cyan-500/30">
                <Bot className="size-5" />
              </div>
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-white flex items-center gap-2">
                  MLOps AI Copilot
                  <Badge
                    variant="outline"
                    className="border-cyan-500/40 text-cyan-300 text-[10px]"
                  >
                    Claude 3.5 Sonnet
                  </Badge>
                </h3>
                <p className="text-[11px] text-slate-400">{activePageName}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 text-slate-400 hover:bg-slate-800 hover:text-white"
              onClick={() => setIsOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>

          {/* Chat Messages Body */}
          <div className="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  msg.sender === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-3 ${
                    msg.sender === "user"
                      ? "bg-blue-600 text-white rounded-tr-none"
                      : "bg-slate-800/90 text-slate-200 border border-slate-700/60 rounded-tl-none"
                  }`}
                >
                  <p className="whitespace-pre-wrap leading-relaxed">
                    {msg.text}
                  </p>

                  {/* 하이브리드 Action Card 렌더링 */}
                  {msg.proposedAction && (
                    <Card className="mt-3 border-blue-500/30 bg-blue-950/40 text-slate-100 shadow-md">
                      <CardHeader className="p-3 pb-1">
                        <CardTitle className="flex items-center gap-2 text-xs font-semibold text-cyan-300">
                          <Zap className="size-4 text-cyan-400" />
                          {msg.proposedAction.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="p-3 pt-1 space-y-2 text-xs">
                        <p className="text-slate-300">
                          {msg.proposedAction.description}
                        </p>
                        <div className="rounded bg-slate-900/80 p-2 text-[11px] font-mono text-cyan-200 border border-slate-800">
                          {Object.entries(msg.proposedAction.payload).map(
                            ([k, v]) => (
                              <div
                                key={k}
                                className="flex justify-between py-0.5"
                              >
                                <span className="text-slate-400">{k}:</span>
                                <span>{String(v)}</span>
                              </div>
                            ),
                          )}
                        </div>

                        {/* 버튼 영역: [⚡ 즉시 생성] & [✏️ 설정 수정 후 생성] */}
                        <div className="mt-3 flex flex-col gap-2 pt-1">
                          {actionSuccess === msg.id ? (
                            <div className="flex items-center justify-center gap-2 rounded bg-emerald-500/20 py-2 text-emerald-300 text-xs font-medium border border-emerald-500/30">
                              <CheckCircle2 className="size-4" />
                              액션 실행이 성공적으로 완료되었습니다!
                            </div>
                          ) : (
                            <div className="grid grid-cols-2 gap-2">
                              <Button
                                size="sm"
                                className="h-8 bg-blue-600 text-white hover:bg-blue-500 text-[11px] font-medium"
                                disabled={actionExecuting === msg.id}
                                onClick={() =>
                                  handleDirectExecute(
                                    msg.id,
                                    msg.proposedAction!,
                                  )
                                }
                              >
                                {actionExecuting === msg.id ? (
                                  <Loader2 className="size-3 animate-spin mr-1" />
                                ) : (
                                  <Zap className="size-3 mr-1" />
                                )}
                                ⚡ 즉시 생성
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-8 border-cyan-500/40 text-cyan-300 hover:bg-cyan-950/40 text-[11px] font-medium"
                                onClick={() =>
                                  handleFormPrefill(msg.proposedAction!)
                                }
                              >
                                <Edit3 className="size-3 mr-1" />
                                ✏️ 설정 수정
                              </Button>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}

                  {/* Recommendations */}
                  {msg.recommendations && msg.recommendations.length > 0 && (
                    <div className="mt-3 space-y-1 border-t border-slate-700/60 pt-2">
                      <p className="text-[11px] font-medium text-cyan-400">
                        추천 가이드:
                      </p>
                      {msg.recommendations.map((rec, idx) => (
                        <button
                          key={idx}
                          onClick={() => handleSend(rec)}
                          className="block text-left text-[11px] text-slate-300 hover:text-cyan-200 underline decoration-slate-600 decoration-dotted"
                        >
                          • {rec}
                        </button>
                      ))}
                    </div>
                  )}

                  {msg.provider && (
                    <div className="mt-2 text-[10px] text-slate-500 text-right">
                      Powered by{" "}
                      {msg.provider === "BEDROCK"
                        ? "AWS Bedrock Claude 3.5"
                        : "Rule Engine"}
                    </div>
                  )}
                </div>
                <span className="mt-1 px-1 text-[10px] text-slate-500">
                  {msg.timestamp}
                </span>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-slate-400 bg-slate-800/40 p-3 rounded-xl w-fit">
                <Loader2 className="size-4 animate-spin text-cyan-400" />
                Claude 3.5 Sonnet 분석 중...
              </div>
            )}
          </div>

          {/* Input Footer */}
          <div className="border-t border-slate-800 bg-slate-950/80 p-3 rounded-b-2xl">
            <div className="flex items-center gap-2">
              <Input
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
                placeholder="MLOps 요청사항을 자연어로 입력하세요..."
                className="h-10 bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 text-xs focus-visible:ring-cyan-500"
              />
              <Button
                onClick={() => handleSend()}
                disabled={loading || !inputMessage.trim()}
                className="h-10 px-4 bg-cyan-600 hover:bg-cyan-500 text-white"
              >
                <Send className="size-4" />
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
