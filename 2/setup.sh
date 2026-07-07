#!/usr/bin/env bash
# setup.sh — table-maint 開発環境セットアップ(WSL/AlmaLinux想定)
#
# 実行:
#   chmod +x setup.sh
#   ./setup.sh
#
# 末尾の `make run-dev` はフォアグラウンドで待ち受け続けるため、
# このスクリプトはそこで停止したままになります(意図通り)。
# Ctrl+C で止めた後、フロントは別ターミナルで frontend-start.sh を実行してください。

set -euo pipefail
cd "$(dirname "$0")"

echo "== 0) ツール確認/導入 =========================================="
sudo dnf install -y podman podman-compose golang nodejs npm make git
which go node npm make podman
go version

echo "== 1) OpenAPI -> サーバーコード生成 ============================"
mkdir -p backend/gen/api
make generate
ls backend/gen/api/

echo "== 2) バックエンドのビルド確認 =================================="
(cd backend && go build ./...)

echo "== 3) フロントの依存導入 + ビルド確認 ============================"
(cd frontend && npm install && npx ng build)

echo "== 4) 開発用 SQL Server 起動(スキーマ+シード込み) ================"
make dev-up
echo "起動待ち(healthy になるまで最大60秒)..."
for i in $(seq 1 30); do
  status="$(podman inspect -f '{{.State.Health.Status}}' tm-mssql 2>/dev/null || echo starting)"
  if [ "$status" = "healthy" ]; then
    echo "tm-mssql: healthy"
    break
  fi
  sleep 2
done
podman logs tm-mssql-init || true

echo "== 5) バックエンド起動(モック認証, フォアグラウンド) =============="
echo "起動後、以下が出れば正常です:"
echo "  meta: loaded 2 table definition(s)"
echo "  meta verify [app_user_roles]: ok"
echo "  meta verify [products]: ok"
echo "  ⚠️  LDAP_MOCK=true: using mock authenticator (dev only)"
echo "  listening on :8080"
echo ""
make run-dev
