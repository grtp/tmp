OAPI_CODEGEN := github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.4.1

.PHONY: generate up down

generate:
	cd backend && go run $(OAPI_CODEGEN) -config ../api/oapi-codegen.yaml ../api/openapi.yaml
	cd frontend && npm run generate:api

up:
	podman compose -f deploy/compose.yaml up -d --build

down:
	podman compose -f deploy/compose.yaml down
