# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS deps

WORKDIR /app

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

RUN corepack enable && corepack prepare pnpm@10.30.3 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
RUN pnpm download-files

FROM deps AS build

COPY tsconfig.json ./
COPY src ./src
RUN pnpm build
RUN pnpm prune --prod

FROM node:24-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

CMD ["node", "dist/agent.js", "start"]
