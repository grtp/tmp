#!/usr/bin/env bash
# smoke-test.sh — API動作確認(別ターミナルで実行)
#
# 前提: setup.sh の 5) でバックエンドが :8080 で起動済みであること。
# jq が無い場合は `sudo dnf install -y jq` を先に。
#
# 実行:
#   chmod +x smoke-test.sh
#   ./smoke-test.sh

set -euo pipefail
COOKIE_JAR="$(mktemp)"
trap 'rm -f "$COOKIE_JAR"' EXIT

echo "== ログイン ====================================================="
curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin"}' \
  -c "$COOKIE_JAR" | (jq . 2>/dev/null || cat)

echo ""
echo "== /auth/me ======================================================"
curl -s http://localhost:8080/api/v1/auth/me \
  -b "$COOKIE_JAR" | (jq . 2>/dev/null || cat)

echo ""
echo "== /tables 一覧 =================================================="
curl -s http://localhost:8080/api/v1/tables \
  -b "$COOKIE_JAR" | (jq . 2>/dev/null || cat)

echo ""
echo "== /tables/products/meta ========================================="
curl -s http://localhost:8080/api/v1/tables/products/meta \
  -b "$COOKIE_JAR" | (jq . 2>/dev/null || cat)

echo ""
echo "== /tables/products/rows (limit=5) ==============================="
curl -s "http://localhost:8080/api/v1/tables/products/rows?limit=5" \
  -b "$COOKIE_JAR" | (jq . 2>/dev/null || cat)

echo ""
echo "== batch: 1件追加 ================================================"
INSERTED=$(curl -s -X POST http://localhost:8080/api/v1/tables/products/rows/batch \
  -H 'Content-Type: application/json' -b "$COOKIE_JAR" \
  -d '{"inserts":[{"code":"SMOKE-1","name":"スモークテスト品","category":"検証","price":100,"stock":1}]}')
echo "$INSERTED" | (jq . 2>/dev/null || cat)
NEW_ID=$(echo "$INSERTED" | jq -r '.insertedKeys[0].id')

echo ""
echo "== batch: 追加した行を更新(rowVersion取得込み) ===================="
RV=$(curl -s "http://localhost:8080/api/v1/tables/products/rows?q=SMOKE-1" \
  -b "$COOKIE_JAR" | jq -r '.rows[0]["$rowVersion"]')
curl -s -X POST http://localhost:8080/api/v1/tables/products/rows/batch \
  -H 'Content-Type: application/json' -b "$COOKIE_JAR" \
  -d "{\"updates\":[{\"key\":{\"id\":$NEW_ID},\"changes\":{\"price\":200},\"rowVersion\":\"$RV\"}]}" \
  | (jq . 2>/dev/null || cat)

echo ""
echo "== batch: 古いrowVersionで更新 -> 409になるはず ==================="
curl -s -X POST http://localhost:8080/api/v1/tables/products/rows/batch \
  -H 'Content-Type: application/json' -b "$COOKIE_JAR" \
  -d "{\"updates\":[{\"key\":{\"id\":$NEW_ID},\"changes\":{\"price\":300},\"rowVersion\":\"$RV\"}]}" \
  | (jq . 2>/dev/null || cat)

echo ""
echo "== batch: 追加した行を削除(最新rowVersionで) ======================"
RV2=$(curl -s "http://localhost:8080/api/v1/tables/products/rows?q=SMOKE-1" \
  -b "$COOKIE_JAR" | jq -r '.rows[0]["$rowVersion"]')
curl -s -X POST http://localhost:8080/api/v1/tables/products/rows/batch \
  -H 'Content-Type: application/json' -b "$COOKIE_JAR" \
  -d "{\"deletes\":[{\"key\":{\"id\":$NEW_ID},\"rowVersion\":\"$RV2\"}]}" \
  | (jq . 2>/dev/null || cat)
