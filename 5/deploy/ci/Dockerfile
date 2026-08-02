# CI ジョブ用イメージ: make check に必要な Go + Node(+make/gcc/git は基底に同梱)。
# ビルド: podman build -t localhost/ftool-ci:latest deploy/ci
FROM docker.io/library/golang:1.25-bookworm
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*
