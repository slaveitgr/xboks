/* Account-free tests of the exact runtime helpers and actual XAsync provider.
 * Synthetic RSA keys stay in this process. No production trust override exists.
 * The license bridge below always fails and cannot contact an account service. */
#define INITGUID
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include "private.h"
#undef TRACE
#define TRACE(...) printf(__VA_ARGS__)

char *storeId = "B00000000001";
static HANDLE bridge_started, bridge_gate;
static LONG bridge_active;
static HRESULT (WINAPI *runtime_query)(const GUID *, REFIID, void **);
HRESULT WINAPI QueryApiImpl(const GUID *clsid, REFIID iid, void **out)
{ return runtime_query(clsid, iid, out); }
UINT64 xuser_get_xuid(XUserHandle user) { return 1; }
void xodus_store_license_note(const char *phase, HRESULT hr) { }
HRESULT xodus_store_license_body(const char **ids, SIZE_T count, const char *nonce, char **out)
{ *out = strdup("synthetic"); return *out ? S_OK : E_OUTOFMEMORY; }
HRESULT xodus_store_license_xml(const char *request, SIZE_T size, char **out)
{
    *out = NULL;
    InterlockedIncrement(&bridge_active);
    SetEvent(bridge_started);
    WaitForSingleObject(bridge_gate, 1500);
    InterlockedDecrement(&bridge_active);
    return E_FAIL;
}
#include "xstore_entitled.h"
/* Only this account-free executable has a synthetic installed-package index. */
HRESULT xpackage_query_content_store(const char *identifier, SIZE_T size, char *store)
{
    if (!identifier || strcmp(identifier, "00000001111122223333444444444444")) return E_GAMEPACKAGE_NO_PACKAGE_IDENTIFIER;
    if (size < 13) return E_NOT_SUFFICIENT_BUFFER;
    strcpy(store, "B00000000001"); return S_OK;
}
#include "xstore_package_license.h"

static unsigned checks, failures, callbacks, enumerated;
#define CHECK(name, expr) do { ++checks; if (!(expr)) { ++failures; printf("FAIL %s line=%d\n", name, __LINE__); } } while (0)

static char *encode(const BYTE *bytes, DWORD size, BOOL url)
{
    DWORD length = 0, i;
    char *text;
    if (!CryptBinaryToStringA(bytes, size, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, NULL, &length) ||
        !(text = malloc(length))) return NULL;
    if (!CryptBinaryToStringA(bytes, size, CRYPT_STRING_BASE64 | CRYPT_STRING_NOCRLF, text, &length))
    { free(text); return NULL; }
    if (url) for (i = 0; text[i]; i++)
    { if (text[i] == '+') text[i] = '-'; else if (text[i] == '/') text[i] = '_'; else if (text[i] == '=') { text[i] = 0; break; } }
    return text;
}

static char *token(HCRYPTPROV provider, const char *cert_id, int variant)
{
    const char *header = variant == 1 ? "{\"alg\":\"HS256\"}" : "{\"alg\":\"RS256\"}";
    char claim[2048], payload[4096], *h = NULL, *p = NULL, *c = NULL, *s = NULL, *input = NULL, *jwt = NULL;
    BYTE signature[512], swap;
    DWORD size = sizeof(signature), i;
    HCRYPTHASH hash = 0;
    UINT64 now = time(NULL);
    snprintf(claim, sizeof(claim), "{\"tokenVersion\":1,\"certificateId\":\"%s\",\"customDeveloperString\":\"synthetic-nonce\","
        "\"licensableProducts\":[{\"productId\":\"B00000000001\",\"skuId\":\"0010\",\"endDate\":\"9999-12-31T23:59:59Z\"}]}", cert_id);
    c = encode((BYTE *)claim, strlen(claim), FALSE);
    if (!c) goto done;
    snprintf(payload, sizeof(payload), "{\"iss\":\"LicensingFD\",\"aud\":\"%s\",\"nbf\":%llu,\"exp\":%llu,\"LicenseTokenClaim\":\"%s\"}",
        variant == 2 ? "wrong" : "SDK/ISV", (unsigned long long)(variant == 4 ? now + 300 : now - 10),
        (unsigned long long)(variant == 3 ? now - 1 : now + 600), c);
    h = encode((BYTE *)header, strlen(header), TRUE); p = encode((BYTE *)payload, strlen(payload), TRUE);
    if (!h || !p || !(input = malloc(strlen(h) + strlen(p) + 2))) goto done;
    sprintf(input, "%s.%s", h, p);
    if (!CryptCreateHash(provider, CALG_SHA_256, 0, 0, &hash) || !CryptHashData(hash, (BYTE *)input, strlen(input), 0) ||
        !CryptSignHashA(hash, AT_SIGNATURE, NULL, 0, signature, &size)) goto done;
    for (i = 0; i < size / 2; i++) { swap = signature[i]; signature[i] = signature[size - 1 - i]; signature[size - 1 - i] = swap; }
    s = encode(signature, size, TRUE);
    if (s && (jwt = malloc(strlen(input) + strlen(s) + 2))) sprintf(jwt, "%s.%s", input, s);
done:
    if (hash) CryptDestroyHash(hash);
    free(h); free(p); free(c); free(s); free(input); return jwt;
}

