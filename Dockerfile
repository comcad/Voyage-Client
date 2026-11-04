# Voyage MS — MapleStory v83 web client
FROM node:22-slim

WORKDIR /app

# Install deps (package.json + package-lock.json for reproducibility)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the client source
COPY . .

# Fail fast if the client bundle can't be built (mirrors server.js's startup
# build). Note: `npm run build` swallows errors (`|| echo 'BUILD FAILED'`),
# so we call esbuild directly to make a broken bundle fail the image build.
RUN npx esbuild src/main.js --bundle --outfile=public/Voyage.js

# The server listens on 3000 by default (overridable via PORT)
EXPOSE 3000

# Assets are mounted at runtime (see docker-compose.yml) — 5.6G, not baked in
ENV ASSETS_DIR=/app/assets

CMD ["node", "server.js"]
