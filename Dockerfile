FROM registry.access.redhat.com/ubi9/nodejs-20:latest AS build

WORKDIR /opt/app-root/src

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM registry.access.redhat.com/ubi9/nodejs-20-minimal:latest

WORKDIR /opt/app-root/src

COPY --from=build /opt/app-root/src/node_modules ./node_modules
COPY package.json ./
COPY server.js ./
COPY public/ ./public/

EXPOSE 8080

USER 1001

CMD ["node", "server.js"]
