# Voyage MS — MapleStory v83 web client
FROM node:22-slim

WORKDIR /app

# Install deps (package.json + package-lock.json for reproducibility)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# Copy the client source
COPY . .

# Build the client bundle. Fails the image build if the bundle can't be built.
# The server builds it again on start, with Build.Obfuscate from client.conf.
RUN node build.mjs

# Run as uid 1000, which rebuilds public/Voyage.js on start (and admin/Admin.js with the admin page on), writes
# /conf/client.conf, keeps the sheets it makes from the assets in /app/cache and the maps made with the admin page
# in /app/custom
RUN mkdir -p /conf cache custom && chown -R 1000:1000 /conf public cache custom admin
USER 1000:1000

# The server listens on 3000 by default (Server.Port in client.conf)
EXPOSE 3000

# Assets are mounted at runtime (see docker-compose.yml) — 5.6G, not baked in.
# Settings are /conf/client.conf, made from the template on the first start.
CMD ["node", "server.js", "--conf", "/conf"]
