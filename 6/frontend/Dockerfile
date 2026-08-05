# frontend/Dockerfile
# ビルドコンテキストはリポジトリルート(compose 側で context: .. を指定)。
# backend/Dockerfile と同じくマルチステージで, 成果物だけを配信イメージへ移す。
#
# 生成コード(core/gen/api-types.ts)はコミット済み前提。イメージ内で
# codegen はしない(backend と同じ方針。api/openapi.yaml を変えたら
# ホストで make generate してからコミットする)。
#
# Node はローカル開発と同じ 24 系に揃える(Angular 21 / nx 23)。
FROM docker.io/library/node:24-alpine AS builder
WORKDIR /app
# 依存だけ先に入れてレイヤーキャッシュを効かせる
# (package.json / package-lock.json が変わらない限り npm ci は再実行されない)。
# .npmrc も必須: legacy-peer-deps=true が無いと Angular 21 系の peer 依存が
# 衝突して npm ci が落ちる(ホストの npm install も同じ設定で通している)。
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ ./
# nx のデーモンはコンテナ内では不要(常駐させない)。
ENV NX_DAEMON=false
RUN npx nx build f-tool
# 動作中イメージのバージョンを成果物へ焼き込む(compose の build.args 経由)。
# 画面(ログインタイトルのホバー / 個人設定の下部)が /version.json を読む。
# ARG をここで初めて消費することで, タグだけ変えた再ビルドでも上の
# npm ci / nx build のレイヤーキャッシュが効く。
ARG IMAGE_TAG=dev
RUN printf '{"version":"%s"}\n' "$IMAGE_TAG" > /app/dist/apps/f-tool/browser/version.json

FROM docker.io/library/nginx:1.27-alpine
# nginx の設定は compose が volumes でマウントする(環境A/B を
# NGINX_CONF で切り替えるため, イメージには焼き込まない)。
COPY --from=builder /app/dist/apps/f-tool/browser /usr/share/nginx/html
EXPOSE 80
