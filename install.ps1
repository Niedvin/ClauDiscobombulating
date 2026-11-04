<#
.SYNOPSIS
  Installs the ClauDiscobombulating mod for Claude Code (user scope).
.DESCRIPTION
  One install serves both apps, the mod picks its mode by surface:
  console = full mod, Claude desktop = limits + cache timer under the prompt.
  Restart Claude Code / the desktop app afterwards.
  -Repo owner/name installs from a GitHub copy of this folder instead of the local one
  and turns on marketplace auto-update in settings.json (the old file is kept in .backups).
  Every other harness found on the PC (opencode, pi) gets its copy too.
#>
[CmdletBinding(SupportsShouldProcess)]
param([switch]$Uninstall, [string]$Repo)

$ErrorActionPreference = 'Stop'
$Root = $PSScriptRoot
# piped from GitHub there is no local folder, so the GitHub copy is the only source — 2026-10-06
if (-not $Root -and -not $Repo) { $Repo = 'Niedvin/ClauDiscobombulating' }
$Market = 'ClauDiscobombulating'
$Plugin = "ClauDiscobombulating@$Market"

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw 'claude CLI not found in PATH' }

function Invoke-Claude([string[]]$CliArgs) {
  Write-Host "> claude $($CliArgs -join ' ')"
  if ($PSCmdlet.ShouldProcess("claude $($CliArgs -join ' ')")) {
    & claude @CliArgs
    if ($LASTEXITCODE -ne 0) { throw "claude $($CliArgs -join ' ') failed ($LASTEXITCODE)" }
  }
}

$ConfigDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $HOME '.claude' }
$Settings = Join-Path $ConfigDir 'settings.json'

function Set-AutoUpdate([bool]$On, [string]$Source) {
  if (-not $PSCmdlet.ShouldProcess($Settings, "autoUpdate $(if ($On) { 'on' } else { 'off' })")) { return }
  $cfg = if (Test-Path $Settings) { Get-Content $Settings -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
  $known = $cfg.PSObject.Properties['extraKnownMarketplaces']
  if (-not $known -and -not $On) { return }
  if (Test-Path $Settings) {
    $bak = Join-Path $ConfigDir '.backups'
    New-Item -ItemType Directory -Force $bak | Out-Null
    $copy = Join-Path $bak "settings.json.$(Get-Date -Format 'yyyyMMdd-HHmmss')"
    Copy-Item $Settings $copy
    if ((Get-Item $copy).Length -eq 0) { throw "backup of $Settings is empty" }
  }
  if (-not $known) { $cfg | Add-Member -NotePropertyName extraKnownMarketplaces -NotePropertyValue ([pscustomobject]@{}); $known = $cfg.PSObject.Properties['extraKnownMarketplaces'] }
  $entries = $known.Value
  if ($On) {
    $entry = [pscustomobject]@{ source = [pscustomobject]@{ source = 'github'; repo = $Source }; autoUpdate = $true }
    $entries | Add-Member -NotePropertyName $Market -NotePropertyValue $entry -Force
    # a pre-rename key would keep auto-updating a marketplace that is gone — 2026-10-11
    $entries.PSObject.Properties.Remove('ClauDiscombobulating')
  } else {
    $entries.PSObject.Properties.Remove($Market)
    $entries.PSObject.Properties.Remove('ClauDiscombobulating')
  }
  New-Item -ItemType Directory -Force $ConfigDir | Out-Null
  $tmp = "$Settings.tmp"
  [IO.File]::WriteAllText($tmp, ($cfg | ConvertTo-Json -Depth 20), (New-Object Text.UTF8Encoding($false)))
  Move-Item $tmp $Settings -Force
}

$OcBase = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HOME '.config' }
$OcDir = Join-Path $OcBase 'opencode/plugins/claudiscobombulating'
$hasOpenCode = [bool](Get-Command opencode -ErrorAction SilentlyContinue) -or (Test-Path (Join-Path $OcBase 'opencode'))
$PiBase = if ($env:PI_CODING_AGENT_DIR) { $env:PI_CODING_AGENT_DIR } else { Join-Path $HOME '.pi/agent' }
$PiExtDir = Join-Path $PiBase 'extensions/claudiscobombulating'
$hasPi = [bool](Get-Command pi -ErrorAction SilentlyContinue) -or (Test-Path $PiBase)
# Command Code support was dropped in 3.0.2; its files go on every run — 2026-11-04
$CcFiles = @('claudiscobombulating.ts', 'claudiscobombulating.plugin.json', 'claudiscobombulating.package.json') | ForEach-Object { Join-Path $HOME ".commandcode/mods/$_" }

function Get-Source([string]$Probe) {
  # raw.githubusercontent.com serves a 5 min old copy after a push; the marketplace clone is fresh — 2026-10-11
  $m = (& claude plugin marketplace list --json 2>$null | ConvertFrom-Json) | Where-Object { $_.name -eq $Market }
  $src = @($m.installLocation, $m.path) | Where-Object { $_ -and (Test-Path (Join-Path $_ $Probe)) } | Select-Object -First 1
  if (-not $src -and -not $Repo) { $src = $Root }
  $src
}

