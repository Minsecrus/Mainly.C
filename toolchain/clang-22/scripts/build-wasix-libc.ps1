[CmdletBinding()]
param(
    [string]$LlvmRoot,
    [string]$MakePath,
    [string]$SourceRoot,
    [string]$BuildRoot,
    [string]$InstallRoot,
    [string]$SysrootPath,
    [int]$Jobs = [Math]::Min(4, [Math]::Max(1, [Environment]::ProcessorCount)),
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolchainRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $toolchainRoot '..\..'))
$wasixLibcVersion = 'v2026-07-03.1'
$wasixLibcCommit = '09503b230e8acc721c1e013ca28a41bf149e4ee2'
$wasiHeadersCommit = 'bac366c8aeb69cacfea6c4c04a503191bf1cede1'
$wasixHeadersCommit = '0dfbd35a0f30f3fe7fd3b3ab5a50dc4191d5caed'
$llvmVersion = '22.1.0'
$llvmInstallerName = 'LLVM-22.1.0-win64.exe'
$llvmInstallerUrl = 'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.0/LLVM-22.1.0-win64.exe'
$llvmInstallerSha256 = 'b31d5f54942e017cb878e594529723dd629cc7b54c9bf7a331e2dc01e8ea5e75'
$makeVersion = '4.4.1'
$makeUrl = 'https://raw.githubusercontent.com/mbuilov/gnumake-windows/master/gnumake-4.4.1-x64.exe'
$makeSha256 = '368df1dcb3d768cda767809c21e4084c3398c9c9817f5819a8851e95782b44a5'
$extraCFlags = '-O2 -DNDEBUG -matomics -mbulk-memory -mmutable-globals -ftls-model=local-exec -D_WASI_EMULATED_MMAN -D_WASI_EMULATED_PROCESS_CLOCKS -Wno-deprecated'
$compatibilityPatchPath = Join-Path $toolchainRoot 'patches\wasix-libc-browser-sdk08.patch'
if (-not (Test-Path -LiteralPath $compatibilityPatchPath)) {
    throw "WASIX libc compatibility patch is missing: $compatibilityPatchPath"
}
$compatibilityPatchSha256 =
    (Get-FileHash -LiteralPath $compatibilityPatchPath -Algorithm SHA256).Hash.ToLowerInvariant()

function Resolve-TaskPath([string]$Value, [string]$DefaultValue) {
    $candidate = if ($Value) { $Value } else { $DefaultValue }
    if ([System.IO.Path]::IsPathRooted($candidate)) {
        return [System.IO.Path]::GetFullPath($candidate)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $candidate))
}

function Assert-WorkspacePath([string]$Path, [string]$Description) {
    $relativePath = [System.IO.Path]::GetRelativePath($repositoryRoot, $Path)
    if ($relativePath -eq '..' -or $relativePath.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")) {
        throw "$Description must stay inside the repository workspace: $Path"
    }
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$FailureMessage) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)"
    }
}

function Get-ExternalSymbols([string]$NmPath, [string[]]$Arguments) {
    $output = & $NmPath @Arguments 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw 'llvm-nm failed while validating the rebuilt WASIX libc'
    }

    $symbols = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::Ordinal)
    foreach ($line in $output) {
        if ($line -match '\s[A-Z]\s+([^\s]+)$') {
            [void]$symbols.Add($Matches[1])
        }
    }
    return ,$symbols
}

$LlvmRoot = Resolve-TaskPath $LlvmRoot '.tools\llvm\v22.1.0'
$SourceRoot = Resolve-TaskPath $SourceRoot '.cache\wasix-libc-source'
$BuildRoot = Resolve-TaskPath $BuildRoot '.cache\wasix-libc-build'
$InstallRoot = Resolve-TaskPath $InstallRoot '.cache\wasix-libc-sysroot'
$SysrootPath = Resolve-TaskPath $SysrootPath 'toolchain\clang-22\package\wasix-compat-sysroot'
$MakePath = Resolve-TaskPath $MakePath '.tools\gnumake\v4.4.1\make.exe'

foreach ($path in @($LlvmRoot, $SourceRoot, $BuildRoot, $InstallRoot, $SysrootPath, $MakePath)) {
    Assert-WorkspacePath $path 'Generated toolchain path'
}
if ($Jobs -lt 1) {
    throw 'Jobs must be at least 1'
}

