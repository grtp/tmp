FROM docker.io/library/node:24-alpine AS builder
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json frontend/.npmrc ./
RUN npm ci
COPY frontend/ ./
ENV NX_DAEMON=false
RUN npx nx build f-tool
ARG IMAGE_TAG=dev
RUN printf '{"version":"%s"}\n' "$IMAGE_TAG" > /app/dist/apps/f-tool/browser/version.json

FROM docker.io/library/nginx:1.27-alpine
COPY --from=builder /app/dist/apps/f-tool/browser /usr/share/nginx/html
EXPOSE 80
