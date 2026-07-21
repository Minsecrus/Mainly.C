#define _POSIX_C_SOURCE 200809L

#include <stdckdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

int main(void) {
    int answer = 0;
    char *message = strdup("ok");

    if (message == nullptr || ckd_add(&answer, 40, 2)) {
        free(message);
        return 1;
    }

    printf("C23-lib:%d:%s\n", answer, message);
    free(message);
    return 0;
}