static void test_receipts(void)
{
    HCRYPTPROV provider = 0;
    HCRYPTKEY key = 0;
    CERT_NAME_BLOB name = {0};
    CRYPT_ALGORITHM_IDENTIFIER algorithm = {szOID_RSA_SHA256RSA, {0}};
    SYSTEMTIME start = {2020, 1, 0, 1}, end = {2099, 1, 0, 1};
    PCCERT_CONTEXT cert = NULL;
    BYTE digest[20]; DWORD size = sizeof(digest);
    char cert_id[41], *jwt;
    UINT i, count;
    UINT64 expiry;
    IJsonObject *claim = NULL;
    struct receipt_license licenses[ENTITLED_MAX_PRODUCTS];
    const char *ids[] = {"B00000000001"};
    BYTE *decoded = NULL; DWORD decoded_size;
    CHECK("invalid-base64-alphabet", FAILED(receipt_decode("AA?A", 4, FALSE, &decoded, &decoded_size)) && !decoded);
    CHECK("invalid-base64-padding", FAILED(receipt_decode("A=AA", 4, FALSE, &decoded, &decoded_size)) && !decoded);
    CHECK("invalid-base64-length", FAILED(receipt_decode("A", 1, TRUE, &decoded, &decoded_size)) && !decoded);
    CHECK("invalid-date-zone", FAILED(receipt_date("2026-10-15T10:00:00+02:00", &expiry)));
    CHECK("crypto-provider", CryptAcquireContextW(&provider, NULL, MS_ENH_RSA_AES_PROV_W, PROV_RSA_AES, CRYPT_VERIFYCONTEXT));
    if (!provider) return;
    CHECK("synthetic-key", CryptGenKey(provider, AT_SIGNATURE, (2048 << 16) | CRYPT_EXPORTABLE, &key));
    if (!key) goto done;
    CHECK("certificate-name-size", CertStrToNameW(X509_ASN_ENCODING, L"CN=Nexus synthetic test only", CERT_X500_NAME_STR, NULL, NULL, &name.cbData, NULL));
    name.pbData = malloc(name.cbData);
    if (!name.pbData) goto done;
    CHECK("certificate-name", CertStrToNameW(X509_ASN_ENCODING, L"CN=Nexus synthetic test only", CERT_X500_NAME_STR, NULL, name.pbData, &name.cbData, NULL));
    cert = CertCreateSelfSignCertificate(provider, &name, CERT_CREATE_SELFSIGN_NO_KEY_INFO, NULL, &algorithm, &start, &end, NULL);
    CHECK("synthetic-certificate", cert != NULL);
    if (!cert) goto done;
    CHECK("thumbprint", CryptHashCertificate(0, CALG_SHA1, 0, cert->pbCertEncoded, cert->cbCertEncoded, digest, &size));
    for (i = 0; i < 20; i++) sprintf(cert_id + i * 2, "%02X", digest[i]);
    for (i = 0; i < 5; i++)
    {
        jwt = token(provider, cert_id, i);
        CHECK("synthetic-signed-token", jwt != NULL);
        if (!jwt) continue;
        if (!i)
        {
            BYTE *decoded = NULL; DWORD length = 0;
            const char *dot = strchr(jwt, '.'), *second = strchr(dot + 1, '.');
            CHECK("header-base64", receipt_decode(jwt, dot - jwt, TRUE, &decoded, &length) == S_OK);
            if (decoded) { CHECK("header-json", receipt_json(decoded, length, &claim) == S_OK); free(decoded); }
            if (claim) { IJsonObject_Release(claim); claim = NULL; }
            CHECK("payload-base64", receipt_decode(dot + 1, second - dot - 1, TRUE, &decoded, &length) == S_OK);
            if (decoded) { CHECK("payload-json", receipt_json(decoded, length, &claim) == S_OK); free(decoded); }
            if (claim) { IJsonObject_Release(claim); claim = NULL; }
            CHECK("signature-base64", receipt_decode(second + 1, strlen(second + 1), TRUE, &decoded, &length) == S_OK);
            free(decoded);
        }
        HRESULT hr = receipt_verify(jwt, "synthetic-nonce", cert_id, cert->pbCertEncoded, cert->cbCertEncoded, &claim, &expiry);
        CHECK("signature-and-claims", i ? FAILED(hr) && !claim : hr == S_OK && claim);
        if (claim)
        {
            count = 0;
            CHECK("signed-inventory", receipt_inventory(claim, ids, 1, licenses, &count, &expiry) == S_OK && count == 1);
            CHECK("exact-signed-sku", count && !strcmp(licenses[0].sku, "0010"));
            count = 0;
            CHECK("no-unrequested-product", receipt_inventory(claim, NULL, 0, licenses, &count, &expiry) == S_OK && !count);
            IJsonObject_Release(claim); claim = NULL;
        }
        CHECK("nonce-replay-rejected", FAILED(receipt_verify(jwt, "other-nonce", cert_id, cert->pbCertEncoded, cert->cbCertEncoded, &claim, &expiry)) && !claim);
        if (!i) CHECK("certificate-id-mismatch", FAILED(receipt_verify(jwt, "synthetic-nonce", "0000000000000000000000000000000000000000", cert->pbCertEncoded, cert->cbCertEncoded, &claim, &expiry)) && !claim);
        char *signature = strrchr(jwt, '.') + 1;
        signature[0] = signature[0] == 'A' ? 'B' : 'A';
        CHECK("tampered-signature-rejected", FAILED(receipt_verify(jwt, "synthetic-nonce", cert_id, cert->pbCertEncoded, cert->cbCertEncoded, &claim, &expiry)) && !claim);
        free(jwt);
    }
    const char *expired = "{\"tokenVersion\":1,\"licensableProducts\":[{\"productId\":\"B00000000001\",\"skuId\":\"0010\",\"endDate\":\"2020-01-01T00:00:00Z\"}]}";
    CHECK("inventory-json", receipt_json((BYTE *)expired, strlen(expired), &claim) == S_OK);
    count = 0; expiry = UINT64_MAX;
    CHECK("expired-license-excluded", claim && receipt_inventory(claim, ids, 1, licenses, &count, &expiry) == S_OK && !count);
    if (claim) { IJsonObject_Release(claim); claim = NULL; }
    const char *malformed = "{\"tokenVersion\":1,\"licensableProducts\":[null]}";
    CHECK("malformed-json", receipt_json((BYTE *)malformed, strlen(malformed), &claim) == S_OK);
    CHECK("malformed-license-rejected", claim && FAILED(receipt_inventory(claim, ids, 1, licenses, &count, &expiry)));
done:
    if (claim) IJsonObject_Release(claim);
    if (cert) CertFreeCertificateContext(cert);
    free(name.pbData);
    if (key) CryptDestroyKey(key);
    CryptReleaseContext(provider, 0);
}

