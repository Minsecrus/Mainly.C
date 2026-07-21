[CmdletBinding()]
param(
    [string]$SourceArchive,
    [string]$WasixCompatArchive,
    [string]$WasmerPath,
    [string]$LlvmRoot,
    [string]$CMakePath,
    [string]$NinjaPath,
    [string]$LibcxxSourceRoot,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolchainRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $toolchainRoot '..\..'))
$packageRoot = Join-Path $toolchainRoot 'package'
$cacheRoot = Join-Path $repositoryRoot '.cache\clang-22'
$archiveUrl = 'https://registry.npmjs.org/@yowasp/clang/-/clang-22.0.0-git20542-10.tgz'
$archiveSha256 = '6230ea1afa9691fa065935cf68c01642ff9b31c183fe8ac64cdfda025df06009'
$wasixCompatSpec = 'clang/clang@0.160000.1'
$wasixCompatSha256 = 'c127b7bfc0041d02c94045f40be7fb4b3eeb98cede25fad96261b7b90a82f405'
$wasixCompatArchivePath = if ($WasixCompatArchive) {
    [System.IO.Path]::GetFullPath($WasixCompatArchive)
} else {
    Join-Path $cacheRoot 'wasmer-clang-0.160000.1.webc'
}
$wasixCompatExtractRoot = Join-Path $cacheRoot 'wasmer-clang-0.160000.1-unpacked'
$archivePath = if ($SourceArchive) {
    [System.IO.Path]::GetFullPath($SourceArchive)
} else {
    Join-Path $cacheRoot 'yowasp-clang-22.0.0-git20542-10.tgz'
}

if (-not $WasmerPath) {
    $WasmerPath = Join-Path $repositoryRoot '.tools\wasmer\v7.2.0\bin\wasmer.exe'
}
$WasmerPath = [System.IO.Path]::GetFullPath($WasmerPath)

New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
New-Item -ItemType Directory -Path $packageRoot -Force | Out-Null

function Invoke-PinnedDownload {
    param(
        [Parameter(Mandatory)]
        [string]$Uri,
        [Parameter(Mandatory)]
        [string]$Path,
        [Parameter(Mandatory)]
        [string]$ExpectedSha256
    )

    $partialPath = "$Path.partial"
    try {
        for ($attempt = 1; $attempt -le 5; $attempt++) {
            try {
                Invoke-WebRequest -Uri $Uri -OutFile $partialPath
                break
            } catch {
                if ($attempt -eq 5) {
                    throw
                }
                $retryDelaySeconds = [Math]::Min(5 * $attempt, 20)
                Write-Warning "Download attempt $attempt failed for $Uri; retrying in $retryDelaySeconds seconds"
                Start-Sleep -Seconds $retryDelaySeconds
            }
        }

        $actualSha256 = (Get-FileHash -LiteralPath $partialPath -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actualSha256 -ne $ExpectedSha256) {
            throw "Downloaded file checksum mismatch for $Uri. Expected $ExpectedSha256, got $actualSha256"
        }
        Move-Item -LiteralPath $partialPath -Destination $Path -Force
    } finally {
        Remove-Item -LiteralPath $partialPath -Force -ErrorAction SilentlyContinue
    }
}

if (-not $SourceArchive -and -not (Test-Path -LiteralPath $archivePath)) {
    $partialPath = "$archivePath.partial"
    Invoke-WebRequest -Uri $archiveUrl -OutFile $partialPath
    Move-Item -LiteralPath $partialPath -Destination $archivePath
}

if (-not (Test-Path -LiteralPath $archivePath)) {
    throw "Clang archive not found: $archivePath"
}

$actualArchiveHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualArchiveHash -ne $archiveSha256) {
    throw "Clang archive checksum mismatch. Expected $archiveSha256, got $actualArchiveHash"
}

