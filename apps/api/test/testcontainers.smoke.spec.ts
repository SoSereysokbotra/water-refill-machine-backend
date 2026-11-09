import { describe, it, expect } from 'vitest';
import { GenericContainer } from 'testcontainers';

describe('Testcontainers smoke test', () => {
  it('starts a lightweight redis container and verifies connectivity', async () => {
    const container = await new GenericContainer('redis:7-alpine').withExposedPorts(6379).start();

    expect(container.getId()).toBeDefined();
    expect(container.getMappedPort(6379)).toBeGreaterThan(0);

    await container.stop();
  }, 120000);
});
