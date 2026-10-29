FROM node:24-alpine AS builder
WORKDIR /app
ENV BUILD_STANDALONE=true NEXT_TELEMETRY_DISABLED=1 MONGOMS_DISABLE_POSTINSTALL=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json next.config.ts styles.css ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

FROM builder AS tools
CMD ["node", "--experimental-strip-types", "scripts/setup-mongo.ts"]

FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000 GOOGLE_COLLECTION_ENABLED=false NEXT_TELEMETRY_DISABLED=1
COPY --from=builder --chown=node:node /app/.next/standalone ./
COPY --from=builder --chown=node:node /app/.next/static ./.next/static
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
