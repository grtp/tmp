OAPI_CODEGEN := github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.4.1
PROD    := podman compose -f deploy/compose.yaml
VERIFY  := podman compose -p atleast -f deploy/compose.verify.yaml
IMAGE_TAG ?= $(shell date +%Y-%m-%d_%H%M%S)

.PHONY: generate build up down verify_up verify_down dev_up dev_down be_serve fe_install fe_serve

generate:
	cd backend && go run $(OAPI_CODEGEN) -config ../api/oapi-codegen.yaml ../api/openapi.yaml
	cd frontend && npm run generate:api

build:
	IMAGE_TAG=$(IMAGE_TAG) $(PROD) build
	@echo "IMAGE_TAG=$(IMAGE_TAG)"

up:
	$(PROD) up -d

down:
	$(PROD) down

verify_up:
	$(VERIFY) up -d --build

verify_down:
	$(VERIFY) down -v

dev_up:
	$(VERIFY) up -d mssql mssql-init ldap redis

dev_down:
	$(VERIFY) down

be_serve:
	cd backend && ENV_FILE=../deploy/.env.dev go run ./cmd/server

fe_install:
	cd frontend && npm ci

fe_serve:
	cd frontend && npm start
