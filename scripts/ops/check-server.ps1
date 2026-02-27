$scriptRoot = Split-Path -Parent $PSScriptRoot
Set-Location $scriptRoot
& .\check-server.ps1
