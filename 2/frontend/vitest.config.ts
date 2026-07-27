// フロントのユニットテスト設定。対象は core/ の純粋関数のみ
// (コンポーネント/DOM の挙動は e2e/ が実ブラウザで検証する方針)。
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/f-tool/src/**/*.spec.ts', 'libs/**/*.spec.ts'],
    environment: 'node',
  },
});
