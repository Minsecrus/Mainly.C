#include <ctype.h>
#include <errno.h>
#include <inttypes.h>
#include <limits.h>
#include <math.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

constexpr size_t INITIAL_CAPACITY = 8;

static_assert(sizeof(uint64_t) == 8, "This example requires a 64-bit uint64_t");

typedef struct {
    int *data;
    size_t length;
    size_t capacity;
} IntVector;

typedef enum {
    PARSE_OK,
    PARSE_INVALID,
    PARSE_OUT_OF_MEMORY
} ParseStatus;

typedef struct {
    int minimum;
    int maximum;
    int mode;
    size_t mode_count;
    size_t prime_count;
    double mean;
    double median;
    double standard_deviation;
    uint64_t hash;
} Statistics;

static bool vector_push(IntVector *vector, int value) {
    if (vector->length == vector->capacity) {
        if (vector->capacity > SIZE_MAX / 2) {
            return false;
        }

        const size_t next_capacity = vector->capacity == 0
            ? INITIAL_CAPACITY
            : vector->capacity * 2;
        if (next_capacity > SIZE_MAX / sizeof *vector->data) {
            return false;
        }

        int *resized = realloc(vector->data, next_capacity * sizeof *vector->data);
        if (resized == nullptr) {
            return false;
        }
        vector->data = resized;
        vector->capacity = next_capacity;
    }

    vector->data[vector->length] = value;
    ++vector->length;
    return true;
}

[[nodiscard]] static ParseStatus parse_values(char *line, IntVector *values) {
    char *cursor = line;

    while (true) {
        while (isspace((unsigned char)*cursor) != 0) {
            ++cursor;
        }
        if (*cursor == '\0') {
            break;
        }

        errno = 0;
        char *end = nullptr;
        const long parsed = strtol(cursor, &end, 10);
        if (end == cursor || errno == ERANGE || parsed < INT_MIN || parsed > INT_MAX) {
            return PARSE_INVALID;
        }
        if (!vector_push(values, (int)parsed)) {
            return PARSE_OUT_OF_MEMORY;
        }
        cursor = end;
    }

    return values->length == 0 ? PARSE_INVALID : PARSE_OK;
}

[[nodiscard]] static bool parse_single_int(char *line, int *result) {
    char *cursor = line;
    while (isspace((unsigned char)*cursor) != 0) {
        ++cursor;
    }

    errno = 0;
    char *end = nullptr;
    const long parsed = strtol(cursor, &end, 10);
    if (end == cursor || errno == ERANGE || parsed < INT_MIN || parsed > INT_MAX) {
        return false;
    }
    while (isspace((unsigned char)*end) != 0) {
        ++end;
    }
    if (*end != '\0') {
        return false;
    }

    *result = (int)parsed;
    return true;
}

static int compare_ints(const void *left, const void *right) {
    const int lhs = *(const int *)left;
    const int rhs = *(const int *)right;
    return (lhs > rhs) - (lhs < rhs);
}

static bool is_prime(int value) {
    if (value < 2) {
        return false;
    }
    for (int divisor = 2; divisor <= value / divisor; ++divisor) {
        if (value % divisor == 0) {
            return false;
        }
    }
    return true;
}

static uint64_t hash_values(const int *values, size_t count) {
    uint64_t hash = UINT64_C(14695981039346656037);
    for (size_t index = 0; index < count; ++index) {
        hash ^= (uint32_t)values[index];
        hash *= UINT64_C(1099511628211);
    }
    return hash;
}

