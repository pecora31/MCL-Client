# MCL Client

A custom Minecraft launcher built with **Tauri 2 (Rust) + React 19 + TypeScript**. Designed for friend groups and private servers. Fast, lightweight, and gets out of your way.

## Features

- **Profile management:** Create and switch between game profiles (Vanilla, Fabric, Forge, NeoForge, Quilt) with automatic mod loader installation.
- **Server Hub:** Save servers, monitor live ping and player count, and connect directly on launch.
- **3D Skin Studio:** Preview your skin in 3D (WebGL), supports Classic and Slim model types.
- **Teammate skins in-game:** Automatically configures CustomSkinLoader so everyone on the server sees each other's skins.
- **Mod manager:** Browse and install mods from Modrinth, or drop in local `.jar` files.
- **Performance settings:** RAM allocation slider, auto Java detection, built-in JVM optimization flags (Aikar's Flags).
- **Storage cleanup:** Scan and remove unused game versions, orphaned instances, and temp cache in one click.
- **Multi-language UI:** English, Vietnamese, Chinese, Japanese, Korean, German, French, Spanish.

## For End Users

**Requirements**
- Windows 10 / 11 (64-bit)
- Nothing else — the launcher downloads the Java version each game needs on its own

**Install**

Download the latest `.msi` or `.exe` from the [Releases](https://github.com/pecora31/MCL-Client/releases) page and run it. No additional setup required.

**Privacy and safety**

No accounts, no analytics, no ads. See [PRIVACY.md](PRIVACY.md) for every connection the
launcher makes and what it sends.

## For Developers & Modders

**Prerequisites**

| Tool | Version |
|------|---------|
| Node.js | 18 or newer |
| Rust + Cargo | 1.77 or newer |
| Java (optional) | 21 LTS |

Install Rust via [rustup.rs](https://rustup.rs/) if you don't have it yet.

**Getting started**

```bash
# Clone the repo
git clone https://github.com/pecora31/MCL-Client.git
cd MCL Client

# Install frontend dependencies
npm install

# Run the full Tauri app in development mode
npm run tauri dev
```

If you only want to work on the UI without Rust:

```bash
npm run dev
```

Then open `http://localhost:5173` in your browser.

**Build a release installer**

```bash
npm run tauri build
```

Output goes to `src-tauri/target/release/bundle/`. You'll get an `.msi` and `.exe` ready to share.

**Project structure**

```
MCL/
├── src/                  # React frontend
│   ├── components/       # UI components
│   ├── locales/          # i18n translation strings
│   ├── services/         # Tauri command wrappers
│   └── types/            # Shared TypeScript types
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── main.rs       # Entry point
│   │   └── commands/     # Tauri command handlers
│   └── tauri.conf.json   # App config
└── public/               # Static assets
```

**Tech stack**

| Layer | Tech |
|-------|------|
| Backend | Tauri 2.0 (Rust) |
| Frontend | React 19, TypeScript, Vite |
| Styling | TailwindCSS, Vanilla CSS |
| 3D Rendering | skinview3d (Three.js / WebGL) |
| Icons | Lucide React |
| Server Ping | Custom Minecraft SLP over TCP (Rust) |

## License

This project is licensed under the **GNU General Public License v3.0**. See the [LICENSE](LICENSE) file for details.
