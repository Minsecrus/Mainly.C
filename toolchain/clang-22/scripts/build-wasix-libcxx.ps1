[CmdletBinding()]
param(
    [string]$LlvmRoot,
    [string]$CMakePath,
    [string]$NinjaPath,
    [string]$SourceRoot,
    [string]$BuildRoot,
    [string]$InstallRoot,
    [string]$SysrootPath,
    [int]$Jobs = [Math]::Max(1, [Environment]::ProcessorCount),
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$toolchainRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $toolchainRoot '..\..'))
$llvmCommit = '9560ae0f2cc440e4fc891fddbc119da6f56daa59'
$llvmVersion = '22.1.0'
$llvmInstallerName = 'LLVM-22.1.0-win64.exe'
$llvmInstallerUrl = 'https://github.com/llvm/llvm-project/releases/download/llvmorg-22.1.0/LLVM-22.1.0-win64.exe'
$llvmInstallerSha256 = 'b31d5f54942e017cb878e594529723dd629cc7b54c9bf7a331e2dc01e8ea5e75'

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

function Find-Executable([string]$ExplicitPath, [string]$CommandName, [string[]]$Candidates) {
    if ($ExplicitPath) {
        $resolved = [System.IO.Path]::GetFullPath($ExplicitPath)
        if (-not (Test-Path -LiteralPath $resolved)) {
            throw "$CommandName executable not found: $resolved"
        }
        return $resolved
    }

    $command = Get-Command $CommandName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    foreach ($candidate in $Candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) {
            return [System.IO.Path]::GetFullPath($candidate)
        }
    }
    throw "Unable to locate $CommandName. Pass its path explicitly."
}

$LlvmRoot = Resolve-TaskPath $LlvmRoot '.tools\llvm\v22.1.0'
$SourceRoot = Resolve-TaskPath $SourceRoot '.cache\llvm-project-libcxx22'
$BuildRoot = Resolve-TaskPath $BuildRoot '.cache\libcxx22-wasix-build'
$InstallRoot = Resolve-TaskPath $InstallRoot '.cache\libcxx22-wasix-install'
$SysrootPath = Resolve-TaskPath $SysrootPath 'toolchain\clang-22\package\wasix-compat-sysroot'

foreach ($path in @($LlvmRoot, $SourceRoot, $BuildRoot, $InstallRoot, $SysrootPath)) {
    Assert-WorkspacePath $path 'Generated toolchain path'
}

