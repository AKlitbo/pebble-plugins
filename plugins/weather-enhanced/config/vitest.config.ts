/**
 * Vitest config for the plugin app's own specs.
 *
 * Runs every *.spec.ts under src/ in node. The framework's specs stay with the framework, so paf/ is
 * never searched. Run through paf test, or npm run test:watch and test:coverage.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  root: path.resolve(import.meta.dirname, '..'),
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'paf/**', 'targets/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      exclude: ['**/*.spec.ts', '**/*.d.ts'],
    },
  },
});
