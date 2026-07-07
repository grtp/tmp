# table-maint Makefile
# 前提: Go 1.22+, Node 20+, podman(+podman-compose)

OAPI_CODEGEN := github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.4.1

.PHONY: generate validate-meta lint-api build test run-dev dev-up dev-down help

## generate: OpenAPI から gin サーバー/モデルを生成 (backend/gen/api)
generate:
	cd backend && go run $(OAPI_CODEGEN) -config ../api/oapi-codegen.yaml ../api/openapi.yaml

## lint-api: OpenAPI 仕様の検証
lint-api:
	npx --yes @redocly/cli@latest lint api/openapi.yaml

## validate-meta: テーブル定義YAMLを JSON Schema + Go ローダ両方で検証
validate-meta:
	node scripts/validate-meta.mjs
	cd backend && go run ./cmd/validate-meta

## build: バックエンドのビルド(生成コードが必要: 先に make generate)
build:
	cd backend && go build ./...

## test: バックエンドのテスト
test:
	cd backend && go test ./...

## run-dev: モック認証でバックエンドを起動(要: dev-up で mssql 起動済み)
run-dev:
	cd backend && LDAP_MOCK=true SKIP_SCHEMA_VERIFY=false go run ./cmd/server

## dev-up: 開発用 SQL Server(+初期化)を起動
dev-up:
	podman compose -f deploy/compose.dev.yaml up -d

## dev-down: 開発用コンテナを破棄(ボリュームも消す)
dev-down:
	podman compose -f deploy/compose.dev.yaml down -v

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'
