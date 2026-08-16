import { StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { ClusterFixture, teardownClusterFixture } from "./cluster-fixture";

type IntegrationTestGlobal = typeof globalThis & {
  __POSTGRES_CONTAINER__?: StartedPostgreSqlContainer;
  __CLUSTER_FIXTURE__?: ClusterFixture;
};

export default async function globalTeardown(): Promise<void> {
  const testGlobal = globalThis as IntegrationTestGlobal;

  try {
    if (testGlobal.__CLUSTER_FIXTURE__) {
      await teardownClusterFixture(testGlobal.__CLUSTER_FIXTURE__);
      delete testGlobal.__CLUSTER_FIXTURE__;
    }
  } finally {
    await testGlobal.__POSTGRES_CONTAINER__?.stop();
    delete testGlobal.__POSTGRES_CONTAINER__;
  }
}
