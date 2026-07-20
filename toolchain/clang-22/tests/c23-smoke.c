#include <stddef.h>
#include <stdio.h>

static_assert(sizeof(int) >= 2, "C requires int to be at least 16 bits");

constexpr int answer = 42;

int main(void) {
    typeof_unqual(answer) value = answer;
    nullptr_t pointer = nullptr;

    printf("C23:%d:%s\n", value, pointer == nullptr ? "ok" : "bad");
    return 0;
}
