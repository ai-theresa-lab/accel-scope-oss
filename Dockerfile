# Waggle — single-user, self-hosted image.
#
#   docker build -t waggle .
#   docker run --rm -p 127.0.0.1:4317:4317 -v waggle-data:/data \
#     -e ANTHROPIC_API_KEY=sk-ant-... waggle
#
# Node 22 runs the TypeScript sources directly (--experimental-strip-types, no build step). git is needed for the
# read-only repo clones a scan performs.
#
# Optional code intelligence (THERESA_CODEINTEL=1) uses repowise, an external AGPL-3.0 Python CLI that is invoked
# strictly as a subprocess and never vendored. It is NOT installed by default; pass a pip requirement to include it:
#   docker build --build-arg REPOWISE_SPEC='repowise @ git+https://github.com/repowise-dev/repowise@v0.28.0' -t waggle .
# Base image pinned by digest (node:22.17-slim) so a rebuild uses the exact same image; bump both FROM lines together.
FROM node:22.17-slim@sha256:2fa754a9ba4d7adbd2a51d182eaabbe355c82b673624035a38c0d42b08724854 AS repowise-builder
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates git python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
ARG REPOWISE_SPEC=""
RUN python3 -m venv /opt/repowise-venv \
  && if [ -n "$REPOWISE_SPEC" ]; then \
       /opt/repowise-venv/bin/pip install --no-cache-dir "$REPOWISE_SPEC" && /opt/repowise-venv/bin/repowise --version ; \
     else \
       echo "repowise: not installed (no REPOWISE_SPEC) — code intelligence stays off" ; \
     fi

FROM node:22.17-slim@sha256:2fa754a9ba4d7adbd2a51d182eaabbe355c82b673624035a38c0d42b08724854
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=repowise-builder /opt/repowise-venv /opt/repowise-venv

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# codex CLI (optional, not installed by default): codex's OS sandbox cannot start inside a container, and an unsandboxed
# codex over scanned-repo content could read the OpenAI key, so the app does not run codex here (report writing uses the
# OpenAI API and Claude instead). To include it anyway: --build-arg CODEX_VERSION=<version> and run with
# THERESA_REPORT_CODEX_REQUIRE_SANDBOX=0 to accept the risk.
ARG CODEX_VERSION=
RUN if [ -n "$CODEX_VERSION" ]; then npm i -g "@openai/codex@${CODEX_VERSION}"; fi
COPY src ./src

# Inside the container the server listens on all interfaces; publish the port on 127.0.0.1 (as above) unless you
# put your own authentication in front of it — the console has no login. THERESA_CODEX_NO_SANDBOX=1 tells the app that
# codex's OS sandbox is unavailable here, so codex stays disabled (see above).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 THERESA_DATA_DIR=/data \
    THERESA_CODEX_NO_SANDBOX=1 THERESA_REPOWISE_BIN=/opt/repowise-venv/bin/repowise
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 4317

CMD ["node", "--disable-warning=ExperimentalWarning", "--experimental-strip-types", "src/server.ts"]
