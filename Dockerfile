# Imagem do Render (ou qualquer hospedagem com Docker). Na subida aplica as migrações e liga a API.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY prisma ./prisma
COPY prisma.config.ts tsconfig*.json nest-cli.json ./
COPY src ./src
RUN npx prisma generate && npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3004
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY prisma ./prisma
COPY prisma.config.ts ./
EXPOSE 3004
USER node
# o prisma (CLI) fica nas dependências de produção só para o migrate deploy
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/main.js"]
