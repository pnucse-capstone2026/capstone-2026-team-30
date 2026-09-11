import { requestWithAuth } from "@/lib/api-client";

export type SimulationScenario = {
  id: string;
  title: string;
  category: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";
  targetPolicy: string;
  expectedResult: "BLOCKED" | "AUDIT_VIOLATION" | "PASSED";
  description: string;
  namespace: string;
  yaml: string;
};

export type DeploySimulationDto = {
  scenarioId?: string;
  customYaml?: string;
  namespace?: string;
  clusterId?: string;
};

export type SimulationDeployResult = {
  scenarioId?: string;
  status: "BLOCKED" | "ALLOWED";
  allowed: boolean;
  message: string;
  blockedReason?: string;
  policyName?: string;
  ruleName?: string;
  resourceKind?: string;
  resourceName?: string;
  namespace: string;
  timestamp: string;
  exceptionApplicable: boolean;
  suggestedException?: {
    policyName: string;
    ruleName?: string;
    resourceKind: string;
    resourceName: string;
    namespace: string;
  };
};

export type SimulationActiveResource = {
  name: string;
  namespace: string;
  status: string;
  scenarioId: string;
  createdAt?: string;
};

/**
 * 사전 정의된 시뮬레이션 시나리오 목록을 조회합니다.
 */
export async function fetchSimulationScenarios(): Promise<
  SimulationScenario[]
> {
  return requestWithAuth<SimulationScenario[]>("/simulation/scenarios", {
    method: "GET",
  });
}

/**
 * 시뮬레이션 배포를 실행합니다.
 */
export async function deploySimulation(
  dto: DeploySimulationDto,
): Promise<SimulationDeployResult> {
  return requestWithAuth<SimulationDeployResult>("/simulation/deploy", {
    method: "POST",
    body: dto,
  });
}

/**
 * 현재 클러스터에 배포된 시뮬레이션 리소스 목록을 조회합니다.
 */
export async function fetchSimulationResources(
  clusterId?: string,
): Promise<SimulationActiveResource[]> {
  const query = clusterId ? `?clusterId=${encodeURIComponent(clusterId)}` : "";
  return requestWithAuth<SimulationActiveResource[]>(
    `/simulation/resources${query}`,
    {
      method: "GET",
    },
  );
}

/**
 * 배포된 모든 시뮬레이션 파드를 일괄 정리합니다.
 */
export async function cleanupSimulationResources(
  clusterId?: string,
): Promise<{ message: string; deletedResources: string[] }> {
  const query = clusterId ? `?clusterId=${encodeURIComponent(clusterId)}` : "";
  return requestWithAuth<{ message: string; deletedResources: string[] }>(
    `/simulation/cleanup${query}`,
    {
      method: "DELETE",
    },
  );
}
