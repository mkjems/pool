# The game's files and the friend-match relay, served by one small Node server (server/server.mjs).

# Build the game into dist/.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# Run it: only the server, its one dependency (ws) and the built files.
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./server/
COPY --from=build /app/dist/ ./dist/

USER node
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
CMD ["node", "server/server.mjs"]
