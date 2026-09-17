FROM oven/bun:1.2 AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock ./
COPY prisma ./prisma
RUN bun install
RUN bunx prisma generate

# Build application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN bunx next build
RUN cp -R .next/static .next/standalone/.next/ && cp -R public .next/standalone/ && cp -R tessdata .next/standalone/

# Production runner
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Fonts for everything that rasterises text in production: the signer
# preview's per-recipient watermark, and pdfjs rendering of PDFs that rely on
# system fonts. Debian slim ships none, so a missing package here would
# silently degrade both to textless output.
RUN apt-get update \
  && apt-get install -y --no-install-recommends fontconfig fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/db ./db

EXPOSE 3000

CMD ["bun", "server.js"]
