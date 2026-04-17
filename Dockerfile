FROM oven/bun:1.3

WORKDIR /app

# Install deps before copying source so this layer is cached
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

# Playwright Chromium + system libs (needed by Alza/Smarty scrapers)
RUN bunx playwright install chromium --with-deps

# Copy source
COPY src/ ./src/
COPY tsconfig.json ./

CMD ["bun", "run", "src/index.ts"]
