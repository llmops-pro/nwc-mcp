# nwc-mcp — container image for Glama's introspection check (stdio MCP server).
#
# Installs the PUBLISHED package (a known-good build) and runs it with placeholder env so
# it lists all tools WITHOUT a real wallet — the wallet is only contacted when a tool is
# *called*, and introspection never calls tools. The placeholder NWC string is
# format-valid (64-hex pubkey/secret) so the client constructs without throwing.
#
# NOTE: we install from npm instead of building from source here because a clean source
# rebuild currently emits a broken ESM bundle (tracked separately as a build bug); the
# published dist is the one that runs in production.
FROM node:22-slim
ENV NODE_ENV=production
ENV NWC_CONNECTION_STRING="nostr+walletconnect://0000000000000000000000000000000000000000000000000000000000000000?relay=wss://relay.example.com&secret=0000000000000000000000000000000000000000000000000000000000000000"
ENV NWC_DAILY_BUDGET_SATS="1000"
ENV NWC_READ_ONLY="true"
RUN npm install -g nwc-mcp@latest
ENTRYPOINT ["nwc-mcp"]
