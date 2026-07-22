# clangd 21 browser runtime

Mainly.C uses the browser port from
[`guyutongxue/clangd-in-browser`](https://github.com/guyutongxue/clangd-in-browser)
as a pinned clangd 21.1.0 WebAssembly runtime. The editor integration and LSP
client live in `src/lsp`; the upstream Monaco wrapper is not bundled.

Prepare the verified local artifacts with:

```powershell
npm run clangd:prepare
```

The script downloads `clangd.js` and `clangd.wasm` into the ignored
`.cache/clangd-21.1.0` directory. `vite.config.ts` gzip-compresses the WASM and
copies both runtime files into the production site. Source URLs, byte lengths,
hashes, and the upstream revision are pinned in `PROVENANCE.json`.

The language server runs with `--sync` inside a dedicated Web Worker, with the
background index and full standard-library index disabled. This keeps browser
Pthread scheduling out of the request path while preserving semantic analysis
for open files, included headers, and workspace symbols.

clangd and LLVM are distributed under Apache-2.0 WITH LLVM-exception. The
generated JavaScript also includes Emscripten runtime code. The existing LLVM
license shipped with the Clang toolchain is at
`toolchain/clang-22/package/LICENSE-LLVM.txt`.