function Copy-Part([string]$Src, [string]$From, [string]$To) {
  $tmp = "$To.tmp"
  if ($Src) { Copy-Item (Join-Path $Src $From) $tmp }
  else { Invoke-WebRequest "https://api.github.com/repos/$Repo/contents/$($From)?ref=main" -Headers @{ Accept = 'application/vnd.github.raw' } -OutFile $tmp -UseBasicParsing }
  if ((Get-Item $tmp).Length -eq 0) { throw "$From is empty" }
  Move-Item $tmp $To -Force
}

function Install-OpenCode {
  if (-not $PSCmdlet.ShouldProcess($OcDir, 'install opencode plugin')) { return }
  $src = Get-Source 'opencode/tui.tsx'
  New-Item -ItemType Directory -Force $OcDir | Out-Null
  Copy-Part $src 'opencode/tui.tsx' (Join-Path $OcDir 'tui.tsx')
  Copy-Part $src 'plugin/.claude-plugin/plugin.json' (Join-Path $OcDir 'plugin.json')
}

function Install-Pi {
  if (-not $PSCmdlet.ShouldProcess($PiExtDir, 'install pi extension')) { return }
  $src = Get-Source 'pi/index.ts'
  New-Item -ItemType Directory -Force $PiExtDir | Out-Null
  Copy-Part $src 'pi/index.ts' (Join-Path $PiExtDir 'index.ts')
}

$markets = (& claude plugin marketplace list --json 2>$null | ConvertFrom-Json)
$hasMarket = [bool]($markets | Where-Object { $_.name -eq $Market })
$plugins = (& claude plugin list --json 2>$null | ConvertFrom-Json)
$hasPlugin = [bool]($plugins | Where-Object { $_.id -eq $Plugin })
# the mod was called prompt-bar before the rename — 2026-10-06
$legacyPlugins = @('ClauDiscombobulating@ClauDiscombobulating', 'prompt-bar@prompt-bar-local', 'prompt-bar@prompt-bar') | Where-Object { $id = $_; $plugins | Where-Object { $_.id -eq $id } }
$legacyMarkets = @('ClauDiscombobulating', 'prompt-bar-local', 'prompt-bar') | Where-Object { $name = $_; $markets | Where-Object { $_.name -eq $name } }

if ($Uninstall) {
  if ($hasPlugin) { Invoke-Claude @('plugin', 'uninstall', $Plugin, '--scope', 'user') }
  if ($hasMarket) { Invoke-Claude @('plugin', 'marketplace', 'remove', $Market) }
  Set-AutoUpdate $false ''
  if ((Test-Path $OcDir) -and $PSCmdlet.ShouldProcess($OcDir, 'remove opencode plugin')) { Remove-Item -Recurse -Force $OcDir }
  if ((Test-Path $PiExtDir) -and $PSCmdlet.ShouldProcess($PiExtDir, 'remove pi extension')) { Remove-Item -Recurse -Force $PiExtDir }
  foreach ($p in $CcFiles) { if ((Test-Path $p) -and $PSCmdlet.ShouldProcess($p, 'remove Command Code mod')) { Remove-Item -Force $p } }
  if (-not $WhatIfPreference) { Write-Host 'ClauDiscobombulating removed.' }
  return
}

$hasLocal = $Root -and (Test-Path (Join-Path $Root 'plugin/.claude-plugin/plugin.json'))
if (-not $hasLocal -and -not $Repo) { throw "plugin folder missing in $Root" }
if ($hasLocal) { Invoke-Claude @('plugin', 'validate', (Join-Path $Root 'plugin')) }
foreach ($id in $legacyPlugins) { Invoke-Claude @('plugin', 'uninstall', $id, '--scope', 'user') }
foreach ($name in $legacyMarkets) { Invoke-Claude @('plugin', 'marketplace', 'remove', $name) }
if ($hasPlugin) { Invoke-Claude @('plugin', 'uninstall', $Plugin, '--scope', 'user') }
if ($hasMarket) { Invoke-Claude @('plugin', 'marketplace', 'remove', $Market) }
Invoke-Claude @('plugin', 'marketplace', 'add', $(if ($Repo) { $Repo } else { $Root }))
Invoke-Claude @('plugin', 'install', $Plugin, '--scope', 'user')
# a local-folder install has no remote to pull from — 2026-10-06
if ($Repo) { Set-AutoUpdate $true $Repo }
if ($hasOpenCode) { Install-OpenCode }
if ($hasPi) { Install-Pi }
foreach ($p in $CcFiles) { if ((Test-Path $p) -and $PSCmdlet.ShouldProcess($p, 'remove Command Code mod')) { Remove-Item -Force $p } }
if (-not $WhatIfPreference) {
  Write-Host 'ClauDiscobombulating installed. Restart Claude Code and the desktop app.'
  if ($hasOpenCode) { Write-Host "opencode plugin in $OcDir (reloads by itself)." }
  if ($hasPi) { Write-Host "pi extension in $PiExtDir. Restart pi." }
}


