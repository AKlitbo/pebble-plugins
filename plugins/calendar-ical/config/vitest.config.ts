/**
 * Vitest config for the plugin app's own specs.
 *
 * Runs every *.spec.ts under src/ in node. The framework's specs stay with the framework, so paf/ is
 * never searched. Run through paf test, or npm run test:watch and test:coverage.
 */
import path from 'node:path';
import { defineConfig } from 'vitest/config';
import { icaljsBundle } from '../paf/tools/shared/paths.ts';

// the framework's iCal reader imports ./icaljs, which only a build copies in beside it
// the specs aim at the same prebuilt ical.js the build bundles, found the way the build finds it
const ICALJS = icaljsBundle();

if (!ICALJS) {
  throw new Error('ical.js is not installed, run paf sync');
}

export default defineConfig({
  root: path.resolve(import.meta.dirname, '..'),
  resolve: {
    alias: [{ find: /^\.\/icaljs$/, replacement: ICALJS }],
  },
  test: {
    include: ['src/**/*.spec.ts'],
    exclude: ['**/node_modules/**', 'paf/**', 'targets/**'],
    // a zone whose clocks change, so a spec built from local dates runs across daylight saving wherever it runs
    env: { TZ: 'America/Toronto' },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      include: ['src/**'],
      exclude: ['**/*.spec.ts', '**/*.d.ts'],
    },
  },
});
