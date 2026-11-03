FROM node:20-alpine
WORKDIR /app
RUN npm install -g pnpm@9.15.4

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages ./packages
COPY services/quote-api ./services/quote-api
COPY chains/solana/package.json ./chains/solana/package.json

RUN pnpm install --frozen-lockfile --prod --ignore-scripts

ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

EXPOSE 3001
USER node
CMD ["node", "services/quote-api/dist/server.js"]
