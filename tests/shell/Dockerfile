# check=error=true
FROM dhi.io/debian-base:trixie-dev@sha256:f90fd43cdf3dd94840b4dc3a2a39fd2a08578e40e7895535e2e20a1275ba6013
USER 0:0
RUN apt-get update \
  && apt-get install -y --no-install-recommends bats jq kcov \
  && rm -rf /var/lib/apt/lists/*