static struct entitled_snapshot *test_metadata(void)
{
    const char *json = "{\"Products\":[{\"ProductId\":\"B00000000001\",\"ProductType\":\"Durable\",\"Properties\":{\"InAppOfferToken\":\"Synthetic offer\"},"
        "\"LocalizedProperties\":[{\"ProductTitle\":\"Synthetic & add-on\",\"Language\":\"en-US\"}],"
        "\"DisplaySkuAvailabilities\":[{\"Sku\":{\"SkuId\":\"0010\",\"Properties\":{\"IsTrial\":false,\"Packages\":[{}]}}},"
        "{\"Sku\":{\"SkuId\":\"0020\",\"Properties\":{\"IsTrial\":true}}}]}]}";
    struct receipt_license license = {"B00000000001", "0010", 0};
    license.expiry = time(NULL) + 3600;
    xmlDocPtr doc = xmlNewDoc(BAD_CAST "1.0");
    xmlNodePtr root = xmlNewNode(NULL, BAD_CAST "Response");
    xmlChar *bytes; int size; char until[32];
    struct entitled_snapshot *snapshot = NULL;
    xmlDocSetRootElement(doc, root);
    xmlNewTextChild(root, NULL, BAD_CAST "HResult", BAD_CAST "0");
    snprintf(until, sizeof(until), "%llu", (unsigned long long)time(NULL) + 60);
    xmlNewTextChild(root, NULL, BAD_CAST "ValidUntil", BAD_CAST until);
    CHECK("metadata", receipt_metadata_parse(&license, 31, (BYTE *)json, strlen(json), root) == S_OK);
    xmlDocDumpMemory(doc, &bytes, &size);
    CHECK("parsed-owned-product", entitled_parse((char *)bytes, size, &snapshot) == S_OK && snapshot && snapshot->count == 1);
    if (snapshot)
    {
        CHECK("only-owned-sku", snapshot->products[0].skusCount == 1 && !strcmp(snapshot->products[0].skus[0].skuId, "0010"));
        CHECK("normal-sku-not-trial", !snapshot->products[0].skus[0].isTrial);
        CHECK("xml-escape", !strcmp(snapshot->products[0].title, "Synthetic & add-on"));
        CHECK("package-metadata", snapshot->products[0].hasDigitalDownload);
        CHECK("developer-offer-token", !strcmp(snapshot->products[0].inAppOfferToken, "Synthetic offer"));
        CHECK("signed-license-end-date", snapshot->products[0].skus[0].collectionData.endDate == license.expiry);
        entitled_snapshot_release(snapshot); snapshot = NULL;
    }
    xmlFree(bytes);
    strcpy(license.sku, "0020");
    CHECK("second-owned-sku", receipt_metadata_parse(&license, 31, (BYTE *)json, strlen(json), root) == S_OK);
    xmlDocDumpMemory(doc, &bytes, &size);
    CHECK("merged-skus", entitled_parse((char *)bytes, size, &snapshot) == S_OK && snapshot && snapshot->count == 1 && snapshot->products[0].skusCount == 2);
    if (snapshot) entitled_snapshot_release(snapshot);
    xmlFree(bytes); snapshot = NULL;
    strcpy(license.sku, "0030");
    CHECK("missing-sku-not-inferred", FAILED(receipt_metadata_parse(&license, 31, (BYTE *)json, strlen(json), root)));
    CHECK("malformed-metadata-rejected", FAILED(receipt_metadata_parse(&license, 31, (BYTE *)"{}", 2, root)));
    char *bad_trial = strdup(json), *trial_field = strstr(bad_trial, "false");
    memcpy(trial_field, "null ", 5); strcpy(license.sku, "0010");
    CHECK("unknown-trial-not-full-license", FAILED(receipt_metadata_parse(&license, 31, (BYTE *)bad_trial, strlen(bad_trial), root)));
    free(bad_trial);
    CHECK("doctype-rejected", FAILED(entitled_parse("<!DOCTYPE Response><Response/>", 30, &snapshot)));
    xmlFreeDoc(doc);
    snapshot = calloc(1, sizeof(*snapshot));
    snapshot->refs = 1; snapshot->valid_until = time(NULL) + 60;
    snapshot->count = 3; snapshot->products = calloc(3, sizeof(XStoreProduct));
    return snapshot;
}

static BOOLEAN CALLBACK enumerate(const XStoreProduct *product, void *context)
{ enumerated++; return TRUE; }
static BOOLEAN CALLBACK close_during_callback(const XStoreProduct *product, void *context)
{ enumerated++; entitled_page_close(context); return FALSE; }
static void CALLBACK complete(XAsyncBlock *async) { callbacks++; }
static void dispatch_until_complete(IXThreadingImpl *threads, XTaskQueueHandle queue, XAsyncBlock *block)
{
    ULONGLONG start = GetTickCount64();
    do { IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0); Sleep(1); }
    while ((!callbacks || IXThreadingImpl_XAsyncGetStatus(threads, block, FALSE) == E_PENDING) && GetTickCount64() - start < 3000);
}

static void test_async(struct entitled_snapshot *snapshot)
{
    IXThreadingImpl *threads;
    XTaskQueueHandle queue;
    XStoreContextHandle store;
    XStoreProductQueryHandle next = NULL;
    XAsyncBlock block = {0};
    struct entitled_page *page;
    ULONGLONG start;
    if (!snapshot) return;
    CHECK("threading", QueryApiImpl(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&threads) == S_OK);
    CHECK("manual-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK);
    CHECK("store-context", entitled_store_create(NULL, &store) == S_OK);
    block.queue = queue; block.callback = complete;
    CHECK("query-begin", entitled_begin(store, 31, 10, &block) == S_OK);
    entitled_store_close(store); /* In-flight request owns copied parameters. */
    start = GetTickCount64();
    CHECK("work", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0));
    CHECK("manual-work-does-not-block", GetTickCount64() - start < 200);
    CHECK("license-worker-started", WaitForSingleObject(bridge_started, 2000) == WAIT_OBJECT_0);
    CHECK("pending-during-network", IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == E_PENDING);
    SetEvent(bridge_gate); dispatch_until_complete(threads, queue, &block);
    CHECK("failure-propagated", IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == E_FAIL);
    CHECK("completion-once", callbacks == 1);
    next = (void *)1;
    CHECK("failure-no-query-handle", FAILED(entitled_result(&block, &next, FALSE)) && !next);

    for (UINT mode = 0; mode < 2; mode++)
    {
        callbacks = 0; ResetEvent(bridge_started); ResetEvent(bridge_gate);
        memset(&block, 0, sizeof(block)); block.queue = queue; block.callback = complete;
        CHECK("cancel-store", entitled_store_create(NULL, &store) == S_OK);
        CHECK("cancel-query", entitled_begin(store, 31, 10, &block) == S_OK);
        entitled_store_close(store);
        if (mode)
        {
            CHECK("cancel-work", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0));
            CHECK("cancel-worker-running", WaitForSingleObject(bridge_started, 2000) == WAIT_OBJECT_0);
        }
        IXThreadingImpl_XAsyncCancel(threads, &block);
        if (!mode) IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0);
        SetEvent(bridge_gate); dispatch_until_complete(threads, queue, &block);
        CHECK("cancel-terminal", IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == E_ABORT);
        CHECK("cancel-completion-once", callbacks == 1);
        start = GetTickCount64();
        while (bridge_active && GetTickCount64() - start < 2000) Sleep(1);
        CHECK("canceled-worker-finished", !bridge_active);
    }
    CHECK("invalid-store-handle", entitled_begin((void *)1, 31, 10, &block) == E_INVALIDARG);
    CHECK("create-requires-output", entitled_store_create(NULL, NULL) == E_POINTER);
    CHECK("begin-store", entitled_store_create(NULL, &store) == S_OK);
    IXThreadingImpl_XTaskQueueSetCurrentProcessTaskQueue(threads, NULL);
    memset(&block, 0, sizeof(block));
    CHECK("begin-failure-without-queue", FAILED(entitled_begin(store, 31, 10, &block)));
    entitled_store_close(store);

    page = calloc(1, sizeof(*page)); page->refs = 1; page->snapshot = snapshot; page->size = 1;
    page->next = entitled_pages; entitled_pages = page;
    enumerated = 0;
    CHECK("first-page", entitled_enumerate(page, NULL, enumerate) == S_OK && enumerated == 1);
    CHECK("has-more", entitled_has_more(page));
    memset(&block, 0, sizeof(block)); block.queue = queue; block.callback = complete;
    CHECK("next-begin", entitled_next(page, &block) == S_OK);
    entitled_page_close(page);
    CHECK("next-work", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0));
    dispatch_until_complete(threads, queue, &block);
    CHECK("next-survives-original-close", entitled_result(&block, &next, TRUE) == S_OK && next);
    page = entitled_page_acquire(next);
    CHECK("retained-page", page && page->offset == 1);
    if (page)
    {
        page->offset = 2;
        CHECK("last-page", !entitled_has_more(next));
        CHECK("no-next-after-last", entitled_next(next, &block) == HRESULT_FROM_WIN32(ERROR_NO_MORE_ITEMS));
        page->snapshot->valid_until = time(NULL);
        CHECK("expired-page", entitled_enumerate(next, NULL, enumerate) == E_ACCESSDENIED && !entitled_has_more(next));
        page->snapshot->valid_until = time(NULL) + 60;
        entitled_page_release(page);
    }
    enumerated = 0;
    CHECK("close-in-callback-and-stop", entitled_enumerate(next, next, close_during_callback) == S_OK && enumerated == 1);
    CHECK("closed-query-rejected", entitled_enumerate(next, NULL, enumerate) == E_INVALIDARG);
    entitled_page_close(next);
    CHECK("foreign-query-rejected", !entitled_has_more((void *)1) && entitled_next((void *)1, &block) == E_INVALIDARG);
    IXThreadingImpl_XTaskQueueCloseHandle(threads, queue); IXThreadingImpl_Release(threads);
}

