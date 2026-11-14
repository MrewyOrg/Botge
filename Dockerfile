# check=error=true
# cspell:words lavfi nostdin pkgconf tmpfs trixie webp xerror

FROM dhi.io/alpine-base:3.24-dev@sha256:266554e75cb00f88effe4048ba78b6f628d6a5ca67ac9e9727ae37a4a1299ce5 AS runtime-tools
WORKDIR /app

RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/v3.24/community \
  apk-tools-static

FROM dhi.io/debian-base:trixie-dev@sha256:9e9caa90d9ef807a54a5cef570d83263715cfcb6f3e7342bc0625c80e3b258b8 AS build-tools
USER 0:0
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
  build-essential cmake pkgconf musl-tools rustup \
  && rm -rf /var/lib/apt/lists/*
ENV CARGO_HOME=/usr/local/cargo \
  RUSTUP_HOME=/usr/local/rustup \
  OPUS_BUNDLED=1 \
  CC_aarch64_unknown_linux_musl=musl-gcc \
  CC_x86_64_unknown_linux_musl=musl-gcc
ENV PATH="${CARGO_HOME}/bin:${PATH}"

FROM build-tools AS build-deps
ARG TARGETARCH
COPY rust-toolchain.toml ./
# Keep the shared channel but omit development and coverage components in the builder.
RUN toolchain=$(sed -n "s/^channel = '\(.*\)'$/\1/p" rust-toolchain.toml) \
  && test -n "$toolchain" \
  && printf "[toolchain]\nchannel = '%s'\nprofile = 'minimal'\n" "$toolchain" > rust-toolchain.toml \
  && case "$TARGETARCH" in amd64) target=x86_64-unknown-linux-musl ;; arm64) target=aarch64-unknown-linux-musl ;; *) exit 1 ;; esac \
  && rustup toolchain install "$toolchain" --profile minimal --no-self-update --target "$target" \
  && mkdir .cargo \
  && printf '[build]\ntarget = "%s"\n[target.%s]\nlinker = "musl-gcc"\n' "$target" "$target" > .cargo/config.toml \
  && printf '%s' "$target" > /rust-target

COPY Cargo.toml Cargo.lock ./

# Cache dependencies in image layers: external caches do not preserve cache-mount contents.
# The placeholder keeps this layer independent of application source changes.
RUN mkdir src \
  && printf '%s\n' '#![doc = "Dependency build placeholder."]' 'fn main() {}' > src/main.rs \
  && cargo fetch --locked

RUN --network=none cargo build --release --frozen

FROM build-deps AS build
COPY src ./src
# Let Cargo remove the placeholder's artifacts without relying on its internal directory layout.
RUN --network=none cargo clean --release --package botge \
  && cargo build --release --frozen && cp "target/$(cat /rust-target)/release/botge" /botge

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
RUN --mount=from=runtime-tools,source=/sbin/apk.static,target=/sbin/apk.static \
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
  && /app/botge --version | grep -E '^Botge [0-9]+[.][0-9]+[.][0-9]+' \
  && test -w /app/data \
  && ffmpeg -nostdin -v error -f lavfi -i 'testsrc2=size=32x32:rate=10' \
    -frames:v 3 -c:v libwebp_anim "$webp" \
  && ffmpeg -nostdin -v error -xerror -f webp_anim -i "$webp" -f null - \
  && packets=$(ffprobe -v error -f webp_anim -count_packets \
    -show_entries stream=nb_read_packets -of csv=p=0 "$webp") \
  && test "$packets" -gt 1

VOLUME ["/app/data"]
CMD ["/app/botge"]
