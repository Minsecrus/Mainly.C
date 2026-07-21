# mainly.c Clang 22 toolchain

This WebC package contains Clang/LLD 22.1.0 compiled as a WASI Preview 1
module, plus the headers and libraries needed to compile and link C and C++ programs
to `wasm32-wasip1` entirely inside a browser.

The package contains:

- the Clang frontend and WebAssembly LLVM backend;
- LLD's WebAssembly linker;
- `llvm-ar`, `llvm-ranlib`, and `llvm-nm`;
- Clang resource headers;
- WASI libc headers, `crt1` objects, libc, libm, and emulation libraries;
- compiler-rt builtins;
- WASIX libc `v2026-07-03.1`, rebuilt with Clang 22 for shared memory, atomics,
  and the POSIX thread model;
- libc++ and libc++abi 22.1.0, rebuilt for WASIX shared memory with atomics and
  pthread support;
- a second, browser-compatible WASIX sysroot used for programs that need live terminal
  input while they are running. This compatibility sysroot is extracted from
  Wasmer's pinned `clang/clang@0.160000.1` package as a bootstrap. Its
  browser-compatible startup objects, compiler-rt builtins, and a few
  compatibility headers are retained; its libc and libc++ headers and archives
  are replaced by the source-built versions. The newer startup objects are not
  packaged because they require WASIX signal imports that Wasmer SDK 0.8 does
  not yet expose in browsers. The libc source build also applies the checked-in
  `wasix-libc-browser-sdk08.patch`, which uses standard WASI `proc_exit` and
  `path_open` plus the older WASIX `fd_dup` behavior because SDK 0.8 does not
  provide the newer process-exit and file-descriptor imports.
  Clang and LLD remain version 22.1.0. It targets the WASIX ABI implemented by
  Wasmer SDK 0.8.0.

## Compiler Adapter contract

This compiler is a standard WASI module. Standard WASI does not provide
process spawning, while the normal Clang driver launches its `-cc1` frontend
and linker as child processes. The mainly.c Compiler Adapter therefore runs
the toolchain in three steps:

1. run `clang -### ...` or `clang++ -### ...` to obtain Clang's authoritative command plan;
2. run each emitted frontend command through the matching package command;
3. run the emitted `wasm-ld ...` command through the package's `wasm-ld`
   command.

All invocations share the same project directory mounted at `/workspace`.
This is the same
strategy used by YoWASP's browser API, but the compiler, linker, sysroot, and
intermediate files are hosted by Wasmer's package filesystem.

The adapter defaults to C23 for C and C++23 for C++. It exposes C99, C11, C23,
C++11, C++14, C++17, C++20, C++23, and the partial C++26 draft mode. The rebuilt
WASIX libc supports part, not all, of the C23 library. For example,
`<stdckdint.h>` is supplied by Clang's resource headers, while `<stdbit.h>` and
several new C23 allocation and memory APIs are absent. The rebuilt libc++
provides `<print>` and `std::println` in C++23 and later. It is built without
exception handling, so C++ programs are compiled with `-fno-exceptions`.
Standard stream file I/O and C++17-and-later libc++ filesystem support are enabled. Common
path, file, and directory operations work in the virtual workspace, while
`std::filesystem::space()` reports `ENOTSUP` because WASIX libc's `statvfs`
entry point is currently a stub.

The adapter must not claim that invoking the package entrypoint once with
`clang source.c -o source.wasm` is supported;
that form attempts a WASI subprocess and fails. Version/help requests,
`-###`, direct `-cc1`, and the individual LLVM tool commands work directly.

For ordinary diagnostics and batch execution, the adapter uses the bundled
WASI Preview 1 sysroot at `/usr`. For an interactive terminal it compiles with
the atomics/shared-memory flags and the browser-compatible WASIX sysroot at
`/wasix`.

## Provenance

The compiler binary and regular WASI sysroot are assembled from the pinned
`@yowasp/clang@22.0.0-git20542-10` distribution. The compiler reports Clang
22.1.0 built from YoWASP's LLVM fork commit
`9560ae0f2cc440e4fc891fddbc119da6f56daa59`. The WASIX libc rebuild uses
release `v2026-07-03.1` at commit
`09503b230e8acc721c1e013ca28a41bf149e4ee2`; the WASIX libc++ rebuild uses the
same LLVM source commit as Clang. Both are compiled with the checksum-pinned
official LLVM 22.1.0 Windows compiler. See `PROVENANCE.json` for all pins and
checksums.

No network access is needed after the resulting WebC has been downloaded by
the application. Compilation and program execution happen locally.
