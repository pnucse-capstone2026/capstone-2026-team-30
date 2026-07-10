import { StartedPostgreSqlContainer } from '@testcontainers/postgresql';

type IntegrationTestGlobal = typeof globalThis & {
  __POSTGRES_CONTAINER__?: StartedPostgreSqlContainer;
};

export default async function globalTeardown(): Promise<void> {
  const testGlobal = globalThis as IntegrationTestGlobal;

  await testGlobal.__POSTGRES_CONTAINER__?.stop();
  delete testGlobal.__POSTGRES_CONTAINER__;
}
