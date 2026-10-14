FROM node:22-alpine

WORKDIR /app

# Dependencias primero (se cachean si no cambia package.json)
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY . .

# Los puntajes viven aquí: monta un volumen en /app/data para no perderlos al redesplegar
RUN mkdir -p /app/data && chown -R node:node /app/data
VOLUME ["/app/data"]

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/config > /dev/null || exit 1

CMD ["node", "server.js"]
