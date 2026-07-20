import type { Monaco } from "@monaco-editor/react";

const C_KEYWORDS = [
  "alignas",
  "alignof",
  "auto",
  "bool",
  "break",
  "case",
  "char",
  "const",
  "constexpr",
  "continue",
  "default",
  "do",
  "double",
  "else",
  "enum",
  "extern",
  "false",
  "float",
  "for",
  "goto",
  "if",
  "inline",
  "int",
  "long",
  "nullptr",
  "register",
  "restrict",
  "return",
  "short",
  "signed",
  "sizeof",
  "static",
  "static_assert",
  "struct",
  "switch",
  "thread_local",
  "true",
  "typedef",
  "typeof",
  "typeof_unqual",
  "union",
  "unsigned",
  "void",
  "volatile",
  "while",
  "_Atomic",
  "_BitInt",
  "_Complex",
] as const;

interface CPreprocessorCompletion {
  label: string;
  snippet: string;
  description: string;
}

const C_PREPROCESSOR_DIRECTIVES: CPreprocessorCompletion[] = [
  { label: "include", snippet: "include <${1:stdio.h}>", description: "包含头文件。" },
  { label: "define", snippet: "define ${1:NAME} ${2:value}", description: "定义对象式宏。" },
  { label: "undef", snippet: "undef ${1:NAME}", description: "取消宏定义。" },
  { label: "if", snippet: "if ${1:condition}\n${2}\n#endif", description: "按常量表达式条件编译。" },
  { label: "ifdef", snippet: "ifdef ${1:NAME}\n${2}\n#endif", description: "当宏已定义时编译。" },
  { label: "ifndef", snippet: "ifndef ${1:NAME}\n${2}\n#endif", description: "当宏未定义时编译。" },
  { label: "elif", snippet: "elif ${1:condition}", description: "添加条件编译分支。" },
  { label: "elifdef", snippet: "elifdef ${1:NAME}", description: "当宏已定义时添加分支。" },
  { label: "elifndef", snippet: "elifndef ${1:NAME}", description: "当宏未定义时添加分支。" },
  { label: "else", snippet: "else", description: "添加条件编译的默认分支。" },
  { label: "endif", snippet: "endif", description: "结束条件编译块。" },
  { label: "error", snippet: "error ${1:message}", description: "产生预处理错误。" },
  { label: "warning", snippet: "warning ${1:message}", description: "产生预处理警告。" },
  { label: "line", snippet: "line ${1:line}", description: "修改后续诊断中的行号。" },
  { label: "pragma", snippet: "pragma ${1:directive}", description: "传递实现相关指令。" },
  { label: "embed", snippet: "embed \"${1:file}\"", description: "在翻译期间嵌入二进制资源。" },
];

const C_STANDARD_HEADERS = [
  "assert.h",
  "complex.h",
  "ctype.h",
  "errno.h",
  "fenv.h",
  "float.h",
  "inttypes.h",
  "limits.h",
  "locale.h",
  "math.h",
  "setjmp.h",
  "signal.h",
  "stdalign.h",
  "stdarg.h",
  "stdatomic.h",
  "stdbit.h",
  "stdbool.h",
  "stdckdint.h",
  "stddef.h",
  "stdint.h",
  "stdio.h",
  "stdlib.h",
  "stdnoreturn.h",
  "string.h",
  "tgmath.h",
  "threads.h",
  "time.h",
  "uchar.h",
  "wchar.h",
  "wctype.h",
] as const;

interface CFunctionCompletion {
  label: string;
  signature: string;
  snippet: string;
  header: string;
  description: string;
}