/* Synthetic handle lifetime/event fixtures only. Actual acquisition below uses
 * the always-failing bridge; no synthetic proof can reach the shipped runtime. */
struct license_callback_context
{
    XStoreLicenseHandle handle;
    XTaskQueueRegistrationToken token;
    UINT mode;
    BOOL ok, waited;
    HANDLE started, gate, wait_started, finished;
};
static LONG lost_callbacks;

static void CALLBACK license_lost(void *arg)
{
    struct license_callback_context *context = arg;
    InterlockedIncrement(&lost_callbacks);
    if (context->mode == 1) context->ok = package_license_unregister(context->handle, context->token, TRUE);
    else if (context->mode == 2) { package_license_close(context->handle); context->ok = TRUE; }
    else if (context->mode == 3)
    { SetEvent(context->started); context->ok = WaitForSingleObject(context->gate, 3000) == WAIT_OBJECT_0; }
}

static void publish_test_license(struct package_license *license)
{
    AcquireSRWLockExclusive(&package_license_lock);
    license->next = package_licenses; package_licenses = license;
    ReleaseSRWLockExclusive(&package_license_lock);
}

static DWORD WINAPI trigger_test_loss(void *arg)
{
    struct package_license *license = arg;
    InterlockedExchange(&license->lost, TRUE);
    package_license_notify(license);
    return 0;
}

static DWORD WINAPI wait_test_unregister(void *arg)
{
    struct license_callback_context *context = arg;
    SetEvent(context->wait_started);
    context->waited = package_license_unregister(context->handle, context->token, TRUE);
    SetEvent(context->finished);
    return 0;
}

