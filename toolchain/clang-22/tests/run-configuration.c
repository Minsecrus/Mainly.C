#include <stdio.h>

int main(int argc, char *argv[]) {
    char input[64];

    if (argc != 3) {
        (void)fprintf(stderr, "unexpected argc: %d\n", argc);
        return 2;
    }
    if (fgets(input, sizeof input, stdin) == NULL) {
        (void)fputs("missing stdin\n", stderr);
        return 3;
    }

    (void)printf("argv=%s|%s\nstdin=%s", argv[1], argv[2], input);
    return 0;
}
