# 🌐 Qbix Platform

An open-source framework for building social apps and communities, by Gregory Magarshak.

**[Documentation](https://qbix.com/platform/guide)** · **[GitHub](https://github.com/Qbix/Platform)** · **[Server Architecture](https://qbix.com/server.html)**

## 💡 Design Goals

- 🧩 **Code Re-Use** — build apps out of plugins and tools; turn any new feature into a reusable plugin
- 🎯 **Don't Repeat Yourself** — one place to modify config, schemas, handlers, views; changes propagate everywhere
- 🔄 **Consistent** — predictable file locations, coding style, APIs, documentation, and user interfaces across every app
- 📚 **Easy to Learn** — stays close to PHP and JS; simple naming; complex systems built on simple ones
- 📈 **Scalable** — distributed by design; sharding, caching, and batching built in; pre-fork worker model for the server
- ⚡ **Responsive** — minimal request overhead; autoloading on demand despite large codebases; reverse caching in the server process
- 🔌 **Extensible** — import libraries via Composer; everything namespaced; plugins live alongside each other cleanly
- 👥 **Team Oriented** — supports division of labor; works well with Git; credentials stay in `local/` (gitignored); CI-friendly
- 📦 **Portable** — deploy anywhere: cloud, bare metal, Raspberry Pi, phone; single-binary builds via static-php-cli; runs on Linux, macOS, Windows

## 🏗️ Technology Stack

| Layer | Technology | Notes |
|---|---|---|
| 🖥️ **OS** | Linux, macOS, Windows, Android | ARM and x86 |
| 🌐 **Web Server** | **Qbix built-in server** | Pure PHP, pre-fork workers, keep-alive, WebSocket, reverse cache. No nginx/Apache needed. Optional: Caddy or nginx as HTTPS proxy |
| 🗄️ **Database** | MySQL 8+ / MariaDB | Via the Db plugin. SQLite for lightweight apps. IndieWeb plugin needs no database at all |
| 🐘 **Core** | PHP 8.1+ | With pcntl, dom, curl, mbstring, openssl |
| 🔧 **Services** | Node.js (optional) | For npm packages and JS/CSS bundling. Not required for the server itself |
| 📱 **Mobile** | Groups iOS app / Android (coming) | Native apps with mesh networking. Or any browser via QR code |
| 🔒 **HTTPS** | Cloudflare / Caddy / AWS / built-in TLS | Cloud edge recommended for production; built-in TLS for dev |

## 📂 Platform Structure

```
platform/
  Q.php                    Core bootstrap
  classes/                 Q framework classes
    Q/
      WebServer.php        Built-in HTTP server
      WebSocket.php        RFC 6455 WebSocket
      Evented.php          Non-blocking event loop
      Dispatcher.php       Request routing
      Config.php           Cascading JSON config
      Cache.php            Multi-level caching
      ...
  plugins/                 Official plugins
    Users/                 Authentication, sessions, devices
    Streams/               Real-time pub/sub, access control
    Communities/           Groups, roles, invitations
    Assets/                Payments, credits, subscriptions
    AI/                    LLM integration
    IndieWeb/              Webmention, feeds, microformats
    ...
  scripts/                 CLI + server scripts
  config/                  Default configuration
  views/                   Shared view templates
```

## 🚀 Getting Started

```bash
git clone https://github.com/Qbix/Platform.git
cd Platform
php MyApp/scripts/Q/webserver.php --port=8080
```

Open http://localhost:8080/Q/panel to manage apps, run scripts, and configure plugins — all from your browser.

## 🔌 Plugin Architecture

Everything in Qbix is a plugin. An app is a plugin. Plugins can depend on other plugins. Each plugin has:

- 📁 `classes/` — PHP classes (autoloaded by naming convention)
- 📁 `handlers/` — event handlers (before/after hooks on any event)
- 📁 `config/` — JSON config (merged with app and local config)
- 📁 `views/` — templates and partials
- 📁 `web/` — public JS, CSS, images
- 📁 `scripts/` — CLI scripts (also runnable from the web panel)
- 📁 `text/` — i18n translations

## 📱 Groups App

The flagship app built on Qbix — 7M+ downloads across 100+ countries.

- 🍎 [Download for iOS](https://apps.apple.com/us/app/groups/id407855546)
- 🤖 Android — coming soon
- 🔒 [Privacy architecture](https://groups.app/confidential.html) — your contacts stay on your phone

## 📜 License

See [LICENSE](LICENSE) for details.