if (-not $WasixCompatArchive -and -not (Test-Path -LiteralPath $wasixCompatArchivePath)) {
    if (-not (Test-Path -LiteralPath $WasmerPath)) {
        throw "Wasmer CLI is required to download the compatibility sysroot: $WasmerPath"
    }
    $partialPath = "$wasixCompatArchivePath.partial"
    & $WasmerPath package download --validate -o $partialPath $wasixCompatSpec
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to download $wasixCompatSpec"
    }
    Move-Item -LiteralPath $partialPath -Destination $wasixCompatArchivePath
}
if (-not (Test-Path -LiteralPath $wasixCompatArchivePath)) {
    throw "WASIX compatibility package not found: $wasixCompatArchivePath"
}
$actualWasixCompatHash = (Get-FileHash -LiteralPath $wasixCompatArchivePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualWasixCompatHash -ne $wasixCompatSha256) {
    throw "WASIX compatibility package checksum mismatch. Expected $wasixCompatSha256, got $actualWasixCompatHash"
}

$extractRoot = Join-Path $cacheRoot 'npm-package'
if ($Force -and (Test-Path -LiteralPath $extractRoot)) {
    Remove-Item -LiteralPath $extractRoot -Recurse
}

if (-not (Test-Path -LiteralPath (Join-Path $extractRoot 'package\gen\llvm.core.wasm'))) {
    New-Item -ItemType Directory -Path $extractRoot -Force | Out-Null
    tar -xzf $archivePath -C $extractRoot `
        'package/gen/llvm.core.wasm' `
        'package/gen/llvm-resources.tar'
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to extract $archivePath"
    }
}

$compatSysrootSource = Join-Path $wasixCompatExtractRoot 'sysroot32'
$compatBuiltinsSource = Join-Path $wasixCompatExtractRoot 'lib-small\clang\16\lib\wasi\libclang_rt.builtins-wasm32.a'
if ($Force -and (Test-Path -LiteralPath $wasixCompatExtractRoot)) {
    Remove-Item -LiteralPath $wasixCompatExtractRoot -Recurse
}
if (-not (Test-Path -LiteralPath $compatSysrootSource) -or
    -not (Test-Path -LiteralPath $compatBuiltinsSource)) {
    if (-not (Test-Path -LiteralPath $WasmerPath)) {
        throw "Wasmer CLI is required to unpack the compatibility sysroot: $WasmerPath"
    }
    if (Test-Path -LiteralPath $wasixCompatExtractRoot) {
        Remove-Item -LiteralPath $wasixCompatExtractRoot -Recurse
    }
    & $WasmerPath package unpack -f webc -o $wasixCompatExtractRoot $wasixCompatArchivePath
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to unpack $wasixCompatArchivePath"
    }
}

$binRoot = Join-Path $packageRoot 'bin'
$sysroot = Join-Path $packageRoot 'sysroot'
$wasixSysroot = Join-Path $packageRoot 'wasix-compat-sysroot'
$legacyWasixSysroot = Join-Path $packageRoot 'wasix-sysroot'

if (Test-Path -LiteralPath $binRoot) {
    Remove-Item -LiteralPath $binRoot -Recurse
}
if (Test-Path -LiteralPath $sysroot) {
    Remove-Item -LiteralPath $sysroot -Recurse
}
if (Test-Path -LiteralPath $wasixSysroot) {
    Remove-Item -LiteralPath $wasixSysroot -Recurse
}
if (Test-Path -LiteralPath $legacyWasixSysroot) {
    Remove-Item -LiteralPath $legacyWasixSysroot -Recurse
}

New-Item -ItemType Directory -Path $binRoot -Force | Out-Null
New-Item -ItemType Directory -Path $sysroot -Force | Out-Null
New-Item -ItemType Directory -Path $wasixSysroot -Force | Out-Null

