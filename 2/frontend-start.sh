#!/usr/bin/env bash
# frontend-start.sh — フロントエンド起動(別ターミナルで実行)
#
# 前提: setup.sh の 5) でバックエンドが :8080 で起動済みであること。
#
# 実行:
#   chmod +x frontend-start.sh
#   ./frontend-start.sh

set -euo pipefail
cd "$(dirname "$0")/frontend"

echo "http://localhost:4200 (admin / admin)"
npm start
