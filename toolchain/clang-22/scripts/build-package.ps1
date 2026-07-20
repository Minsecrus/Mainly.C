[CmdletBinding()]
param(
    [string]$WasmerPath,
    [string]$OutputPath,
    [switch]$SkipPrepare
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolchainRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $toolchainRoot '..\..'))
$packageRoot = Join-Path $toolchainRoot 'package'

if (-not $WasmerPath) {
    $WasmerPath = Join-Path $repositoryRoot '.tools\wasmer\v7.2.0\bin\wasmer.exe'
}
$WasmerPath = [System.IO.Path]::GetFullPath($WasmerPath)

if (-not $OutputPath) {
    $OutputPath = Join-Path $repositoryRoot 'dist\mainly-c-clang-22.1.0-1.webc'
}
$OutputPath = [System.IO.Path]::GetFullPath($OutputPath)

if (-not (Test-Path -LiteralPath $WasmerPath)) {
    throw "Wasmer CLI not found: $WasmerPath"
}

if (-not $SkipPrepare) {
    & (Join-Path $PSScriptRoot 'prepare-package.ps1') -WasmerPath $WasmerPath
}

$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

if (Test-Path -LiteralPath $OutputPath) {
    Remove-Item -LiteralPath $OutputPath
}
if (Test-Path -LiteralPath "$OutputPath.sha256") {
    Remove-Item -LiteralPath "$OutputPath.sha256"
}

& $WasmerPath package build $packageRoot --check
if ($LASTEXITCODE -ne 0) {
    throw 'Wasmer rejected the package manifest'
}

& $WasmerPath package build $packageRoot --out $OutputPath
if ($LASTEXITCODE -ne 0) {
    throw 'Wasmer failed to build the WebC package'
}

$webcHash = (Get-FileHash -LiteralPath $OutputPath -Algorithm SHA256).Hash.ToLowerInvariant()
"$webcHash  $([System.IO.Path]::GetFileName($OutputPath))" |
    Set-Content -LiteralPath "$OutputPath.sha256" -Encoding ascii

$output = Get-Item -LiteralPath $OutputPath
[pscustomobject]@{
    Package = $output.FullName
    Bytes = $output.Length
    Sha256 = $webcHash
} | Format-List
