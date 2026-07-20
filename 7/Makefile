# F-tool Makefile
# 前提: Go 1.22+, Node 20+, podman(+compose)

OAPI_CODEGEN := github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.4.1

# 開発専用の接続パスワード暗号鍵(32byte の base64)。本番は必ず
# `openssl rand -base64 32` で生成した値を deploy/.env に置くこと。
DEV_CONN_ENC_KEY := ZGV2LWtleS0zMmJ5dGVzLWZvci1mLXRvb2wtZGV2ISE=

.PHONY: generate api_lint be_build be_test be_test_race check be_serve_mock be_serve \
        dev_up dev_down dev_seed ci_init ci_image ci_up ci_down ci_clean \
        fe_install fe_serve fe_build fe_lint fe_storybook help

## generate: OpenAPI から backend(gen/api)と frontend(core/gen/api-types.ts)の型を生成
generate:
	cd backend && go run $(OAPI_CODEGEN) -config ../api/oapi-codegen.yaml ../api/openapi.yaml
	cd frontend && npm run generate:api

## api_lint: OpenAPI 仕様の検証
api_lint:
	npx --yes @redocly/cli@latest lint api/openapi.yaml

## be_build: バックエンドのビルド(生成コードが必要: 先に make generate)
be_build:
	cd backend && go build ./...

## be_test: バックエンドのテスト
be_test:
	cd backend && go test ./...

## be_test_race: race detector 付きテスト(cgo が必要。alma9 内か CI で実行する)
be_test_race:
	cd backend && go test -race ./...

## check: E2E 以外の全検証(コミット前・スプリント締めに実行)
check:
	cd backend && test -z "$$(gofmt -l ./internal/ ./cmd/)" || { gofmt -l ./internal/ ./cmd/; exit 1; }
	cd backend && go vet ./...
	$(MAKE) be_test_race
	@sum1=$$(git hash-object backend/gen/api/api.gen.go frontend/apps/f-tool/src/app/core/gen/api-types.ts); \
	$(MAKE) generate >/dev/null 2>&1; \
	sum2=$$(git hash-object backend/gen/api/api.gen.go frontend/apps/f-tool/src/app/core/gen/api-types.ts); \
	[ "$$sum1" = "$$sum2" ] || { echo "NG: 生成物が openapi.yaml と同期していない(make generate の結果をコミットすること)"; exit 1; }
	cd frontend && npm test
	$(MAKE) fe_lint
	cd frontend && npx nx build f-tool --skip-nx-cache
	cd frontend && npx nx build-storybook ui --skip-nx-cache
	@echo "check: all green"

## be_serve_mock: モック認証でバックエンドを起動(要: dev_up でコンテナ起動済み)
be_serve_mock:
	cd backend && LDAP_MOCK=true REDIS_ADDR=localhost:6379 \
	CONN_ENC_KEY=$(DEV_CONN_ENC_KEY) \
	go run ./cmd/server

## be_serve: バックエンド開発サーバー(開発用 OpenLDAP 認証。通常はこちら)
be_serve:
	cd backend && \
	REDIS_ADDR=localhost:6379 \
	LDAP_URL=ldap://localhost:1389 \
	LDAP_BASE_DN=dc=example,dc=local \
	LDAP_BIND_DN=cn=admin,dc=example,dc=local \
	LDAP_BIND_PASSWORD=Fidev01! \
	LDAP_USER_FILTER='(uid=%s)' \
	LDAP_ATTR_GUID=entryUUID \
	LDAP_ATTR_USERNAME=uid \
	LDAP_GUID_FORMAT=uuid-string \
	CONN_ENC_KEY=$(DEV_CONN_ENC_KEY) \
	go run ./cmd/server

## dev_up: 開発用コンテナ(SQL Server/OpenLDAP/Valkey※Redis互換)を起動
dev_up:
	podman compose -f deploy/compose.dev.yaml up -d

## dev_down: 開発用コンテナを破棄(ボリュームも消す。LDAP の entryUUID も変わる)
dev_down:
	podman compose -f deploy/compose.dev.yaml down -v

## ci_image: CI ジョブ用イメージをビルド(alma9 内で実行)
ci_image:
	podman build -t localhost/ftool-ci:latest deploy/ci

## ci_init: CI の初期構築(イメージ + Gitea + 管理ユーザー local + ランナー登録)。
## 再実行しても安全(既存ユーザー作成は読み飛ばす)
ci_init: ci_image
	systemctl enable --now podman.socket
	podman compose -f deploy/compose.ci.yaml up -d gitea
	until curl -s http://localhost:3300/api/healthz >/dev/null; do sleep 2; done
	podman exec -u 1000 ft-gitea gitea admin user create --username local \
		--password 'Fidev01!' --email local@example.local \
		--admin --must-change-password=false || true
	echo "GITEA_RUNNER_REGISTRATION_TOKEN=$$(podman exec -u 1000 ft-gitea gitea actions generate-runner-token | tr -d '[:space:]')" > deploy/.env
	podman compose -f deploy/compose.ci.yaml up -d runner

## ci_up: CI(Gitea + ランナー)を起動(alma9 内で実行。初回構築は dev-guide §5.3.5)
ci_up:
	systemctl enable --now podman.socket
	podman compose -f deploy/compose.ci.yaml up -d

## ci_down: CI を停止(ボリュームは残す)
ci_down:
	podman compose -f deploy/compose.ci.yaml down

## ci_clean: CI を完全撤去(リポジトリ・ユーザー・登録・イメージごと消える)
ci_clean:
	podman compose -f deploy/compose.ci.yaml down -v
	podman rmi localhost/ftool-ci docker.io/gitea/gitea:1.24 docker.io/gitea/act_runner:latest || true
	rm -f deploy/.env

## dev_seed: demoDB 接続 + 検証用テーブル(bigdata/wide/codes/audit_demo)の
##   管理テーブル登録を API 経由で行う(要: backend 起動済み・冪等)。
##   ADMIN_USER/ADMIN_PASS で admin 権限のユーザーを指定可(既定: モック admin/admin)
dev_seed:
	node deploy/initdb/dev-seed-connections.mjs

## fe_install: フロントエンドの依存をインストール
fe_install:
	cd frontend && npm install

## fe_serve: フロントエンド開発サーバー(/api は :8080 へプロキシ)
fe_serve:
	cd frontend && npx nx serve f-tool

## fe_build: フロントエンドの本番ビルド(deploy/compose.yaml がマウントする)
fe_build:
	cd frontend && npx nx build f-tool

## fe_lint: フロントエンドの静的解析(eslint)
fe_lint:
	cd frontend && npx nx lint f-tool && npx nx lint ui

## fe_storybook: Storybook(UI カタログ)を起動 (:4400)
fe_storybook:
	cd frontend && npx nx storybook ui

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'
