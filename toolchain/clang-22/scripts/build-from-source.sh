#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TOOLCHAIN_ROOT=$(cd -- "$SCRIPT_DIR/.." && pwd)
REPOSITORY_ROOT=$(cd -- "$TOOLCHAIN_ROOT/../.." && pwd)
WORK_ROOT=${1:-"$REPOSITORY_ROOT/.cache/clang-22-source"}
SOURCE_ROOT="$WORK_ROOT/yowasp-clang"
PACKAGE_ROOT="$TOOLCHAIN_ROOT/package"

YOWASP_CLANG_COMMIT=409b7dfdbd5ed12545eed706808fd423f1f692c6
LLVM_COMMIT=9560ae0f2cc440e4fc891fddbc119da6f56daa59
WASI_LIBC_COMMIT=2fc32bc81b9f07f8d9525edea59bfbaf760c06d6

for command in git cmake make ccache curl tar flex bison; do
  command -v "$command" >/dev/null || {
    echo "Required build command is missing: $command" >&2
    exit 1
  }
done

mkdir -p "$WORK_ROOT"
if [[ ! -d "$SOURCE_ROOT/.git" ]]; then
  git clone https://codeberg.org/YoWASP/clang.git "$SOURCE_ROOT"
fi

git -C "$SOURCE_ROOT" fetch origin "$YOWASP_CLANG_COMMIT"
git -C "$SOURCE_ROOT" checkout --detach "$YOWASP_CLANG_COMMIT"
git -C "$SOURCE_ROOT" submodule update --init

actual_llvm_commit=$(git -C "$SOURCE_ROOT/llvm-src" rev-parse HEAD)
actual_wasi_libc_commit=$(git -C "$SOURCE_ROOT/wasi-libc-src" rev-parse HEAD)

[[ "$actual_llvm_commit" == "$LLVM_COMMIT" ]] || {
  echo "Unexpected LLVM commit: $actual_llvm_commit" >&2
  exit 1
}
[[ "$actual_wasi_libc_commit" == "$WASI_LIBC_COMMIT" ]] || {
  echo "Unexpected wasi-libc commit: $actual_wasi_libc_commit" >&2
  exit 1
}

build_jobs=${BUILD_JOBS:-$(getconf _NPROCESSORS_ONLN)}
(
  cd "$SOURCE_ROOT"
  MAKEFLAGS="-j$build_jobs" ./build.sh
)

mkdir -p "$PACKAGE_ROOT/bin" "$PACKAGE_ROOT/sysroot"
cp "$SOURCE_ROOT/llvm-build/bin/llvm" "$PACKAGE_ROOT/bin/llvm.wasm"
cp -R "$SOURCE_ROOT/wasi-prefix/usr/." "$PACKAGE_ROOT/sysroot/"

sha256sum "$PACKAGE_ROOT/bin/llvm.wasm"
echo "Clang 22 source build copied into $PACKAGE_ROOT"
