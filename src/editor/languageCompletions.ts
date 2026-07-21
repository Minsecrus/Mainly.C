import type { Monaco } from "@monaco-editor/react";
import type * as MonacoEditor from "monaco-editor";

import {
  DEFAULT_LANGUAGE_STANDARDS,
  isCStandard,
  isCppStandard,
  languageStandardLabel,
  type CStandard,
  type CppStandard,
  type LanguageStandard,
  type SourceLanguage,
} from "../languages.js";

interface ModelCompletionContext {
  enabled: boolean;
  standard?: LanguageStandard;
}

interface VersionedName {
  label: string;
  since: LanguageStandard;
}

interface PreprocessorCompletion {
  label: string;
  snippet: string;
  description: string;
  cSince?: CStandard;
  cppSince?: CppStandard;
}

interface SnippetCompletion {
  label: string;
  snippet: string;
  description: string;
  languages: readonly SourceLanguage[];
  since?: LanguageStandard;
}

type LibraryItemKind = "class" | "constant" | "function" | "namespace" | "variable";

interface LibraryCompletion {
  label: string;
  signature: string;
  snippet: string;
  header: string;
  description: string;
  since: LanguageStandard;
  kind?: LibraryItemKind;
}

const modelCompletionContexts = new WeakMap<MonacoEditor.editor.ITextModel, ModelCompletionContext>();

const C_STANDARD_RANK: Record<CStandard, number> = { c99: 99, c11: 111, c23: 123 };
const CPP_STANDARD_RANK: Record<CppStandard, number> = {
  "c++11": 11,
  "c++14": 14,
  "c++17": 17,
  "c++20": 20,
  "c++23": 23,
  "c++26": 26,
};

function versionedNames(since: LanguageStandard, labels: readonly string[]): VersionedName[] {
  return labels.map((label) => ({ label, since }));
}

const C_KEYWORDS: VersionedName[] = [
  ...versionedNames("c99", [
    "auto", "break", "case", "char", "const", "continue", "default", "do", "double",
    "else", "enum", "extern", "float", "for", "goto", "if", "inline", "int", "long",
    "register", "restrict", "return", "short", "signed", "sizeof", "static", "struct",
    "switch", "typedef", "union", "unsigned", "void", "volatile", "while", "_Bool", "_Complex",
  ]),
  ...versionedNames("c11", [
    "_Alignas", "_Alignof", "_Atomic", "_Generic", "_Noreturn", "_Static_assert", "_Thread_local",
  ]),
  ...versionedNames("c23", [
    "alignas", "alignof", "bool", "constexpr", "false", "nullptr", "static_assert",
    "thread_local", "true", "typeof", "typeof_unqual", "_BitInt",
  ]),
];

const CPP_KEYWORDS: VersionedName[] = [
  ...versionedNames("c++11", [
    "alignas", "alignof", "and", "and_eq", "asm", "auto", "bitand", "bitor", "bool", "break",
    "case", "catch", "char", "char16_t", "char32_t", "class", "compl", "const", "const_cast",
    "constexpr", "continue", "decltype", "default", "delete", "do", "double", "dynamic_cast",
    "else", "enum", "explicit", "export", "extern", "false", "final", "float", "for", "friend",
    "goto", "if", "inline", "int", "long", "mutable", "namespace", "new", "noexcept", "not",
    "not_eq", "nullptr", "operator", "or", "or_eq", "override", "private", "protected", "public",
    "register", "reinterpret_cast", "return", "short", "signed", "sizeof", "static", "static_assert",
    "static_cast", "struct", "switch", "template", "this", "thread_local", "throw", "true", "try",
    "typedef", "typeid", "typename", "union", "unsigned", "using", "virtual", "void", "volatile",
    "wchar_t", "while", "xor", "xor_eq",
  ]),
  ...versionedNames("c++20", [
    "char8_t", "concept", "consteval", "constinit", "co_await", "co_return", "co_yield", "import",
    "module", "requires",
  ]),
];

const C_HEADERS: VersionedName[] = [
  ...versionedNames("c99", [
    "assert.h", "complex.h", "ctype.h", "errno.h", "fenv.h", "float.h", "inttypes.h", "iso646.h",
    "limits.h", "locale.h", "math.h", "setjmp.h", "signal.h", "stdarg.h", "stdbool.h", "stddef.h",
    "stdint.h", "stdio.h", "stdlib.h", "string.h", "tgmath.h", "time.h", "wchar.h", "wctype.h",
  ]),
  ...versionedNames("c11", [
    "stdalign.h", "stdatomic.h", "stdnoreturn.h", "threads.h", "uchar.h",
  ]),
  ...versionedNames("c23", ["stdbit.h", "stdckdint.h"]),
];

