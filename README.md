# MCL Client

A custom Minecraft launcher built with **Tauri 2 (Rust) + React 19 + TypeScript**. Designed for friend groups and private servers — fast, lightweight, and straightforward.

---

## Features

- **Profile management** — Create and switch between game profiles (Vanilla, Fabric, Forge, NeoForge, Quilt) with auto mod loader installation.
- **Server Hub** — Save servers, see live ping / player count, and jump straight in on launch.
- **3D Skin Studio** — Preview your skin in 3D (WebGL), supports Classic and Slim model types.
- **Teammate skins in-game** — Automatically configures CustomSkinLoader so everyone on the server sees each other's skins, even on offline/cracked accounts.
- **Mod manager** — Browse and install mods from Modrinth, or drop in local `.jar` files.
- **Performance settings** — RAM allocation slider, auto Java detection, built-in JVM optimization flags (Aikar's Flags).
- **Storage cleanup** — Scan and remove unused game versions, orphaned instances, and temp cache in one click.
- **Multi-language UI** — English, Vietnamese, Chinese, Japanese, Korean, German, French, Spanish.

---

## For End Users

### Requirements
- Windows 10 / 11 (64-bit)
- Java 21 LTS recommended ([download](https://adoptium.net/))

### Install
Download the latest `.msi` or `.exe` installer from the [Releases](https://github.com/pecora31/MCLv2/releases) page and run it. No extra setup needed.

---

## For Developers & Modders

### Prerequisites
| Tool | Version |
|------|---------|
| Node.js | 18 or newer |
| Rust + Cargo | 1.77 or newer |
| Java (optional, for testing launch) | 21 LTS |

Install Rust via [rustup.rs](https://rustup.rs/) if you don't have it.

### Getting Started

```bash
# 1. Clone the repo
git clone https://github.com/pecora31/MCLv2.git
cd MCLv2

# 2. Install frontend dependencies
npm install

# 3. Run in development mode (full Tauri app)
npm run tauri dev
```

> **Frontend only** (no Rust, faster iteration on UI):
> ```bash
> npm run dev
> ```
> Then open `http://localhost:5173` in your browser.

### Build a Release Installer

```bash
npm run tauri build
```

Output is in `src-tauri/target/release/bundle/` — you'll find `.msi` and `.exe` files ready to distribute.

### Project Layout

```
MCL/
├── src/                  # React frontend
│   ├── components/       # UI components
│   ├── locales/          # i18n translations
│   ├── services/         # API calls (Tauri commands)
│   └── types/            # Shared TypeScript types
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── main.rs       # Entry point
│   │   └── commands/     # Tauri command handlers
│   └── tauri.conf.json   # App config (window size, bundle, etc.)
└── public/               # Static assets
```

### Tech Stack

| Layer | Tech |
|-------|------|
| Backend | Tauri 2.0 (Rust) |
| Frontend | React 19, TypeScript, Vite |
| Styling | TailwindCSS, Vanilla CSS |
| 3D Rendering | skinview3d (Three.js / WebGL) |
| Icons | Lucide React |
| Server Ping | Custom Minecraft SLP over TCP (Rust) |

---

## License

Built and maintained by **pecora31**. For personal and community use.
