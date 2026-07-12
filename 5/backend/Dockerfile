# backend/Dockerfile
# ビルドコンテキストはリポジトリルート(compose 側で context: .. を指定)。
# 生成コード(gen/api)はコミット済み前提。イメージ内で codegen はしない。
FROM golang:1.22-alpine AS builder
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/server ./cmd/server

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/server /server
EXPOSE 8080
USER nonroot
ENTRYPOINT ["/server"]
