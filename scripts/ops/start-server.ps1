Param(
    [switch]$Stop
)
$scriptRoot = Split-Path -Parent $PSScriptRoot
Set-Location $scriptRoot
if ($Stop) {
    & .\start-server.ps1 -Stop
} else {
    & .\start-server.ps1
}
