# Getting Started

## For players

**Requirements:** Windows 10 or 11 (64 bit). Nothing else, the launcher downloads whatever Java version a profile needs on its own.

1. Go to the [Releases page](https://github.com/pecora31/MCL-Client/releases) and download the latest `.msi` or `.exe`.
2. Run the installer. No account, no sign in, no extra setup.
3. Open MCL Client and follow the short onboarding to pick a language and create your player profile.
4. Head to [Creating a Profile](creating-a-profile.md) to set up your first Minecraft install.

The launcher checks for updates on its own and never collects analytics. See [PRIVACY.md](https://github.com/pecora31/MCL-Client/blob/main/PRIVACY.md) for the exact list of network requests it makes.

## For developers

**Prerequisites**

| Tool | Version |
|------|---------|
| Node.js | 18 or newer |
| Rust and Cargo | 1.77 or newer |
| Java (optional, for testing) | 21 LTS |

Install Rust with [rustup.rs](https://rustup.rs/) if you do not already have it.

**Clone and run**

```bash
git clone https://github.com/pecora31/MCL-Client.git
cd MCL-Client
npm install
npm run tauri dev
```

To work on the UI only, without compiling the Rust backend:

```bash
npm run dev
```

Then open `http://localhost:5173`. Tauri commands are mocked in this mode so the app stays usable, see `src/services/api.ts` for what each mock returns.

**Build an installer**

```bash
npm run tauri build
```

The `.msi` and `.exe` land in `src-tauri/target/release/bundle/`.

**Project layout**

```
MCL/
├── src/                  # React frontend
│   ├── components/       # UI components, grouped by feature
│   ├── locales/          # i18n strings for all 8 languages
│   ├── services/         # Tauri command wrappers
│   └── types/            # Shared TypeScript types
├── src-tauri/            # Rust backend
│   ├── src/
│   │   ├── lib.rs        # Tauri command registration
│   │   ├── bin/          # The standalone MCL Agent binary
│   │   └── minecraft_core/  # Version, loader, and launch logic
│   └── tauri.conf.json
└── public/
```

See [Tech stack](https://github.com/pecora31/MCL-Client#tech-stack) in the README for the full list of libraries.
