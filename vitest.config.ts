import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': root,
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: [
      'src/**/*.{test,spec}.ts',
      'verum-swap/backend/**/*.{test,spec}.ts',
      'api/**/*.{test,spec}.ts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.expo/**',
      'app/**',
      'components/**',
      'hooks/**',
      'constants/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts', 'verum-swap/backend/src/**/*.ts', 'api/**/*.ts'],
      exclude: [
        '**/__tests__/**',
        '**/*.{test,spec}.ts',
        '**/*.d.ts',
        'src/components/**',
        'src/context/**',
        'src/hooks/**',
      ],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