$clang = Join-Path $LlvmRoot 'bin\clang.exe'
$llvmAr = Join-Path $LlvmRoot 'bin\llvm-ar.exe'
$llvmNm = Join-Path $LlvmRoot 'bin\llvm-nm.exe'
if (-not (Test-Path -LiteralPath $clang)) {
    $installerRoot = Join-Path $repositoryRoot '.cache\llvm'
    $installerPath = Join-Path $installerRoot $llvmInstallerName
    New-Item -ItemType Directory -Path $installerRoot -Force | Out-Null

    if (-not (Test-Path -LiteralPath $installerPath)) {
        $gh = Get-Command gh -ErrorAction SilentlyContinue
        if ($gh) {
            Invoke-Checked $gh.Source @(
                'release', 'download', 'llvmorg-22.1.0',
                '--repo', 'llvm/llvm-project',
                '--pattern', $llvmInstallerName,
                '--dir', $installerRoot
            ) 'Unable to download the pinned LLVM installer with GitHub CLI'
        } else {
            Invoke-WebRequest -Uri $llvmInstallerUrl -OutFile $installerPath
        }
    }

    $installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installerHash -ne $llvmInstallerSha256) {
        throw "LLVM installer checksum mismatch. Expected $llvmInstallerSha256, got $installerHash"
    }
    if (Test-Path -LiteralPath $LlvmRoot) {
        throw "LLVM destination exists but does not contain clang: $LlvmRoot"
    }

    $installer = Start-Process `
        -FilePath $installerPath `
        -ArgumentList '/S', "/D=$LlvmRoot" `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    if ($installer.ExitCode -ne 0) {
        throw "LLVM installer exited with $($installer.ExitCode)"
    }
}
foreach ($tool in @($clang, $llvmAr, $llvmNm)) {
    if (-not (Test-Path -LiteralPath $tool)) {
        throw "Required LLVM tool is missing: $tool"
    }
}

$compilerVersion = (& $clang --version | Select-Object -First 1)
if ($compilerVersion -notmatch '^clang version 22\.1\.0\b') {
    throw "Unexpected native compiler: $compilerVersion"
}

$makeRoot = Split-Path -Parent $MakePath
New-Item -ItemType Directory -Path $makeRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $MakePath)) {
    $partialMakePath = "$MakePath.partial"
    Invoke-WebRequest -Uri $makeUrl -OutFile $partialMakePath
    Move-Item -LiteralPath $partialMakePath -Destination $MakePath
}
$actualMakeHash = (Get-FileHash -LiteralPath $MakePath -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualMakeHash -ne $makeSha256) {
    throw "GNU Make checksum mismatch. Expected $makeSha256, got $actualMakeHash"
}

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCommand) {
    throw 'Git for Windows is required to fetch WASIX libc and provide its Unix build tools'
}
$git = $gitCommand.Source
$gitCommandDirectory = Split-Path -Parent $git
$gitInstallRoot = Split-Path -Parent $gitCommandDirectory
$gitUnixBin = Join-Path $gitInstallRoot 'usr\bin'
foreach ($unixTool in @('sh.exe', 'cp.exe', 'find.exe', 'sed.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $gitUnixBin $unixTool))) {
        throw "Git for Windows Unix tool is missing: $(Join-Path $gitUnixBin $unixTool)"
    }
}

if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot '.git'))) {
    if (Test-Path -LiteralPath $SourceRoot) {
        throw "WASIX libc source destination exists but is not a Git repository: $SourceRoot"
    }
    New-Item -ItemType Directory -Path $SourceRoot -Force | Out-Null
    Invoke-Checked $git @('-C', $SourceRoot, 'init') 'Unable to initialize the WASIX libc source repository'
    Invoke-Checked $git @(
        '-C', $SourceRoot, 'remote', 'add', 'origin', 'https://github.com/wasix-org/wasix-libc.git'
    ) 'Unable to configure the WASIX libc source remote'
}

& $git -C $SourceRoot cat-file -e "$wasixLibcCommit^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
    Invoke-Checked $git @('-C', $SourceRoot, 'fetch', '--depth', '1', 'origin', $wasixLibcCommit) `
        "Unable to fetch WASIX libc commit $wasixLibcCommit"
}
Invoke-Checked $git @('-C', $SourceRoot, 'checkout', '--detach', $wasixLibcCommit) `
    "Unable to check out WASIX libc commit $wasixLibcCommit"
Invoke-Checked $git @(
    '-C', $SourceRoot, 'submodule', 'update', '--init', '--depth', '1',
    'tools/wasi-headers/WASI', 'tools/wasix-headers/WASI'
) 'Unable to fetch the pinned WASI and WASIX header submodules'

& $git -C $SourceRoot apply --reverse --check $compatibilityPatchPath 2>$null
if ($LASTEXITCODE -eq 0) {
    Invoke-Checked $git @('-C', $SourceRoot, 'apply', '--reverse', $compatibilityPatchPath) `
        'Unable to clean up a previously interrupted WASIX libc browser compatibility build'
}