static void test_package_licenses(void)
{
    IXThreadingImpl *threads = NULL;
    XTaskQueueHandle queue = NULL, immediate = NULL;
    struct package_license *license = NULL;
    XStoreProduct product = {0}; XStoreSku sku = {0};
    struct entitled_snapshot proof = {0};
    struct license_callback_context context = {0};
    XStoreContextHandle store;
    XStoreLicenseHandle result;
    XAsyncBlock block = {0};
    HANDLE trigger, waiter;
    ULONGLONG start;
    CHECK("license-threading", QueryApiImpl(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&threads) == S_OK && threads);
    if (!threads) return;
    CHECK("license-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK);
    CHECK("license-immediate", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Immediate, &immediate) == S_OK);
    product.storeId = "B00000000001"; product.productKind = XStoreProductKind_Durable;
    product.isInUserCollection = product.hasDigitalDownload = TRUE;
    product.skus = &sku; product.skusCount = 1;
    sku.isInUserCollection = TRUE; sku.collectionData.endDate = time(NULL) + 3600;
    proof.count = 1; proof.products = &product; proof.valid_until = time(NULL) + 60;
    CHECK("license-no-proof-no-grant", package_license_from_snapshot(&proof, product.storeId, threads, &license) == E_ACCESSDENIED && !license);
    proof.proof_until = time(NULL) + 60;
    product.isInUserCollection = FALSE;
    CHECK("license-unowned-no-grant", package_license_from_snapshot(&proof, product.storeId, threads, &license) == E_ACCESSDENIED && !license);
    product.isInUserCollection = TRUE; product.hasDigitalDownload = FALSE;
    CHECK("license-no-package-no-grant", package_license_from_snapshot(&proof, product.storeId, threads, &license) == E_ACCESSDENIED);
    product.hasDigitalDownload = TRUE; product.productKind = XStoreProductKind_Game;
    CHECK("license-base-not-durable", package_license_from_snapshot(&proof, product.storeId, threads, &license) == E_ACCESSDENIED);
    product.productKind = XStoreProductKind_Durable; sku.isTrial = TRUE;
    CHECK("license-trial-not-full", package_license_from_snapshot(&proof, product.storeId, threads, &license) == E_ACCESSDENIED);
    sku.isTrial = FALSE;
    CHECK("license-wrong-product", package_license_from_snapshot(&proof, "B00000000002", threads, &license) == E_ACCESSDENIED);
    sku.collectionData.endDate = time(NULL);
    CHECK("license-expired-sku", package_license_from_snapshot(&proof, product.storeId, threads, &license) == E_ACCESSDENIED);
    sku.collectionData.endDate = -1;
    CHECK("license-negative-expiry", package_license_from_snapshot(&proof, product.storeId, threads, &license) == E_ACCESSDENIED);
    sku.collectionData.endDate = time(NULL) + 3600;
    CHECK("license-fixture", package_license_from_snapshot(&proof, product.storeId, threads, &license) == S_OK && license);
    if (!license) goto done;
    CHECK("license-proof-bounded", license->until == proof.proof_until);
    {
        struct package_license_async acquired = {0};
        XAsyncProviderData data = {0};
        acquired.license = license; data.context = &acquired;
        CHECK("license-result-buffer-required", package_license_provider(XAsyncOp_GetResult, &data) == E_INVALIDARG && acquired.license == license);
        data.buffer = &result; data.bufferSize = sizeof(result);
        CHECK("license-provider-result-transfer", package_license_provider(XAsyncOp_GetResult, &data) == S_OK && result == license && !acquired.license);
        CHECK("license-provider-result-once", package_license_provider(XAsyncOp_GetResult, &data) == E_INVALIDARG);
    }
    CHECK("license-valid", package_license_valid(license));
    CHECK("license-foreign-invalid", !package_license_valid((void *)1));
    context.handle = license; lost_callbacks = 0;
    CHECK("license-register", package_license_register(license, queue, &context, license_lost, &context.token) == S_OK && context.token.token);
    CHECK("license-no-initial-event", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && !lost_callbacks);
    InterlockedExchange(&license->lost, TRUE); package_license_notify(license); package_license_notify(license);
    CHECK("license-lost-invalid", !package_license_valid(license));
    CHECK("license-loss-on-completion", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && lost_callbacks == 1);
    CHECK("license-no-duplicate-event", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
    CHECK("license-unregister", package_license_unregister(license, context.token, TRUE));
    package_license_close(license);
    CHECK("license-close-invalid", !package_license_valid(license));
    package_license_close(license); package_license_close((void *)1);

    CHECK("license-queued-fixture", package_license_create(threads, time(NULL) + 60, &license) == S_OK);
    publish_test_license(license); context.handle = license; lost_callbacks = 0;
    CHECK("license-queued-register", package_license_register(license, queue, &context, license_lost, &context.token) == S_OK);
    InterlockedExchange(&license->lost, TRUE); package_license_notify(license);
    CHECK("license-unregister-pending", !package_license_unregister(license, context.token, FALSE));
    CHECK("license-unregister-wait-after-pending", package_license_unregister(license, context.token, TRUE));
    CHECK("license-pending-suppressed", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && !lost_callbacks);
    package_license_close(license);

    CHECK("license-expiry-fixture", package_license_create(threads, time(NULL) + 1, &license) == S_OK);
    publish_test_license(license); context.handle = license; lost_callbacks = 0;
    CHECK("license-expiry-register", package_license_register(license, queue, &context, license_lost, &context.token) == S_OK);
    start = GetTickCount64();
    while (!lost_callbacks && GetTickCount64() - start < 2500)
    { IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 10); Sleep(1); }
    CHECK("license-actual-expiry-event", lost_callbacks == 1 && !package_license_valid(license));
    CHECK("license-expired-register-denied", package_license_register(license, queue, &context, license_lost, &context.token) == E_ACCESSDENIED);
    package_license_close(license);

    for (UINT mode = 1; mode <= 2; mode++)
    {
        CHECK("license-reentrant-fixture", package_license_create(threads, time(NULL) + 60, &license) == S_OK);
        publish_test_license(license); memset(&context, 0, sizeof(context));
        context.handle = license; context.mode = mode; lost_callbacks = 0;
        CHECK("license-reentrant-register", package_license_register(license, immediate, &context, license_lost, &context.token) == S_OK);
        InterlockedExchange(&license->lost, TRUE); package_license_notify(license);
        CHECK("license-reentrant-callback", lost_callbacks == 1 && context.ok);
        package_license_close(license);
    }

    CHECK("license-wait-fixture", package_license_create(threads, time(NULL) + 60, &license) == S_OK);
    publish_test_license(license); memset(&context, 0, sizeof(context));
    context.handle = license; context.mode = 3;
    context.started = CreateEventW(NULL, TRUE, FALSE, NULL); context.gate = CreateEventW(NULL, TRUE, FALSE, NULL);
    context.wait_started = CreateEventW(NULL, TRUE, FALSE, NULL); context.finished = CreateEventW(NULL, TRUE, FALSE, NULL);
    CHECK("license-wait-register", package_license_register(license, immediate, &context, license_lost, &context.token) == S_OK);
    trigger = CreateThread(NULL, 0, trigger_test_loss, license, 0, NULL);
    CHECK("license-running-callback", trigger && WaitForSingleObject(context.started, 2000) == WAIT_OBJECT_0);
    CHECK("license-unregister-running-pending", !package_license_unregister(license, context.token, FALSE));
    waiter = CreateThread(NULL, 0, wait_test_unregister, &context, 0, NULL);
    CHECK("license-wait-started", waiter && WaitForSingleObject(context.wait_started, 1000) == WAIT_OBJECT_0);
    CHECK("license-wait-really-blocks", WaitForSingleObject(context.finished, 20) == WAIT_TIMEOUT);
    SetEvent(context.gate);
    CHECK("license-wait-finishes", WaitForSingleObject(context.finished, 2000) == WAIT_OBJECT_0 && context.waited);
    CHECK("license-callback-finishes", WaitForSingleObject(trigger, 2000) == WAIT_OBJECT_0 && context.ok);
    WaitForSingleObject(waiter, 2000); CloseHandle(waiter); CloseHandle(trigger);
    CloseHandle(context.started); CloseHandle(context.gate); CloseHandle(context.wait_started); CloseHandle(context.finished);
    package_license_close(license);

    CHECK("license-no-live-handles", !package_licenses && !package_license_registrations);
    CHECK("license-invalid-register", package_license_register((void *)1, queue, NULL, license_lost, &context.token) == E_INVALIDARG);
    CHECK("license-null-callback", package_license_register((void *)1, queue, NULL, NULL, &context.token) == E_POINTER);
    CHECK("license-foreign-store", package_license_begin((void *)1, "00000001111122223333444444444444", &block) == E_INVALIDARG);
    for (UINT mode = 0; mode < 3; mode++)
    {
        ResetEvent(bridge_started); ResetEvent(bridge_gate); callbacks = 0;
        memset(&block, 0, sizeof(block)); block.queue = queue; block.callback = complete;
        CHECK("license-context", entitled_store_create(NULL, &store) == S_OK);
        CHECK("license-unknown-package", package_license_begin(store, "unknown", &block) == E_GAMEPACKAGE_NO_PACKAGE_IDENTIFIER);
        CHECK("license-acquire-begin", package_license_begin(store, "00000001111122223333444444444444", &block) == S_OK);
        entitled_store_close(store);
        if (mode != 1)
        {
            start = GetTickCount64();
            CHECK("license-dispatch-work", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0));
            CHECK("license-nonblocking-work", GetTickCount64() - start < 200);
            CHECK("license-worker-started", WaitForSingleObject(bridge_started, 2000) == WAIT_OBJECT_0);
        }
        if (mode) IXThreadingImpl_XAsyncCancel(threads, &block);
        if (mode == 1) IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0);
        SetEvent(bridge_gate); dispatch_until_complete(threads, queue, &block);
        CHECK("license-failure-preserved", IXThreadingImpl_XAsyncGetStatus(threads, &block, FALSE) == (mode ? E_ABORT : E_FAIL));
        CHECK("license-completion-once", callbacks == 1);
        result = (void *)1;
        CHECK("license-no-handle-on-failure", FAILED(package_license_result(&block, &result)) && !result);
        start = GetTickCount64(); while (bridge_active && GetTickCount64() - start < 2000) Sleep(1);
        CHECK("license-failed-worker-finishes", !bridge_active);
    }
