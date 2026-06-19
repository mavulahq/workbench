# getfluxo.io - Worker Kit Docker Build Configuration
# Copyright (c) 2026 getfluxo.io
# License: PROPRIETARY

FROM node:22.22.3-alpine AS builder
WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/fwk/package.json packages/fwk/package.json
RUN --mount=type=cache,id=getfluxo-pnpm-store,target=/pnpm/store,sharing=locked \
    npm i -g pnpm@10.33.0 && \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @getfluxo/fwk... --frozen-lockfile --prod=false --ignore-scripts
COPY packages/fwk packages/fwk
RUN pnpm --filter @getfluxo/fwk build

FROM node:22.22.3-alpine AS runtime
WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/fwk/package.json packages/fwk/package.json
RUN --mount=type=cache,id=getfluxo-pnpm-store,target=/pnpm/store,sharing=locked \
    npm i -g pnpm@10.33.0 && \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @getfluxo/fwk --prod --frozen-lockfile --ignore-scripts
COPY --from=builder /usr/src/app/packages/fwk/dist ./dist
ENV NODE_ENV=production
ENV FWK_WORKER_ENABLED=true
EXPOSE 3010
CMD ["node","dist/main.js"]
