import { defineConfig } from 'vitest/config';

export default defineConfig({
  // 测试经包名导入时直连源码，避免测到 gitignored 的 dist 陈旧产物
  // （相对路径由 vite 基于项目根解析）
  resolve: {
    alias: [
      { find: /^@purea\/utils$/, replacement: './src/index.ts' },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/index.ts'],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
});
