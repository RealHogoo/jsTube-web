# jsTube Web

React/Vite frontend for the JsTube media service.

This repository intentionally contains source code only. Do not commit
production `.env` files, tokens, build output, media files, or private keys.

## Role

- Media gallery, search, albums, favorites, likes, and public flags.
- Video/image detail views.
- YouTube preview/import controls.
- Karaoke TV and mobile remote screens.
- Adaptive video playback using API-proxied HLS when available and MP4 range
  streaming as a fallback.

## Runtime URLs

The frontend is built with these Vite variables:

```env
VITE_MEDIA_API_BASE=http://localhost:8084
VITE_ADMIN_BASE_URL=http://localhost:8081
VITE_WEBHARD_BASE_URL=http://localhost:8083
```

In production the web container serves the built app and proxies `/api/` to
`jsTube-api` on the Docker internal network.

## Video Playback

`AdaptiveVideo` prefers `item.hls_url` for videos.

- Safari and iPad use native HLS support.
- Other browsers load `hls.js` at runtime and attach it to the video element.
- If HLS is unavailable or fails, playback falls back to `item.content_url`,
  which supports normal MP4 byte-range streaming through the API.

The current app loads `hls.js` from a pinned CDN URL. If external script loading
is blocked by a stricter production policy, bundle or self-host that asset before
deploying the policy change.

## Local

```sh
npm ci
cp .env.example .env
npm run dev
```

## Verify

```sh
npm run build
```
