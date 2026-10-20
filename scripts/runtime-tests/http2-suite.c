/* Controlled, unauthenticated WinHTTP regression suite. Test CA may be
 * installed ONLY in the explicitly named disposable suite prefix. */
#include <windows.h>
#include <winhttp.h>
#include <wincrypt.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifndef WINHTTP_OPTION_SERVER_CERT_CHAIN_CONTEXT
#define WINHTTP_OPTION_SERVER_CERT_CHAIN_CONTEXT 147
#endif

static unsigned failures, checks;
static INTERNET_PORT port;
static void check(BOOL value, const char *name)
{
    checks++;
    if (!value) { failures++; printf("FAIL %s error=%lu\n", name, GetLastError()); }
}

static BOOL trust_ca(const char *filename)
{
    char prefix[2048];
    DWORD size = GetEnvironmentVariableA("WINEPREFIX", prefix, sizeof(prefix));
    char expected[2048];
    DWORD expected_size = GetEnvironmentVariableA("XODUS_RUNTIME_TEST_PREFIX", expected, sizeof(expected));
    if (!size || size >= sizeof(prefix) || !expected_size || expected_size >= sizeof(expected) ||
        strcmp(prefix, expected) || !strstr(prefix, "/runtime-http2-")) return FALSE;
    FILE *file = fopen(filename, "rb");
    if (!file) return FALSE;
    BYTE data[16384];
    size_t length = fread(data, 1, sizeof(data), file);
    BOOL whole = feof(file);
    fclose(file);
    if (!whole || !length) return FALSE;
    HCERTSTORE store = CertOpenStore(CERT_STORE_PROV_SYSTEM_A, 0, 0, CERT_SYSTEM_STORE_CURRENT_USER, "ROOT");
    if (!store) return FALSE;
    BOOL result = CertAddEncodedCertificateToStore(store, X509_ASN_ENCODING, data, length, CERT_STORE_ADD_REPLACE_EXISTING, NULL);
    CertCloseStore(store, 0);
    return result;
}

static BOOL pattern(const BYTE *buffer, DWORD offset, DWORD length)
{
    for (DWORD i = 0; i < length; i++) if (buffer[i] != (BYTE)('a' + (offset + i) % 26)) return FALSE;
    return TRUE;
}

static BOOL noise_pattern(const BYTE *buffer, DWORD offset, DWORD length)
{
    for (DWORD i = 0; i < length; i++) {
        DWORD n = offset + i;
        n = (n ^ (n >> 16)) * 0x45d9f3bu;
        n = (n ^ (n >> 16)) * 0x45d9f3bu;
        if (buffer[i] != (BYTE)(n ^ (n >> 16))) return FALSE;
    }
    return TRUE;
}

static void decompression_options(void)
{
    HINTERNET session = WinHttpOpen(L"WinHTTP-Options-Test", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    HINTERNET connection = session ? WinHttpConnect(session, L"localhost", port, 0) : NULL;
    HINTERNET request = connection ? WinHttpOpenRequest(connection, L"GET", L"/encoding", NULL, NULL, NULL, WINHTTP_FLAG_SECURE) : NULL;
    HINTERNET handles[] = { session, request };
    check(session && connection && request, "decompression-option-handles");
    for (unsigned i = 0; i < 2; i++) {
        DWORD flags = 0x80000000;
        BOOL ok = WinHttpSetOption(handles[i], WINHTTP_OPTION_DECOMPRESSION, &flags, sizeof(flags));
        check(!ok && GetLastError() == ERROR_INVALID_PARAMETER, "decompression-reject-unknown-flags");
        ok = WinHttpSetOption(handles[i], WINHTTP_OPTION_DECOMPRESSION, NULL, sizeof(flags));
        check(!ok && GetLastError() == ERROR_INVALID_PARAMETER, "decompression-reject-null-buffer");
        ok = WinHttpSetOption(handles[i], WINHTTP_OPTION_DECOMPRESSION, &flags, 1);
        check(!ok && GetLastError() == ERROR_INSUFFICIENT_BUFFER, "decompression-reject-short-buffer");
    }
    DWORD flags = WINHTTP_DECOMPRESSION_FLAG_GZIP, code = 0, size = sizeof(code);
    BOOL ok = request && WinHttpSetOption(request, WINHTTP_OPTION_DECOMPRESSION, &flags, sizeof(flags)) &&
        WinHttpSendRequest(request, NULL, 0, NULL, 0, 0, 0) && WinHttpReceiveResponse(request, NULL) &&
        WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL, &code, &size, NULL);
    check(ok && code == 200, "decompression-advertises-encoding");
    PCCERT_CHAIN_CONTEXT chain = NULL;
    size = sizeof(chain);
    ok = request && WinHttpQueryOption(request, WINHTTP_OPTION_SERVER_CERT_CHAIN_CONTEXT, &chain, &size);
    check(ok && chain, "chain-retain-before-request-close");
    if (request) WinHttpCloseHandle(request);
    if (connection) WinHttpCloseHandle(connection);
    if (session) WinHttpCloseHandle(session);
    if (chain) {
        check(chain->cChain > 0 && chain->rgpChain[0]->cElement > 0, "chain-reference-survives-request-close");
        CertFreeCertificateChain(chain);
    }
}