Copy-Item -LiteralPath (Join-Path $extractRoot 'package\gen\llvm.core.wasm') `
    -Destination (Join-Path $binRoot 'llvm.wasm')

tar -xf (Join-Path $extractRoot 'package\gen\llvm-resources.tar') -C $sysroot
if ($LASTEXITCODE -ne 0) {
    throw 'Unable to extract the Clang sysroot'
}

Copy-Item -Path (Join-Path $compatSysrootSource '*') -Destination $wasixSysroot -Recurse

$wasixBuiltins = Join-Path $wasixSysroot 'lib\wasm32-wasi\libclang_rt.builtins-wasm32.a'
Copy-Item -LiteralPath $compatBuiltinsSource -Destination $wasixBuiltins

# Clang 22 diagnoses the legacy wasm32-wasi target spelling when -Werror is
# enabled. WASIX still publishes its libraries under that legacy directory,
# so expose the same compatible archives under Clang's wasm32-wasip1 lookup
# path as part of our locally assembled package.
$wasixWasip1Lib = Join-Path $wasixSysroot 'lib\wasm32-wasip1'
New-Item -ItemType Directory -Path $wasixWasip1Lib -Force | Out-Null
Copy-Item `
    -Path (Join-Path $wasixSysroot 'lib\wasm32-wasi\*') `
    -Destination $wasixWasip1Lib `
    -Recurse `
    -Force

# Clang locates compiler-rt relative to its resource directory rather than the
# selected sysroot. Add the WASIX-flavoured builtins under the resource path it
# derives for the wasm32-unknown-wasi triple.
$wasixResourceLib = Join-Path $sysroot 'lib\wasm32-unknown-wasi'
New-Item -ItemType Directory -Path $wasixResourceLib -Force | Out-Null
Copy-Item `
    -LiteralPath $wasixBuiltins `
    -Destination (Join-Path $wasixResourceLib 'libclang_rt.builtins.a')
$wasixWasip1ResourceLib = Join-Path $sysroot 'lib\wasm32-unknown-wasip1'
New-Item -ItemType Directory -Path $wasixWasip1ResourceLib -Force | Out-Null
Copy-Item `
    -LiteralPath $wasixBuiltins `
    -Destination (Join-Path $wasixWasip1ResourceLib 'libclang_rt.builtins.a')

$licenseDownloads = @(
    @{
        Uri = 'https://codeberg.org/YoWASP/llvm-project/raw/commit/9560ae0f2cc440e4fc891fddbc119da6f56daa59/LICENSE.TXT'
        Path = Join-Path $packageRoot 'LICENSE-LLVM.txt'
        Sha256 = '8d85c1057d742e597985c7d4e6320b015a9139385cff4cbae06ffc0ebe89afee'
    },
    @{
        Uri = 'https://raw.githubusercontent.com/WebAssembly/wasi-libc/2fc32bc81b9f07f8d9525edea59bfbaf760c06d6/LICENSE'
        Path = Join-Path $packageRoot 'LICENSE-WASI-LIBC.txt'
        Sha256 = '2711a8b5a5cdfef0e639f96c1aca12ae23d7d64a02d0507f1bdf14d2b27bbc3a'
    },
    @{
        Uri = 'https://codeberg.org/YoWASP/clang/raw/commit/409b7dfdbd5ed12545eed706808fd423f1f692c6/LICENSE.txt'
        Path = Join-Path $packageRoot 'LICENSE-YOWASP.txt'
        Sha256 = '65c6633c2c9effa87f95bfe794d5da07bd3faab2814e4a0a15883e28ec4e543f'
    },
    @{
        Uri = 'https://raw.githubusercontent.com/wasix-org/wasix-libc/09503b230e8acc721c1e013ca28a41bf149e4ee2/LICENSE'
        Path = Join-Path $packageRoot 'LICENSE-WASIX-LIBC.txt'
        Sha256 = 'da1128117561950db9e04201ce9ac3f0bd9e3baf852289211608b73098d51ac0'
    }
)

foreach ($license in $licenseDownloads) {
    if (-not (Test-Path -LiteralPath $license.Path)) {
        Invoke-PinnedDownload `
            -Uri $license.Uri `
            -Path $license.Path `
            -ExpectedSha256 $license.Sha256
    }
    $actualLicenseSha256 = (Get-FileHash -LiteralPath $license.Path -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($actualLicenseSha256 -ne $license.Sha256) {
        throw "Pinned license checksum mismatch for $($license.Path). Expected $($license.Sha256), got $actualLicenseSha256"
    }
}

$libcBuildArguments = @{
    SysrootPath = $wasixSysroot
}
if ($LlvmRoot) {
    $libcBuildArguments.LlvmRoot = $LlvmRoot
}
if ($Force) {
    $libcBuildArguments.Force = $true
}
& (Join-Path $PSScriptRoot 'build-wasix-libc.ps1') @libcBuildArguments

