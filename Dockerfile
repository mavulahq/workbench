# mavula.io - Worker Kit Docker Build Configuration
# Copyright (c) 2026 mavula.io
# SPDX-License-Identifier: AGPL-3.0-only

FROM node:22.22.3-alpine AS dev
WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages packages
RUN npm i -g pnpm@10.33.0 && \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @mavula/workbench... --frozen-lockfile --ignore-scripts && \
    pnpm --filter @mavula/settlements build && \
    pnpm --filter @mavula/legacy-connectors build

FROM node:22.22.3-alpine AS builder
WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/settlements/package.json packages/settlements/package.json
COPY packages/legacy-connectors/package.json packages/legacy-connectors/package.json
COPY packages/workbench/package.json packages/workbench/package.json
RUN --mount=type=cache,id=mavula-pnpm-store,target=/pnpm/store,sharing=locked \
    npm i -g pnpm@10.33.0 && \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @mavula/workbench... --frozen-lockfile --prod=false --ignore-scripts
COPY packages/settlements packages/settlements
COPY packages/legacy-connectors packages/legacy-connectors
COPY packages/workbench packages/workbench
RUN pnpm --filter @mavula/settlements build && \
    pnpm --filter @mavula/legacy-connectors build && \
    pnpm --filter @mavula/workbench build

FROM node:22.22.3-alpine AS runtime
WORKDIR /usr/src/app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/settlements/package.json packages/settlements/package.json
COPY packages/legacy-connectors/package.json packages/legacy-connectors/package.json
COPY packages/workbench/package.json packages/workbench/package.json
RUN npm i -g pnpm@10.33.0 && \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --filter @mavula/workbench... --prod --frozen-lockfile --ignore-scripts
COPY --from=builder /usr/src/app/packages/settlements/dist packages/settlements/dist
COPY --from=builder /usr/src/app/packages/legacy-connectors/dist packages/legacy-connectors/dist
COPY --from=builder /usr/src/app/packages/legacy-connectors/contracts packages/legacy-connectors/contracts
COPY --from=builder /usr/src/app/packages/workbench/dist ./dist
ENV NODE_ENV=production
ENV FWK_WORKER_ENABLED=true
EXPOSE 3010
CMD ["node","dist/main.js"]
