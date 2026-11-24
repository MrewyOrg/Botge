# check=error=true
FROM dhi.io/debian-base:trixie-dev@sha256:3107d81acc72300d2474f26fdc72cfa9ea8e31315ff033d4b9ec109308696e35
USER 0:0
RUN apt-get update \
  && apt-get install -y --no-install-recommends bats jq kcov \
  && rm -rf /var/lib/apt/lists/*