static void certificate_chain(HINTERNET request)
{
    PCCERT_CHAIN_CONTEXT chain = NULL, second = NULL;
    DWORD size = 0;
    BOOL ok = WinHttpQueryOption(request, WINHTTP_OPTION_SERVER_CERT_CHAIN_CONTEXT, NULL, &size);
    check(!ok && GetLastError() == ERROR_INSUFFICIENT_BUFFER && size == sizeof(chain), "chain-buffer-size");
    size = sizeof(chain);
    ok = WinHttpQueryOption(request, WINHTTP_OPTION_SERVER_CERT_CHAIN_CONTEXT, &chain, &size);
    check(ok && chain && size == sizeof(chain), "chain-query");
    if (ok && chain) {
        check(chain->cChain > 0 && chain->rgpChain[0]->cElement > 0 && !chain->TrustStatus.dwErrorStatus,
              "chain-real-trusted-elements");
        size = sizeof(second);
        ok = WinHttpQueryOption(request, WINHTTP_OPTION_SERVER_CERT_CHAIN_CONTEXT, &second, &size);
        check(ok && second, "chain-second-owned-reference");
        CertFreeCertificateChain(chain);
        if (second) {
            check(second->cChain > 0 && second->rgpChain[0]->cElement > 0, "chain-first-free-preserves-second");
            CertFreeCertificateChain(second);
        }
    }
}

