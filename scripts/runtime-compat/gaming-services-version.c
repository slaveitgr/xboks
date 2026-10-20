/* SPDX-License-Identifier: MIT
 * TEMPORARY explicit version override, not an installed Microsoft service
 * or certification that all Gaming Services APIs are implemented.
 */
#include <windows.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
int main(int argc, char **argv)
{
    if (argc != 2 || strcmp(argv[1], "apply")) return 64;
    const uint64_t version = ((uint64_t)38 << 48) | ((uint64_t)117 << 32) | ((uint64_t)27001 << 16);
    HKEY key;
    LONG error = RegCreateKeyExW(HKEY_LOCAL_MACHINE, L"SOFTWARE\\Microsoft\\GamingServices",
        0, NULL, 0, KEY_SET_VALUE | KEY_WOW64_64KEY, NULL, &key, NULL);
    if (!error) {
        error = RegSetValueExW(key, L"CurrentVersion", 0, REG_QWORD, (const BYTE *)&version, sizeof(version));
        if (!error) error = RegSetValueExW(key, L"AvailableVersion", 0, REG_QWORD, (const BYTE *)&version, sizeof(version));
        RegCloseKey(key);
    }
    if (error) { fprintf(stderr, "Nexus runtime: version override failed (%ld).\n", error); return 70; }
    fprintf(stderr, "Nexus runtime: TEMPORARY Gaming Services version override 38.117.27001.0; not an installed Microsoft service.\n");
    return 0;
}
