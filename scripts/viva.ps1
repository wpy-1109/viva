# Windows PowerShell launcher. Not executed on a Windows machine in this workspace.
Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
& node (Join-Path $PSScriptRoot "viva.mjs")
if (-not $?) { exit $LASTEXITCODE }
