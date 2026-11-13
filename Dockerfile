# check=error=true
# cspell:words lavfi nostdin pkgconf tmpfs webp xerror

FROM dhi.io/alpine-base:3.24-dev@sha256:266554e75cb00f88effe4048ba78b6f628d6a5ca67ac9e9727ae37a4a1299ce5 AS build-tools
WORKDIR /app

RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/v3.24/community \
  apk-tools-static build-base cmake pkgconf rustup
ENV CARGO_HOME=/usr/local/cargo \
  RUSTUP_HOME=/usr/local/rustup \
  OPUS_BUNDLED=1
ENV PATH="${CARGO_HOME}/bin:${PATH}"
RUN rustup-init -y --no-modify-path --default-toolchain none

FROM build-tools AS build
ARG TARGETARCH
COPY rust-toolchain.toml ./
# Keep the shared channel but omit development and coverage components in the builder.
RUN toolchain=$(sed -n "s/^channel = '\(.*\)'$/\1/p" rust-toolchain.toml) \
  && test -n "$toolchain" \
  && printf "[toolchain]\nchannel = '%s'\nprofile = 'minimal'\n" "$toolchain" > rust-toolchain.toml \
  && rustup toolchain install --no-self-update

COPY Cargo.toml Cargo.lock ./
COPY src ./src

# Fetch locked dependencies before the offline compilation step.
RUN --mount=type=cache,id=botge-registry-${TARGETARCH},target=/usr/local/cargo/registry,sharing=locked \
  --mount=type=cache,id=botge-git-${TARGETARCH},target=/usr/local/cargo/git,sharing=locked \
  cargo fetch --locked

RUN --network=none \
  --mount=type=cache,id=botge-registry-${TARGETARCH},target=/usr/local/cargo/registry,sharing=locked \
  --mount=type=cache,id=botge-git-${TARGETARCH},target=/usr/local/cargo/git,sharing=locked \
  --mount=type=cache,id=botge-target-${TARGETARCH},target=/app/target,sharing=locked \
  cargo build --release --frozen && cp /app/target/release/botge /botge

FROM dhi.io/alpine-base:3.24@sha256:7b06d747fcb428a0699679955e903b13322c92c79d94ce94c108634f13a714f1 AS botge
USER 0:0
WORKDIR /app
ENV BOTGE_REGISTER_COMMANDS=true
LABEL org.opencontainers.image.authors="Mrewy" \
  org.opencontainers.image.description="Discord bot for emotes, overlays, and the Botge Activity." \
  org.opencontainers.image.documentation="https://github.com/MrewyOrg/Botge/tree/main/docs" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.source="https://github.com/MrewyOrg/Botge" \
  org.opencontainers.image.title="Botge" \
  org.opencontainers.image.url="https://github.com/MrewyOrg/Botge" \
  org.opencontainers.image.vendor="MrewyOrg"

# Install packages without adding APK itself to the runtime image.
RUN --mount=from=build-tools,source=/sbin/apk.static,target=/sbin/apk.static \
  apk.static upgrade --no-cache \
  && printf '%s\n' \
    '@edge https://dl-cdn.alpinelinux.org/alpine/edge/main' \
    '@edge https://dl-cdn.alpinelinux.org/alpine/edge/community' \
    >> /etc/apk/repositories \
  && apk.static add --no-cache ca-certificates opus ffmpeg@edge \
  && addgroup -S -g 1000 node \
  && adduser -S -D -H -u 1000 -G node node \
  && install -d -m 0700 -o node -g node /app/data

COPY --from=build --chmod=0555 /botge /app/botge
COPY LICENSE.txt /app/

USER node:node
# Exercise animated WebP under the runtime user and discard the fixture with the temporary mount.
RUN --network=none \
  --mount=type=tmpfs,target=/tmp \
  webp=/tmp/botge-smoke.webp \
  && /app/botge --version \
  && test -w /app/data \
  && ffmpeg -nostdin -v error -f lavfi -i 'testsrc2=size=32x32:rate=10' \
    -frames:v 3 -c:v libwebp_anim "$webp" \
  && ffmpeg -nostdin -v error -xerror -f webp_anim -i "$webp" -f null - \
  && packets=$(ffprobe -v error -f webp_anim -count_packets \
    -show_entries stream=nb_read_packets -of csv=p=0 "$webp") \
  && test "$packets" -gt 1

VOLUME ["/app/data"]
CMD ["/app/botge"]
