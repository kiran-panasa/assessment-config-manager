FROM mcr.microsoft.com/playwright:v1.60.0-noble

WORKDIR /app

COPY package.json ./
RUN npm install

COPY . .

EXPOSE 3001

CMD ["node", "server.js"]
