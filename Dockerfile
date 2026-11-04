# Voyage MS — MapleStory v83 web client
FROM node:22-slim

WORKDIR /app

# Install deps (package.json + package-lock.json for reproducibility)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the client source
COPY . .

# Build the client bundle (respects OBFUSCATE). Fails the image build if the
# bundle can't be built. OBFUSCATE=1 (or true/yes/on) minifies + obfuscates.
ARG OBFUSCATE=0
ENV OBFUSCATE=$OBFUSCATE
RUN node build.mjs

# The server listens on 3000 by default (overridable via PORT)
EXPOSE 3000

# Assets are mounted at runtime (see docker-compose.yml) — 5.6G, not baked in
ENV ASSETS_DIR=/app/assets

CMD ["node", "server.js"]
