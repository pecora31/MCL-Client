# Creating a Profile

A profile in MCL is one Minecraft install: a version, a mod loader, and its own mods, worlds, and settings, kept separate from every other profile.

## Choosing a loader

Five loaders are available:

* **Vanilla**, unmodified Minecraft. Note that custom skins do not sync to other players on a Vanilla profile, see [Skin Studio](skin-studio.md) for why.
* **Fabric**, the default selection, lightweight and widely supported by mods.
* **Forge**
* **NeoForge**
* **Quilt**

Picking a loader other than Vanilla shows a loader version dropdown once a Minecraft version is chosen.

## Choosing a version

The version list comes straight from Mojang's manifest. Only stable releases show by default, turn on **Show Snapshots** to pick a snapshot or pre release build instead.

## RAM allocation

Two values matter:

* **Min RAM**, defaults to 2048 MB.
* **Max RAM**, defaults to the value set in [Settings](settings.md), capped by how much memory your computer actually has.

Going above the recommended amount is allowed, MCL just warns that Windows and the game itself may not have enough memory left over.

## Java

MCL detects every Java installation on your computer and only offers the ones that satisfy the version's required Java major version, incompatible ones are shown disabled rather than hidden, so it is clear why they cannot be picked. If nothing compatible is installed, the launcher offers to download the right Java build automatically the first time you press Play, see the **Auto Download Java** setting.

## After creating a profile

The profile appears in the Instances list, where you can rename it, duplicate it, back up its worlds, open its folder directly, or delete it. To copy the setup to a friend, see [Sharing Profiles](sharing-profiles.md).
