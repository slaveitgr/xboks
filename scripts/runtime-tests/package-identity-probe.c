/* SPDX-License-Identifier: MIT
 * Synthetic on-disk manifests through the real IXPackage ABI. Each child has
 * its own fixture directory and metadata cache. No account, game or license. */
#define COBJMACROS
#define INITGUID
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "xpackage.h"
#undef IXPackageImpl3_XPackageEnumeratePackages

static unsigned checks, failures, callbacks, selected;
#define CHECK(x) do { ++checks; if (!(x)) { ++failures; printf("FAIL %u:%d %s\n", selected, __LINE__, #x); } } while (0)
static const struct fixture {
    const char *xml, *display, *description, *publisher, *title, *store;
    BOOL version;
} cases[] = {
    { "<Game><Identity Version=\"1.2.3.4\"/><ShellVisuals DefaultDisplayName=\"Actual package\" "
      "Description=\"Description\" PublisherDisplayName=\"Publisher\"/><TitleId>DEADBEEF</TitleId>"
      "<StoreId>9AAAAAAAAAAA</StoreId></Game>", "Actual package", "Description", "Publisher", "DEADBEEF", "9AAAAAAAAAAA", TRUE },
    { "<?xml version=\"1.0\"?><!-- example -> <Identity Version=\"0.0.0.0\"/>"
      "<ShellVisuals DefaultDisplayName=\"Wrong\" Description=\"Wrong\" PublisherDisplayName=\"Wrong\"/>"
      "<TitleId>0000</TitleId><StoreId>000000000000</StoreId> -->"
      "<Game configVersion=\"0\"><!-- <StoreId>111111111111</StoreId> -->"
      "<Identity Version='1.2.3.4'/><ShellVisuals DefaultDisplayName='Actual &amp; package' "
      "Description='a &gt; b' PublisherDisplayName='Publisher'/><TitleId>DEAD<!-- note -->BEEF</TitleId>"
      "<StoreId>9AAAAA<!-- note -->AAAAAA</StoreId></Game>",
      "Actual & package", "a > b", "Publisher", "DEADBEEF", "9AAAAAAAAAAA", TRUE },
    { "<Game><!-- <Identity Version=\"1.2.3.4\"/><ShellVisuals DefaultDisplayName=\"Wrong\"/>"
      "<StoreId>000000000000</StoreId><TitleId>0000</TitleId> -->"
      "<Description><![CDATA[<StoreId>111111111111</StoreId>]]></Description></Game>",
      NULL, NULL, NULL, NULL, NULL, FALSE },
    { "<Game><!-- <StoreId>000000000000</StoreId></Game>", NULL, NULL, NULL, NULL, NULL, FALSE },
    { "<!DOCTYPE Game [<!ENTITY sample SYSTEM 'file:///no-such-nexus-fixture'>]>"
      "<Game><StoreId>&sample;</StoreId></Game>", NULL, NULL, NULL, NULL, NULL, FALSE },
    { "<Other><StoreId>000000000000</StoreId></Other>", NULL, NULL, NULL, NULL, NULL, FALSE },
    { "<Game><Identity OtherVersion=\"7.7.7.7\" Version=\"1.2.3.4\"/>"
      "<Unrelated><ShellVisuals DefaultDisplayName=\"Wrong\"/><StoreId>000000000000</StoreId></Unrelated>"
      "<StoreId>9AAAAAAAAAAA</StoreId></Game>", NULL, NULL, NULL, NULL, "9AAAAAAAAAAA", TRUE },
    { "<Game><StoreId>9AAAAAAAAAAA</StoreId><StoreId>9BBBBBBBBBBB</StoreId></Game>",
      NULL, NULL, NULL, NULL, NULL, FALSE },
};

static BOOL same( const char *actual, const char *expected )
{
    return expected ? actual && !strcmp(actual, expected) : !actual;
}

static BOOLEAN WINAPI visit( void *context, const XPackageDetails *details )
{
    const struct fixture *test = &cases[selected];
    (void)context;
    ++callbacks;
    CHECK(same(details->displayName, test->display));
    CHECK(same(details->description, test->description));
    CHECK(same(details->publisher, test->publisher));
    CHECK(same(details->titleID, test->title));
    CHECK(same(details->storeId, test->store));
    CHECK(details->version.major == (test->version ? 1 : 0));
    CHECK(details->version.minor == (test->version ? 2 : 0));
    CHECK(details->version.build == (test->version ? 3 : 0));
    CHECK(details->version.revision == (test->version ? 4 : 0));
    CHECK(details->packageIdentifier && strlen(details->packageIdentifier) == 32);
    return TRUE;
}