const CPP_HEADERS: VersionedName[] = [
  ...versionedNames("c++11", [
    "algorithm", "array", "atomic", "bitset", "cassert", "cctype", "cerrno", "cfenv", "cfloat",
    "chrono", "cinttypes", "climits", "clocale", "cmath", "complex", "condition_variable", "csetjmp",
    "csignal", "cstdarg", "cstddef", "cstdint", "cstdio", "cstdlib", "cstring", "ctime", "cuchar",
    "cwchar", "cwctype", "deque", "exception", "forward_list", "fstream", "functional", "future",
    "initializer_list", "iomanip", "ios", "iosfwd", "iostream", "istream", "iterator", "limits",
    "list", "locale", "map", "memory", "mutex", "new", "numeric", "ostream", "queue", "random",
    "ratio", "regex", "scoped_allocator", "set", "sstream", "stack", "stdexcept", "streambuf",
    "string", "system_error", "thread", "tuple", "type_traits", "typeindex", "typeinfo",
    "unordered_map", "unordered_set", "utility", "valarray", "vector",
  ]),
  ...versionedNames("c++14", ["shared_mutex"]),
  ...versionedNames("c++17", [
    "any", "charconv", "execution", "filesystem", "memory_resource", "optional", "string_view", "variant",
  ]),
  ...versionedNames("c++20", [
    "barrier", "bit", "compare", "concepts", "coroutine", "format", "latch", "numbers", "ranges",
    "semaphore", "source_location", "span", "stop_token", "syncstream", "version",
  ]),
  ...versionedNames("c++23", ["expected", "flat_map", "flat_set", "mdspan", "print"]),
];

const PREPROCESSOR_COMPLETIONS: PreprocessorCompletion[] = [
  { label: "include", snippet: "include <${1:stdio.h}>", description: "包含头文件。", cSince: "c99", cppSince: "c++11" },
  { label: "define", snippet: "define ${1:NAME} ${2:value}", description: "定义对象式宏。", cSince: "c99", cppSince: "c++11" },
  { label: "undef", snippet: "undef ${1:NAME}", description: "取消宏定义。", cSince: "c99", cppSince: "c++11" },
  { label: "if", snippet: "if ${1:condition}\n${2}\n#endif", description: "按常量表达式条件编译。", cSince: "c99", cppSince: "c++11" },
  { label: "ifdef", snippet: "ifdef ${1:NAME}\n${2}\n#endif", description: "当宏已定义时编译。", cSince: "c99", cppSince: "c++11" },
  { label: "ifndef", snippet: "ifndef ${1:NAME}\n${2}\n#endif", description: "当宏未定义时编译。", cSince: "c99", cppSince: "c++11" },
  { label: "elif", snippet: "elif ${1:condition}", description: "添加条件编译分支。", cSince: "c99", cppSince: "c++11" },
  { label: "else", snippet: "else", description: "添加条件编译的默认分支。", cSince: "c99", cppSince: "c++11" },
  { label: "endif", snippet: "endif", description: "结束条件编译块。", cSince: "c99", cppSince: "c++11" },
  { label: "error", snippet: "error ${1:message}", description: "产生预处理错误。", cSince: "c99", cppSince: "c++11" },
  { label: "line", snippet: "line ${1:line}", description: "修改后续诊断中的行号。", cSince: "c99", cppSince: "c++11" },
  { label: "pragma", snippet: "pragma ${1:directive}", description: "传递实现相关指令。", cSince: "c99", cppSince: "c++11" },
  { label: "elifdef", snippet: "elifdef ${1:NAME}", description: "当宏已定义时添加分支。", cSince: "c23", cppSince: "c++23" },
  { label: "elifndef", snippet: "elifndef ${1:NAME}", description: "当宏未定义时添加分支。", cSince: "c23", cppSince: "c++23" },
  { label: "warning", snippet: "warning ${1:message}", description: "产生预处理警告。", cSince: "c23", cppSince: "c++23" },
  { label: "embed", snippet: "embed \"${1:file}\"", description: "在翻译期间嵌入二进制资源。", cSince: "c23", cppSince: "c++26" },
];

