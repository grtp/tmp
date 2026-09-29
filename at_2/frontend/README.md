Node.js 22~

```bash
npm ci                 # 依存のインストール(package-lock.json どおり)
npm start              # アプリ本体 (http://localhost:4200。/api は :8080 へプロキシ)
npm test               # Vitest(純粋ロジックの単体テスト)
npx nx build f-tool    # 本番ビルド → dist/apps/f-tool
npx nx lint f-tool && npx nx lint ui
```