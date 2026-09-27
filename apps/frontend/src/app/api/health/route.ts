import { NextResponse } from "next/server";

/**
 * ALB Ingress 및 Kubernetes 프로브를 위한 프론트엔드 자체 헬스체크 엔드포인트입니다.
 * 백엔드 라우팅과 동일한 /api/health 경로에서 200 OK를 반환하여 Target Group 정상 상태를 보장합니다.
 */
export async function GET() {
  return NextResponse.json(
    { status: "ok", service: "frontend" },
    { status: 200 },
  );
}