const LANGUAGE_SNIPPETS: SnippetCompletion[] = [
  { label: "main", snippet: "int main(void) {\n    ${1}\n}", description: "C 程序入口。", languages: ["c"] },
  { label: "main", snippet: "int main() {\n    ${1}\n}", description: "C++ 程序入口。", languages: ["cpp"] },
  { label: "if", snippet: "if (${1:condition}) {\n    ${2}\n}", description: "条件语句。", languages: ["c", "cpp"] },
  { label: "ifelse", snippet: "if (${1:condition}) {\n    ${2}\n} else {\n    ${3}\n}", description: "带 else 的条件语句。", languages: ["c", "cpp"] },
  { label: "for", snippet: "for (${1:int i = 0}; ${2:i < count}; ${3:++i}) {\n    ${4}\n}", description: "计数循环。", languages: ["c", "cpp"] },
  { label: "while", snippet: "while (${1:condition}) {\n    ${2}\n}", description: "while 循环。", languages: ["c", "cpp"] },
  { label: "do", snippet: "do {\n    ${1}\n} while (${2:condition});", description: "do-while 循环。", languages: ["c", "cpp"] },
  { label: "switch", snippet: "switch (${1:value}) {\ncase ${2:value}:\n    ${3}\n    break;\ndefault:\n    break;\n}", description: "switch 分支。", languages: ["c", "cpp"] },
  { label: "struct", snippet: "struct ${1:Name} {\n    ${2}\n};", description: "结构体定义。", languages: ["c", "cpp"] },
  { label: "class", snippet: "class ${1:Name} {\npublic:\n    ${2}\n};", description: "类定义。", languages: ["cpp"], since: "c++11" },
  { label: "namespace", snippet: "namespace ${1:name} {\n${2}\n}", description: "命名空间。", languages: ["cpp"], since: "c++11" },
  { label: "rangefor", snippet: "for (${1:const auto& item} : ${2:items}) {\n    ${3}\n}", description: "范围 for 循环。", languages: ["cpp"], since: "c++11" },
];

