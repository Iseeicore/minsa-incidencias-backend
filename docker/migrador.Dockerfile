# Migrador del stack: reutiliza el esquema, las migraciones y el padron de establecimientos del repo del bot (contexto
# nombrado "bot", que fija docker-compose.stack.yml con BOT_DIR). Mismo mecanismo que el Dockerfile del bot: la CLI de
# Prisma aislada en /opt/prisma y `migrate deploy`. El padron se carga con su script `db-seed-eess.mjs` (necesita psql).
FROM node:22-alpine
RUN apk add --no-cache openssl postgresql-client
# Debe coincidir con PRISMA_VERSION del Dockerfile del bot.
ARG PRISMA_VERSION=6.19.3
WORKDIR /opt/prisma
RUN npm init -y > /dev/null && npm install --no-audit --no-fund prisma@${PRISMA_VERSION}

WORKDIR /app
COPY --from=bot --chown=node:node prisma/schema.prisma ./prisma/schema.prisma
COPY --from=bot --chown=node:node prisma/migrations ./prisma/migrations
COPY --from=bot --chown=node:node prisma/seeds/eess ./prisma/seeds/eess
COPY --from=bot --chown=node:node scripts/db-seed-eess.mjs ./scripts/db-seed-eess.mjs

USER node
CMD ["sh", "-c", "node /opt/prisma/node_modules/prisma/build/index.js migrate deploy --schema /app/prisma/schema.prisma && node scripts/db-seed-eess.mjs"]
