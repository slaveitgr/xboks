# Xodus Nexus backend 0.2.9

- Fix Store-ticket handling for accounts receiving delegation-compact sign-in tokens, addressing empty libraries and content-licensing failures. Thanks @btsouth.
- Preserve token data correctly in GNOME textual keyrings and keep saved account credentials consistent. Thanks @chalkers.
- Improve account refresh handling and retry library loading after temporary failures.
- Recover stalled or interrupted downloads without panicking, while preserving resumable progress and existing game files.
- Add a shared, adjustable download speed limit across parallel streams, including active downloads.
- Improve package-metadata retries and distinguish network stalls from time spent writing files or applying the speed limit.