$actualSourceCommit = (& $git -C $SourceRoot rev-parse HEAD).Trim()
$actualWasiHeadersCommit = (& $git -C (Join-Path $SourceRoot 'tools\wasi-headers\WASI') rev-parse HEAD).Trim()
$actualWasixHeadersCommit = (& $git -C (Join-Path $SourceRoot 'tools\wasix-headers\WASI') rev-parse HEAD).Trim()
if ($actualSourceCommit -ne $wasixLibcCommit) {
    throw "Unexpected WASIX libc source commit: $actualSourceCommit"
}
if ($actualWasiHeadersCommit -ne $wasiHeadersCommit) {
    throw "Unexpected WASI headers commit: $actualWasiHeadersCommit"
}
if ($actualWasixHeadersCommit -ne $wasixHeadersCommit) {
    throw "Unexpected WASIX headers commit: $actualWasixHeadersCommit"
}

$cachedMetadataPath = Join-Path $InstallRoot 'LIBC-BUILD.json'
$requiredCachedOutputs = @(
    (Join-Path $InstallRoot 'include\stdio.h'),
    (Join-Path $InstallRoot 'include\sys\statvfs.h'),
    (Join-Path $InstallRoot 'lib\wasm32-wasi\crt1.o'),
    (Join-Path $InstallRoot 'lib\wasm32-wasi\libc.a'),
    (Join-Path $InstallRoot 'lib\wasm32-wasi\libc.imports')
)
$needsBuild = $Force -or @($requiredCachedOutputs | Where-Object { -not (Test-Path -LiteralPath $_) }).Count -gt 0
if (-not $needsBuild) {
    try {
        $cachedMetadata = Get-Content -LiteralPath $cachedMetadataPath -Raw | ConvertFrom-Json
        $needsBuild = $cachedMetadata.commit -ne $wasixLibcCommit -or
            $cachedMetadata.hostCompiler -ne $compilerVersion -or
            $cachedMetadata.buildFlags -ne $extraCFlags -or
            $cachedMetadata.compatibilityPatchSha256 -ne $compatibilityPatchSha256
    } catch {
        $needsBuild = $true
    }
}