const C_LIBRARY_COMPLETIONS: LibraryCompletion[] = [
  { label: "printf", signature: "int printf(const char *format, ...)", snippet: "printf(\"${1:%s}\\n\", ${2:value});", header: "<stdio.h>", description: "按格式写入标准输出。", since: "c99" },
  { label: "fprintf", signature: "int fprintf(FILE *stream, const char *format, ...)", snippet: "fprintf(${1:stderr}, \"${2:%s}\\n\", ${3:value});", header: "<stdio.h>", description: "向指定流写入格式化输出。", since: "c99" },
  { label: "snprintf", signature: "int snprintf(char *buffer, size_t size, const char *format, ...)", snippet: "snprintf(${1:buffer}, sizeof ${1:buffer}, \"${2:%s}\", ${3:value});", header: "<stdio.h>", description: "把格式化结果写入有限大小的缓冲区。", since: "c99" },
  { label: "scanf", signature: "int scanf(const char *format, ...)", snippet: "scanf(\"${1:%d}\", &${2:value});", header: "<stdio.h>", description: "从标准输入读取格式化数据。", since: "c99" },
  { label: "sscanf", signature: "int sscanf(const char *text, const char *format, ...)", snippet: "sscanf(${1:text}, \"${2:%d}\", &${3:value});", header: "<stdio.h>", description: "从字符串读取格式化数据。", since: "c99" },
  { label: "puts", signature: "int puts(const char *string)", snippet: "puts(\"${1:text}\");", header: "<stdio.h>", description: "输出字符串并追加换行。", since: "c99" },
  { label: "putchar", signature: "int putchar(int character)", snippet: "putchar(${1:character});", header: "<stdio.h>", description: "输出一个字符。", since: "c99" },
  { label: "getchar", signature: "int getchar(void)", snippet: "getchar()", header: "<stdio.h>", description: "读取一个字符。", since: "c99" },
  { label: "fgets", signature: "char *fgets(char *buffer, int count, FILE *stream)", snippet: "fgets(${1:buffer}, sizeof ${1:buffer}, ${2:stdin})", header: "<stdio.h>", description: "安全地读取一行文本。", since: "c99" },
  { label: "fputs", signature: "int fputs(const char *string, FILE *stream)", snippet: "fputs(${1:text}, ${2:stdout});", header: "<stdio.h>", description: "向流写入字符串。", since: "c99" },
  { label: "fopen", signature: "FILE *fopen(const char *path, const char *mode)", snippet: "fopen(${1:path}, \"${2:r}\")", header: "<stdio.h>", description: "打开文件流。", since: "c99" },
  { label: "fclose", signature: "int fclose(FILE *stream)", snippet: "fclose(${1:file});", header: "<stdio.h>", description: "关闭文件流。", since: "c99" },
  { label: "perror", signature: "void perror(const char *prefix)", snippet: "perror(\"${1:error}\");", header: "<stdio.h>", description: "输出当前 errno 对应的错误信息。", since: "c99" },
  { label: "remove", signature: "int remove(const char *path)", snippet: "remove(${1:path})", header: "<stdio.h>", description: "删除文件。", since: "c99" },
  { label: "rename", signature: "int rename(const char *old_path, const char *new_path)", snippet: "rename(${1:old_path}, ${2:new_path})", header: "<stdio.h>", description: "重命名文件。", since: "c99" },
  { label: "malloc", signature: "void *malloc(size_t size)", snippet: "malloc(${1:count} * sizeof(${2:type}))", header: "<stdlib.h>", description: "分配未初始化的动态内存。", since: "c99" },
  { label: "calloc", signature: "void *calloc(size_t count, size_t size)", snippet: "calloc(${1:count}, sizeof(${2:type}))", header: "<stdlib.h>", description: "分配清零后的动态内存。", since: "c99" },
  { label: "realloc", signature: "void *realloc(void *pointer, size_t size)", snippet: "realloc(${1:pointer}, ${2:size})", header: "<stdlib.h>", description: "调整动态内存块大小。", since: "c99" },
  { label: "free", signature: "void free(void *pointer)", snippet: "free(${1:pointer});", header: "<stdlib.h>", description: "释放动态内存。", since: "c99" },
  { label: "strtol", signature: "long strtol(const char *text, char **end, int base)", snippet: "strtol(${1:text}, &${2:end}, ${3:10})", header: "<stdlib.h>", description: "把字符串转换为长整数。", since: "c99" },
  { label: "strtod", signature: "double strtod(const char *text, char **end)", snippet: "strtod(${1:text}, &${2:end})", header: "<stdlib.h>", description: "把字符串转换为双精度浮点数。", since: "c99" },
  { label: "qsort", signature: "void qsort(void *base, size_t count, size_t size, int (*compare)(const void *, const void *))", snippet: "qsort(${1:items}, ${2:count}, sizeof ${1:items}[0], ${3:compare});", header: "<stdlib.h>", description: "使用比较函数排序数组。", since: "c99" },
  { label: "bsearch", signature: "void *bsearch(const void *key, const void *base, size_t count, size_t size, int (*compare)(const void *, const void *))", snippet: "bsearch(&${1:key}, ${2:items}, ${3:count}, sizeof ${2:items}[0], ${4:compare})", header: "<stdlib.h>", description: "在有序数组中执行二分查找。", since: "c99" },
  { label: "exit", signature: "_Noreturn void exit(int status)", snippet: "exit(${1:EXIT_SUCCESS});", header: "<stdlib.h>", description: "正常终止程序。", since: "c99" },
  { label: "aligned_alloc", signature: "void *aligned_alloc(size_t alignment, size_t size)", snippet: "aligned_alloc(${1:alignment}, ${2:size})", header: "<stdlib.h>", description: "分配指定对齐的内存。", since: "c11" },
  { label: "quick_exit", signature: "_Noreturn void quick_exit(int status)", snippet: "quick_exit(${1:EXIT_SUCCESS});", header: "<stdlib.h>", description: "快速终止程序。", since: "c11" },
  { label: "strlen", signature: "size_t strlen(const char *string)", snippet: "strlen(${1:string})", header: "<string.h>", description: "返回字符串长度。", since: "c99" },
  { label: "strcmp", signature: "int strcmp(const char *left, const char *right)", snippet: "strcmp(${1:left}, ${2:right})", header: "<string.h>", description: "按字典序比较字符串。", since: "c99" },
  { label: "strcpy", signature: "char *strcpy(char *destination, const char *source)", snippet: "strcpy(${1:destination}, ${2:source});", header: "<string.h>", description: "复制字符串。", since: "c99" },
  { label: "strncpy", signature: "char *strncpy(char *destination, const char *source, size_t count)", snippet: "strncpy(${1:destination}, ${2:source}, ${3:count});", header: "<string.h>", description: "复制限定数量的字符。", since: "c99" },
  { label: "strcat", signature: "char *strcat(char *destination, const char *source)", snippet: "strcat(${1:destination}, ${2:source});", header: "<string.h>", description: "拼接字符串。", since: "c99" },
  { label: "strchr", signature: "char *strchr(const char *string, int character)", snippet: "strchr(${1:string}, ${2:character})", header: "<string.h>", description: "查找字符。", since: "c99" },
  { label: "strstr", signature: "char *strstr(const char *text, const char *needle)", snippet: "strstr(${1:text}, ${2:needle})", header: "<string.h>", description: "查找子字符串。", since: "c99" },
  { label: "memcpy", signature: "void *memcpy(void *destination, const void *source, size_t count)", snippet: "memcpy(${1:destination}, ${2:source}, ${3:count});", header: "<string.h>", description: "复制不重叠的内存区域。", since: "c99" },
  { label: "memmove", signature: "void *memmove(void *destination, const void *source, size_t count)", snippet: "memmove(${1:destination}, ${2:source}, ${3:count});", header: "<string.h>", description: "复制可以重叠的内存区域。", since: "c99" },
  { label: "memset", signature: "void *memset(void *destination, int value, size_t count)", snippet: "memset(${1:destination}, ${2:0}, ${3:count});", header: "<string.h>", description: "用指定字节填充内存。", since: "c99" },
  { label: "strdup", signature: "char *strdup(const char *string)", snippet: "strdup(${1:string})", header: "<string.h>", description: "复制字符串并分配存储空间。", since: "c23" },
  { label: "strndup", signature: "char *strndup(const char *string, size_t count)", snippet: "strndup(${1:string}, ${2:count})", header: "<string.h>", description: "复制限定长度的字符串并分配存储空间。", since: "c23" },
  { label: "isalpha", signature: "int isalpha(int character)", snippet: "isalpha(${1:character})", header: "<ctype.h>", description: "判断字符是否为字母。", since: "c99" },
  { label: "isdigit", signature: "int isdigit(int character)", snippet: "isdigit(${1:character})", header: "<ctype.h>", description: "判断字符是否为十进制数字。", since: "c99" },
  { label: "isspace", signature: "int isspace(int character)", snippet: "isspace(${1:character})", header: "<ctype.h>", description: "判断字符是否为空白字符。", since: "c99" },
  { label: "tolower", signature: "int tolower(int character)", snippet: "tolower(${1:character})", header: "<ctype.h>", description: "把字符转换为小写。", since: "c99" },
  { label: "toupper", signature: "int toupper(int character)", snippet: "toupper(${1:character})", header: "<ctype.h>", description: "把字符转换为大写。", since: "c99" },
  { label: "sqrt", signature: "double sqrt(double value)", snippet: "sqrt(${1:value})", header: "<math.h>", description: "计算平方根。", since: "c99" },
  { label: "pow", signature: "double pow(double base, double exponent)", snippet: "pow(${1:base}, ${2:exponent})", header: "<math.h>", description: "计算幂。", since: "c99" },
  { label: "sin", signature: "double sin(double angle)", snippet: "sin(${1:angle})", header: "<math.h>", description: "计算正弦。", since: "c99" },
  { label: "cos", signature: "double cos(double angle)", snippet: "cos(${1:angle})", header: "<math.h>", description: "计算余弦。", since: "c99" },
  { label: "assert", signature: "void assert(scalar expression)", snippet: "assert(${1:condition});", header: "<assert.h>", description: "调试时验证条件。", since: "c99" },
  { label: "time", signature: "time_t time(time_t *result)", snippet: "time(${1:NULL})", header: "<time.h>", description: "获取当前日历时间。", since: "c99" },
];

