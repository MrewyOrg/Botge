# check=error=true

FROM dhi.io/uv:0.13.9@sha256:d382f4728500d5ca0cd49656b0bc55de4198dec48ab9aca09b33b56b431341b5 AS uv-tool

FROM dhi.io/python:3.15.2-debian13-dev@sha256:10500dc8fcfd14a748f6422d0ac9e705a6fba13e80edecf921c200c89a667768 AS builder
USER 0:0
WORKDIR /app
COPY --from=uv-tool /usr/local/bin/uv /usr/local/bin/uv
COPY .python-version pyproject.toml uv.lock ./
RUN test "$(python3 --version)" = "Python $(cat .python-version)" \
  && UV_PROJECT_ENVIRONMENT=/app/.venv UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy \
    uv sync --locked --no-dev --no-install-project --no-python-downloads --extra chemistry

FROM dhi.io/python:3.15.2-debian13@sha256:a85031f7d1403e0d66b427651a528d2d338438cd9c5017b17481df50978eda53 AS chemistry
WORKDIR /app
LABEL org.opencontainers.image.authors="Mrewy" \
  org.opencontainers.image.description="CPU-only RDKit organic chemistry sidecar for Botge." \
  org.opencontainers.image.documentation="https://github.com/MrewyOrg/Botge/tree/main/docs" \
  org.opencontainers.image.licenses="MIT" \
  org.opencontainers.image.source="https://github.com/MrewyOrg/Botge" \
  org.opencontainers.image.title="Botge Chemistry Sidecar" \
  org.opencontainers.image.url="https://github.com/MrewyOrg/Botge" \
  org.opencontainers.image.vendor="MrewyOrg"

ENV PATH="/app/.venv/bin:${PATH}" \
  PYTHONDONTWRITEBYTECODE=1 \
  PYTHONUNBUFFERED=1 \
  HOME=/tmp

COPY --from=builder /app/.venv /app/.venv
COPY LICENSE.txt /app/LICENSE.txt
COPY chemistry/atlas.py /app/chemistry/atlas.py
COPY chemistry/depict.py /app/chemistry/depict.py
COPY chemistry/engine.py /app/chemistry/engine.py
COPY chemistry/server.py /app/chemistry/server.py

USER 65532:65532
EXPOSE 3091
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD ["/app/.venv/bin/python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3091/healthz', timeout=2)"]
CMD ["/app/.venv/bin/uvicorn", "server:app", "--app-dir", "/app/chemistry", "--host", "0.0.0.0", "--port", "3091", "--workers", "1"]
