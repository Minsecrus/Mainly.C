# mainly.c Clang 22 toolchain

This WebC package contains Clang/LLD 22.1.0 compiled as a WASI Preview 1
module, plus the headers and libraries needed to compile and link C programs
to `wasm32-wasip1` entirely inside a browser.

The package contains:

- the Clang frontend and WebAssembly LLVM backend;
- LLD's WebAssembly linker;
- `llvm-ar`, `llvm-ranlib`, and `llvm-nm`;
- Clang resource headers;
- WASI libc headers, `crt1` objects, libc, libm, and emulation libraries;
- compiler-rt builtins;
- libc++ and libc++abi (included for toolchain completeness, although
  mainly.c only exposes C).
- a second, browser-compatible WASIX sysroot used for programs that need live terminal
  input while they are running. This compatibility sysroot is extracted from
  Wasmer's pinned `clang/clang@0.160000.1` package; only its libraries are
  reused, while Clang and LLD remain version 22.1.0. It targets the WASIX ABI
  implemented by Wasmer SDK 0.8.0.

## Compiler Adapter contract

This compiler is a standard WASI module. Standard WASI does not provide
process spawning, while the normal Clang driver launches its `-cc1` frontend
and linker as child processes. The mainly.c Compiler Adapter therefore runs
the toolchain in three steps:

1. run `clang -### ...` to obtain Clang's authoritative command plan;
2. run each emitted `clang -cc1 ...` command through the package's `clang`
   command;
3. run the emitted `wasm-ld ...` command through the package's `wasm-ld`
   command.

All invocations share the same project directory mounted at `/workspace`.
This is the same
strategy used by YoWASP's browser API, but the compiler, linker, sysroot, and
intermediate files are hosted by Wasmer's package filesystem.

The adapter passes `-std=c23` by default. It must not claim that invoking the
package entrypoint once with `clang source.c -o source.wasm` is supported;
that form attempts a WASI subprocess and fails. Version/help requests,
`-###`, direct `-cc1`, and the individual LLVM tool commands work directly.

For ordinary diagnostics and batch execution, the adapter uses the bundled
WASI Preview 1 sysroot at `/usr`. For an interactive terminal it compiles with
the atomics/shared-memory flags and the browser-compatible WASIX sysroot at
`/wasix`.

## Provenance

The binary and sysroot are assembled from the pinned
`@yowasp/clang@22.0.0-git20542-10` distribution. The compiler reports Clang
22.1.0 built from YoWASP's LLVM fork commit
`9560ae0f2cc440e4fc891fddbc119da6f56daa59`. See `PROVENANCE.json` for all
pins and checksums.

No network access is needed after the resulting WebC has been downloaded by
the application. Compilation and program execution happen locally.
