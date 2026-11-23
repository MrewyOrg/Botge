# check=error=true
FROM --platform=$BUILDPLATFORM dhi.io/node:26.13.1-debian13-dev@sha256:a06c9ce7ac94ecf31b85b6b82baa685479ca3fe4e28a61fdafc9676f7d313c0c AS site
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

FROM --platform=$BUILDPLATFORM dhi.io/golang:1.27.4-debian13-dev@sha256:a5ae848409581006068480c4920b114b7d8a2b879d1207e268828225386683cd AS build
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

FROM dhi.io/static:20250419-debian13@sha256:1295ce0b300e0972ee6034f75f2161a629c12d760526f2e029528416dec2f96e
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
