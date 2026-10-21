# frontend/Dockerfile
# ビルドコンテキストはリポジトリルート(compose 側で context: .. を指定)。
# backend/Dockerfile と同じくマルチステージで, 成果物だけを配信イメージへ移す。
#
# 生成コード(core/gen/api-types.ts)はコミット済み前提。イメージ内で
# codegen はしない(backend と同じ方針。api/openapi.yaml を変えたら
# ホストで make generate してからコミットする)。
#
# Node はローカル開発と同じ 24 系に揃える(Angular 21)。
FROM docker.io/library/node:24-alpine AS builder
WORKDIR /app
# 依存だけ先に入れてレイヤーキャッシュを効かせる
# (package.json / package-lock.json が変わらない限り npm ci は再実行されない)。
# .npmrc(ignore-scripts)も先に入れ,イメージ内の npm ci でもインストール時スクリプトを止める
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ ./
RUN npx ng build
# 動作中イメージのバージョンを成果物へ焼き込む(compose の build.args 経由)。
# 画面(ログインタイトルのホバー / 個人設定の下部)が /version.json を読む。
# ARG をここで初めて消費することで, タグだけ変えた再ビルドでも上の
# npm ci / ng build のレイヤーキャッシュが効く。
ARG IMAGE_TAG=dev
RUN printf '{"version":"%s"}\n' "$IMAGE_TAG" > /app/dist/apps/f-tool/browser/version.json

FROM docker.io/library/nginx:1.27-alpine
# nginx の設定は compose が volumes でマウントする(環境A/B を
# NGINX_CONF で切り替えるため, イメージには焼き込まない)。
COPY --from=builder /app/dist/apps/f-tool/browser /usr/share/nginx/html
EXPOSE 80
