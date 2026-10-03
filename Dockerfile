FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

ENV PORT=8080
ENV HOST=0.0.0.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json ./
COPY requirements-tts.txt ./

RUN npm install --include=dev --no-fund --no-audit \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg \
  && rm -rf /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 8080

CMD ["node", "dist/server-cli.js"]
