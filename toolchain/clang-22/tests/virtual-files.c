#include <stdio.h>
#include <string.h>

int main(void) {
    char input[64];
    char output[96];
    FILE *file = fopen("seed.txt", "r");

    if (file == NULL) {
        perror("seed.txt");
        return 1;
    }
    if (fgets(input, sizeof input, file) == NULL || fclose(file) != 0) {
        fputs("unable to read seed.txt\n", stderr);
        return 2;
    }
    input[strcspn(input, "\r\n")] = '\0';

    file = fopen("created.txt", "w");
    if (file == NULL) {
        perror("created.txt");
        return 3;
    }
    if (fprintf(file, "copied:%s\n", input) < 0 || fclose(file) != 0) {
        fputs("unable to write created.txt\n", stderr);
        return 4;
    }

    file = fopen("created.txt", "r");
    if (file == NULL) {
        perror("created.txt");
        return 5;
    }
    if (fgets(output, sizeof output, file) == NULL || fclose(file) != 0) {
        fputs("unable to read created.txt\n", stderr);
        return 6;
    }

    fputs(output, stdout);
    return 0;
}
