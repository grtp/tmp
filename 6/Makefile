# F-tool Makefile
# 前提: Go 1.22+, Node 20+, podman(+compose)

OAPI_CODEGEN := github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.4.1

# 開発専用の接続パスワード暗号鍵(32byte の base64)。本番は必ず
# `openssl rand -base64 32` で生成した値を deploy/.env に置くこと。
DEV_CONN_ENC_KEY := ZGV2LWtleS0zMmJ5dGVzLWZvci1mb3JnZS10b29sISE=

.PHONY: generate lint-api build test run-dev run-dev-ldap dev-up dev-down dev-seed \
        fe-install fe-serve fe-build fe-storybook help

## generate: OpenAPI から gin サーバー/モデルを生成 (backend/gen/api)
generate:
	cd backend && go run $(OAPI_CODEGEN) -config ../api/oapi-codegen.yaml ../api/openapi.yaml

## lint-api: OpenAPI 仕様の検証
lint-api:
	npx --yes @redocly/cli@latest lint api/openapi.yaml

## build: バックエンドのビルド(生成コードが必要: 先に make generate)
build:
	cd backend && go build ./...

## test: バックエンドのテスト
test:
	cd backend && go test ./...

## run-dev: モック認証でバックエンドを起動(要: dev-up で mssql/redis 起動済み)
run-dev:
	cd backend && LDAP_MOCK=true REDIS_ADDR=localhost:6379 \
	CONN_ENC_KEY=$(DEV_CONN_ENC_KEY) \
	go run ./cmd/server

## run-dev-ldap: 開発用 OpenLDAP で認証してバックエンドを起動
run-dev-ldap:
	cd backend && \
	REDIS_ADDR=localhost:6379 \
	LDAP_URL=ldap://localhost:1389 \
	LDAP_BASE_DN=dc=example,dc=local \
	LDAP_BIND_DN=cn=admin,dc=example,dc=local \
	LDAP_BIND_PASSWORD=adminpassword \
	LDAP_USER_FILTER='(uid=%s)' \
	LDAP_ATTR_GUID=entryUUID \
	LDAP_ATTR_USERNAME=uid \
	LDAP_GUID_FORMAT=uuid-string \
	CONN_ENC_KEY=$(DEV_CONN_ENC_KEY) \
	go run ./cmd/server

## dev-up: 開発用コンテナ(SQL Server/OpenLDAP/Redis)を起動
dev-up:
	podman compose -f deploy/compose.dev.yaml up -d

## dev-down: 開発用コンテナを破棄(ボリュームも消す。LDAP の entryUUID も変わる)
dev-down:
	podman compose -f deploy/compose.dev.yaml down -v

## dev-seed: demoDB 接続 + 検証用テーブル(bigdata/wide/codes/audit_demo)の
##   管理テーブル登録を API 経由で行う(要: backend 起動済み・冪等)。
##   ADMIN_USER/ADMIN_PASS で admin 権限のユーザーを指定可(既定: モック admin/admin)
dev-seed:
	node deploy/initdb/dev-seed-connections.mjs

## fe-install: フロントエンドの依存をインストール
fe-install:
	cd frontend && npm install

## fe-serve: フロントエンド開発サーバー(/api は :8080 へプロキシ)
fe-serve:
	cd frontend && npx nx serve f-tool

## fe-build: フロントエンドの本番ビルド(deploy/compose.yaml がマウントする)
fe-build:
	cd frontend && npx nx build f-tool

## fe-storybook: Storybook(UI カタログ)を起動 (:4400)
fe-storybook:
	cd frontend && npx nx storybook ui

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'
