FROM node:22-alpine AS frontend-build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ARG VITE_ADMIN_BASE_URL=
ARG VITE_WEBHARD_BASE_URL=
ARG VITE_MEDIA_API_BASE=
ENV VITE_ADMIN_BASE_URL=$VITE_ADMIN_BASE_URL
ENV VITE_WEBHARD_BASE_URL=$VITE_WEBHARD_BASE_URL
ENV VITE_MEDIA_API_BASE=$VITE_MEDIA_API_BASE
RUN npm run build

FROM nginx:1.27-alpine

COPY --from=frontend-build /app/dist /usr/share/nginx/html

RUN cat > /etc/nginx/conf.d/default.conf <<'NGINX'
server {
  listen 8084;
  server_name _;
  root /usr/share/nginx/html;
  index index.html;
  server_tokens off;
  resolver 127.0.0.11 valid=10s ipv6=off;
  gzip on;
  gzip_comp_level 5;
  gzip_min_length 1024;
  gzip_types text/plain text/css application/javascript application/json application/xml image/svg+xml;

  add_header X-Content-Type-Options "nosniff" always;
  add_header X-Frame-Options "DENY" always;
  add_header X-Permitted-Cross-Domain-Policies "none" always;
  add_header Referrer-Policy "strict-origin-when-cross-origin" always;
  add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
  add_header Cross-Origin-Opener-Policy "same-origin" always;
  add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

  location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Permitted-Cross-Domain-Policies "none" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
  }

  location = /flutter_service_worker.js {
    add_header Cache-Control "no-store" always;
    return 410;
  }

  location /api/ {
    set $jstube_api http://jstube-api:8085;
    proxy_pass $jstube_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_read_timeout 1800s;
    proxy_send_timeout 1800s;
    proxy_buffering off;
    proxy_request_buffering off;
    proxy_max_temp_file_size 0;
    client_max_body_size 1g;
  }

  location / {
    try_files $uri $uri/ /index.html;
    add_header Cache-Control "no-store" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;
    add_header X-Permitted-Cross-Domain-Policies "none" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
    add_header Cross-Origin-Opener-Policy "same-origin" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self'; connect-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' blob: https:; frame-src https://www.youtube.com https://youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
  }
}
NGINX

EXPOSE 8084
CMD ["nginx", "-g", "daemon off;"]
