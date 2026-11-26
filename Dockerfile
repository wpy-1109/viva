FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV VIVA_HOST=0.0.0.0
ENV VIVA_ALLOW_NONLOCAL=1
ENV VIVA_DOCKER=1
ENV VIVA_DATA_DIR=/data
ENV VIVA_PORT=43123
EXPOSE 43123
VOLUME ["/data"]
CMD ["node", "dist/server/main.js"]
