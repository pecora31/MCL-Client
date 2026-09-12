# Server Hub and Server Config

## Server Hub

The Overview tab keeps a list of saved servers. Each one is pinged in the background, every 60 seconds for the whole list, every 30 seconds for whichever server is currently selected, showing live ping and player count without opening the game.

Turning on **Connect on Play** for a server makes the next launch join that server's address automatically, instead of dropping you at the main menu.

## Server Config

Server Config, opened from the Server Info and Hub tab, edits the `server.properties` file of a server that already exists somewhere on disk. It is meant for a server you or a friend is running outside MCL entirely, such as a dedicated box or a friend's computer, not one MCL is hosting itself. Use the folder picker to point it at that server's directory once, and MCL remembers the handful of settings most groups actually need:

* **Online mode**, whether the server requires a real Microsoft account. Turn this off if everyone connecting uses an MCL offline account, otherwise nobody can join and you will see an "Invalid session" error.
* **PvP**, whether players can fight each other.
* **Whitelist**, whether only listed players may join.
* **Difficulty**
* **Max players**
* **MOTD**

Only these specific lines get rewritten, every other line and comment in `server.properties` is left exactly as it was.

If you want MCL to download, run, and manage the server itself instead of just editing an existing one, see [Hosting a Server Locally](hosting-a-server-locally.md) or [MCL Agent: Remote Hosting](mcl-agent-remote-hosting.md).
