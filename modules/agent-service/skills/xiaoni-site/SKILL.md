---
name: xiaoni-site
description: Publish or test Xiaoni's personal website at https://xiaoni.liahuas.top from the Xiaoni exec_command runtime.
---

# Xiaoni Site

Use this skill when you want to build, run, test, or debug your public personal website at:

```text
https://xiaoni.liahuas.top
```

## Runtime Cost

```text
energy_cost: 0.002
```

## Public Route

The operator has already connected the domain for you:

```text
https://xiaoni.liahuas.top
-> Cloudflare Tunnel
-> host 127.0.0.1:3458
-> xiaoni-site-expose-proxy
-> qqbot-xiaoni-executor:3458
```

Your `exec_command` commands run inside `qqbot-xiaoni-executor`. To make the site reachable from the public domain, your web server must listen on:

```text
0.0.0.0:3458
```

Do not bind the public site to `127.0.0.1:3458` inside the executor container. That only listens on the container's own localhost and the proxy cannot reach it.

## Run A Vite Or Node Dev Server

From your website project directory:

```bash
nohup npm run dev -- --host 0.0.0.0 --port 3458 \
  > /xiaoni-runtime/xiaoni-site.log 2>&1 &
```

Then test:

```bash
curl -I http://127.0.0.1:3458
curl -I https://xiaoni.liahuas.top
```

## Serve A Static Build

If the project builds to `dist`:

```bash
npm run build
nohup npx serve -s dist -l tcp://0.0.0.0:3458 \
  > /xiaoni-runtime/xiaoni-site.log 2>&1 &
```

Then test:

```bash
curl -I http://127.0.0.1:3458
curl -I https://xiaoni.liahuas.top
```

## Quick Smoke Test

Use this if you want to confirm the domain route before building a real site:

```bash
mkdir -p /tmp/xiaoni-site-smoke
printf 'xiaoni-site-ok\n' > /tmp/xiaoni-site-smoke/index.html
cd /tmp/xiaoni-site-smoke
nohup python3 -m http.server 3458 --bind 0.0.0.0 \
  > /xiaoni-runtime/xiaoni-site.log 2>&1 &

curl -sS http://127.0.0.1:3458
curl -sS https://xiaoni.liahuas.top
```

Stop the smoke server when done:

```bash
pkill -f 'python3 -m http.server 3458' || true
```

## Check And Stop Existing Site Processes

See whether something is already listening:

```bash
ss -ltnp 2>/dev/null | grep ':3458' || true
ps aux | grep -E '3458|vite|serve|http.server' | grep -v grep || true
```

Stop common site servers:

```bash
pkill -f 'vite.*3458' || true
pkill -f 'serve.*3458' || true
pkill -f 'http.server 3458' || true
```

## Expected Failures

- Public `502`: the domain and tunnel are alive, but no site is listening on `0.0.0.0:3458` in `qqbot-xiaoni-executor`.
- Local works but public fails: make sure the command used `--host 0.0.0.0`, not localhost.
- Port already used: stop the old process or reuse it intentionally.
- Logs: read `/xiaoni-runtime/xiaoni-site.log`.

