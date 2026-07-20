#include <stdio.h>
#include <string.h>

int main(void) {
    char name[64];

    fputs("name> ", stdout);
    fflush(stdout);

    if (fgets(name, sizeof name, stdin) == NULL) {
        fputs("input closed\n", stderr);
        return 1;
    }

    name[strcspn(name, "\r\n")] = '\0';
    printf("hello, %s\n", name);
    return 0;
}
