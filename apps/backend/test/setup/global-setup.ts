import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

type IntegrationTestGlobal = typeof globalThis & {
  __POSTGRES_CONTAINER__?: StartedPostgreSqlContainer;
};

export default async function globalSetup(): Promise<void> {
  const container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('kyverno_dashboard_integration')
    .withUsername('integration_user')
    .withPassword('integration_password')
    .start();

  try {
    const databaseUrl = container.getConnectionUri();

    execFileSync(
      'pnpm',
      ['exec', 'prisma', 'db', 'push', '--skip-generate'],
      {
        cwd: resolve(__dirname, '../..'),
        env: {
          ...process.env,
          DATABASE_URL: databaseUrl,
        },
        stdio: 'pipe',
      },
    );

    process.env.TEST_DATABASE_URL = databaseUrl;
    (globalThis as IntegrationTestGlobal).__POSTGRES_CONTAINER__ = container;
  } catch (error) {
    await container.stop();
    throw error;
  }
}
