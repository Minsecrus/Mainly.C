# Clang 22 Wasmer package

This directory builds the local Clang 22 toolchain used by mainly.c.

## Prepare and build on Windows

From the repository root:

```powershell
pwsh -File toolchain/clang-22/scripts/prepare-package.ps1
pwsh -File toolchain/clang-22/scripts/build-package.ps1
```

The first command downloads the pinned, checksum-verified LLVM 22 WebAssembly
artifact plus a bootstrap WASIX sysroot from `clang/clang@0.160000.1`. It then
uses a private LLVM 22.1.0 Windows install to rebuild WASIX libc
`v2026-07-03.1`, libc++, and libc++abi with the atomics and pthread features
required by Wasmer's shared-memory runtime. The libc build uses a pinned GNU
Make executable and only the two small WASI/WASIX header submodules; it does not
clone the WASIX repository's LLVM monorepo submodule. The second command uses Wasmer to create
`dist/mainly-c-clang-22.1.0-4.webc`.

The package retains the bootstrap sysroot's tiny startup objects because the
new release initializes signals through WASIX imports that Wasmer SDK 0.8 does
not expose in browsers. The C headers and library archives themselves still
come from the pinned source rebuild. A small checked-in compatibility patch
maps process exit and file opening to the standard WASI `proc_exit`/`path_open`
imports and retains the older WASIX `fd_dup` behavior, because Wasmer SDK 0.8
does not provide the newer WASIX imports in browsers.

Wasmer itself is intentionally not installed system-wide. The build script
expects the portable Wasmer 7.2.0 archive under `.tools/wasmer/v7.2.0`, or an
explicit `-WasmerPath` argument.

The libc rebuild requires Git for Windows, which supplies the small Unix tools
used by the upstream Makefile. The libc++ rebuild requires CMake and Ninja;
their executable paths can be passed as `-CMakePath` and `-NinjaPath`. The
native LLVM compiler and GNU Make are downloaded, checksum-verified, and kept
under `.tools/`; neither is added to the system `PATH`.

## Build the compiler from source

`scripts/build-from-source.sh` provides the long path: it checks out the exact
YoWASP build recipe, LLVM fork, and wasi-libc commits and rebuilds the compiler
and sysroot. YoWASP supports this build on x86_64 Linux. The checked-in package
assembly path uses the byte-for-byte pinned published result so Windows
developers do not need a multi-hour LLVM bootstrap for ordinary builds.

## Verify

```powershell
pwsh -File toolchain/clang-22/scripts/verify-package.ps1
```

Verification checks the reported Clang version, compiles and runs C23 and
C++23 programs, exercises the rebuilt WASIX libc with `<stdckdint.h>`,
`strdup`, and `statvfs`, exercises `<print>`/`std::println`, C++ stream file
I/O, and `std::filesystem`, checks standard
input/output, and confirms a Clang diagnostic has the expected file, line, and column. The
browser suite additionally compiles and runs every language-standard option
exposed by the application.

The application-facing TypeScript adapter lives in
`src/compiler/ClangCompilerAdapter.ts`. It logs every compiler command as
`command:spawn`, `command:wait`, and `command:done`. Its interactive terminal
wrapper also logs every accepted stdin write, stdout/stderr chunk, stdin-lock
release, wait, and process exit.

The real-browser smoke test is intentionally capped at 60 seconds and uses the
pinned `@wasmer/sdk@0.8.0` release. SDK 0.10.0 was rejected because its
`Instance.wait()` does not complete for the packaged LLD command.

For a live terminal, the SDK 0.8 stdin writer must release its stream lock
after the program has consumed its input and before `Instance.wait()` is
called. `InteractiveTerminalSession.finish()` enforces that ordering. This is
covered by the real Chrome test, not a mocked stream test.

```powershell
npm run test:clang:browser
```

To run both the native Wasmer verification and the browser verification:

```powershell
npm run test:clang
```
