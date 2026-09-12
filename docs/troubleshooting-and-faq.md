# Troubleshooting and FAQ

## "Failed to log in: Invalid session" when joining a server

The server has **online mode** turned on, which requires a real Microsoft account. MCL accounts are offline by default, so if everyone in your group is using an offline account, turn online mode off on the server, either through [Server Config](server-hub-and-server-config.md) if it is an existing server, or the settings panel in [Host Server](hosting-a-server-locally.md) if MCL is running it.

## My skin does not show up for anyone else

Check which loader the profile uses. Custom skins only sync on Fabric, Forge, NeoForge, and Quilt profiles, a Vanilla profile has no way to resolve or publish a custom skin at all, see [Skin Studio](skin-studio.md) for why. If the profile already uses one of those loaders, make sure **Share My Skin** is turned on in Settings.

## I can ping a server in MCL but cannot actually join

Pinging only needs the server to respond, joining needs authentication to succeed too, so this usually points back to the online mode issue above rather than a connectivity problem.

## Friends on the same network cannot connect to a server I am hosting

Check that the port shown in the Host Server tab, `25565` by default, is not blocked by Windows Firewall or your router. If you are connecting over something like Radmin VPN, use the address shown in the Radmin adapter, not the one MCL displays for local hosting.

## Which loaders can I host a server with?

Vanilla, Fabric, Quilt, Forge, and NeoForge, both [locally](hosting-a-server-locally.md) and through [MCL Agent](mcl-agent-remote-hosting.md).

## The MCL Agent will not start, something about a crypto provider

This means the build is missing its TLS backend. Rebuild with `cargo build --release --bin mcl-agent --features agent`, the `agent` feature pulls in everything the certificate and TLS handling needs.

## I lost the certificate or token for a remote host

Reading the agent's console output again will not show the token or certificate a second time by design in some setups, but both are saved to files in the agent's data directory (`agent-token.txt` and `agent-cert.pem`), open those directly on the VPS if you need to see them again.

## Where do I report a bug or ask something not covered here?

Open an [issue](https://github.com/pecora31/MCL-Client/issues) on the repository.