static void compressed_response(const char *name, const WCHAR *target, BOOL disable_h2,
                                DWORD flags, BOOL request_option, BOOL decoded, BOOL malformed, DWORD expected_size)
{
    HINTERNET session = WinHttpOpen(L"WinHTTP-Compression-Test", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    HINTERNET connection = NULL, request = NULL;
    BYTE buffer[4093];
    DWORD count = 0, total = 0, available = 0, length, protocol = 99, header = 0;
    BOOL ok = FALSE, saw_error = FALSE;
    if (!session) goto done;
    WinHttpSetTimeouts(session, 5000, 5000, 5000, 5000);
    if (disable_h2) {
        DWORD disabled = 0;
        if (!WinHttpSetOption(session, WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, &disabled, sizeof(disabled))) goto done;
    }
    if (!request_option && !WinHttpSetOption(session, WINHTTP_OPTION_DECOMPRESSION, &flags, sizeof(flags))) goto done;
    connection = WinHttpConnect(session, L"localhost", port, 0);
    if (!connection) goto done;
    request = WinHttpOpenRequest(connection, L"GET", target, NULL, NULL, NULL, WINHTTP_FLAG_SECURE);
    if (!request) goto done;
    if (request_option && !WinHttpSetOption(request, WINHTTP_OPTION_DECOMPRESSION, &flags, sizeof(flags))) goto done;
    if (!WinHttpSendRequest(request, NULL, 0, NULL, 0, 0, 0) || !WinHttpReceiveResponse(request, NULL)) goto done;
    length = sizeof(protocol);
    if (!WinHttpQueryOption(request, WINHTTP_OPTION_HTTP_PROTOCOL_USED, &protocol, &length) ||
        protocol != (disable_h2 ? 0 : WINHTTP_PROTOCOL_FLAG_HTTP2)) goto done;
    length = sizeof(header);
    BOOL has_length = WinHttpQueryHeaders(request, WINHTTP_QUERY_CONTENT_LENGTH | WINHTTP_QUERY_FLAG_NUMBER,
                                         NULL, &header, &length, NULL);
    check(decoded ? !has_length && GetLastError() == ERROR_WINHTTP_HEADER_NOT_FOUND : has_length,
          "compressed-content-length-policy");
    for (unsigned iteration = 0; iteration < 100000; iteration++) {
        if (!WinHttpQueryDataAvailable(request, &available)) { saw_error = TRUE; break; }
        if (!available) { ok = TRUE; break; }
        DWORD next = min(available, iteration % 2 ? sizeof(buffer) : 7);
        if (!WinHttpReadData(request, buffer, next, &count)) { saw_error = TRUE; break; }
        if (!count) { ok = TRUE; break; }
        if (decoded && !(wcscmp(target, L"/gzip-large") ? pattern(buffer, total, count) : noise_pattern(buffer, total, count))) goto done;
        if (!decoded && !total && target[1] == 'g' && (count < 2 || buffer[0] != 0x1f || buffer[1] != 0x8b)) goto done;
        total += count;
        if (total > 200000) goto done;
    }
    ok = malformed ? saw_error : ok && !saw_error && (decoded ? total == expected_size : total > 0 && total < 200000);
done:
    printf("CASE %s protocol=%lu bytes=%lu malformed=%u error=%u\n", name, protocol, total, malformed, saw_error);
    check(ok, name);
    if (request) WinHttpCloseHandle(request);
    if (connection) WinHttpCloseHandle(connection);
    if (session) WinHttpCloseHandle(session);
}

static void reused_compressed_request(BOOL disable_h2)
{
    HINTERNET session = WinHttpOpen(L"WinHTTP-Reuse-Test", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    HINTERNET connection = NULL, request = NULL;
    DWORD flags = WINHTTP_DECOMPRESSION_FLAG_GZIP, disabled = 0;
    BOOL ok = FALSE;
    if (!session) goto done;
    WinHttpSetTimeouts(session, 5000, 5000, 5000, 5000);
    if (!WinHttpSetOption(session, WINHTTP_OPTION_DECOMPRESSION, &flags, sizeof(flags))) goto done;
    if (disable_h2 && !WinHttpSetOption(session, WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, &disabled, sizeof(disabled))) goto done;
    connection = WinHttpConnect(session, L"localhost", port, 0);
    if (!connection) goto done;
    request = WinHttpOpenRequest(connection, L"GET", L"/gzip", NULL, NULL, NULL, WINHTTP_FLAG_SECURE);
    if (!request) goto done;
    for (unsigned attempt = 0; attempt < 3; attempt++) {
        BYTE buffer[4096];
        DWORD count, total = 0;
        if (!WinHttpSendRequest(request, NULL, 0, NULL, 0, 0, 0) || !WinHttpReceiveResponse(request, NULL)) goto done;
        do {
            if (!WinHttpReadData(request, buffer, attempt ? sizeof(buffer) : 7, &count)) goto done;
            if (!pattern(buffer, total, count)) goto done;
            total += count;
            if (total > 200000) goto done;
        } while (count && attempt);
        if (total != (attempt ? 200000 : 7)) goto done;
    }
    ok = TRUE;
done:
    check(ok, disable_h2 ? "gzip-reused-request-h1" : "gzip-reused-request-h2");
    if (request) WinHttpCloseHandle(request);
    if (connection) WinHttpCloseHandle(connection);
    if (session) WinHttpCloseHandle(session);
}

static void synchronous(const char *name, const WCHAR *verb, const WCHAR *target,
                        BOOL disable_h2, DWORD expected_status, DWORD body_length, BOOL upload, BOOL stream_upload)
{
    HINTERNET session = WinHttpOpen(L"WinHTTP2-Controlled-Test", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    HINTERNET connection = NULL, request = NULL;
    BYTE buffer[10000], body[200000];
    DWORD code = 0, protocol = 99, length = sizeof(code), count = 0, total = 0;
    BOOL result = FALSE;
    for (DWORD i = 0; i < sizeof(body); i++) body[i] = 'a' + i % 26;
    if (!session) goto done;
    WinHttpSetTimeouts(session, 5000, 5000, 5000, 5000);
    if (disable_h2) {
        DWORD disabled = 0;
        if (!WinHttpSetOption(session, WINHTTP_OPTION_ENABLE_HTTP_PROTOCOL, &disabled, sizeof(disabled))) goto done;
    }
    connection = WinHttpConnect(session, L"localhost", port, 0);
    if (!connection) goto done;
    request = WinHttpOpenRequest(connection, verb, target, NULL, NULL, NULL, WINHTTP_FLAG_SECURE);
    if (!request) goto done;
    PCCERT_CHAIN_CONTEXT chain = (void *)1;
    length = sizeof(chain);
    BOOL before = WinHttpQueryOption(request, WINHTTP_OPTION_SERVER_CERT_CHAIN_CONTEXT, &chain, &length);
    check(!before && !chain && GetLastError() == ERROR_WINHTTP_INCORRECT_HANDLE_STATE, "chain-before-response");
    if (!WinHttpSendRequest(request, L"X-Controlled-Test: dummy\r\n", (DWORD)-1L,
        upload ? body : NULL, upload ? (stream_upload ? 5 : sizeof(body)) : 0, upload ? sizeof(body) : 0, 0)) goto done;
    if (upload && stream_upload) {
        DWORD offset = 5;
        while (offset < sizeof(body)) {
            DWORD next = min(10000, sizeof(body) - offset), written = 0;
            if (!WinHttpWriteData(request, body + offset, next, &written) || written != next) goto done;
            offset += next;
        }
    }
    if (!WinHttpReceiveResponse(request, NULL)) goto done;
    certificate_chain(request);
    if (!WinHttpQueryHeaders(request, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER, NULL, &code, &length, NULL)) goto done;
    length = sizeof(protocol);
    if (!WinHttpQueryOption(request, WINHTTP_OPTION_HTTP_PROTOCOL_USED, &protocol, &length)) goto done;
    if (code != expected_status || protocol != (disable_h2 ? 0 : WINHTTP_PROTOCOL_FLAG_HTTP2)) goto done;
    for (;;) {
        if (!WinHttpReadData(request, buffer, sizeof(buffer), &count)) goto done;
        if (!count) break;
        if (!pattern(buffer, total, count)) goto done;
        total += count;
        if (total > body_length) goto done;
    }
    result = total == body_length;
done:
    printf("CASE %s status=%lu protocol=%lu bytes=%lu\n", name, code, protocol, total);
    check(result, name);
    if (request) WinHttpCloseHandle(request);
    if (connection) WinHttpCloseHandle(connection);
    if (session) WinHttpCloseHandle(session);
}

struct asynchronous {
    HANDLE done, closed;
    BYTE buffer[8192];
    DWORD total, send_count, header_count, errors, error_code;
    BOOL cancel, query_available;
};

static void CALLBACK callback(HINTERNET handle, DWORD_PTR context, DWORD status, void *info, DWORD length)
{
    struct asynchronous *test = (void *)context;
    if (!test) return;
    switch (status) {
    case WINHTTP_CALLBACK_STATUS_SENDREQUEST_COMPLETE:
        test->send_count++;
        if (!test->cancel && !WinHttpReceiveResponse(handle, NULL)) { test->errors++; SetEvent(test->done); }
        break;
    case WINHTTP_CALLBACK_STATUS_HEADERS_AVAILABLE:
        test->header_count++;
        if (!test->cancel && !(test->query_available ? WinHttpQueryDataAvailable(handle, NULL) :
                              WinHttpReadData(handle, test->buffer, sizeof(test->buffer), NULL))) { test->errors++; SetEvent(test->done); }
        break;
    case WINHTTP_CALLBACK_STATUS_DATA_AVAILABLE:
        if (!*(DWORD *)info) { SetEvent(test->done); break; }
        if (!WinHttpReadData(handle, test->buffer, min(*(DWORD *)info, sizeof(test->buffer)), NULL)) { test->errors++; SetEvent(test->done); }
        break;
    case WINHTTP_CALLBACK_STATUS_READ_COMPLETE:
        if (!length) { SetEvent(test->done); break; }
        if (!pattern(info, test->total, length)) test->errors++;
        test->total += length;
        if (!(test->query_available ? WinHttpQueryDataAvailable(handle, NULL) :
              WinHttpReadData(handle, test->buffer, sizeof(test->buffer), NULL))) { test->errors++; SetEvent(test->done); }
        break;
    case WINHTTP_CALLBACK_STATUS_REQUEST_ERROR:
        test->errors++; test->error_code = ((WINHTTP_ASYNC_RESULT *)info)->dwError;
        if (!test->cancel) SetEvent(test->done);
        break;
    case WINHTTP_CALLBACK_STATUS_HANDLE_CLOSING:
        if (test->cancel) SetEvent(test->done);
        SetEvent(test->closed);
        break;
    }
}

static DWORD WINAPI async_test(void *argument)
{
    BOOL cancel = (UINT_PTR)argument == 1, compressed = (UINT_PTR)argument >= 2;
    struct asynchronous test = {0};
    test.cancel = cancel;
    test.query_available = (UINT_PTR)argument == 3;
    test.done = CreateEventW(NULL, TRUE, FALSE, NULL);
    test.closed = CreateEventW(NULL, TRUE, FALSE, NULL);
    HINTERNET session = WinHttpOpen(L"WinHTTP2-Async-Test", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, WINHTTP_FLAG_ASYNC);
    HINTERNET connection = NULL, request = NULL;
    BOOL ok = FALSE;
    if (!session) goto done;
    WinHttpSetTimeouts(session, 5000, 5000, 5000, 5000);
    if (compressed) {
        DWORD flags = WINHTTP_DECOMPRESSION_FLAG_GZIP;
        if (!WinHttpSetOption(session, WINHTTP_OPTION_DECOMPRESSION, &flags, sizeof(flags))) goto done;
    }
    connection = WinHttpConnect(session, L"localhost", port, 0);
    if (!connection) goto done;
    request = WinHttpOpenRequest(connection, L"GET", cancel ? L"/slow" : compressed ? L"/gzip" : L"/body", NULL, NULL, NULL, WINHTTP_FLAG_SECURE);
    if (!request) goto done;
    WinHttpSetStatusCallback(request, callback, WINHTTP_CALLBACK_FLAG_ALL_NOTIFICATIONS, 0);
    if (!WinHttpSendRequest(request, NULL, 0, NULL, 0, 0, (DWORD_PTR)&test)) goto done;
    if (cancel) { Sleep(200); WinHttpCloseHandle(request); request = NULL; }
    if (WaitForSingleObject(test.done, 10000) != WAIT_OBJECT_0) goto done;
    ok = cancel ? (test.errors == 1 && test.error_code == ERROR_WINHTTP_OPERATION_CANCELLED) :
        !test.errors && test.send_count == 1 && test.header_count == 1 && test.total == 200000;
done:
    if (request) WinHttpCloseHandle(request);
    if (connection && WaitForSingleObject(test.closed, 10000) != WAIT_OBJECT_0) ok = FALSE;
    if (connection) WinHttpCloseHandle(connection);
    if (session) WinHttpCloseHandle(session);
    CloseHandle(test.done);
    CloseHandle(test.closed);
    printf("ASYNC cancel=%u send=%lu headers=%lu bytes=%lu errors=%lu code=%lu result=%u\n",
           cancel, test.send_count, test.header_count, test.total, test.errors, test.error_code, ok);
    return ok ? 0 : 1;
}

static void rejection(const char *name, const WCHAR *host, const WCHAR *target)
{
    HINTERNET session = WinHttpOpen(L"WinHTTP2-Rejection-Test", WINHTTP_ACCESS_TYPE_NO_PROXY, NULL, NULL, 0);
    WinHttpSetTimeouts(session, 5000, 5000, 5000, 5000);
    HINTERNET connection = WinHttpConnect(session, host, port, 0);
    HINTERNET request = WinHttpOpenRequest(connection, L"GET", target, NULL, NULL, NULL, WINHTTP_FLAG_SECURE);
    BOOL result = request && WinHttpSendRequest(request, NULL, 0, NULL, 0, 0, 0) && WinHttpReceiveResponse(request, NULL);
    DWORD error = GetLastError();
    check(!result && (error == ERROR_WINHTTP_SECURE_CHANNEL_ERROR || error == ERROR_WINHTTP_SECURE_FAILURE || error == ERROR_WINHTTP_REDIRECT_FAILED), name);
    printf("REJECT %s result=%u error=%lu\n", name, result, error);
    if (request) WinHttpCloseHandle(request);
    if (connection) WinHttpCloseHandle(connection);
    if (session) WinHttpCloseHandle(session);
}

int main(int argc, char **argv)
{
    if (argc != 3 || !trust_ca(argv[2])) { puts("Test CA import refused/failed"); return 2; }
    port = (INTERNET_PORT)strtoul(argv[1], NULL, 10);
    decompression_options();
    synchronous("head-h2", L"HEAD", L"/head", FALSE, 405, 0, FALSE, FALSE);
    synchronous("body-h2", L"GET", L"/body", FALSE, 200, 200000, FALSE, FALSE);
    synchronous("post-h2", L"POST", L"/echo", FALSE, 201, 200000, TRUE, FALSE);
    synchronous("stream-post-h2", L"POST", L"/echo", FALSE, 201, 200000, TRUE, TRUE);
    synchronous("fallback-h1", L"GET", L"/body", TRUE, 200, 200000, FALSE, FALSE);
    synchronous("real-http-error", L"GET", L"/error", FALSE, 503, 0, FALSE, FALSE);
    synchronous("redirect-h2", L"GET", L"/redirect", FALSE, 200, 200000, FALSE, FALSE);
    for (unsigned h1 = 0; h1 < 2; h1++) {
        reused_compressed_request(h1);
        compressed_response(h1 ? "plain-chunked-h1" : "plain-fragmented-h2", L"/chunked", h1, 0, FALSE, TRUE, FALSE, 200000);
        compressed_response(h1 ? "gzip-h1" : "gzip-h2", L"/gzip", h1, WINHTTP_DECOMPRESSION_FLAG_GZIP, FALSE, TRUE, FALSE, 200000);
        compressed_response(h1 ? "gzip-large-h1" : "gzip-large-h2", L"/gzip-large", h1, WINHTTP_DECOMPRESSION_FLAG_GZIP, FALSE, TRUE, FALSE, 200000);
        compressed_response(h1 ? "gzip-request-h1" : "gzip-request-h2", L"/gzip", h1, WINHTTP_DECOMPRESSION_FLAG_GZIP, TRUE, TRUE, FALSE, 200000);
        compressed_response(h1 ? "gzip-disabled-h1" : "gzip-disabled-h2", L"/gzip", h1, 0, FALSE, FALSE, FALSE, 0);
        compressed_response(h1 ? "gzip-chunked-h1" : "gzip-fragmented-h2", L"/gzip-chunked", h1, WINHTTP_DECOMPRESSION_FLAG_GZIP, FALSE, TRUE, FALSE, 200000);
        compressed_response(h1 ? "gzip-empty-h1" : "gzip-empty-h2", L"/gzip-empty", h1, WINHTTP_DECOMPRESSION_FLAG_GZIP, FALSE, TRUE, FALSE, 0);
        compressed_response(h1 ? "gzip-invalid-h1" : "gzip-invalid-h2", L"/gzip-invalid", h1, WINHTTP_DECOMPRESSION_FLAG_GZIP, FALSE, TRUE, TRUE, 0);
        compressed_response(h1 ? "gzip-truncated-h1" : "gzip-truncated-h2", L"/gzip-truncated", h1, WINHTTP_DECOMPRESSION_FLAG_GZIP, FALSE, TRUE, TRUE, 0);
        compressed_response(h1 ? "deflate-h1" : "deflate-h2", L"/deflate", h1, WINHTTP_DECOMPRESSION_FLAG_ALL, FALSE, TRUE, FALSE, 200000);
        compressed_response(h1 ? "deflate-not-enabled-h1" : "deflate-not-enabled-h2", L"/deflate", h1, WINHTTP_DECOMPRESSION_FLAG_GZIP, FALSE, FALSE, FALSE, 0);
    }
    synchronous("plain-after-compression", L"GET", L"/body", FALSE, 200, 200000, FALSE, FALSE);
    rejection("wrong-host-certificate", L"127.0.0.1", L"/body");
    rejection("https-downgrade", L"localhost", L"/downgrade");
    HANDLE threads[4];
    for (unsigned i = 0; i < 4; i++) threads[i] = CreateThread(NULL, 0, async_test, NULL, 0, NULL);
    WaitForMultipleObjects(4, threads, TRUE, 20000);
    for (unsigned i = 0; i < 4; i++) { DWORD code = 1; GetExitCodeThread(threads[i], &code); check(code == 0, "concurrent-async"); CloseHandle(threads[i]); }
    check(async_test((void *)1) == 0, "cancel-pending");
    check(async_test((void *)2) == 0, "gzip-async");
    check(async_test((void *)3) == 0, "gzip-async-query-available");
    printf("SUMMARY checks=%u failures=%u\n", checks, failures);
    return failures ? 1 : 0;
}