done:
    if (immediate) IXThreadingImpl_XTaskQueueCloseHandle(threads, immediate);
    if (queue) IXThreadingImpl_XTaskQueueCloseHandle(threads, queue);
    IXThreadingImpl_Release(threads);
}

struct game_test_context
{
    XStoreContextHandle store;
    XTaskQueueRegistrationToken token;
    UINT64 serial, version;
    LONG calls;
    UINT mode;
    BOOL ok, waited;
    HANDLE started, gate, waiting, finished;
};

static void CALLBACK game_changed(void *arg)
{
    struct game_test_context *context = arg;
    InterlockedIncrement(&context->calls);
    if (context->mode == 1) context->ok = game_license_unregister(context->store, context->token, TRUE);
    else if (context->mode == 2) { entitled_store_close(context->store); context->ok = TRUE; }
    else if (context->mode == 3)
    { SetEvent(context->started); context->ok = WaitForSingleObject(context->gate, 3000) == WAIT_OBJECT_0; }
    else if (context->mode == 4 && context->calls == 1)
        game_license_notify(context->serial, ++context->version);
}

static DWORD WINAPI game_test_trigger(void *arg)
{
    struct game_test_context *context = arg;
    game_license_notify(context->serial, ++context->version);
    return 0;
}

static DWORD WINAPI game_test_wait(void *arg)
{
    struct game_test_context *context = arg;
    SetEvent(context->waiting);
    if (context->mode == 5) { entitled_store_close(context->store); context->waited = TRUE; }
    else context->waited = game_license_unregister(context->store, context->token, TRUE);
    SetEvent(context->finished);
    return 0;
}

