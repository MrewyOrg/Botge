# check=error=true

FROM dhi.io/node@sha256:e56c934b0a4a678a79555be48c6a74f204e04a264e261a357630387bfa7f1ef1 AS base
USER root

FROM base AS ci-dependencies
WORKDIR /app
ENV CI=true NPM_CONFIG_CACHE=/root/.npm

COPY .husky/install.ts ./.husky/install.ts
COPY .npmrc package.json package-lock.json ./
COPY activity/package.json ./activity/

FROM ci-dependencies AS node-dependencies

RUN --mount=type=cache,id=botge-npm,target=/root/.npm,sharing=locked \
  npm ci --omit=dev --workspaces=false

FROM ci-dependencies AS build

RUN --mount=type=cache,id=botge-npm,target=/root/.npm,sharing=locked \
  npm ci --include=dev --workspaces=false

COPY tsconfig.base.json ./
COPY src ./src

RUN --network=none npm run build:production

FROM base AS botge
WORKDIR /app
ENV NODE_ENV=production
LABEL org.opencontainers.image.authors="Mrewy" \
  org.opencontainers.image.description="Search emotes, clips, use zero-width emotes and other such commands." \
  org.opencontainers.image.documentation="https://github.com/MrewyOrg/Botge/tree/main/docs" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.source="https://github.com/MrewyOrg/Botge" \
  org.opencontainers.image.title="Botge" \
  org.opencontainers.image.url="https://github.com/MrewyOrg/Botge" \
  org.opencontainers.image.vendor="MrewyOrg"

RUN apk upgrade --no-cache \
  && printf '%s\n' \
    '@edge https://dl-cdn.alpinelinux.org/alpine/edge/main' \
    '@edge https://dl-cdn.alpinelinux.org/alpine/edge/community' \
    >> /etc/apk/repositories \
  && apk add --no-cache ffmpeg@edge \
  && apk del --no-cache \
    corepack \
    git \
    npm \
    sfw-free \
    sfw-free-npm \
    sfw-free-oci-config \
    sfw-free-yarn \
    yarn

COPY --from=node-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY docs ./docs
COPY LICENSE.txt botge.config.schema.json node.config.json package.json README.md ./

RUN chmod -R a-w /app/dist /app/node_modules /app/docs \
  /app/LICENSE.txt /app/botge.config.schema.json /app/node.config.json /app/package.json /app/README.md \
  && mkdir -p /app/data/tmp \
  && chown -R node:node /app/data \
  && chmod -R u=rwX,go= /app/data

USER node:node

VOLUME ["/app/data"]

CMD ["node", "--experimental-default-config-file", "--title", "botge", "dist/index.js"]
