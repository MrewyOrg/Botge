# check=error=true
# cspell:words lavfi pkgconf xerror

FROM dhi.io/alpine-base:3.24-dev@sha256:266554e75cb00f88effe4048ba78b6f628d6a5ca67ac9e9727ae37a4a1299ce5 AS runtime-tools
WORKDIR /app

RUN apk add --no-cache --repository=https://dl-cdn.alpinelinux.org/alpine/v3.24/community \
  apk-tools-static

FROM dhi.io/debian-base:trixie-dev@sha256:f90fd43cdf3dd94840b4dc3a2a39fd2a08578e40e7895535e2e20a1275ba6013 AS build-tools
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
COPY Cargo.toml ./
# Build with the stable workspace rust-version; development checks keep the pinned nightly.
RUN toolchain=$(sed -n "s/^rust-version = '\(.*\)'$/\1/p" Cargo.toml) \
  && test -n "$toolchain" \
  && printf "[toolchain]\nchannel = '%s'\nprofile = 'minimal'\n" "$toolchain" > rust-toolchain.toml \
  && case "$TARGETARCH" in amd64) target=x86_64-unknown-linux-musl ;; arm64) target=aarch64-unknown-linux-musl ;; *) exit 1 ;; esac \
  && rustup toolchain install "$toolchain" --profile minimal --no-self-update --target "$target" \
  && mkdir .cargo \
  && printf '[build]\ntarget = "%s"\n[target.%s]\nlinker = "musl-gcc"\n' "$target" "$target" > .cargo/config.toml \
  && printf '%s' "$target" > /rust-target

COPY --parents Cargo.toml Cargo.lock crates/*/Cargo.toml ./

# Cache dependencies in image layers: external caches do not preserve cache-mount contents.
# The placeholder keeps this layer independent of application source changes.
RUN for manifest in crates/*/Cargo.toml; do \
    directory=${manifest%/Cargo.toml}; \
    mkdir -p "$directory/src"; \
    case "$directory" in \
      crates/botge) printf '%s\n' '#![doc = "Dependency build placeholder."]' 'fn main() {}' > "$directory/src/main.rs" ;; \
      *) printf '%s\n' '//! Dependency build placeholder.' > "$directory/src/lib.rs" ;; \
    esac; \
  done \
  && cargo fetch --locked

RUN --network=none cargo build --release --frozen

FROM build-deps AS build
COPY crates ./crates
# Let Cargo remove the placeholder's artifacts without relying on its internal directory layout.
RUN --network=none for manifest in crates/*/Cargo.toml; do \
    package=${manifest#crates/}; package=${package%/Cargo.toml}; \
    cargo clean --release --package "$package" || exit; \
  done \
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

# Alpine edge keeps only its newest build, so this pin fails the build when edge moves on.
# Update it deliberately, then rerun the animated WebP smoke check below.
ARG FFMPEG_VERSION=9.0.2-r3
# Install packages without adding APK itself to the runtime image.
RUN --mount=from=runtime-tools,source=/sbin/apk.static,target=/sbin/apk.static \
  apk.static upgrade --no-cache \
  && printf '%s\n' \
    '@edge https://dl-cdn.alpinelinux.org/alpine/edge/main' \
    '@edge https://dl-cdn.alpinelinux.org/alpine/edge/community' \
    >> /etc/apk/repositories \
  && apk.static add --no-cache ca-certificates opus "ffmpeg@edge=${FFMPEG_VERSION}" \
  && addgroup -S -g 1000 botge \
  && adduser -S -D -H -u 1000 -G botge botge \
  && install -d -m 0700 -o botge -g botge /app/data

COPY --from=build --chmod=0555 /botge /app/botge
COPY LICENSE.txt /app/

USER botge:botge
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