static void test_game_licenses(void)
{
    IXThreadingImpl *threads = NULL;
    XTaskQueueHandle queue = NULL, immediate = NULL, terminated = NULL, process_queue = NULL, pool = NULL;
    struct game_test_context context = {0}, other = {0};
    XStoreSku skus[2] = {{0}}, swap;
    XStoreProduct product = {0};
    struct entitled_snapshot proof = {0};
    UINT64 now = time(NULL), refresh = 0, serial, xuid;
    XTaskQueueRegistrationToken token = {0};
    HANDLE trigger, waiter;
    CHECK("game-threading", QueryApiImpl(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&threads) == S_OK && threads);
    if (!threads) return;
    CHECK("game-manual-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK);
    CHECK("game-immediate-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Immediate, &immediate) == S_OK);
    CHECK("game-create", entitled_store_create(NULL, &context.store) == S_OK);
    CHECK("game-create-other", entitled_store_create(NULL, &other.store) == S_OK);
    CHECK("game-identity", entitled_store_identity(context.store, &xuid, &context.serial) == S_OK && context.serial);
    CHECK("game-other-identity", entitled_store_identity(other.store, &xuid, &other.serial) == S_OK && other.serial != context.serial);
    CHECK("game-null-token", game_license_register(context.store, queue, NULL, game_changed, NULL) == E_POINTER);
    token.token = 123;
    CHECK("game-null-callback-clears-token", game_license_register(context.store, queue, NULL, NULL, &token) == E_POINTER && !token.token);
    token.token = 123;
    CHECK("game-invalid-context-clears-token", game_license_register((void *)1, queue, NULL, game_changed, &token) == E_INVALIDARG && !token.token);
    CHECK("game-register", game_license_register(context.store, queue, &context, game_changed, &context.token) == S_OK && context.token.token);
    CHECK("game-register-other", game_license_register(other.store, queue, &other, game_changed, &other.token) == S_OK && other.token.token != context.token.token);
    CHECK("game-no-initial-event", !context.calls && !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
    CHECK("game-wrong-context-token-noop", game_license_unregister(other.store, context.token, TRUE));
    proof.valid_until = now + 60; proof.proof_until = now + 600; proof.count = 1; proof.products = &product;
    product.storeId = storeId; product.productKind = XStoreProductKind_Game; product.isInUserCollection = TRUE;
    product.skusCount = 1; product.skus = skus;
    skus[0].skuId = "0010"; skus[0].isInUserCollection = TRUE; skus[0].isTrial = TRUE; skus[0].collectionData.endDate = now + 3600;
    game_license_observe(context.serial, ++refresh, &proof);
    CHECK("game-first-proof-only-baseline", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && !context.calls);
    skus[0].isTrial = FALSE;
    game_license_observe(context.serial, ++refresh, &proof);
    CHECK("game-completion-not-work-port", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Work, 0) && !context.calls);
    CHECK("game-trial-full-change", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && context.calls == 1 && !other.calls);
    CHECK("game-no-duplicate-event", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
    proof.proof_until++;
    game_license_observe(context.serial, ++refresh, &proof);
    CHECK("game-proof-ttl-not-license-change", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
    skus[1] = skus[0]; skus[1].skuId = "0020"; product.skusCount = 2;
    game_license_observe(context.serial, ++refresh, &proof);
    CHECK("game-sku-set-change", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && context.calls == 2);
    swap = skus[0]; skus[0] = skus[1]; skus[1] = swap;
    game_license_observe(context.serial, ++refresh, &proof);
    CHECK("game-sku-order-not-change", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
    skus[0].isTrial = TRUE;
    game_license_observe(context.serial, refresh - 1, &proof);
    proof.proof_until = 0; game_license_observe(context.serial, ++refresh, &proof); proof.proof_until = now + 600;
    proof.valid_until = now - 1; game_license_observe(context.serial, ++refresh, &proof); proof.valid_until = now + 60;
    product.storeId = "B00000000002"; game_license_observe(context.serial, ++refresh, &proof); product.storeId = storeId;
    product.productKind = XStoreProductKind_Durable; game_license_observe(context.serial, ++refresh, &proof); product.productKind = XStoreProductKind_Game;
    proof.count = 0; game_license_observe(context.serial, ++refresh, &proof); proof.count = 1;
    skus[0].collectionData.endDate = -1; game_license_observe(context.serial, ++refresh, &proof); skus[0].collectionData.endDate = now + 3600;
    CHECK("game-no-unverified-expired-related-absent-stale-events", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && context.calls == 2);
    game_license_observe(context.serial, ++refresh, &proof);
    skus[0].isTrial = FALSE; game_license_observe(context.serial, ++refresh, &proof);
    CHECK("game-coalesced-refresh", IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && context.calls == 3);
    CHECK("game-coalesced-no-extra", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
    skus[0].collectionData.endDate++; game_license_observe(context.serial, ++refresh, &proof);
    CHECK("game-unregister-queued-false", !game_license_unregister(context.store, context.token, FALSE));
    CHECK("game-wait-after-pending", game_license_unregister(context.store, context.token, TRUE));
    IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0);
    CHECK("game-queued-event-suppressed", context.calls == 3);
    CHECK("game-repeat-unregister-safe", game_license_unregister(context.store, context.token, TRUE));
    CHECK("game-other-still-registered", game_license_registrations && game_license_registrations->serial == other.serial);
    CHECK("game-other-unregister", game_license_unregister(other.store, other.token, FALSE));
    CHECK("game-register-after-baseline", game_license_register(context.store, queue, &context, game_changed, &context.token) == S_OK);
    CHECK("game-no-event-after-register-known", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0));
    skus[0].collectionData.endDate++; game_license_observe(context.serial, ++refresh, &proof);
    serial = context.serial; entitled_store_close(context.store);
    IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0);
    CHECK("game-close-queued-suppressed", context.calls == 3 && !game_license_registrations);
    CHECK("game-closed-context-denied", game_license_register(context.store, queue, &context, game_changed, &token) == E_INVALIDARG);
    game_license_observe(serial, ++refresh, &proof);
    entitled_store_close(other.store);
    CHECK("game-new-context-after-close", entitled_store_create(NULL, &context.store) == S_OK);
    CHECK("game-new-context-serial", entitled_store_identity(context.store, &xuid, &context.serial) == S_OK && context.serial != serial);
    game_license_observe(serial, ++refresh, &proof);
    CHECK("game-stale-async-cannot-touch-new-context", !((struct entitled_store_context *)context.store)->license_version);
    entitled_store_close(context.store);

    for (UINT mode = 1; mode <= 4; mode++)
    {
        if (mode == 3) continue;
        memset(&context, 0, sizeof(context)); context.mode = mode;
        CHECK("game-reentrant-create", entitled_store_create(NULL, &context.store) == S_OK);
        CHECK("game-reentrant-identity", entitled_store_identity(context.store, &xuid, &context.serial) == S_OK);
        CHECK("game-reentrant-register", game_license_register(context.store, immediate, &context, game_changed, &context.token) == S_OK);
        game_test_trigger(&context);
        CHECK("game-reentrant-completes", mode == 4 ? context.calls == 2 : context.calls == 1 && context.ok);
        if (mode != 2) entitled_store_close(context.store);
        CHECK("game-reentrant-no-live-registration", !game_license_registrations);
    }
    for (UINT close = 0; close < 2; close++)
    {
        memset(&context, 0, sizeof(context)); context.mode = 3;
        CHECK("game-wait-create", entitled_store_create(NULL, &context.store) == S_OK);
        CHECK("game-wait-identity", entitled_store_identity(context.store, &xuid, &context.serial) == S_OK);
        context.started = CreateEventW(NULL, TRUE, FALSE, NULL); context.gate = CreateEventW(NULL, TRUE, FALSE, NULL);
        context.waiting = CreateEventW(NULL, TRUE, FALSE, NULL); context.finished = CreateEventW(NULL, TRUE, FALSE, NULL);
        CHECK("game-wait-register", game_license_register(context.store, immediate, &context, game_changed, &context.token) == S_OK);
        if (close)
        {
            memset(&other, 0, sizeof(other)); other.store = context.store;
            CHECK("game-close-multiple-register", game_license_register(context.store, queue, &other, game_changed, &other.token) == S_OK);
        }
        trigger = CreateThread(NULL, 0, game_test_trigger, &context, 0, NULL);
        CHECK("game-running-callback", trigger && WaitForSingleObject(context.started, 2000) == WAIT_OBJECT_0);
        CHECK("game-running-unregister-false", !game_license_unregister(context.store, context.token, FALSE));
        /* The callback has already selected mode 3 before waiting on its gate. */
        context.mode = close ? 5 : 3;
        waiter = CreateThread(NULL, 0, game_test_wait, &context, 0, NULL);
        CHECK("game-wait-started", waiter && WaitForSingleObject(context.waiting, 1000) == WAIT_OBJECT_0);
        CHECK("game-wait-blocks-until-callback-return", WaitForSingleObject(context.finished, 20) == WAIT_TIMEOUT);
        SetEvent(context.gate);
        CHECK("game-wait-finishes", WaitForSingleObject(context.finished, 2000) == WAIT_OBJECT_0 && context.waited);
        CHECK("game-running-callback-finishes", WaitForSingleObject(trigger, 2000) == WAIT_OBJECT_0 && context.ok);
        WaitForSingleObject(waiter, 2000); CloseHandle(waiter); CloseHandle(trigger);
        CloseHandle(context.started); CloseHandle(context.gate); CloseHandle(context.waiting); CloseHandle(context.finished);
        if (!close) entitled_store_close(context.store);
        else
        {
            IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0);
            CHECK("game-close-suppresses-all-other-registrations", !other.calls);
        }
        CHECK("game-wait-clean", !game_license_registrations);
    }

    CHECK("game-threadpool-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_ThreadPool, XTaskQueueDispatchMode_ThreadPool, &pool) == S_OK);
    for (UINT i = 0; i < 100; i++)
    {
        memset(&context, 0, sizeof(context));
        CHECK("game-race-create", entitled_store_create(NULL, &context.store) == S_OK);
        CHECK("game-race-identity", entitled_store_identity(context.store, &xuid, &context.serial) == S_OK);
        CHECK("game-race-register", game_license_register(context.store, pool, &context, game_changed, &context.token) == S_OK);
        game_test_trigger(&context);
        CHECK("game-race-unregister", game_license_unregister(context.store, context.token, TRUE));
        CHECK("game-race-at-most-once", context.calls <= 1);
        entitled_store_close(context.store);
    }
    IXThreadingImpl_XTaskQueueCloseHandle(threads, pool);

    memset(&context, 0, sizeof(context));
    CHECK("game-process-context", entitled_store_create(NULL, &context.store) == S_OK);
    IXThreadingImpl_XTaskQueueGetCurrentProcessTaskQueue(threads, &process_queue);
    IXThreadingImpl_XTaskQueueSetCurrentProcessTaskQueue(threads, queue);
    CHECK("game-null-queue-uses-process-queue", game_license_register(context.store, NULL, &context, game_changed, &context.token) == S_OK);
    CHECK("game-null-queue-unregister", game_license_unregister(context.store, context.token, TRUE));
    IXThreadingImpl_XTaskQueueSetCurrentProcessTaskQueue(threads, process_queue);
    if (process_queue) IXThreadingImpl_XTaskQueueCloseHandle(threads, process_queue);
    CHECK("game-cancel-queue-create", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &terminated) == S_OK);
    CHECK("game-cancel-identity", entitled_store_identity(context.store, &xuid, &context.serial) == S_OK);
    CHECK("game-cancel-register", game_license_register(context.store, terminated, &context, game_changed, &context.token) == S_OK);
    game_test_trigger(&context);
    CHECK("game-terminate-start", IXThreadingImpl_XTaskQueueTerminate(threads, terminated, FALSE, NULL, NULL) == S_OK);
    for (UINT i = 0; i < 20; i++)
    {
        IXThreadingImpl_XTaskQueueDispatch(threads, terminated, XTaskQueuePort_Work, 0);
        IXThreadingImpl_XTaskQueueDispatch(threads, terminated, XTaskQueuePort_Completion, 0);
    }
    CHECK("game-canceled-not-delivered", !context.calls);
    game_test_trigger(&context); /* Submission to a terminated queue must unwind. */
    CHECK("game-submit-failure-unregister", game_license_unregister(context.store, context.token, FALSE));
    IXThreadingImpl_XTaskQueueCloseHandle(threads, terminated);
    entitled_store_close(context.store);
    IXThreadingImpl_XTaskQueueCloseHandle(threads, queue);
    IXThreadingImpl_XTaskQueueCloseHandle(threads, immediate);
    IXThreadingImpl_Release(threads);
    CHECK("game-no-live-stores-or-registrations", !entitled_stores && !game_license_registrations);
}

int main(void)
{
    HMODULE dll = LoadLibraryA("xgameruntime.dll");
    if (!dll || !(runtime_query = (void *)GetProcAddress(dll, "QueryApiImpl"))) return 2;
    HRESULT hr = RoInitialize(RO_INIT_MULTITHREADED);
    CHECK("winrt", SUCCEEDED(hr));
    IXStoreImpl6 *store_api = NULL; XStoreContextHandle store = NULL;
    CHECK("runtime-store-abi", runtime_query(&CLSID_XStoreImpl, &IID_IXStoreImpl6, (void **)&store_api) == S_OK && store_api);
    if (store_api)
    {
        CHECK("runtime-create-store-context", IXStoreImpl6_XStoreCreateContext(store_api, NULL, &store) == S_OK && store);
        IXThreadingImpl *threads = NULL;
        XTaskQueueHandle queue = NULL;
        XTaskQueueRegistrationToken game_token = {0};
        struct game_test_context context = {0};
        CHECK("runtime-game-threading", runtime_query(&CLSID_XThreadingImpl, &IID_IXThreadingImpl, (void **)&threads) == S_OK && threads);
        if (threads)
        {
            CHECK("runtime-game-queue", IXThreadingImpl_XTaskQueueCreate(threads, XTaskQueueDispatchMode_Manual, XTaskQueueDispatchMode_Manual, &queue) == S_OK);
            CHECK("runtime-game-register-implemented", IXStoreImpl6_XStoreRegisterGameLicenseChanged(store_api, store, queue, &context, game_changed, &game_token) == S_OK && game_token.token);
            CHECK("runtime-game-no-initial-event", !IXThreadingImpl_XTaskQueueDispatch(threads, queue, XTaskQueuePort_Completion, 0) && !context.calls);
            IXThreadingImpl_XTaskQueueCloseHandle(threads, queue); /* Subscription owns a duplicate. */
            CHECK("runtime-game-unregister", IXStoreImpl6_XStoreUnregisterGameLicenseChanged(store_api, store, game_token, TRUE));
            game_token.token = 123;
            CHECK("runtime-game-invalid-context", IXStoreImpl6_XStoreRegisterGameLicenseChanged(store_api, (void *)1, NULL, &context, game_changed, &game_token) == E_INVALIDARG && !game_token.token);
            game_token.token = 123;
            CHECK("runtime-game-null-callback", IXStoreImpl6_XStoreRegisterGameLicenseChanged(store_api, store, NULL, NULL, NULL, &game_token) == E_POINTER && !game_token.token);
            CHECK("runtime-game-register-close", IXStoreImpl6_XStoreRegisterGameLicenseChanged(store_api, store, NULL, NULL, game_changed, &game_token) == S_OK);
            IXThreadingImpl_Release(threads);
        }
        XAsyncBlock invalid_license = {0};
        CHECK("runtime-license-invalid-context", IXStoreImpl6_XStoreAcquireLicenseForPackageAsync(store_api, (void *)1, "00000001111122223333444444444444", &invalid_license) == E_INVALIDARG);
        CHECK("runtime-license-invalid-handle", !IXStoreImpl6_XStoreIsLicenseValid(store_api, (void *)1));
        IXStoreImpl6_XStoreCloseLicenseHandle(store_api, (void *)1);
        IXStoreImpl6_XStoreCloseContextHandle(store_api, store);
        HRESULT query_hr = IXStoreImpl6_XStoreEnumerateProductsQuery(store_api, (void *)1, NULL, enumerate);
        printf("STORE_ABI invalid_handle_hr=%08lx\n", query_hr);
        CHECK("runtime-invalid-query-handle", query_hr == E_INVALIDARG);
        IXStoreImpl6_Release(store_api);
    }
    bridge_started = CreateEventA(NULL, TRUE, FALSE, NULL); bridge_gate = CreateEventA(NULL, TRUE, FALSE, NULL);
    test_receipts(); test_async(test_metadata()); test_package_licenses(); test_game_licenses();
    CloseHandle(bridge_started); CloseHandle(bridge_gate);
    if (SUCCEEDED(hr)) RoUninitialize();
    printf("CHECKS %u FAILURES %u\n", checks, failures);
    return failures ? 1 : 0;
}
