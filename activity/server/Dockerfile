# check=error=true
FROM --platform=$BUILDPLATFORM dhi.io/node:26.13.0-debian13-dev@sha256:c4566c7cf80e9ab58a1985d2290c323b21827b1a8159ddb9f6c70b0b15716966 AS site
WORKDIR /workspace
COPY .nvmrc .npmrc package.json package-lock.json ./
COPY .husky/install.sh .husky/
COPY activity/package.json activity/
RUN test "$(node --version)" = "$(cat .nvmrc)" \
  && CI=true npm ci --no-audit

COPY tsconfig.base.json ./
COPY activity/index.html activity/tsconfig*.json activity/vite.config.ts activity/
COPY activity/public/ activity/public/
COPY activity/src/ activity/src/
COPY assets/botge-emoji.png assets/botge-icon.png assets/
COPY activity/scripts/stage-server-site.ts activity/scripts/
COPY scripts/activity/stage-activity-server.sh scripts/activity/
RUN --network=none sh scripts/activity/stage-activity-server.sh

FROM --platform=$BUILDPLATFORM dhi.io/golang:1.27.4-debian13-dev@sha256:2f58c6928a851f0b6059f1a63514828a788a748d88b218a1bc9ae23c3b540140 AS build
ARG TARGETOS
ARG TARGETARCH
ENV CGO_ENABLED=0 GOTOOLCHAIN=local GOWORK=off
WORKDIR /src
COPY activity/server/.go-version activity/server/go.mod ./
COPY activity/server/cmd/ cmd/
COPY activity/server/internal/ internal/
COPY --from=site /workspace/activity/server/internal/site/dist/ internal/site/dist/
RUN --network=none test "$(go env GOVERSION)" = "go$(cat .go-version)" \
  && test "${TARGETOS}/${TARGETARCH}" = linux/amd64 \
  && GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" \
    go build -trimpath -mod=readonly -o /out/activity-server ./cmd/activity-server

FROM dhi.io/static:20250419-debian13@sha256:4749130e822c145dbdf9ca11ec0cc2f694b5fe687fd74268a2b62160e6726f39
LABEL org.opencontainers.image.source="https://github.com/MrewyOrg/Botge" \
  org.opencontainers.image.title="Botge Activity Origin" \
  org.opencontainers.image.licenses="MIT"
COPY LICENSE.txt /LICENSE.txt
COPY --from=build --chmod=0555 /out/activity-server /activity-server
USER 65532:65532
ENV PORT=8080
EXPOSE 8080
STOPSIGNAL SIGTERM
ENTRYPOINT ["/activity-server"]
