[CmdletBinding()]
param(
    [string]$WasmerPath,
    [string]$WebcPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolchainRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $toolchainRoot '..\..'))

if (-not $WasmerPath) {
    $WasmerPath = Join-Path $repositoryRoot '.tools\wasmer\v7.2.0\bin\wasmer.exe'
}
if (-not $WebcPath) {
    $WebcPath = Join-Path $repositoryRoot 'dist\mainly-c-clang-22.1.0-4.webc'
}

$env:WASMER_PATH = [System.IO.Path]::GetFullPath($WasmerPath)
$env:CLANG_WEBC = [System.IO.Path]::GetFullPath($WebcPath)

node (Join-Path $toolchainRoot 'tests\wasmer-cli-adapter.mjs')
if ($LASTEXITCODE -ne 0) {
    throw 'Clang 22 package verification failed'
}
