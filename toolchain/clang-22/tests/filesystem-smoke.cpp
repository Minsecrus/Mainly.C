#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <string>
#include <system_error>

int main() {
    namespace fs = std::filesystem;

    const fs::path directory = "cpp-filesystem";
    const fs::path original = directory / "source.txt";
    const fs::path renamed = directory / "renamed.txt";
    std::error_code ec;

    fs::remove_all(directory, ec);
    ec.clear();
    if (!fs::create_directory(directory, ec) || ec) return 1;

    {
        std::ofstream output(original);
        output << "created by C++\n";
        if (!output) return 2;
    }

    std::string contents;
    {
        std::ifstream input(original);
        std::getline(input, contents);
        if (!input && !input.eof()) return 3;
    }
    if (contents != "created by C++") return 4;

    ec.clear();
    if (!fs::exists(original, ec) || ec || fs::file_size(original, ec) != 15 || ec) return 5;

    ec.clear();
    fs::rename(original, renamed, ec);
    if (ec || !fs::exists(renamed, ec) || ec) return 6;

    std::size_t entries = 0;
    ec.clear();
    for (fs::directory_iterator it(directory, ec), end; it != end && !ec; it.increment(ec)) {
        ++entries;
    }
    if (ec || entries != 1) return 7;

    {
        std::ofstream output("created.txt");
        output << "created by C++\n";
        if (!output) return 8;
    }

    ec.clear();
    const fs::space_info space = fs::space(".", ec);
    const auto unsupported_value = std::numeric_limits<std::uintmax_t>::max();
    const bool space_is_unsupported = ec &&
        space.capacity == unsupported_value &&
        space.free == unsupported_value &&
        space.available == unsupported_value;
    if (!space_is_unsupported) return 9;

    std::error_code cleanup_error;
    fs::remove_all(directory, cleanup_error);
    if (cleanup_error) return 10;

    std::cout << "fstream=" << contents
              << ",filesystem=ok,space=unsupported\n";
    return 0;
}
