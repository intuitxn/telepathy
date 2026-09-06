# ---- build stage: compile the Vite SPA ----
FROM node:22-alpine AS build
WORKDIR /app
COPY site/package.json site/package-lock.json ./
RUN npm ci
COPY site/ ./
RUN npm run build

# ---- serve stage: nginx serving the static bundle ----
FROM nginx:1.27-alpine AS serve
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