if ($needsBuild) {
    foreach ($generatedPath in @($BuildRoot, $InstallRoot)) {
        Assert-WorkspacePath $generatedPath 'WASIX libc cleanup path'
        if (Test-Path -LiteralPath $generatedPath) {
            Remove-Item -LiteralPath $generatedPath -Recurse
        }
    }

    $makeSource = $SourceRoot.Replace('\', '/')
    $makeBuild = $BuildRoot.Replace('\', '/')
    $makeInstall = $InstallRoot.Replace('\', '/')
    $makeLlvmBin = (Join-Path $LlvmRoot 'bin').Replace('\', '/')
    $makeVariables = @(
        "CC=$makeLlvmBin/clang.exe",
        "AR=$makeLlvmBin/llvm-ar.exe",
        "NM=$makeLlvmBin/llvm-nm.exe",
        "OBJDIR=$makeBuild",
        "SYSROOT=$makeInstall",
        'TARGET_ARCH=wasm32',
        'TARGET_OS=wasix',
        'THREAD_MODEL=posix',
        'PIC=no',
        'CHECK_SYMBOLS=no',
        "EXTRA_CFLAGS=$extraCFlags"
    )

    $originalPath = $env:PATH
    $patchApplied = $false
    try {
        Invoke-Checked $git @('-C', $SourceRoot, 'apply', '--check', $compatibilityPatchPath) `
            'The WASIX libc browser SDK 0.8 patch no longer applies cleanly'
        Invoke-Checked $git @('-C', $SourceRoot, 'apply', $compatibilityPatchPath) `
            'Unable to apply the WASIX libc browser SDK 0.8 patch'
        $patchApplied = $true
        $env:PATH = "$gitUnixBin;$originalPath"
        $headerMakeArguments = @(
            '--silent', '--no-print-directory', '-C', $makeSource, 'include_dirs'
        ) + $makeVariables
        Invoke-Checked $MakePath $headerMakeArguments 'Unable to install the WASIX libc headers'
        $buildMakeArguments = @(
            '--silent', '--no-print-directory', '--old-file=include_dirs', "-j$Jobs",
            '-C', $makeSource, 'finish'
        ) + $makeVariables
        Invoke-Checked $MakePath $buildMakeArguments 'Unable to build WASIX libc'
    } finally {
        $env:PATH = $originalPath
        if ($patchApplied) {
            Invoke-Checked $git @('-C', $SourceRoot, 'apply', '--reverse', $compatibilityPatchPath) `
                'Unable to restore the clean WASIX libc source tree after the build'
        }
    }

    $libraryRoot = Join-Path $InstallRoot 'lib\wasm32-wasi'
    $libcArchive = Join-Path $libraryRoot 'libc.a'
    $definedInputs = @($libcArchive) +
        @(Get-ChildItem -LiteralPath $libraryRoot -File -Filter 'libwasi-emulated-*.a' | ForEach-Object FullName) +
        @(Get-ChildItem -LiteralPath $libraryRoot -File -Filter '*.o' | ForEach-Object FullName)
    $undefinedInputs = @($libcArchive) +
        @(Get-ChildItem -LiteralPath $libraryRoot -File -Filter 'libc-*.a' | ForEach-Object FullName) +
        @(Get-ChildItem -LiteralPath $libraryRoot -File -Filter '*.o' | ForEach-Object FullName)
    $definedSymbols = Get-ExternalSymbols $llvmNm (@('--defined-only', '--extern-only') + $definedInputs)
    $undefinedSymbols = Get-ExternalSymbols $llvmNm (@('--undefined-only', '--extern-only') + $undefinedInputs)
    $imports = @(
        $undefinedSymbols |
            Where-Object { -not $definedSymbols.Contains($_) -and $_ -match '^_*imported_wasix_' } |
            Sort-Object
    )
    $imports | Set-Content -LiteralPath (Join-Path $libraryRoot 'libc.imports') -Encoding ascii

    foreach ($requiredSymbol in @('malloc', 'free', 'printf', 'pthread_create', 'strdup', 'statvfs', 'fstatvfs')) {
        if (-not $definedSymbols.Contains($requiredSymbol)) {
            throw "Rebuilt WASIX libc is missing required symbol: $requiredSymbol"
        }
    }

    $smokeSource = Join-Path $BuildRoot 'mainly-libc-smoke.c'
    @'
#define _POSIX_C_SOURCE 200809L
#include <pthread.h>
#include <stdckdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/statvfs.h>

static void *worker(void *value) { return value; }

int main(void) {
    int sum = 0;
    pthread_t thread;
    struct statvfs status;
    char *copy = strdup("ok");
    return ckd_add(&sum, 40, 2) || copy == NULL ||
        pthread_create(&thread, NULL, worker, NULL) != 0 ||
        statvfs(".", &status) == 0;
}
'@ | Set-Content -LiteralPath $smokeSource -Encoding utf8NoBOM

    $clangSysroot = $InstallRoot.Replace('\', '/')
    Invoke-Checked $clang @(
        '--target=wasm32-wasip1', "--sysroot=$clangSysroot",
        '-std=c23', '-fsyntax-only', '-Werror', '-pedantic',
        '-matomics', '-mbulk-memory', '-mmutable-globals', '-pthread',
        '-mthread-model', 'posix', '-ftls-model=local-exec',
        '-D_WASI_EMULATED_MMAN', '-D_WASI_EMULATED_PROCESS_CLOCKS',
        $smokeSource
    ) 'The rebuilt WASIX libc headers failed the C23 syntax smoke test'

    $archiveMemberCount = @(& $llvmAr t $libcArchive).Count
    if ($LASTEXITCODE -ne 0 -or $archiveMemberCount -lt 1000) {
        throw "Rebuilt WASIX libc archive is incomplete: $archiveMemberCount members"
    }

    $metadata = [ordered]@{
        name = 'WASIX libc for Mainly.C'
        version = $wasixLibcVersion
        source = 'https://github.com/wasix-org/wasix-libc'
        commit = $wasixLibcCommit
        wasiHeadersCommit = $wasiHeadersCommit
        wasixHeadersCommit = $wasixHeadersCommit
        hostCompiler = $compilerVersion
        hostCompilerRelease = $llvmInstallerUrl
        hostCompilerInstallerSha256 = $llvmInstallerSha256
        makeVersion = $makeVersion
        makeExecutableSha256 = $makeSha256
        target = 'wasm32-wasip1'
        threadModel = 'posix'
        wasmFeatures = @('atomics', 'bulk-memory', 'mutable-globals')
        buildFlags = $extraCFlags
        compatibilityPatch = 'toolchain/clang-22/patches/wasix-libc-browser-sdk08.patch'
        compatibilityPatchSha256 = $compatibilityPatchSha256
        compatibilityPatchReason = 'use the standard WASI proc_exit/path_open and legacy WASIX fd_dup ABI because Wasmer SDK 0.8 browsers do not support the newer imports'
        archiveMembers = $archiveMemberCount
        c23Library = 'partial'
        statvfs = 'present; WASIX implementation returns ENOTSUP'
        packagedStartupObjects = 'retained from clang/clang@0.160000.1 for Wasmer SDK 0.8 browser compatibility'
    }
    $metadata | ConvertTo-Json -Depth 4 | Set-Content `
        -LiteralPath $cachedMetadataPath `
        -Encoding utf8NoBOM
}

if (-not (Test-Path -LiteralPath $SysrootPath)) {
    throw "WASIX compatibility sysroot does not exist: $SysrootPath"
}

$cachedMetadataDocument = Get-Content -LiteralPath $cachedMetadataPath -Raw | ConvertFrom-Json -AsHashtable
$cachedMetadataDocument['packagedStartupObjects'] =
    'retained from clang/clang@0.160000.1 for Wasmer SDK 0.8 browser compatibility'
$cachedMetadataDocument | ConvertTo-Json -Depth 4 | Set-Content `
    -LiteralPath $cachedMetadataPath `
    -Encoding utf8NoBOM

$targetIncludeRoot = Join-Path $SysrootPath 'include'
New-Item -ItemType Directory -Path $targetIncludeRoot -Force | Out-Null
Copy-Item -Path (Join-Path $InstallRoot 'include\*') -Destination $targetIncludeRoot -Recurse -Force

$sourceLibraryRoot = Join-Path $InstallRoot 'lib\wasm32-wasi'
$preservedStartupObjects = @('crt1.o', 'crt1-command.o', 'crt1-reactor.o', 'scrt1.o')
foreach ($triple in @('wasm32-wasi', 'wasm32-wasip1')) {
    $targetLibraryRoot = Join-Path $SysrootPath "lib\$triple"
    New-Item -ItemType Directory -Path $targetLibraryRoot -Force | Out-Null
    $sourceLibraries = Get-ChildItem -LiteralPath $sourceLibraryRoot -File |
        Where-Object { $_.Name -notin $preservedStartupObjects }
    foreach ($sourceLibrary in $sourceLibraries) {
        Copy-Item -LiteralPath $sourceLibrary.FullName -Destination $targetLibraryRoot -Force
    }
}

$sourceShareRoot = Join-Path $InstallRoot 'share\wasm32-wasi'
if (Test-Path -LiteralPath $sourceShareRoot) {
    $targetShareRoot = Join-Path $SysrootPath 'share\wasm32-wasi'
    New-Item -ItemType Directory -Path $targetShareRoot -Force | Out-Null
    Copy-Item -Path (Join-Path $sourceShareRoot '*') -Destination $targetShareRoot -Recurse -Force
}
Copy-Item -LiteralPath $cachedMetadataPath -Destination (Join-Path $SysrootPath 'LIBC-BUILD.json') -Force

$targetLibcArchive = Join-Path $SysrootPath 'lib\wasm32-wasip1\libc.a'
[pscustomobject]@{
    Compiler = $compilerVersion
    SourceVersion = $wasixLibcVersion
    SourceCommit = $wasixLibcCommit
    LibcArchive = $targetLibcArchive
    LibcBytes = (Get-Item -LiteralPath $targetLibcArchive).Length
    LibcSha256 = (Get-FileHash -LiteralPath $targetLibcArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    C23Library = 'partial'
    Statvfs = 'present; returns ENOTSUP'
} | Format-List
