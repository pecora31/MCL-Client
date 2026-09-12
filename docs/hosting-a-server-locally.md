# Hosting a Server Locally

The Host Server tab, its own entry in the sidebar, runs a dedicated server for one of your profiles on your own computer, so you and your friends can join it, without opening a terminal or downloading anything by hand.

## Setting one up

1. Open the Host Server tab and pick which profile to host, then leave **Where** set to **This Computer**.
2. Accept the Minecraft EULA, this is required before any server jar will start.
3. Press **Download and Prepare**. MCL downloads a dedicated server jar matching the profile's loader and Minecraft version directly into that profile's own `server` folder, so there is no folder to point at, MCL already knows where it lives.
4. Once prepared, press **Start**. Server output streams live into the console panel in the tab.

Supported loaders are Vanilla, Fabric, Quilt, Forge, and NeoForge. Forge and NeoForge work by running their own official installer in server mode, the same tool the client side install uses, and launching Java against the run script it generates.

## Settings and joining

The same handful of settings from [Server Config](server-hub-and-server-config.md) (online mode, PvP, whitelist, difficulty, max players, MOTD) appear right in the tab once a server is prepared, already pointed at the right folder. Turn off **Online Mode** if everyone joining uses an MCL offline account.

While the server is running, the tab shows the address to join, `localhost:25565` by default, with a copy button. Anyone on the same network or reachable through something like Radmin VPN can join at your computer's local address on the same port.

## Status and the console

The status dot next to Start/Stop reflects what the server is actually doing:

* **Stopped**, grey, nothing running.
* **Starting**, amber, the process has launched but the world has not finished loading yet.
* **Running**, green, ready for players.
* **Crashed**, red, the server exited on its own rather than being stopped, check the console for why.

The console panel is not read only, type a command into the box underneath it (`op <player>`, `whitelist add <player>`, `say hello`, anything you would normally type at the server's own terminal) and press Send. Typing `stop` there works exactly like pressing the Stop button, and still lets the server save the world before it exits.

## Mods

Mods already installed in the profile are copied into the server automatically when you prepare it. Mods marked client only are not a problem, every current loader already skips them when running as a server, they just will not do anything there.