$libcxxBuildArguments = @{
    SysrootPath = $wasixSysroot
}
if ($LlvmRoot) {
    $libcxxBuildArguments.LlvmRoot = $LlvmRoot
}
if ($CMakePath) {
    $libcxxBuildArguments.CMakePath = $CMakePath
}
if ($NinjaPath) {
    $libcxxBuildArguments.NinjaPath = $NinjaPath
}
if ($LibcxxSourceRoot) {
    $libcxxBuildArguments.SourceRoot = $LibcxxSourceRoot
}
if ($Force) {
    $libcxxBuildArguments.Force = $true
}
& (Join-Path $PSScriptRoot 'build-wasix-libcxx.ps1') @libcxxBuildArguments

$requiredFiles = @(
    (Join-Path $binRoot 'llvm.wasm'),
    (Join-Path $sysroot 'include\wasm32-wasip1\stdio.h'),
    (Join-Path $sysroot 'lib\wasm32-wasip1\crt1-command.o'),
    (Join-Path $sysroot 'lib\wasm32-wasip1\libc.a'),
    (Join-Path $sysroot 'lib\wasm32-unknown-wasip1\libclang_rt.builtins.a'),
    (Join-Path $wasixSysroot 'include\stdio.h'),
    (Join-Path $wasixSysroot 'include\sys\statvfs.h'),
    (Join-Path $wasixSysroot 'lib\wasm32-wasi\crt1.o'),
    (Join-Path $wasixSysroot 'lib\wasm32-wasi\libc.a'),
    (Join-Path $wasixSysroot 'lib\wasm32-wasi\libc.imports'),
    (Join-Path $wasixWasip1Lib 'crt1.o'),
    (Join-Path $wasixWasip1Lib 'libc.a'),
    (Join-Path $wasixWasip1Lib 'libm.a'),
    (Join-Path $wasixWasip1Lib 'libpthread.a'),
    (Join-Path $wasixSysroot 'include\c++\v1\print'),
    (Join-Path $wasixSysroot 'include\c++\v1\filesystem'),
    (Join-Path $wasixSysroot 'include\c++\v1\__config_site'),
    (Join-Path $wasixSysroot 'lib\wasm32-wasi\libc++.a'),
    (Join-Path $wasixSysroot 'lib\wasm32-wasi\libc++abi.a'),
    (Join-Path $wasixWasip1Lib 'libc++.a'),
    (Join-Path $wasixWasip1Lib 'libc++abi.a'),
    (Join-Path $wasixSysroot 'LIBC-BUILD.json'),
    (Join-Path $wasixSysroot 'LIBCXX-BUILD.json'),
    $wasixBuiltins,
    (Join-Path $wasixResourceLib 'libclang_rt.builtins.a'),
    (Join-Path $wasixWasip1ResourceLib 'libclang_rt.builtins.a')
)

foreach ($requiredFile in $requiredFiles) {
    if (-not (Test-Path -LiteralPath $requiredFile)) {
        throw "Required toolchain file is missing: $requiredFile"
    }
}

$hashLines = foreach ($requiredFile in $requiredFiles) {
    $relativePath = [System.IO.Path]::GetRelativePath($packageRoot, $requiredFile).Replace('\', '/')
    $hash = (Get-FileHash -LiteralPath $requiredFile -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $relativePath"
}
$hashLines | Set-Content -LiteralPath (Join-Path $packageRoot 'ARTIFACTS.sha256') -Encoding utf8NoBOM

$module = Get-Item -LiteralPath (Join-Path $binRoot 'llvm.wasm')
$sysrootBytes = (Get-ChildItem -LiteralPath $sysroot -File -Recurse | Measure-Object -Property Length -Sum).Sum
$wasixSysrootBytes = (Get-ChildItem -LiteralPath $wasixSysroot -File -Recurse | Measure-Object -Property Length -Sum).Sum

[pscustomobject]@{
    Compiler = 'Clang 22.1.0'
    ModuleBytes = $module.Length
    SysrootBytes = $sysrootBytes
    WasixSysrootBytes = $wasixSysrootBytes
    PackageRoot = $packageRoot
    ArchiveSha256 = $actualArchiveHash
    WasixCompatArchiveSha256 = $actualWasixCompatHash
} | Format-List
