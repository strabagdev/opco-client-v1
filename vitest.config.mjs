import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // SQLite integration fixtures use real disk I/O and child processes. The paired
    // full-suite controls exceed the unchanged 5s limit when all CPU workers race.
    // Keep assertions, isolation and timeouts intact; serialize test files instead.
    maxWorkers: 1,
  },
});