$clang = Join-Path $LlvmRoot 'bin\clang++.exe'
if (-not (Test-Path -LiteralPath $clang)) {
    $installerRoot = Join-Path $repositoryRoot '.cache\llvm'
    $installerPath = Join-Path $installerRoot $llvmInstallerName
    New-Item -ItemType Directory -Path $installerRoot -Force | Out-Null

    if (-not (Test-Path -LiteralPath $installerPath)) {
        $gh = Get-Command gh -ErrorAction SilentlyContinue
        if ($gh) {
            & $gh.Source release download llvmorg-22.1.0 `
                --repo llvm/llvm-project `
                --pattern $llvmInstallerName `
                --dir $installerRoot
            if ($LASTEXITCODE -ne 0) {
                throw 'Unable to download the pinned LLVM installer with GitHub CLI'
            }
        } else {
            Invoke-WebRequest -Uri $llvmInstallerUrl -OutFile $installerPath
        }
    }

    $installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($installerHash -ne $llvmInstallerSha256) {
        throw "LLVM installer checksum mismatch. Expected $llvmInstallerSha256, got $installerHash"
    }
    if (Test-Path -LiteralPath $LlvmRoot) {
        throw "LLVM destination exists but does not contain clang++: $LlvmRoot"
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

$compilerVersion = (& $clang --version | Select-Object -First 1)
if ($compilerVersion -notmatch '^clang version 22\.1\.0\b') {
    throw "Unexpected native compiler: $compilerVersion"
}

$visualStudioCandidates = @()
foreach ($edition in @('Enterprise', 'Professional', 'Community', 'BuildTools')) {
    if ($env:ProgramFiles) {
        $visualStudioCandidates += Join-Path $env:ProgramFiles "Microsoft Visual Studio\2022\$edition\Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe"
    }
}
$vswhereCandidates = @()
if (${env:ProgramFiles(x86)}) {
    $vswhereCandidates += Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
}
if ($env:ProgramFiles) {
    $vswhereCandidates += Join-Path $env:ProgramFiles 'Microsoft Visual Studio\Installer\vswhere.exe'
}
$vswhere = $vswhereCandidates | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if ($vswhere) {
    $visualStudioRoots = @(& $vswhere -products '*' -property installationPath)
    foreach ($visualStudioRoot in $visualStudioRoots) {
        if ($visualStudioRoot) {
            $visualStudioCandidates += Join-Path $visualStudioRoot 'Common7\IDE\CommonExtensions\Microsoft\CMake\CMake\bin\cmake.exe'
        }
    }
}
$CMakePath = Find-Executable $CMakePath 'cmake' $visualStudioCandidates
$cmakeBin = Split-Path -Parent $CMakePath
$NinjaPath = Find-Executable $NinjaPath 'ninja' @(
    [System.IO.Path]::GetFullPath((Join-Path $cmakeBin '..\..\Ninja\ninja.exe'))
)
$git = Find-Executable '' 'git' @()

if (-not (Test-Path -LiteralPath (Join-Path $SourceRoot '.git'))) {
    if (Test-Path -LiteralPath $SourceRoot) {
        throw "LLVM source destination exists but is not a Git repository: $SourceRoot"
    }
    New-Item -ItemType Directory -Path $SourceRoot -Force | Out-Null
    & $git -C $SourceRoot init
    & $git -C $SourceRoot remote add origin https://codeberg.org/YoWASP/llvm-project.git
    & $git -C $SourceRoot sparse-checkout init --cone
    & $git -C $SourceRoot sparse-checkout set libc libcxx libcxxabi libunwind cmake runtimes llvm/cmake
}

& $git -C $SourceRoot cat-file -e "$llvmCommit^{commit}" 2>$null
if ($LASTEXITCODE -ne 0) {
    & $git -C $SourceRoot fetch --depth 1 --filter=blob:none origin $llvmCommit
    if ($LASTEXITCODE -ne 0) {
        throw "Unable to fetch LLVM commit $llvmCommit"
    }
}
& $git -C $SourceRoot sparse-checkout set libc libcxx libcxxabi libunwind cmake runtimes llvm/cmake
& $git -C $SourceRoot checkout --detach $llvmCommit
if ($LASTEXITCODE -ne 0) {
    throw "Unable to check out LLVM commit $llvmCommit"
}
$actualCommit = (& $git -C $SourceRoot rev-parse HEAD).Trim()
if ($actualCommit -ne $llvmCommit) {
    throw "Unexpected LLVM source commit: $actualCommit"
}

$toolchainFile = Join-Path $toolchainRoot 'cmake\wasix-libcxx.cmake'
$runtimesSource = Join-Path $SourceRoot 'runtimes'
$libcxxAbiIncludes = Join-Path $SourceRoot 'libcxxabi\include'
$installedHeaders = Join-Path $InstallRoot 'include\c++\v1'
$installedLibraries = Join-Path $InstallRoot 'lib\wasm32-wasip1'
$requiredBuildOutputs = @(
    (Join-Path $installedHeaders '__config'),
    (Join-Path $installedHeaders '__config_site'),
    (Join-Path $installedHeaders 'filesystem'),
    (Join-Path $installedHeaders 'print'),
    (Join-Path $installedLibraries 'libc++.a'),
    (Join-Path $installedLibraries 'libc++abi.a')
)

$libcMetadataPath = Join-Path $SysrootPath 'LIBC-BUILD.json'
if (-not (Test-Path -LiteralPath $libcMetadataPath)) {
    throw "WASIX libc build metadata is missing: $libcMetadataPath"
}
$cacheMetadataPath = Join-Path $InstallRoot 'LIBCXX-CACHE.json'
$cacheInputs = [ordered]@{
    sourceCommit = $llvmCommit
    hostCompiler = $compilerVersion
    cmakeVersion = ((& $CMakePath --version | Select-Object -First 1).Trim())
    ninjaVersion = ((& $NinjaPath --version | Select-Object -First 1).Trim())
    libcMetadataSha256 = (Get-FileHash -LiteralPath $libcMetadataPath -Algorithm SHA256).Hash.ToLowerInvariant()
    toolchainFileSha256 = (Get-FileHash -LiteralPath $toolchainFile -Algorithm SHA256).Hash.ToLowerInvariant()
    buildScriptSha256 = (Get-FileHash -LiteralPath $PSCommandPath -Algorithm SHA256).Hash.ToLowerInvariant()
}
$needsBuild = $Force -or @(
    $requiredBuildOutputs | Where-Object { -not (Test-Path -LiteralPath $_) }
).Count -gt 0
if (-not $needsBuild) {
    try {
        $cachedInputs = Get-Content -LiteralPath $cacheMetadataPath -Raw | ConvertFrom-Json -AsHashtable
        foreach ($entry in $cacheInputs.GetEnumerator()) {
            if (-not $cachedInputs.ContainsKey($entry.Key) -or $cachedInputs[$entry.Key] -ne $entry.Value) {
                $needsBuild = $true
                break
            }
        }
    } catch {
        $needsBuild = $true
    }
}

if ($needsBuild) {
    foreach ($generatedPath in @($BuildRoot, $InstallRoot)) {
        Assert-WorkspacePath $generatedPath 'Build cleanup path'
        if (Test-Path -LiteralPath $generatedPath) {
            Remove-Item -LiteralPath $generatedPath -Recurse
        }
    }
}

$configureArguments = @(
    '-G', 'Ninja',
    '-S', $runtimesSource,
    '-B', $BuildRoot,
    "-DCMAKE_MAKE_PROGRAM=$NinjaPath",
    "-DCMAKE_TOOLCHAIN_FILE=$toolchainFile",
    "-DMAINLY_LLVM_ROOT=$LlvmRoot",
    "-DMAINLY_WASIX_SYSROOT=$SysrootPath",
    "-DCMAKE_INSTALL_PREFIX=$InstallRoot",
    '-DCMAKE_BUILD_TYPE=Release',
    '-DCMAKE_INSTALL_MESSAGE=LAZY',
    '-DLLVM_ENABLE_RUNTIMES=libcxx;libcxxabi',
    '-DLLVM_INCLUDE_TESTS=OFF',
    '-DLIBCXX_INCLUDE_TESTS=OFF',
    '-DLIBCXXABI_INCLUDE_TESTS=OFF',
    '-DLIBCXX_INCLUDE_BENCHMARKS=OFF',
    '-DLIBCXX_ENABLE_SHARED=OFF',
    '-DLIBCXX_ENABLE_STATIC=ON',
    '-DLIBCXX_ENABLE_EXCEPTIONS=OFF',
    '-DLIBCXX_ENABLE_FILESYSTEM=ON',
    '-DLIBCXX_ENABLE_ABI_LINKER_SCRIPT=OFF',
    '-DLIBCXX_ENABLE_TIME_ZONE_DATABASE=OFF',
    '-DLIBCXX_ENABLE_THREADS=ON',
    '-DLIBCXX_HAS_PTHREAD_API=ON',
    '-DLIBCXX_CXX_ABI=libcxxabi',
    "-DLIBCXX_CXX_ABI_INCLUDE_PATHS=$libcxxAbiIncludes",
    '-DLIBCXX_HAS_MUSL_LIBC=ON',
    '-DLIBCXX_ABI_VERSION=2',
    '-DLIBCXXABI_ENABLE_THREADS=ON',
    '-DLIBCXXABI_HAS_PTHREAD_API=ON',
    '-DLIBCXXABI_ENABLE_SHARED=OFF',
    '-DLIBCXXABI_ENABLE_STATIC=ON',
    '-DLIBCXXABI_ENABLE_EXCEPTIONS=OFF',
    '-DLIBCXXABI_USE_LLVM_UNWINDER=OFF',
    '-DLIBCXXABI_SILENT_TERMINATE=ON',
    '-DLIBCXX_LIBDIR_SUFFIX=/wasm32-wasip1',
    '-DLIBCXXABI_LIBDIR_SUFFIX=/wasm32-wasip1'
)

if ($needsBuild) {
    & $CMakePath @configureArguments
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to configure the WASIX libc++ build'
    }
    & $CMakePath --build $BuildRoot --target cxx cxxabi --parallel $Jobs
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to build WASIX libc++ and libc++abi'
    }
    & $CMakePath --install $BuildRoot
    if ($LASTEXITCODE -ne 0) {
        throw 'Unable to install the rebuilt WASIX libc++ artifacts'
    }
    $cacheInputs | ConvertTo-Json -Depth 4 | Set-Content `
        -LiteralPath $cacheMetadataPath `
        -Encoding utf8NoBOM
}

foreach ($requiredOutput in $requiredBuildOutputs) {
    if (-not (Test-Path -LiteralPath $requiredOutput)) {
        throw "Rebuilt libc++ output is missing: $requiredOutput"
    }
}

$libcxxConfig = Get-Content -LiteralPath (Join-Path $installedHeaders '__config') -Raw
$libcxxConfigSite = Get-Content -LiteralPath (Join-Path $installedHeaders '__config_site') -Raw
if ($libcxxConfig -notmatch '#\s*define\s+_LIBCPP_VERSION\s+220100\b') {
    throw 'Rebuilt headers do not report libc++ 22.1.0'
}
if ($libcxxConfigSite -notmatch '#define _LIBCPP_HAS_THREAD_API_PTHREAD 1') {
    throw 'Rebuilt libc++ does not use the pthread API'
}
if ($libcxxConfigSite -notmatch '#define _LIBCPP_HAS_FILESYSTEM 1') {
    throw 'Rebuilt libc++ does not enable filesystem support'
}

$targetHeaders = Join-Path $SysrootPath 'include\c++\v1'
$resolvedTargetHeaders = [System.IO.Path]::GetFullPath($targetHeaders)
$relativeTargetHeaders = [System.IO.Path]::GetRelativePath($SysrootPath, $resolvedTargetHeaders)
if ($relativeTargetHeaders -eq '..' -or $relativeTargetHeaders.StartsWith("..$([System.IO.Path]::DirectorySeparatorChar)")) {
    throw "Unsafe libc++ header target: $resolvedTargetHeaders"
}
if (Test-Path -LiteralPath $targetHeaders) {
    Remove-Item -LiteralPath $targetHeaders -Recurse
}
Copy-Item -LiteralPath $installedHeaders -Destination $targetHeaders -Recurse

foreach ($triple in @('wasm32-wasi', 'wasm32-wasip1')) {
    $targetLibraryRoot = Join-Path $SysrootPath "lib\$triple"
    New-Item -ItemType Directory -Path $targetLibraryRoot -Force | Out-Null
    foreach ($name in @('libc++.a', 'libc++abi.a', 'libc++experimental.a', 'libc++.modules.json')) {
        $sourceFile = Join-Path $installedLibraries $name
        if (Test-Path -LiteralPath $sourceFile) {
            Copy-Item -LiteralPath $sourceFile -Destination (Join-Path $targetLibraryRoot $name) -Force
        }
    }
}

$metadata = [ordered]@{
    name = 'libc++ for Mainly.C WASIX'
    version = $llvmVersion
    source = 'https://codeberg.org/YoWASP/llvm-project'
    commit = $llvmCommit
    hostCompiler = $compilerVersion
    hostCompilerRelease = $llvmInstallerUrl
    hostCompilerInstallerSha256 = $llvmInstallerSha256
    target = 'wasm32-wasip1'
    threadApi = 'pthread'
    wasmFeatures = @('atomics', 'bulk-memory', 'mutable-globals')
    exceptions = $false
    filesystem = $true
    filesystemLimitations = @(
        'std::filesystem::space reports ENOTSUP because WASIX statvfs is a stub'
    )
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content `
    -LiteralPath (Join-Path $SysrootPath 'LIBCXX-BUILD.json') `
    -Encoding utf8NoBOM

$libcxxArchive = Join-Path $SysrootPath 'lib\wasm32-wasip1\libc++.a'
[pscustomobject]@{
    Compiler = $compilerVersion
    SourceCommit = $llvmCommit
    LibcxxArchive = $libcxxArchive
    LibcxxBytes = (Get-Item -LiteralPath $libcxxArchive).Length
    LibcxxSha256 = (Get-FileHash -LiteralPath $libcxxArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    HasPrintHeader = Test-Path -LiteralPath (Join-Path $targetHeaders 'print')
    Filesystem = 'enabled; space() reports ENOTSUP because WASIX statvfs is a stub'
    Cache = if ($needsBuild) { 'rebuilt' } else { 'reused' }
} | Format-List
