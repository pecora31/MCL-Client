# Skin Studio

Skin Studio gives you a 3D, WebGL preview of your skin, supporting both the Classic and Slim model types, so you can see how it looks before jumping into a world.

## Syncing your skin to teammates

Multiplayer skin syncing works through CustomSkinLoader, a mod MCL installs automatically on any non Vanilla profile, and a small skin lookup service MCL runs. When you set a skin:

1. MCL saves it locally into CustomSkinLoader's own skin cache, so it applies immediately for you.
2. If the **Share My Skin** setting is on, MCL uploads the skin to its lookup service, keyed by your in game username.
3. Anyone else running MCL (or plain CustomSkinLoader configured the same way) resolves your skin by looking up that same username, so they see it without you doing anything else.

Turning **Share My Skin** off in [Settings](settings.md) removes any copy you previously published, keeping the skin local to your own game from then on.

## The Vanilla limitation

Custom skins do not sync on a Vanilla profile. CustomSkinLoader only gets installed on Fabric, Forge, NeoForge, and Quilt profiles, since it is itself a mod, so a Vanilla profile has no way to resolve anyone else's custom skin, or publish its own for others to see. This is a Minecraft limitation, not a bug, switch the profile to a mod loader if teammate skins matter to you.

## Username and skin lookups

Because the lookup service is keyed by username, and MCL accounts are offline (no Microsoft login required), two different players could in theory pick the same display name. MCL checks whether a name is already claimed while you type a rename, and warns you if so, letting you save anyway or pick a different name. This is a soft warning rather than a hard block, since a name collision only affects skin syncing for players who use it, not anything else.
