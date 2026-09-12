# MCL Agent: Remote Hosting

If you run a server on a real VPS instead of your own computer, MCL Agent lets you manage it from the same Host Server tab, start it, stop it, edit its settings, sync mods, and watch its console, without SSH.

The agent is a small standalone program (`mcl-agent`), separate from the desktop app, meant to run on the remote machine. It reuses the exact same server logic the desktop app uses locally, exposed over an HTTPS API.

## Security model

Every request needs a bearer token, generated the first time the agent runs. The API is served over HTTPS using a certificate the agent generates for itself, since there is no domain name or certificate authority involved. Because that certificate has no CA behind it, MCL does not use the usual browser style trust model, instead you paste the exact certificate into MCL once, the same way you paste in the token, and MCL only ever trusts that specific certificate for that host. This is called certificate pinning, and it is what stands in for a manual SSH tunnel or reverse proxy.

Treat the token and the certificate together as equivalent to an SSH key, anyone with both has full control over that server.

## Setting up the agent on a VPS

Most VPS providers run Linux, so the quickest path is the install script, which downloads a prebuilt binary (no Rust toolchain needed) and sets it up as a systemd service that starts on boot:

```bash
curl -fsSL https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.sh | sudo bash
```

This only works on x86_64 Linux for now, the prebuilt binary is published from every tagged release. When it finishes, it prints the URL, bearer token, and certificate you need for the next step.

To change the port or data directory it uses, set the matching environment variable before running it:

```bash
sudo MCL_AGENT_DIR=/opt/mcl-agent MCL_AGENT_PORT=9000 bash -c "$(curl -fsSL https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.sh)"
```

Open the port it uses (`8642` by default) in the VPS firewall and in your provider's security group if it has one, separately from the Minecraft server's own port (`25565` by default, also needs to be open for players to actually join). Java also needs to already be installed on the VPS, the agent finds and uses whatever is there, it does not download Java for you the way the desktop app does.

### Building from source instead

If you are on a different architecture, or want to build it yourself:

```bash
curl https://sh.rustup.rs -sSf | sh
sudo apt install -y build-essential cmake
git clone https://github.com/pecora31/MCL-Client.git
cd MCL-Client/src-tauri
cargo build --release --bin mcl-agent --features agent
./target/release/mcl-agent
```

The first run prints the same three things either way:

* The address it is listening on
* A bearer token
* The path to its certificate file (`agent-cert.pem`)

If you run it directly like this instead of through the install script, it stops the moment you close the SSH session, and won't come back after a reboot, wrap it in a systemd service yourself to keep it running (the install script's own unit file is a good starting point, see `/etc/systemd/system/mcl-agent.service` on a machine where you already ran it).

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
