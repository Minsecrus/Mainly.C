# Mainly.C

Mainly.C 是一个面向 C 与 C++ 学习者的轻量级浏览器编辑器。它使用 Clang 22 将当前源文件编译为 WebAssembly，并通过 Wasmer 在浏览器本地交互运行；源代码、标准输入输出和编译过程不经过远程编译服务器。

在线版本：[https://minsecrus.github.io/Mainly.C/](https://minsecrus.github.io/Mainly.C/)

## 功能

- C / C++ / 文本多文件工作区与本地浏览器持久化
- Monaco Editor C 与 C++ 语法高亮
- 浏览器 Worker 内运行的 clangd 21.1.0 WebAssembly 语言服务
- 基于真实工作区内容的实时诊断、语义补全、悬停、签名帮助、定义与引用跳转
- 顶部语言标准选择器：C99、C11、C23；C++11、14、17、20、23、26
- clangd 未就绪时使用内置 C23 / 标准库补全，就绪后自动切换为语义补全
- `Ctrl+S` 使用本地 Clang-format 22 自动格式化并保存
- UI 优先显示，随后在后台并行准备 Clang-format 与 Clang 22 工具链
- Clang 22 编译诊断与 Monaco 行列映射
- 类 Error Lens 的行内错误提示
- 基于 xterm.js 的交互式终端
- `Ctrl+C` 或运行按钮强制终止程序
- 单次运行，或每 5、10、30 秒循环编译运行
- 完全本地的编译、链接和 WebAssembly 执行

## 技术栈

- TypeScript、React、Vite、Tailwind CSS
- Monaco Editor、Radix UI、xterm.js
- `@wasm-fmt/clang-format` 22.1.8
- `@wasmer/sdk` 0.8.0
- clangd 21.1.0 WebAssembly（固定来源、长度与 SHA-256）
- 自制 Clang / LLD 22.1.0 WebC 工具链、WASIX libc v2026-07-03.1 与 libc++ 22.1.0
- C / C++、`wasm32-wasip1` 与浏览器兼容 WASIX sysroot

## 架构

```text
                    ┌─ LSP Client ─ clangd 21 WASM Worker
UI ─ Monaco Editor ┤
                    └─ UDE API ─ Compiler Adapter ─ Clang / LLD 22 WebC
                                                      │
                                              WebAssembly Runtime
```

编辑器把工作区源文件、每次内容变更和所选语言标准通过 LSP 同步给独立 clangd Worker；所有分析都在当前浏览器内完成。编译器适配器根据文件类型通过 `clang -###` 或 `clang++ -###` 获取命令计划，再分别运行 Clang 前端和 LLD。交互程序在另一独立 Worker 内执行；手动终止时会先读取最终虚拟文件快照，再销毁整个运行实例。

## 本地开发

要求：Node.js 22、PowerShell 7、Git for Windows、Wasmer CLI 7.2.0，以及 CMake 与 Ninja。构建脚本会下载经过 SHA-256 校验的 LLVM 22.1.0 Windows 工具和 GNU Make，并仅安装到项目的 `.tools/` 目录，用它们为 WASIX 重建 libc、libc++ 与 libc++abi。

```powershell
npm install
npm run clang:build
npm run clangd:prepare
npm run dev
```

如果 Wasmer CLI 不在项目默认的 `.tools/wasmer/v7.2.0/bin/wasmer.exe` 位置，可直接向构建脚本传入路径：

```powershell
pwsh -NoProfile -File toolchain/clang-22/scripts/build-package.ps1 -WasmerPath "C:\path\to\wasmer.exe"
```

生产构建：

```powershell
npm run build
```

## GitHub Pages

推送到 `main` 后，[部署工作流](.github/workflows/deploy-pages.yml)会重建 Clang WebC、下载并校验固定版本的 clangd 运行时、以 `/Mainly.C/` 为 Vite 基路径构建站点，并部署到 GitHub Pages。

GitHub Pages 无法直接配置运行 WebAssembly 线程所需的 COOP/COEP 响应头，因此站点随包部署 `coi-serviceworker`。首次访问时页面可能自动刷新一次，以建立跨源隔离环境。

## 当前边界

- clangd 会分析工作区内全部 `.c`、`.cpp`、`.cc` 与 `.cxx` 文件；运行按钮仍只编译当前打开的一个源文件。
- clangd 在独立 Worker 内使用同步请求调度，并关闭后台索引与全标准库索引；这不会阻塞 UI，已包含头文件与工作区符号的语义分析仍可用。
- C23 语言模式可用；WASIX libc 为 v2026-07-03.1，但 C23 标准库仍是部分支持，并非完整实现。
- C++ 使用针对 WASIX 共享内存运行方式重建的 libc++ 22.1.0；C++23 起可使用 `<print>` 与 `std::println`。
  - 当前 C++ 运行库以 `-fno-exceptions` 构建；可用 `std::ifstream` / `std::ofstream` 读写虚拟工作区文件，C++17 起也已启用常用 `std::filesystem` 操作。由于 WASIX libc 的 `statvfs` 目前只返回 `ENOTSUP`，`std::filesystem::space()` 会报告不支持。
  - 程序编译和运行期间，`.txt` 文件由虚拟文件系统管理并保持只读；运行中的新增、修改与删除会以 100ms 间隔单向同步到文件列表和浏览器工作区。自然退出和手动终止都会执行最终同步，同步或浏览器存储失败会在终端中提示。
- C++26 是 Clang 22 的实验性草案模式，不代表完整 ISO C++26 语言与标准库实现。
- 程序运行在浏览器 WASI/WASIX 沙箱中，不等同于本机原生进程。
- 网络、子进程和本机文件系统等能力受到浏览器与运行时限制。
- clangd 端口需要跨源隔离，并创建 2 GB 的共享 WebAssembly 线性内存；低内存或 32 位浏览器可能无法启动，此时编辑器会继续使用内置补全。
- 首次打开时会在编辑器显示后并行下载 gzip 压缩的 `.webc.data` 编译工具链（约 32 MB，流式解压后约 124 MB）和 clangd WASM（约 24 MB）；两者都使用浏览器 Cache Storage 复用。`.data` 扩展名兼容静态托管平台的文件白名单；clangd 未就绪不影响编辑，编译工具链准备完成前不能运行。

## License

Copyright © 2026 Minsecrus. Mainly.C 以 [MIT License](LICENSE) 发布。Clang、LLVM、WASI/WASIX、字体及其他第三方组件遵循各自的许可证。
