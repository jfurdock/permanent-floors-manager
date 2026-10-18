FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY core ./core
COPY server ./server
COPY dist ./dist
ENV PORT=3000 HOST=0.0.0.0 DATA_DIR=/data NODE_ENV=production
VOLUME /data
EXPOSE 3000
CMD ["node", "--disable-warning=ExperimentalWarning", "server/index.js"]
