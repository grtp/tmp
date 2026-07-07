```bash
make generate            # api/openapi.yaml -> backend/gen/api
# SQL Server for dev
make dev-up
# back_mock admin/admin
make run-dev
cd frontend && npm install && npm start   # http://localhost:4200
```
```
api/openapi.yaml -> make lint-api -> make generate
backend/meta/tables/*.yaml -> make validate-meta -> 再ビルド
cd frontend && npm run build -> podman compose -f deploy/compose.yaml up -d --build
```