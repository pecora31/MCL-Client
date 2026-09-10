# Privacy

MCL Client has no accounts, no analytics, no ads and no crash reporting. It does not install
anything besides itself, the game, and the Java runtime the game needs.

This page lists every place the launcher connects to, and what it sends. If you find a
connection that is not listed here, that is a bug — please [open an issue](https://github.com/pecora31/MCL-Client/issues).

## What stays on your computer

- Your player name, profiles, servers, settings and skins.
- The secret token that proves a shared skin is yours. It is stored in the launcher's data
  folder and only ever sent to the MCL skin service.
- Game logs. They are shown in the launcher's console and never uploaded.

There is no password: MCL uses offline accounts, so nothing about you is checked against
Mojang or Microsoft.

## Where the launcher connects, and why

| Service | When | What it receives |
|---|---|---|
| Mojang (`piston-meta.mojang.com`, `resources.download.minecraft.net`) | Installing or updating a game version | Nothing but the file requests |
| Fabric, Quilt, Forge, NeoForge | Installing a mod loader | Nothing but the file requests |
| Adoptium (`api.adoptium.net`) | A game needs a Java version you don't have | Which Java version to download |
| Modrinth (`api.modrinth.com`) | Browsing or installing mods | Your search terms |
| CurseForge, through the MCL service | Browsing or installing CurseForge mods | Your search terms (the MCL service adds the API key and forwards them) |
| MCL skin service | See below | See below |
| GitHub (`github.com`) | Checking for launcher updates | Nothing but the file request |
| Google Fonts | Only when the language is Chinese, Japanese or Korean | Nothing but the font request |
| Minecraft servers you add | Showing their status in the server list | A standard server ping, the same one the game sends |
| Discord (the app on your computer, not the internet) | Only with "Discord status" turned on | The game and version you are playing |

Like any website, each of these can see your IP address when the launcher connects to it.

## The MCL skin service

This is the only service run by MCL itself. Its source code is public:
[pecora31/mcl-skin-service](https://github.com/pecora31/mcl-skin-service).

| Feature | What is sent | What is stored | For how long |
|---|---|---|---|
| Skin sharing (Settings → "Share my skin with other players") | Your player name and skin image | Your player name, the skin image, a hash of your token, when it was created and updated | Until you delete the skin in the launcher, or turn sharing off and play once |
| Name check while renaming | The name you are typing | Nothing | — |
| Profile share codes | The profile's name, game version, loader, RAM and which mods it uses (not the mod files) | That same list | 60 days |
| CurseForge browsing | Your search terms | Search results are cached for 15 minutes, with nothing linking them to you | 15 minutes |

To stop abuse, the service counts how many skins and share codes each network creates per
day. It does not keep your IP address for this — only a salted hash of it, which cannot be
turned back into the address and is deleted within two days.

With skin sharing turned off, the launcher sends nothing to the skin service when you play,
except once to remove a skin you shared earlier.

The service runs on Cloudflare, which, like any hosting provider, handles the network traffic
to it.
