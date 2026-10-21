
SHELL := bash

OAPI_CODEGEN := github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.4.1

STACK_COMPOSE := BACKEND_ENV_FILE=.env.dev podman compose --env-file deploy/.env.dev \
        -f deploy/compose.yaml -f deploy/compose.dev.yaml -f deploy/compose.stack.yaml

DEV_ENV_FILE := ../deploy/.env.dev

.PHONY: generate api_lint be_build be_test be_test_race check env_check be_serve \
        dev_up dev_down dev_seed stack_up stack_down ci_init ci_image ci_up ci_down ci_clean \
        fe_install fe_serve fe_build fe_lint help

generate:
	cd backend && go run $(OAPI_CODEGEN) -config ../api/oapi-codegen.yaml ../api/openapi.yaml
	cd frontend && npm run generate:api

api_lint:
	npx --yes @redocly/cli@latest lint api/openapi.yaml

be_build:
	cd backend && go build ./...

be_test:
	cd backend && go test ./...

be_test_race:
	cd backend && go test -race ./...

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
	cd frontend && npx ng build
	$(MAKE) env_check
	@echo "check: all green"

env_check:
	@diff <(grep -o '^[A-Z_]*=' deploy/.env.dev | sort) \
	      <(grep -o '^[A-Z_]*=' deploy/.env.example | grep -v '^IMAGE_TAG=\|^FRONTEND_BIND=\|^FRONTEND_PORT=\|^NGINX_CONF=' | sort) \
	  || { echo "NG: deploy/.env.dev と deploy/.env.example のキーが一致しない(< dev だけ / > example だけ)"; exit 1; }
	@echo "env_check: ok"

be_serve:
	cd backend && ENV_FILE=$(DEV_ENV_FILE) go run ./cmd/server

dev_up:
	podman compose -f deploy/compose.dev.yaml up -d

dev_down:
	podman compose -f deploy/compose.dev.yaml down -v

stack_up:
	$(STACK_COMPOSE) up -d --build

stack_down:
	$(STACK_COMPOSE) down

ci_image:
	podman build -t localhost/ftool-ci:latest deploy/ci

ci_init: ci_image
	systemctl enable --now podman.socket
	podman compose -f deploy/compose.ci.yaml up -d gitea
	until curl -s http://localhost:3300/api/healthz >/dev/null; do sleep 2; done
	podman exec -u 1000 ft-gitea gitea admin user create --username local \
		--password 'Fidev01!' --email local@example.local \
		--admin --must-change-password=false || true
	echo "GITEA_RUNNER_REGISTRATION_TOKEN=$$(podman exec -u 1000 ft-gitea gitea actions generate-runner-token | tr -d '[:space:]')" > deploy/.env
	podman compose -f deploy/compose.ci.yaml up -d runner

ci_up:
	systemctl enable --now podman.socket
	podman compose -f deploy/compose.ci.yaml up -d

ci_down:
	podman compose -f deploy/compose.ci.yaml down

ci_clean:
	podman compose -f deploy/compose.ci.yaml down -v
	podman rmi localhost/ftool-ci docker.io/gitea/gitea:1.24 docker.io/gitea/act_runner:latest || true
	rm -f deploy/.env

dev_seed:
	node deploy/initdb/dev-seed-connections.mjs

dev_seed_users:
	node deploy/initdb/dev-seed-users.mjs

fe_install:
	cd frontend && npm install

fe_serve:
	cd frontend && npx ng serve

fe_build:
	cd frontend && npx ng build

fe_lint:
	cd frontend && npm run lint

help:
	@grep -E '^## ' $(MAKEFILE_LIST) | sed 's/^## /  /'
