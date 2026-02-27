Param(
    [switch]$FixOnly,
    [switch]$Stop
)
$scriptRoot = Split-Path -Parent $PSScriptRoot
Set-Location $scriptRoot
if ($FixOnly -and $Stop) {
    & .\START-CRM.ps1 -FixOnly -Stop
} elseif ($FixOnly) {
    & .\START-CRM.ps1 -FixOnly
} elseif ($Stop) {
    & .\START-CRM.ps1 -Stop
} else {
    & .\START-CRM.ps1
}
