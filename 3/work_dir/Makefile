# table-maint v2 Makefile
# 前提: Go 1.22+, Node 20+, podman(+compose)

OAPI_CODEGEN := github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.4.1

.PHONY: generate lint-api build test run-dev run-dev-ldap dev-up dev-down \
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
	cd backend && LDAP_MOCK=true REDIS_ADDR=localhost:6379 go run ./cmd/server

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
	go run ./cmd/server

## dev-up: 開発用コンテナ(SQL Server/OpenLDAP/Redis)を起動
dev-up:
	podman compose -f deploy/compose.dev.yaml up -d

## dev-down: 開発用コンテナを破棄(ボリュームも消す。LDAP の entryUUID も変わる)
dev-down:
	podman compose -f deploy/compose.dev.yaml down -v

## fe-install: フロントエンドの依存をインストール
fe-install:
	cd frontend && npm install

## fe-serve: フロントエンド開発サーバー(/api は :8080 へプロキシ)
fe-serve:
	cd frontend && npx nx serve table-maint

## fe-build: フロントエンドの本番ビルド(deploy/compose.yaml がマウントする)
fe-build:
	cd frontend && npx nx build table-maint

## fe-storybook: Storybook(UI カタログ)を起動 (:4400)
fe-storybook:
	cd frontend && npx nx storybook ui

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'
