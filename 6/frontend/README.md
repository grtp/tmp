# f-tool monorepo (Nx)

Angular アプリ本体と UI コンポーネントライブラリ + Storybook を
Nx Monorepo で管理する構成。

## 構成

```
apps/f-tool/              アプリ本体 (Angular 21.2 / esbuild)
libs/ui/                 UI コンポーネントライブラリ (A案デザイン)
  src/lib/<機能>/<component>/  機能別サブフォルダ(shared/login/dashboard/
                                table-maint/settings/history)+ stories
  src/styles/tokens.css      デザイントークン (--tm-*, メイン #3e69ad)
  .storybook/                この lib 専用の Storybook 設定
```

アプリ側からは `import { LoginPage } from '@f-tool/ui';`
(tsconfig.base.json の paths で解決) で利用できます。

## セットアップと起動

Node.js 22 以上が必要です。

```bash
npm install            # .npmrc の legacy-peer-deps=true が効く
npm run storybook      # Storybook (http://localhost:4400)
npm start              # アプリ本体 (http://localhost:4200)
npm run build-storybook  # 静的ビルド → dist/storybook/ui
```

## Angular のバージョンについて

現時点 (2026-07) の Nx 23.0.1 が公式対応する Angular は 21.2 のため、
本ワークスペースは Angular 21.2 で構築しています。コンポーネントは
`ChangeDetectionStrategy.OnPush` を明示しており (22 ではデフォルト)、
`input()` / `output()` シグナル API のみを使っているため、
Angular 22 対応の Nx がリリースされ次第、以下で移行できます:

```bash
npx nx migrate latest
npm install
npx nx migrate --run-migrations
```

## 依存関係のポイント

- `.npmrc` の `legacy-peer-deps=true`: @storybook/angular の
  peer 依存レンジが最新 Angular に追従していないための回避策。
  Storybook 側の対応後に外して構いません。
- `@angular-devkit/build-angular`: @storybook/angular が要求する
  Webpack 系ビルダー。アプリ本体は esbuild (`@angular/build`) を
  使うため両方が devDependencies に入っています。
- tokens.css は Storybook では project.json の storybook /
  build-storybook ターゲットの `styles` オプションで読み込んでいます。
  アプリ本体で使う場合は apps/f-tool/project.json の build
  ターゲットの `styles` にも追加してください。
- Tabler Icons は libs/ui/.storybook/preview-head.html で CDN から
  読み込んでいます。社内 LAN 運用では `@tabler/icons-webfont` を
  npm で入れて styles 経由に切り替えることを推奨します。

## 検証済み

- `nx build-storybook ui` … 成功 (stories 14 entries)
- `nx build f-tool` … 成功