const CPP_LIBRARY_COMPLETIONS: LibraryCompletion[] = [
  { label: "cout", signature: "std::ostream std::cout", snippet: "cout << ${1:value}", header: "<iostream>", description: "标准输出流。", since: "c++11", kind: "variable" },
  { label: "cin", signature: "std::istream std::cin", snippet: "cin >> ${1:value}", header: "<iostream>", description: "标准输入流。", since: "c++11", kind: "variable" },
  { label: "cerr", signature: "std::ostream std::cerr", snippet: "cerr << ${1:error}", header: "<iostream>", description: "标准错误流。", since: "c++11", kind: "variable" },
  { label: "endl", signature: "std::endl", snippet: "endl", header: "<ostream>", description: "输出换行并刷新流。", since: "c++11", kind: "function" },
  { label: "string", signature: "std::string", snippet: "string", header: "<string>", description: "动态字符串类型。", since: "c++11", kind: "class" },
  { label: "vector", signature: "template<class T> class std::vector", snippet: "vector<${1:int}>", header: "<vector>", description: "动态连续数组。", since: "c++11", kind: "class" },
  { label: "array", signature: "template<class T, size_t N> struct std::array", snippet: "array<${1:int}, ${2:size}>", header: "<array>", description: "固定大小数组。", since: "c++11", kind: "class" },
  { label: "deque", signature: "template<class T> class std::deque", snippet: "deque<${1:int}>", header: "<deque>", description: "双端队列。", since: "c++11", kind: "class" },
  { label: "list", signature: "template<class T> class std::list", snippet: "list<${1:int}>", header: "<list>", description: "双向链表。", since: "c++11", kind: "class" },
  { label: "map", signature: "template<class Key, class T> class std::map", snippet: "map<${1:Key}, ${2:Value}>", header: "<map>", description: "有序键值容器。", since: "c++11", kind: "class" },
  { label: "set", signature: "template<class Key> class std::set", snippet: "set<${1:Key}>", header: "<set>", description: "有序唯一值容器。", since: "c++11", kind: "class" },
  { label: "unordered_map", signature: "template<class Key, class T> class std::unordered_map", snippet: "unordered_map<${1:Key}, ${2:Value}>", header: "<unordered_map>", description: "哈希键值容器。", since: "c++11", kind: "class" },
  { label: "unordered_set", signature: "template<class Key> class std::unordered_set", snippet: "unordered_set<${1:Key}>", header: "<unordered_set>", description: "哈希唯一值容器。", since: "c++11", kind: "class" },
  { label: "unique_ptr", signature: "template<class T> class std::unique_ptr", snippet: "unique_ptr<${1:Type}>", header: "<memory>", description: "独占所有权智能指针。", since: "c++11", kind: "class" },
  { label: "shared_ptr", signature: "template<class T> class std::shared_ptr", snippet: "shared_ptr<${1:Type}>", header: "<memory>", description: "共享所有权智能指针。", since: "c++11", kind: "class" },
  { label: "make_shared", signature: "std::shared_ptr<T> std::make_shared(Args&&...)", snippet: "make_shared<${1:Type}>(${2:arguments})", header: "<memory>", description: "创建 shared_ptr。", since: "c++11" },
  { label: "make_unique", signature: "std::unique_ptr<T> std::make_unique(Args&&...)", snippet: "make_unique<${1:Type}>(${2:arguments})", header: "<memory>", description: "创建 unique_ptr。", since: "c++14" },
  { label: "move", signature: "std::remove_reference_t<T>&& std::move(T&& value)", snippet: "move(${1:value})", header: "<utility>", description: "把表达式转换为右值。", since: "c++11" },
  { label: "forward", signature: "T&& std::forward(std::remove_reference_t<T>& value)", snippet: "forward<${1:Type}>(${2:value})", header: "<utility>", description: "保持值类别进行完美转发。", since: "c++11" },
  { label: "sort", signature: "void std::sort(RandomIt first, RandomIt last)", snippet: "sort(${1:items}.begin(), ${1:items}.end())", header: "<algorithm>", description: "排序范围。", since: "c++11" },
  { label: "find", signature: "InputIt std::find(InputIt first, InputIt last, const T& value)", snippet: "find(${1:items}.begin(), ${1:items}.end(), ${2:value})", header: "<algorithm>", description: "在线性范围中查找值。", since: "c++11" },
  { label: "accumulate", signature: "T std::accumulate(InputIt first, InputIt last, T init)", snippet: "accumulate(${1:items}.begin(), ${1:items}.end(), ${2:0})", header: "<numeric>", description: "累加范围。", since: "c++11" },
  { label: "min", signature: "const T& std::min(const T& left, const T& right)", snippet: "min(${1:left}, ${2:right})", header: "<algorithm>", description: "返回较小值。", since: "c++11" },
  { label: "max", signature: "const T& std::max(const T& left, const T& right)", snippet: "max(${1:left}, ${2:right})", header: "<algorithm>", description: "返回较大值。", since: "c++11" },
  { label: "tuple", signature: "template<class... Types> class std::tuple", snippet: "tuple<${1:Types...}>", header: "<tuple>", description: "固定大小异构值集合。", since: "c++11", kind: "class" },
  { label: "make_tuple", signature: "std::tuple<...> std::make_tuple(Types&&...)", snippet: "make_tuple(${1:values})", header: "<tuple>", description: "创建 tuple。", since: "c++11" },
  { label: "function", signature: "template<class Signature> class std::function", snippet: "function<${1:void()}>", header: "<functional>", description: "通用可调用对象包装器。", since: "c++11", kind: "class" },
  { label: "thread", signature: "class std::thread", snippet: "thread(${1:function}, ${2:arguments})", header: "<thread>", description: "线程对象。", since: "c++11", kind: "class" },
  { label: "mutex", signature: "class std::mutex", snippet: "mutex", header: "<mutex>", description: "互斥锁。", since: "c++11", kind: "class" },
  { label: "optional", signature: "template<class T> class std::optional", snippet: "optional<${1:Type}>", header: "<optional>", description: "可选值。", since: "c++17", kind: "class" },
  { label: "variant", signature: "template<class... Types> class std::variant", snippet: "variant<${1:Types...}>", header: "<variant>", description: "类型安全联合体。", since: "c++17", kind: "class" },
  { label: "any", signature: "class std::any", snippet: "any", header: "<any>", description: "类型安全的任意值容器。", since: "c++17", kind: "class" },
  { label: "string_view", signature: "class std::string_view", snippet: "string_view", header: "<string_view>", description: "非拥有字符串视图。", since: "c++17", kind: "class" },
  { label: "filesystem", signature: "namespace std::filesystem", snippet: "filesystem", header: "<filesystem>", description: "文件系统操作命名空间。", since: "c++17", kind: "namespace" },
  { label: "span", signature: "template<class T, size_t Extent> class std::span", snippet: "span<${1:Type}>", header: "<span>", description: "连续对象序列视图。", since: "c++20", kind: "class" },
  { label: "format", signature: "std::string std::format(format_string<Args...>, Args&&...)", snippet: "format(\"${1:{}}\", ${2:value})", header: "<format>", description: "格式化为字符串。", since: "c++20" },
  { label: "ranges", signature: "namespace std::ranges", snippet: "ranges", header: "<ranges>", description: "范围库命名空间。", since: "c++20", kind: "namespace" },
  { label: "jthread", signature: "class std::jthread", snippet: "jthread(${1:function}, ${2:arguments})", header: "<thread>", description: "自动合并的可停止线程。", since: "c++20", kind: "class" },
  { label: "print", signature: "void std::print(format_string<Args...>, Args&&...)", snippet: "print(\"${1:text}\");", header: "<print>", description: "输出格式化文本。", since: "c++23" },
  { label: "println", signature: "void std::println(format_string<Args...>, Args&&...)", snippet: "println(\"${1:text}\");", header: "<print>", description: "输出格式化文本并换行。", since: "c++23" },
  { label: "expected", signature: "template<class T, class E> class std::expected", snippet: "expected<${1:Value}, ${2:Error}>", header: "<expected>", description: "保存预期值或错误。", since: "c++23", kind: "class" },
];

