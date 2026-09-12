# MCL Agent: Remote Hosting

If you run a server on a real VPS instead of your own computer, MCL Agent lets you manage it from the same Host Server tab, start it, stop it, edit its settings, sync mods, and watch its console, without SSH.

The agent is a small standalone program (`mcl-agent`), separate from the desktop app, meant to run on the remote machine. It reuses the exact same server logic the desktop app uses locally, exposed over an HTTPS API.

## Security model

Every request needs a bearer token, generated the first time the agent runs. The API is served over HTTPS using a certificate the agent generates for itself, since there is no domain name or certificate authority involved. Because that certificate has no CA behind it, MCL does not use the usual browser style trust model, instead you paste the exact certificate into MCL once, the same way you paste in the token, and MCL only ever trusts that specific certificate for that host. This is called certificate pinning, and it is what stands in for a manual SSH tunnel or reverse proxy.

Treat the token and the certificate together as equivalent to an SSH key, anyone with both has full control over that server.

## Setting up the agent on a VPS

Build it directly on the VPS, most VPS providers run Linux:

```bash
curl https://sh.rustup.rs -sSf | sh
sudo apt install -y build-essential cmake
git clone https://github.com/pecora31/MCL-Client.git
cd MCL-Client/src-tauri
cargo build --release --bin mcl-agent --features agent
./target/release/mcl-agent
```

The first run prints three things you will need:

* The address it is listening on
* A bearer token
* The path to its certificate file (`agent-cert.pem`)

Open the port it prints (`8642` by default) in the VPS firewall and in your provider's security group if it has one, separately from the Minecraft server's own port (`25565` by default, also needs to be open for players to actually join). Java also needs to already be installed on the VPS, the agent finds and uses whatever is there, it does not download Java for you the way the desktop app does.

To keep the agent running after you close the SSH session, and to have it start again on reboot, run it as a systemd service rather than directly in a terminal. Ask in an issue or a discussion if you would like a ready made unit file.

## Adding the host in MCL

In the Host Server tab, set **Where** to **Add a remote host**, then fill in:

* A name for the host
* Its URL, in the form `https://<vps-address>:8642`
* The bearer token it printed
* The full contents of `agent-cert.pem`, open it with something like `cat agent-cert.pem` and copy everything including the `BEGIN CERTIFICATE` and `END CERTIFICATE` lines

From then on, preparing, starting, stopping, editing settings, and watching the console all work the same as [hosting locally](hosting-a-server-locally.md), just pointed at the remote machine instead.

## Syncing mods

After preparing a server on a remote host, MCL uploads whatever mod jars the selected profile has that the agent does not already have. Use the **Sync Mods to This Host** button any time you add mods to the profile afterward and want them on the server too. This only ever adds files, it does not remove mods from the server that you have since removed from the profile, remove those by hand if you want the server to match exactly.

## If the certificate changes

The agent's certificate is tied to the data directory it was generated in. If that directory is deleted or the agent is pointed at a new one, it generates a new certificate, and the one already saved in MCL for that host will no longer match. Remove the old host entry and add it again with the new certificate.
