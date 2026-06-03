#Requires -Version 5.1
<#
.SYNOPSIS
    Installs dependencies and starts the System Diagnostics Dashboard.

.DESCRIPTION
    This script:
      1. Locates npm automatically (searches PATH and common Node.js install dirs).
      2. Downloads and installs Node.js (LTS) silently if npm is not found.
      3. Installs dashboard npm dependencies (npm install).
      4. Launches the dashboard development server (npm run dev).

    The dashboard will be available at:
        Frontend : http://localhost:5000
        API      : http://localhost:3001

.NOTES
    Run with:  powershell -ExecutionPolicy Bypass -File install-and-run-dashboard.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Helpers ──────────────────────────────────────────────────────────────────

function Write-Step {
    param([string]$Message)
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-OK {
    param([string]$Message)
    Write-Host "    [OK] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "    [WARN] $Message" -ForegroundColor Yellow
}

function Write-Fail {
    param([string]$Message)
    Write-Host "    [ERROR] $Message" -ForegroundColor Red
}

# ── Step 1: Locate npm ───────────────────────────────────────────────────────

Write-Step "Searching for npm..."

$npmExe = $null

# 1a. Try PATH first (covers nvm, fnm, scoop, winget, etc.)
$inPath = Get-Command npm -ErrorAction SilentlyContinue
if ($inPath) {
    $npmExe = $inPath.Source
    Write-OK "Found npm in PATH: $npmExe"
}

# 1b. Search well-known Node.js installation directories
if (-not $npmExe) {
    $candidateDirs = @(
        "$env:ProgramFiles\nodejs",
        "${env:ProgramFiles(x86)}\nodejs",
        "$env:APPDATA\npm",
        "$env:LOCALAPPDATA\Programs\nodejs",
        "$env:LOCALAPPDATA\nvm",          # nvm-windows default
        "C:\nodejs",
        "C:\Program Files\nodejs"
    )

    foreach ($dir in $candidateDirs) {
        $candidate = Join-Path $dir 'npm.cmd'
        if (Test-Path $candidate) {
            $npmExe = $candidate
            Write-OK "Found npm at: $npmExe"

            # Add the directory to the current session PATH so child processes find node too
            $env:PATH = "$dir;$env:PATH"
            break
        }
    }
}

# ── Step 2: Install Node.js if npm was not found ─────────────────────────────

if (-not $npmExe) {
    Write-Warn "npm not found. Downloading and installing Node.js LTS..."

    # Resolve latest LTS version from the Node.js release index
    $indexUrl  = 'https://nodejs.org/dist/index.json'
    $installer = Join-Path $env:TEMP 'node-lts-installer.msi'

    try {
        Write-Step "Fetching Node.js release index from $indexUrl ..."
        $releases = Invoke-RestMethod -Uri $indexUrl -UseBasicParsing
        $lts      = $releases | Where-Object { $_.lts -and $_.lts -ne $false } | Select-Object -First 1

        if (-not $lts) {
            throw "Could not determine the latest LTS version from $indexUrl"
        }

        $version    = $lts.version          # e.g. "v20.14.0"
        $arch       = if ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }
        $msiUrl     = "https://nodejs.org/dist/$version/node-$version-$arch.msi"

        Write-Step "Downloading Node.js $version ($arch) from:`n    $msiUrl"
        Invoke-WebRequest -Uri $msiUrl -OutFile $installer -UseBasicParsing
        Write-OK "Download complete: $installer"
    }
    catch {
        Write-Fail "Failed to download Node.js: $_"
        Write-Host @"

    Please install Node.js manually from https://nodejs.org/
    After installation, re-run this script.
"@ -ForegroundColor Yellow
        exit 1
    }

    Write-Step "Installing Node.js silently (this may take a minute)..."
    $msiArgs = @('/i', $installer, '/quiet', '/norestart', 'ADDLOCAL=ALL')
    $proc    = Start-Process msiexec.exe -ArgumentList $msiArgs -Wait -PassThru

    Remove-Item $installer -Force -ErrorAction SilentlyContinue

    if ($proc.ExitCode -notin @(0, 3010)) {
        Write-Fail "Node.js installer exited with code $($proc.ExitCode)."
        exit 1
    }

    Write-OK "Node.js installed successfully."

    # Refresh PATH from the registry so npm is visible in this session
    $machinePath = [System.Environment]::GetEnvironmentVariable('PATH', 'Machine')
    $userPath    = [System.Environment]::GetEnvironmentVariable('PATH', 'User')
    $env:PATH    = "$machinePath;$userPath"

    $inPath = Get-Command npm -ErrorAction SilentlyContinue
    if ($inPath) {
        $npmExe = $inPath.Source
        Write-OK "npm is now available at: $npmExe"
    }
    else {
        Write-Fail "npm still not found after installation. Please open a new terminal and re-run this script."
        exit 1
    }
}

# ── Step 3: Verify Node.js + npm versions ────────────────────────────────────

Write-Step "Verifying Node.js and npm versions..."
try {
    $nodeVer = & node --version 2>&1
    $npmVer  = & npm  --version 2>&1
    Write-OK "Node.js : $nodeVer"
    Write-OK "npm     : $npmVer"
}
catch {
    Write-Fail "Could not verify Node.js/npm versions: $_"
    exit 1
}

# ── Step 4: Locate the dashboard directory ───────────────────────────────────

Write-Step "Locating the dashboard directory..."

# Resolve the script's own directory (works when dot-sourced or run directly)
$scriptDir    = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$dashboardDir = Join-Path $scriptDir 'dashboard'

if (-not (Test-Path (Join-Path $dashboardDir 'package.json'))) {
    Write-Fail "Dashboard directory not found at: $dashboardDir"
    Write-Host "    Make sure you run this script from the repository root." -ForegroundColor Yellow
    exit 1
}

Write-OK "Dashboard directory: $dashboardDir"

# ── Step 5: Install npm dependencies ─────────────────────────────────────────

Write-Step "Installing dashboard dependencies (npm install)..."
Push-Location $dashboardDir
try {
    & npm install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed (exit code $LASTEXITCODE)" }
    Write-OK "Dependencies installed."
}
catch {
    Write-Fail "npm install failed: $_"
    Pop-Location
    exit 1
}
Pop-Location

# ── Step 6: Start the dashboard ───────────────────────────────────────────────

Write-Step "Starting the dashboard (npm run dev)..."
Write-Host @"

    ┌─────────────────────────────────────────────┐
    │  System Diagnostics Dashboard               │
    │                                             │
    │  Frontend  →  http://localhost:5000         │
    │  API       →  http://localhost:3001         │
    │                                             │
    │  Press Ctrl+C to stop the server.           │
    └─────────────────────────────────────────────┘

"@ -ForegroundColor Cyan

Push-Location $dashboardDir
try {
    & npm run dev
}
finally {
    Pop-Location
}