static void child( unsigned index )
{
    HRESULT (WINAPI *query)(const GUID *, REFIID, void **);
    IXPackageImpl4 *package = NULL;
    HMODULE dll = LoadLibraryW(L"xgameruntime.dll");
    selected = index;
    CHECK(dll != NULL);
    if (!dll) return;
    query = (void *)GetProcAddress(dll, "QueryApiImpl");
    CHECK(query != NULL);
    if (!query) return;
    CHECK(query(&CLSID_XPackageImpl, &IID_IXPackageImpl4, (void **)&package) == S_OK && package);
    if (!package) return;
    CHECK(IXPackageImpl4_XPackageEnumeratePackages(package, XPackageKind_Game,
          XPackageEnumerationScope_ThisOnly, NULL, visit) == S_OK);
    CHECK(callbacks == 1);
    IXPackageImpl4_Release(package);
    FreeLibrary(dll);
}

static BOOL write_fixture( const WCHAR *path, const char *text )
{
    HANDLE file = CreateFileW(path, GENERIC_WRITE, 0, NULL, CREATE_NEW, 0, NULL);
    DWORD written;
    BOOL ok;
    if (file == INVALID_HANDLE_VALUE) return FALSE;
    ok = WriteFile(file, text, strlen(text), &written, NULL) && written == strlen(text);
    CloseHandle(file);
    return ok;
}

int main( int argc, char **argv )
{
    if (argc == 3 && !strcmp(argv[1], "--case"))
    {
        unsigned index = (unsigned)atoi(argv[2]);
        if (index >= sizeof(cases) / sizeof(cases[0])) return 2;
        child(index);
    }
    else
    {
        WCHAR temp[MAX_PATH], root[MAX_PATH], own[MAX_PATH];
        unsigned i;
        CHECK(GetTempPathW(MAX_PATH, temp) && GetTempFileNameW(temp, L"nxi", 0, root));
        if (failures) return 1;
        CHECK(DeleteFileW(root) && CreateDirectoryW(root, NULL));
        CHECK(GetModuleFileNameW(NULL, own, MAX_PATH));
        if (failures) return 1;
        for (i = 0; i < sizeof(cases) / sizeof(cases[0]); i++)
        {
            WCHAR dir[MAX_PATH], exe[MAX_PATH], config[MAX_PATH], layout[MAX_PATH], command[MAX_PATH * 2];
            STARTUPINFOW startup = {0};
            PROCESS_INFORMATION process;
            DWORD code = 1, wait;
            selected = i;
            startup.cb = sizeof(startup);
            swprintf(dir, MAX_PATH, L"%ls\\%u", root, i);
            swprintf(exe, MAX_PATH, L"%ls\\probe.exe", dir);
            swprintf(config, MAX_PATH, L"%ls\\MicrosoftGame.Config", dir);
            swprintf(layout, MAX_PATH, L"%ls\\layout_01234567-89ab-cdef-0123-456789abcdef.xml", dir);
            CHECK(CreateDirectoryW(dir, NULL));
            CHECK(CopyFileW(own, exe, TRUE));
            CHECK(write_fixture(config, cases[i].xml));
            CHECK(write_fixture(layout, "<Package/>"));
            swprintf(command, MAX_PATH * 2, L"\"%ls\" --case %u", exe, i);
            if (CreateProcessW(exe, command, NULL, NULL, FALSE, 0, NULL, dir, &startup, &process))
            {
                wait = WaitForSingleObject(process.hProcess, 10000);
                CHECK(wait == WAIT_OBJECT_0);
                if (wait != WAIT_OBJECT_0) { TerminateProcess(process.hProcess, 2); WaitForSingleObject(process.hProcess, 5000); }
                CHECK(GetExitCodeProcess(process.hProcess, &code) && code == 0);
                CloseHandle(process.hThread); CloseHandle(process.hProcess);
            }
            else CHECK(FALSE);
            CHECK(DeleteFileW(exe)); CHECK(DeleteFileW(config)); CHECK(DeleteFileW(layout)); CHECK(RemoveDirectoryW(dir));
        }
        CHECK(RemoveDirectoryW(root));
    }
    printf("CHECKS %u FAILURES %u (package metadata case %u)\n", checks, failures, selected);
    return failures ? 1 : 0;
}
