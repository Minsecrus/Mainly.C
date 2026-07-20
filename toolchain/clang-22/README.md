# Clang 22 Wasmer package

This directory builds the local Clang 22 toolchain used by mainly.c.

## Prepare and build on Windows

From the repository root:

```powershell
pwsh -File toolchain/clang-22/scripts/prepare-package.ps1
pwsh -File toolchain/clang-22/scripts/build-package.ps1
```

The first command downloads the pinned, checksum-verified LLVM 22 WebAssembly
artifact plus the browser-compatible WASIX sysroot from
`clang/clang@0.160000.1`, then expands them into `package/`. The second command
uses Wasmer to create `dist/mainly-c-clang-22.1.0-1.webc`.

Wasmer itself is intentionally not installed system-wide. The build script
expects the portable Wasmer 7.2.0 archive under `.tools/wasmer/v7.2.0`, or an
explicit `-WasmerPath` argument.

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

Verification checks the reported Clang version, compiles and runs a C23
program, checks standard input/output, and confirms a Clang diagnostic has the
expected file, line, and column.

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
