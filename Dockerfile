FROM node:22-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=8787
ENV HOST=0.0.0.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json ./

RUN npm install   && npx playwright install --with-deps chromium   && apt-get update   && apt-get install -y --no-install-recommends ffmpeg   && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src

RUN npm run build   && npm prune --omit=dev

EXPOSE 8787

CMD ["node", "dist/server-cli.js"]
