# 🚀 Qbix Server

A complete web server in pure PHP. No nginx, no Apache, no Docker.

## ⚡ Quick Start

```bash
git clone https://github.com/Qbix/Platform.git
cd Platform
# download QbixServer.zip, unzip here, then:
bash install.sh
```

Opens http://localhost:8080/Q/panel 🎉

## 📖 Full Documentation

**[qbix.com/server.html](https://qbix.com/server.html)** — architecture deep dive, mesh networking, HTTPS options, the Groups app, and how to build a standalone single-binary server with `build.sh`.

## 🔧 Manual Install

```bash
# 📦 Copy server classes into your platform
cp -r Q/classes/Q/* /path/to/platform/classes/Q/

# 🌐 Optional: install IndieWeb plugin
cp -r IndieWeb /path/to/platform/plugins/

# 🏃 Start
cd /path/to/your-app
php scripts/Q/webserver.php --port=8080 --workers=4
```

## 📋 Requirements

- 🐘 PHP 8.1+ with extensions: pcntl, dom, curl, mbstring, json
- 🎯 That's it

## 🗺️ Server Endpoints

- 🎛️ `/Q/panel` — Control panel (manage apps, run scripts, open folders)
- 📊 `/Q/dashboard` — Live server stats with WebSocket updates
- 🏥 `/Q/health` — JSON health check (for load balancers)
- 🔌 `/Q/ws` — WebSocket endpoint

## ✨ What's Included

- ⚡ **Keep-alive connections** — 100 requests per connection, 15s idle timeout
- 🗜️ **Compression** — gzip on-the-fly, pre-compressed .gz/.br file support
- 🔄 **Reverse cache** — APCu + filesystem, serves cached responses without forking workers
- 📡 **WebSocket** — RFC 6455 on the same port, no socket.io needed
- 🔒 **X-Accel-Redirect** — PHP checks auth, server does file I/O
- 🛡️ **Proxy headers** — X-Forwarded-For/Proto/Host with trusted proxy list
- 📝 **Access logging** — Apache combined format with automatic rotation
- 🔑 **TLS support** — built-in certbot + remote cert download for dev
- 🐧 **systemd ready** — `--systemd` generates a production unit file
- 📱 **Mobile-friendly panel** — glassmorphism UI, works on phones

## 📱 Groups App

The native client for the Qbix Platform — 7M+ downloads, privacy-preserving community management. Your contacts stay on your phone.

- 🍎 [Download for iOS](https://apps.apple.com/us/app/groups/id407855546)
- 🤖 Android — coming soon

## 🏗️ Build Standalone Binary

```bash
# Creates a ~15MB self-contained executable (PHP + SQLite + Q framework)
./scripts/Q/build.sh

# Run anywhere — no PHP installation needed
./qbix-server --port=8080 --workers=4
```

See [qbix.com/server.html](https://qbix.com/server.html) for the full story on the single-binary architecture, mesh networking, and deployment options.