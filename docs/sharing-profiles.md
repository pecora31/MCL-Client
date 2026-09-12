# Sharing Profiles

If you want a friend to end up with the same mod loader, version, and mod list as one of your profiles, you do not need to zip anything up.

## Sharing

From the Instances list, choose **Share** on a profile. MCL builds a share code covering the profile's name, Minecraft version, loader and loader version, RAM settings, and the list of installed mods, resource packs, and other addons, each tagged with where it came from (Modrinth or CurseForge) so it can be re-downloaded on the other end. You can set the code to expire after a number of days.

Mods that MCL cannot match back to a known Modrinth or CurseForge listing are left out of the share and flagged separately, so you know if something will not carry over.

## Importing

On the receiving side, choose **Import Share Code**, paste it in, and MCL creates a new profile with the same settings, then downloads every addon in the list, showing progress per file as it goes. Nothing is transferred peer to peer, both sides pull from Modrinth or CurseForge directly.
