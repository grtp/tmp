```bash
cd backend
cp .env.example .env          # LDAP 接続情報を編集
set -a; . ./.env; set +a      # env を読み込む（bash）
go mod tidy
go run ./cmd/server           # http://localhost:8080
```

```bash
cd frontend
npm install
npm start                     # http://localhost:4200 （/api は 8080 へプロキシ）
```
| POST | `/api/auth/login` | `{username,password}` LDAP 認証 → cookie 発行
| POST | `/api/auth/logout` | cookie 失効 |
| GET | `/api/auth/me` | 現在のユーザー（cookie 必須） |
| GET | `/api/products?q&limit&offset` | 一覧（既定 limit=100） |
| POST | `/api/products` | 追加 |
| PUT | `/api/products/{id}` | 更新 |
| DELETE | `/api/products/{id}` | 削除 |
| POST | `/api/products/import` | CSV/JSON 取込（追加） |
