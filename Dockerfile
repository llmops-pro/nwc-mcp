# nwc-mcp — container image for Glama's introspection check (stdio MCP server).
#
# Built from source with pnpm + the frozen lockfile. Glama starts this and sends MCP
# `initialize` + `tools/list`; the PLACEHOLDER NWC connection string + budget let config
# validate and the server list all its tools WITHOUT a real wallet — the wallet is only
# contacted when a tool is *called*, and introspection never calls tools. The placeholder
# is format-valid (64-hex pubkey/secret + relay) so the NWC client constructs cleanly.
FROM node:22-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml tsconfig.json ./
RUN pnpm install --frozen-lockfile
COPY src ./src
RUN pnpm build

FROM node:22-slim
WORKDIR /app
RUN corepack enable
ENV NODE_ENV=production
ENV NWC_CONNECTION_STRING="nostr+walletconnect://0000000000000000000000000000000000000000000000000000000000000000?relay=wss://relay.example.com&secret=0000000000000000000000000000000000000000000000000000000000000000"
ENV NWC_DAILY_BUDGET_SATS="1000"
ENV NWC_READ_ONLY="true"
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
ENTRYPOINT ["node", "dist/index.js"]
