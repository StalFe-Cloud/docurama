# Build Stage
FROM node:22-alpine AS build

WORKDIR /app

COPY package.json package-lock.json* ./
# npm ci: reproduce the committed lockfile exactly instead of letting
# npm install drift onto untested dependency versions.
RUN npm ci

COPY . .
RUN npm run build

# Production Stage
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 3000

CMD ["nginx", "-g", "daemon off;"]
