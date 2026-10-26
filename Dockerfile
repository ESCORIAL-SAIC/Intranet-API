# Imagen de produccion de la API.
# La construye el workflow .github/workflows/deploy.yml en el servidor
# y la levanta deploy/docker-compose.yml (servicio "api").

# --- dependencias ---
# bcrypt es un addon nativo: en alpine puede tener que compilarse, por eso
# las herramientas de build quedan solo en esta etapa.
FROM node:22-alpine AS deps

WORKDIR /app

RUN apk add --no-cache python3 make g++

COPY package*.json ./
RUN npm ci --omit=dev

# --- runtime ---
FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# files/ se monta como volumen (la app escribe ahi en runtime)
USER node

EXPOSE 2223

CMD ["node", "server.js"]
