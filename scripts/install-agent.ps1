#Requires -RunAsAdministrator
<#
Installs mcl-agent as a Windows Service: downloads the prebuilt binary from the latest MCL
Client release, no Rust toolchain or build step needed.

Usage (from an elevated PowerShell prompt):
    irm https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.ps1 | iex

Override the data directory or port first if the defaults don't suit:
    $env:MCL_AGENT_DIR = "D:\mcl-agent"
    $env:MCL_AGENT_PORT = "9000"
    irm https://raw.githubusercontent.com/pecora31/MCL-Client/main/scripts/install-agent.ps1 | iex
#>

$ErrorActionPreference = "Stop"

$Repo = "pecora31/MCL-Client"
$DataDir = if ($env:MCL_AGENT_DIR) { $env:MCL_AGENT_DIR } else { "$env:ProgramData\MCLAgent" }
$Port = if ($env:MCL_AGENT_PORT) { $env:MCL_AGENT_PORT } else { "8642" }
$Bind = if ($env:MCL_AGENT_BIND) { $env:MCL_AGENT_BIND } else { "0.0.0.0" }
$InstallDir = "$env:ProgramFiles\MCLAgent"
$ExePath = "$InstallDir\mcl-agent.exe"
$ServiceName = "MCLAgent"

New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

Write-Host "Downloading the latest mcl-agent build..."
Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest/download/mcl-agent-windows-x86_64.exe" -OutFile $ExePath

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Host "Stopping and removing the existing $ServiceName service..."
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 1
}

Write-Host "Registering the Windows Service..."
# Baked into the service's own command line rather than machine environment variables: the
# Service Control Manager only reads the environment it itself started with, so a variable
# set here would not reliably reach the service process even on its very next start.
$binPath = "`"$ExePath`" --service --dir `"$DataDir`" --port $Port --bind $Bind"
sc.exe create $ServiceName binPath= $binPath start= auto DisplayName= "MCL Agent" | Out-Null
sc.exe description $ServiceName "Lets MCL Client manage a Minecraft server on this computer from another machine, over its certificate-pinned HTTPS API." | Out-Null

sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/5000/restart/5000 | Out-Null

Write-Host "Starting the service..."
Start-Service -Name $ServiceName

Write-Host "Waiting for the agent to generate its token and certificate..."
$tokenPath = Join-Path $DataDir "agent-token.txt"
$certPath = Join-Path $DataDir "agent-cert.pem"
$ready = $false
for ($i = 0; $i -lt 20; $i++) {
    if ((Test-Path $tokenPath) -and (Test-Path $certPath)) {
        $ready = $true
        break
    }
    Start-Sleep -Milliseconds 500
}

if (-not $ready) {
    Write-Error "The agent did not start in time. Check its status with: Get-Service $ServiceName"
    exit 1
}

$publicIp = try { (Invoke-RestMethod -Uri "https://ifconfig.me" -TimeoutSec 3) } catch { "<this-computer-ip>" }

Write-Host ""
Write-Host "mcl-agent is installed and running as a Windows Service ($ServiceName)."
Write-Host ""
Write-Host "Paste these into MCL when adding this host:"
Write-Host ""
Write-Host "URL:   https://${publicIp}:${Port}"
Write-Host "Token: $(Get-Content $tokenPath -Raw)"
Write-Host ""
Write-Host "Certificate ($certPath):"
Write-Host ""
Get-Content $certPath -Raw
Write-Host ""
Write-Host "Open port $Port in Windows Firewall (and your router if reaching this over the internet),"
Write-Host "separately from Minecraft's own port (25565 by default)."
