# accel-scope — single-user, self-hosted image.
#
#   docker build -t accel-scope .
#   docker run --rm -p 127.0.0.1:4317:4317 -v accel-scope-data:/data \
#     -e ANTHROPIC_API_KEY=sk-ant-... accel-scope
#
# Node 22 runs the TypeScript sources directly (--experimental-strip-types, no build step). git is needed for the
# read-only repo clones a scan performs.
#
# Optional code intelligence (THERESA_CODEINTEL=1) uses repowise, an external AGPL-3.0 Python CLI that is invoked
# strictly as a subprocess and never vendored. It is NOT installed by default; pass a pip requirement to include it:
#   docker build --build-arg REPOWISE_SPEC='repowise @ git+https://github.com/repowise-dev/repowise@v0.28.0' -t accel-scope .
FROM node:22.17-slim AS repowise-builder
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

FROM node:22.17-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=repowise-builder /opt/repowise-venv /opt/repowise-venv

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
# codex CLI (optional): with an OPENAI_API_KEY the report writers and QC judges run as an OpenAI coding agent and fall
# back to Claude without it. It only ever authenticates with the key you configure (src/apiKeys.ts).
ARG CODEX_VERSION=0.141.0
RUN if [ -n "$CODEX_VERSION" ]; then npm i -g "@openai/codex@${CODEX_VERSION}"; fi
COPY src ./src

# Inside the container the server listens on all interfaces; publish the port on 127.0.0.1 (as above) unless you
# put your own authentication in front of it — the console has no login. codex's OS sandbox cannot start inside a
# container, so it runs with the container itself as the boundary (THERESA_CODEX_NO_SANDBOX=1).
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4317 THERESA_DATA_DIR=/data \
    THERESA_CODEX_NO_SANDBOX=1 THERESA_REPOWISE_BIN=/opt/repowise-venv/bin/repowise
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]
USER node
EXPOSE 4317

CMD ["node", "--disable-warning=ExperimentalWarning", "--experimental-strip-types", "src/server.ts"]
