import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { ClusterFixture, provisionClusterFixture } from "./cluster-fixture";

type IntegrationTestGlobal = typeof globalThis & {
  __POSTGRES_CONTAINER__?: StartedPostgreSqlContainer;
  __CLUSTER_FIXTURE__?: ClusterFixture;
};

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer("postgres:17-alpine")
    .withDatabase("kyverno_dashboard_integration")
    .withUsername("integration_user")
    .withPassword("integration_password")
    .start();

  try {
    const databaseUrl = container.getConnectionUri();

    execFileSync(
      resolve(__dirname, "../../node_modules/.bin/prisma"),
      ["migrate", "deploy"],
      {
        cwd: resolve(__dirname, "../.."),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        stdio: "pipe",
      },
    );

    process.env.TEST_DATABASE_URL = databaseUrl;
    (globalThis as IntegrationTestGlobal).__POSTGRES_CONTAINER__ = container;
  } catch (error) {
    await container.stop();
    throw error;
  }

  // 실 클러스터 스펙은 kind 기동 비용이 커서 옵트인이다. 게이트가 없으면
  // 해당 스펙이 스스로 skip 하므로 기존 통합 실행은 그대로 빠르게 끝난다.
  if (!process.env.RUN_CLUSTER_TESTS) return;

  try {
    (globalThis as IntegrationTestGlobal).__CLUSTER_FIXTURE__ =
      await provisionClusterFixture();
  } catch (error) {
    await container.stop();
    throw error;
  }
}
