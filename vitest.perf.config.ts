import { defineConfig } from 'vitest/config';
/** Timing budgets: run alone and one file at a time so the main suite's parallel load can't skew them. */
export default defineConfig({ test: { globals: true, environment: 'node', include: ['tests/perf/**/*.test.ts'], fileParallelism: false } });
