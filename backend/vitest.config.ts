import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts', 'src/tests/**/*.test.js'],
    testTimeout: 20000,
    hookTimeout: 20000,
    env: {
      // Test environment — deterministic, no live providers.
      NODE_ENV: 'test',
      TELECOM_WEBHOOK_SECRET: 'test-webhook-secret',
      DEVICE_API_KEYS: 'test-key:POS-TEST-01',
      SMS_PROVIDER: 'disabled',
      SMS_BUSINESS_NAME: 'KhatHub',
      RUN_MIGRATIONS: 'false',
      DATABASE_URL: 'postgres://unused:unused@localhost:5432/unused',
      EVC_API_KEY: '',
      EVC_SECRET: '',
      ZAAD_MERCHANT_CODE: '',
      ZAAD_SECRET: '',
    },
  },
});
