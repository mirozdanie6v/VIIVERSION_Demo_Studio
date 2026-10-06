FROM mcr.microsoft.com/playwright:v1.63.0-noble

WORKDIR /app

ENV PORT=8080
ENV HOST=0.0.0.0
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

COPY package.json package-lock.json ./
COPY requirements-tts.txt requirements-tts-chatterbox.txt ./

RUN npm ci --include=dev --no-fund --no-audit \
  && apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg espeak-ng python3 python3-venv \
  && python3 -m venv /opt/viiversion-tts \
  && /opt/viiversion-tts/bin/python -m pip install --no-cache-dir --upgrade pip \
  && /opt/viiversion-tts/bin/python -m pip install --no-cache-dir torch torchaudio --index-url https://download.pytorch.org/whl/cpu \
  && /opt/viiversion-tts/bin/python -m pip install --no-cache-dir "setuptools<82" resemble-perth numpy chatterbox-tts supertonic ruaccent \
  && rm -rf /root/.cache/pip /var/lib/apt/lists/*

COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts

RUN npm run build \
  && npm prune --omit=dev

ENV NODE_ENV=production
ENV HF_TTS_PREMIUM_DEFAULT=1
ENV HF_TTS_PYTHON=/opt/viiversion-tts/bin/python
ENV HF_TTS_DEVICE=cpu

EXPOSE 8080

CMD ["node", "dist/server-cli.js"]
