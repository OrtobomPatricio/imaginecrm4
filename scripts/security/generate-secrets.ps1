$scriptRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Split-Path -Parent $scriptRoot
Set-Location $repoRoot
& .\generate-secrets.ps1
