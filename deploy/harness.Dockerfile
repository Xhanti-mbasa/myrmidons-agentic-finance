FROM node:22.23.0-bookworm-slim
RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
WORKDIR /app
COPY --chown=node:node . .
RUN pnpm install --frozen-lockfile
USER node
EXPOSE 8091
CMD ["node", "--import", "tsx", "services/backend/src/harness/main.ts", "--demo", "/state", "--container"]
