
```bash
npm ci                 # 依存のインストール(package-lock.json どおり)
npm start              # アプリ本体 (http://localhost:4200。/api は :8080 へプロキシ)
npm test               # Vitest(純粋ロジックの単体テスト)
npm run build          # 本番ビルド → dist/apps/f-tool
npm run lint           # ESLint(apps/ と libs/ をまとめて)
```