function isAvailable(standard: LanguageStandard, since: LanguageStandard): boolean {
  if (isCStandard(standard) && isCStandard(since)) {
    return C_STANDARD_RANK[standard] >= C_STANDARD_RANK[since];
  }
  if (isCppStandard(standard) && isCppStandard(since)) {
    return CPP_STANDARD_RANK[standard] >= CPP_STANDARD_RANK[since];
  }
  return false;
}

function currentStandard(language: SourceLanguage, context?: ModelCompletionContext): LanguageStandard {
  if (language === "c" && isCStandard(context?.standard)) return context.standard;
  if (language === "cpp" && isCppStandard(context?.standard)) return context.standard;
  return DEFAULT_LANGUAGE_STANDARDS[language];
}

function availablePreprocessorItems(
  language: SourceLanguage,
  standard: LanguageStandard,
): PreprocessorCompletion[] {
  return PREPROCESSOR_COMPLETIONS.filter((item) => {
    const since = language === "c" ? item.cSince : item.cppSince;
    return since !== undefined && isAvailable(standard, since);
  });
}

function completionKind(monaco: Monaco, kind: LibraryItemKind = "function") {
  switch (kind) {
    case "class": return monaco.languages.CompletionItemKind.Class;
    case "constant": return monaco.languages.CompletionItemKind.Constant;
    case "namespace": return monaco.languages.CompletionItemKind.Module;
    case "variable": return monaco.languages.CompletionItemKind.Variable;
    default: return monaco.languages.CompletionItemKind.Function;
  }
}

