FROM node:22-alpine AS client-build
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ .
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci
COPY server/ .
RUN npm run build

FROM node:22-alpine
WORKDIR /app

COPY --from=server-build /app/server/package*.json ./server/
COPY --from=server-build /app/server/dist ./server/dist/
COPY --from=server-build /app/server/node_modules ./server/node_modules/

COPY --from=client-build /app/client/dist ./client/dist/

WORKDIR /app/server

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