const C_FUNCTIONS: CFunctionCompletion[] = [
  { label: "printf", signature: "int printf(const char *format, ...)", snippet: "printf(\"${1:%s}\\n\", ${2:value});", header: "<stdio.h>", description: "按格式写入标准输出。" },
  { label: "scanf", signature: "int scanf(const char *format, ...)", snippet: "scanf(\"${1:%d}\", &${2:value});", header: "<stdio.h>", description: "从标准输入读取格式化数据。" },
  { label: "puts", signature: "int puts(const char *string)", snippet: "puts(\"${1:text}\");", header: "<stdio.h>", description: "输出字符串并追加换行。" },
  { label: "putchar", signature: "int putchar(int character)", snippet: "putchar(${1:character});", header: "<stdio.h>", description: "向标准输出写入一个字符。" },
  { label: "getchar", signature: "int getchar(void)", snippet: "getchar()", header: "<stdio.h>", description: "从标准输入读取一个字符。" },
  { label: "fgets", signature: "char *fgets(char *buffer, int count, FILE *stream)", snippet: "fgets(${1:buffer}, sizeof ${1:buffer}, ${2:stdin})", header: "<stdio.h>", description: "安全地读取一行文本。" },
  { label: "fputs", signature: "int fputs(const char *string, FILE *stream)", snippet: "fputs(${1:text}, ${2:stdout});", header: "<stdio.h>", description: "向流写入字符串。" },
  { label: "fopen", signature: "FILE *fopen(const char *path, const char *mode)", snippet: "fopen(${1:path}, \"${2:r}\")", header: "<stdio.h>", description: "打开文件流。" },
  { label: "fclose", signature: "int fclose(FILE *stream)", snippet: "fclose(${1:file});", header: "<stdio.h>", description: "关闭文件流。" },
  { label: "malloc", signature: "void *malloc(size_t size)", snippet: "malloc(${1:count} * sizeof(${2:type}))", header: "<stdlib.h>", description: "分配未初始化的动态内存。" },
  { label: "calloc", signature: "void *calloc(size_t count, size_t size)", snippet: "calloc(${1:count}, sizeof(${2:type}))", header: "<stdlib.h>", description: "分配清零后的动态内存。" },
  { label: "realloc", signature: "void *realloc(void *pointer, size_t size)", snippet: "realloc(${1:pointer}, ${2:size})", header: "<stdlib.h>", description: "调整动态内存块大小。" },
  { label: "free", signature: "void free(void *pointer)", snippet: "free(${1:pointer});", header: "<stdlib.h>", description: "释放动态内存。" },
  { label: "strlen", signature: "size_t strlen(const char *string)", snippet: "strlen(${1:string})", header: "<string.h>", description: "返回字符串长度。" },
  { label: "strcmp", signature: "int strcmp(const char *left, const char *right)", snippet: "strcmp(${1:left}, ${2:right})", header: "<string.h>", description: "按字典序比较两个字符串。" },
  { label: "strcpy", signature: "char *strcpy(char *destination, const char *source)", snippet: "strcpy(${1:destination}, ${2:source});", header: "<string.h>", description: "复制以空字符结尾的字符串。" },
  { label: "memcpy", signature: "void *memcpy(void *destination, const void *source, size_t count)", snippet: "memcpy(${1:destination}, ${2:source}, ${3:count});", header: "<string.h>", description: "复制不重叠的内存区域。" },
  { label: "memmove", signature: "void *memmove(void *destination, const void *source, size_t count)", snippet: "memmove(${1:destination}, ${2:source}, ${3:count});", header: "<string.h>", description: "复制可以重叠的内存区域。" },
  { label: "memset", signature: "void *memset(void *destination, int value, size_t count)", snippet: "memset(${1:destination}, ${2:0}, ${3:count});", header: "<string.h>", description: "用指定字节填充内存。" },
  { label: "strtol", signature: "long strtol(const char *string, char **end, int base)", snippet: "strtol(${1:text}, &${2:end}, ${3:10})", header: "<stdlib.h>", description: "把字符串转换为长整数并报告结束位置。" },
  { label: "qsort", signature: "void qsort(void *base, size_t count, size_t size, int (*compare)(const void *, const void *))", snippet: "qsort(${1:items}, ${2:count}, sizeof ${1:items}[0], ${3:compare});", header: "<stdlib.h>", description: "使用比较函数排序数组。" },
  { label: "exit", signature: "_Noreturn void exit(int status)", snippet: "exit(${1:EXIT_SUCCESS});", header: "<stdlib.h>", description: "正常终止程序。" },
  { label: "sqrt", signature: "double sqrt(double value)", snippet: "sqrt(${1:value})", header: "<math.h>", description: "计算平方根。" },
  { label: "pow", signature: "double pow(double base, double exponent)", snippet: "pow(${1:base}, ${2:exponent})", header: "<math.h>", description: "计算幂。" },
  { label: "assert", signature: "void assert(scalar expression)", snippet: "assert(${1:condition});", header: "<assert.h>", description: "调试时验证条件。" },
  { label: "time", signature: "time_t time(time_t *result)", snippet: "time(${1:NULL})", header: "<time.h>", description: "获取当前日历时间。" },
];

export function registerCCompletions(monaco: Monaco) {
  return monaco.languages.registerCompletionItemProvider("c", {
    triggerCharacters: ["#", "<", "\""],
    provideCompletionItems(model, position) {
      const line = model.getLineContent(position.lineNumber);
      const linePrefix = line.slice(0, position.column - 1);
      const lineSuffix = line.slice(position.column - 1);
      const includeMatch = linePrefix.match(/^\s*#\s*include\s*([<"])([^>"]*)$/);
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
        return {
          suggestions: C_STANDARD_HEADERS.map((header) => ({
            label: `${opener}${header}${closer}`,
            filterText: header,
            kind: monaco.languages.CompletionItemKind.Module,
            insertText: `${header}${lineSuffix.startsWith(closer) ? "" : closer}`,
            detail: "标准头文件",
            sortText: `0-${header}`,
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
          suggestions: C_PREPROCESSOR_DIRECTIVES.map((item) => ({
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

      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      return {
        suggestions: [
          ...C_KEYWORDS.map((keyword) => ({
            label: keyword,
            kind: monaco.languages.CompletionItemKind.Keyword,
            insertText: keyword,
            detail: "C 关键字",
            sortText: `1-${keyword}`,
            range,
          })),
          ...C_FUNCTIONS.map((item) => ({
            label: item.label,
            kind: monaco.languages.CompletionItemKind.Function,
            insertText: item.snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: `${item.signature}  ·  ${item.header}`,
            documentation: { value: `${item.description}\n\n需要 \`${item.header}\`` },
            sortText: `0-${item.label}`,
            range,
          })),
        ],
      };
    },
  });
}
