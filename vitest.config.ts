import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // every test file shares one real postgres/kafka/redis stack, not an
    // isolated db per worker - running files in parallel lets one file's
    // fixtures/cleanup race another's and corrupt shared state
    fileParallelism: false,
  },
});
