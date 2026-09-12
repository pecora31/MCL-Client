# Mod Manager

The Mods tab browses two sources at once, Modrinth and CurseForge, each with its own checkbox so you can turn either off if you only want results from one.

## Content types

Besides mods, the same browser covers resource packs, data packs, shader packs, modpacks, and plugins, filtered by tab.

## Installing something

Pick an item for the active profile and MCL downloads it straight into that profile's folder. If a download is not available on Modrinth, MCL automatically tries CurseForge next rather than failing outright.

## Installing a modpack

Drop a `.mrpack` file onto the Mods tab, or use the file picker, and MCL reads the pack's manifest, creates a new profile matching its loader and version, and downloads every listed file with a progress bar per item.

## Conflict warnings

MCL reads what each mod itself declares about compatibility, in its Fabric or Quilt JSON metadata, or its Forge or NeoForge TOML metadata, rather than guessing from file contents. Three kinds of warnings can show up:

* **Breaks**, a mod explicitly states it crashes alongside another installed mod.
* **Conflicts**, a softer, declared incompatibility that does not necessarily crash.
* **Missing**, a required dependency is not installed.

These are read from what mod authors actually publish, so a warning only appears when the mods themselves say so, and the absence of a warning is not a guarantee two mods work perfectly together.

## Managing installed mods

The mods already in a profile are listed with a toggle to enable or disable each one without deleting it, plus its version and file size. Removing one from the list deletes the file.
