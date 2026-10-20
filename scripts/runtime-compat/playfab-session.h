/* SPDX-License-Identifier: MIT
 * Verified x64 GDK/PlayFab ABI. This prefix of IXThreadingImpl is checked
 * against the pinned generated interface in the native session probe.
 */
#ifndef NEXUS_PLAYFAB_SESSION_H
#define NEXUS_PLAYFAB_SESSION_H
typedef struct NexusAsync NexusAsync;
typedef struct NexusThreads NexusThreads;
typedef void WINAPI NexusCompletion(NexusAsync *);
struct NexusAsync { void *queue, *context; NexusCompletion *callback; void *internal[4]; };
typedef struct { NexusAsync *async; size_t bufferSize; void *buffer, *context; } NexusProviderData;
typedef HRESULT WINAPI NexusProvider(unsigned, const NexusProviderData *);
typedef struct {
    HRESULT (WINAPI *query)(NexusThreads *, const GUID *, void **);
    ULONG (WINAPI *addref)(NexusThreads *);
    ULONG (WINAPI *release)(NexusThreads *);
    HRESULT (WINAPI *status)(NexusThreads *, NexusAsync *, BOOLEAN);
    void (WINAPI *unused_size)(void);
    void (WINAPI *cancel)(NexusThreads *, NexusAsync *);
    void (WINAPI *unused_run)(void);
    HRESULT (WINAPI *begin)(NexusThreads *, NexusAsync *, void *, const void *, const char *, NexusProvider *);
    void (WINAPI *unused_padding)(void);
    void (WINAPI *unused_schedule)(void);
    void (WINAPI *complete)(NexusThreads *, NexusAsync *, HRESULT, size_t);
    void (WINAPI *unused_result)(void);
    HRESULT (WINAPI *create_queue)(NexusThreads *, unsigned, unsigned, void **);
    void (WINAPI *unused_composite)(void);
    void (WINAPI *unused_port)(void);
    void (WINAPI *unused_duplicate)(void);
    void (WINAPI *unused_dispatch)(void);
    void (WINAPI *close_queue)(NexusThreads *, void *);
} NexusThreadsVtable;
struct NexusThreads { const NexusThreadsVtable *vtable; };
_Static_assert(sizeof(NexusAsync)==56 && offsetof(NexusAsync,internal)==24, "Unsupported XAsync ABI");
typedef struct {
    int64_t time;
    uint64_t totalBytes, uploadedBytes;
    char deviceType[256], deviceId[256], deviceFriendlyName[256];
    char thumbnailUri[2048], shortSaveDescription[4096];
} SaveDescriptor;
typedef struct {
    void (WINAPI *progress)(void *, unsigned, void *); void *progressContext;
    void (WINAPI *failed)(void *, unsigned, HRESULT, void *); void *failedContext;
    void (WINAPI *contention)(void *, SaveDescriptor *, SaveDescriptor *, void *); void *contentionContext;
    void (WINAPI *conflict)(void *, SaveDescriptor *, SaveDescriptor *, void *); void *conflictContext;
    void (WINAPI *storage)(void *, uint64_t, void *); void *storageContext;
} SaveCallbacks;
_Static_assert(sizeof(SaveCallbacks)==80 && offsetof(SaveDescriptor,shortSaveDescription)==2840,
    "Unsupported PlayFab descriptor/callback ABI");
#endif