static Statistics analyze(const int *values, size_t count) {
    Statistics result = {
        .minimum = values[0],
        .maximum = values[count - 1],
        .mode = values[0],
        .mode_count = 1,
        .prime_count = 0,
        .mean = 0.0,
        .median = 0.0,
        .standard_deviation = 0.0,
        .hash = 0,
    };

    double sum = 0.0;
    size_t current_count = 1;
    for (size_t index = 0; index < count; ++index) {
        sum += (double)values[index];
        if (is_prime(values[index])) {
            ++result.prime_count;
        }
        if (index > 0) {
            if (values[index] == values[index - 1]) {
                ++current_count;
            } else {
                current_count = 1;
            }
            if (current_count > result.mode_count) {
                result.mode = values[index];
                result.mode_count = current_count;
            }
        }
    }

    result.mean = sum / (double)count;
    if (count % 2 == 0) {
        result.median = ((double)values[count / 2 - 1] + (double)values[count / 2]) / 2.0;
    } else {
        result.median = (double)values[count / 2];
    }

    double squared_error_sum = 0.0;
    for (size_t index = 0; index < count; ++index) {
        const double difference = (double)values[index] - result.mean;
        squared_error_sum += difference * difference;
    }
    result.standard_deviation = sqrt(squared_error_sum / (double)count);
    result.hash = hash_values(values, count);
    return result;
}

[[nodiscard]] static bool find_first(
    const int *values,
    size_t count,
    int target,
    size_t *position
) {
    size_t left = 0;
    size_t right = count;

    while (left < right) {
        const size_t middle = left + (right - left) / 2;
        if (values[middle] < target) {
            left = middle + 1;
        } else {
            right = middle;
        }
    }

    if (left < count && values[left] == target) {
        *position = left;
        return true;
    }
    return false;
}

static void print_values(const int *values, size_t count) {
    for (size_t index = 0; index < count; ++index) {
        printf("%s%d", index == 0 ? "" : ", ", values[index]);
    }
    putchar('\n');
}

static void print_primes(const int *values, size_t count) {
    bool first = true;
    for (size_t index = 0; index < count; ++index) {
        if (is_prime(values[index])) {
            printf("%s%d", first ? "" : ", ", values[index]);
            first = false;
        }
    }
    if (first) {
        printf("（没有）");
    }
    putchar('\n');
}

int main(void) {
    char line[1024];
    IntVector values = { .data = nullptr, .length = 0, .capacity = 0 };

    printf("请输入一组整数（空格分隔）: ");
    fflush(stdout);
    if (fgets(line, sizeof line, stdin) == nullptr) {
        fputs("读取输入失败。\n", stderr);
        return EXIT_FAILURE;
    }

    const ParseStatus status = parse_values(line, &values);
    if (status != PARSE_OK) {
        fputs(
            status == PARSE_OUT_OF_MEMORY ? "内存不足。\n" : "输入包含无效整数。\n",
            stderr
        );
        free(values.data);
        return EXIT_FAILURE;
    }

    qsort(values.data, values.length, sizeof *values.data, compare_ints);
    const Statistics statistics = analyze(values.data, values.length);

    printf("\n排序结果: ");
    print_values(values.data, values.length);
    printf("数量: %zu\n", values.length);
    printf("范围: %d .. %d\n", statistics.minimum, statistics.maximum);
    printf("平均值: %.3f\n", statistics.mean);
    printf("中位数: %.3f\n", statistics.median);
    printf("总体标准差: %.3f\n", statistics.standard_deviation);
    printf("众数: %d（出现 %zu 次）\n", statistics.mode, statistics.mode_count);
    printf("质数（共 %zu 个）: ", statistics.prime_count);
    print_primes(values.data, values.length);
    printf("FNV-1a 指纹: 0x%016" PRIx64 "\n", statistics.hash);

    printf("\n请输入要二分查找的整数: ");
    fflush(stdout);
    if (fgets(line, sizeof line, stdin) == nullptr) {
        fputs("读取查找目标失败。\n", stderr);
        free(values.data);
        return EXIT_FAILURE;
    }

    int target = 0;
    if (!parse_single_int(line, &target)) {
        fputs("查找目标不是有效整数。\n", stderr);
        free(values.data);
        return EXIT_FAILURE;
    }

    size_t position = 0;
    if (find_first(values.data, values.length, target, &position)) {
        printf("找到 %d：排序后下标为 %zu（从 0 开始）。\n", target, position);
    } else {
        printf("没有找到 %d。\n", target);
    }

    free(values.data);
    return EXIT_SUCCESS;
}