function registerProvider(monaco: Monaco, language: SourceLanguage): void {
  monaco.languages.registerCompletionItemProvider(language, {
    triggerCharacters: language === "cpp" ? ["#", "<", "\"", ":"] : ["#", "<", "\""],
    provideCompletionItems(model, position) {
      const context = modelCompletionContexts.get(model);
      if (!context?.enabled) return { suggestions: [] };

      const standard = currentStandard(language, context);
      const line = model.getLineContent(position.lineNumber);
      const linePrefix = line.slice(0, position.column - 1);
      const lineSuffix = line.slice(position.column - 1);
      const includeMatch = linePrefix.match(/^\s*#\s*include\s*([<\"])([^>\"]*)$/);
      if (includeMatch) {
        const opener = includeMatch[1];
        const typed = includeMatch[2];
        const closer = opener === "<" ? ">" : "\"";
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column,
        };
        const headers = (language === "c" ? C_HEADERS : CPP_HEADERS)
          .filter((item) => isAvailable(standard, item.since));
        return {
          suggestions: headers.map((header) => ({
            label: `${opener}${header.label}${closer}`,
            filterText: header.label,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: `${header.label}${lineSuffix.startsWith(closer) ? "" : closer}`,
            detail: `${languageStandardLabel(header.since)} 标准头文件`,
            sortText: `0-${header.label}`,
            range,
          })),
        };
      }

      const directiveMatch = linePrefix.match(/^\s*#\s*([A-Za-z_]*)$/);
      if (directiveMatch) {
        const typed = directiveMatch[1];
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column,
        };
        return {
          suggestions: availablePreprocessorItems(language, standard).map((item) => ({
            label: `#${item.label}`,
            filterText: item.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: item.snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: "预处理指令",
            documentation: item.description,
            sortText: `0-${item.label}`,
            range,
          })),
        };
      }

      const stdMatch = language === "cpp" ? linePrefix.match(/\bstd::([A-Za-z_]*)$/) : null;
      if (stdMatch) {
        const typed = stdMatch[1];
        const range = {
          startLineNumber: position.lineNumber,
          endLineNumber: position.lineNumber,
          startColumn: position.column - typed.length,
          endColumn: position.column,
        };
        return {
          suggestions: CPP_LIBRARY_COMPLETIONS
            .filter((item) => isAvailable(standard, item.since))
            .map((item) => ({
              label: item.label,
              kind: completionKind(monaco, item.kind),
              insertText: item.snippet,
              insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
              detail: `${item.signature}  ·  ${item.header}`,
              documentation: { value: `${item.description}\n\n需要 \`${item.header}\` · ${languageStandardLabel(item.since)} 起` },
              sortText: `0-${item.label}`,
              range,
            })),
        };
      }

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };
      const keywords = (language === "c" ? C_KEYWORDS : CPP_KEYWORDS)
        .filter((item) => isAvailable(standard, item.since));
      const snippets = LANGUAGE_SNIPPETS.filter((item) =>
        item.languages.includes(language) && (!item.since || isAvailable(standard, item.since))
      );
      const libraryItems = (language === "c" ? C_LIBRARY_COMPLETIONS : CPP_LIBRARY_COMPLETIONS)
        .filter((item) => isAvailable(standard, item.since));

      return {
        suggestions: [
          ...libraryItems.map((item) => ({
            label: language === "cpp" ? `std::${item.label}` : item.label,
            filterText: language === "cpp" ? `${item.label} std::${item.label}` : item.label,
            kind: completionKind(monaco, item.kind),
            insertText: language === "cpp" ? `std::${item.snippet}` : item.snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: `${item.signature}  ·  ${item.header}`,
            documentation: { value: `${item.description}\n\n需要 \`${item.header}\` · ${languageStandardLabel(item.since)} 起` },
            sortText: `0-${item.label}`,
            range,
          })),
          ...snippets.map((item) => ({
            label: item.label,
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertText: item.snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: item.description,
            sortText: `1-${item.label}`,
            range,
          })),
          ...keywords.map((keyword) => ({
            label: keyword.label,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword.label,
            detail: `${languageStandardLabel(keyword.since)} 关键字`,
            sortText: `2-${keyword.label}`,
            range,
          })),
        ],
      };
    },
  });
}

export function setModelCompletionContext(
  model: MonacoEditor.editor.ITextModel,
  context: ModelCompletionContext,
): void {
  modelCompletionContexts.set(model, context);
}

export function clearModelCompletionContext(model: MonacoEditor.editor.ITextModel): void {
  modelCompletionContexts.delete(model);
}

export function registerLanguageCompletions(monaco: Monaco): void {
  registerProvider(monaco, "c");
  registerProvider(monaco, "cpp");
}
