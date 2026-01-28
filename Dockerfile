FROM node:20-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

# Install only Chromium and its system dependencies to keep the image smaller.
RUN ./node_modules/.bin/playwright install chromium --with-deps \
	&& rm -rf /var/lib/apt/lists/*

# Remove dev dependencies after browser install.
RUN npm prune --omit=dev

COPY --from=build /app/dist ./dist

ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "dist/server.js"]
