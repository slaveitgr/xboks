# Xbox party voice: native and signaling evidence

This targeted static pass identifies the original application's party control and media boundaries. The supplied GamingApp **2610.1001.20.0 x64** contains a separate COM party host, `xCommsUwp`, and a direct dependency on **PlayFab Party**. Its JavaScript party controls also contain a Game Bar app-service path. Implementing the messaging REST APIs or capturing a microphone alone does not implement this party protocol.

No original executable was launched, credential read, authenticated request made, party joined or audio sent during this analysis. This chapter describes package evidence and a proposed Linux implementation; it does not claim working Xbox party voice in xboks.

## Original native boundary

These files are members of `work/reference/XboxAppPackage_2610.1001.20.0_x64.msix`. SHA-256 binds the locators to this exact version:

| Package member | Bytes | SHA-256 |
|---|---:|---|
| `XboxPartyChatHost.exe` |1,271,648|`b959652051089c255de076e856141ecae969721a162c4e19a6491caf3378217d`|
| `XboxPartyChatHost.winmd` |12,128|`9ccc82beb5615582834f74ea74f4297082424e59143e4a92fe97a159cb94adba`|
| `xCommsUwp.dll` |2,681,192|`9500be75d99c64ee360a9f8f27291cb3ee67ccbc5d364d58ce65bcbdde63d5cd`|
| `xCommsUwp.winmd` |29,536|`2bc7b5436b5c8006ab8e2b1c3eb2c1ff5ed66a0c37ca28e97e3fd38b8cb0de0a`|
| `PartyWin.dll` |4,027,240|`cc9b999fcea9f00c39fba7c0adb3119c01cfa0d73304b3eb431a65dbdcb027c0`|
| `Microsoft.Xbox.ChatAudio.dll` |801,088|`6af8e7479a3cc5bb440f52267de7e18e7312e8be967255c63ea1105b6c4d2388`|

`AppxManifest.xml` registers `XboxPartyChatHost.exe` as a COM executable server at line 136, its class at 137, and the application's `PartyWidget` Game Bar UI extension at 234. It registers `Microsoft.Xbox.ChatAudio.dll` at 594 and `xCommsUwp.dll` at 610, and declares microphone capability at 1012. The separately supplied Game Bar package declares microphone capability at its manifest line 272. This ties the widget to the GamingApp package; the presence of a Game Bar window does not mean its media implementation lives in the overlay package alone.

The PE import directory of `xCommsUwp.dll` directly imports **49 functions from `PartyWin.dll`**. These include:

- Library lifetime and event processing: `PartyInitialize`, `PartyCleanup`, `PartyStartProcessingStateChanges`, `PartyFinishProcessingStateChanges`.
- Identity/network: `PartyCreateLocalUser`, `PartyLocalUserUpdateEntityToken`, `PartyCreateNewNetwork`, `PartyConnectToNetwork`, `PartyNetworkAuthenticateLocalUser`, `PartySerializeNetworkDescriptor`, `PartyDeserializeNetworkDescriptor`.
- Audio membership: `PartyDeviceCreateChatControl`, `PartyNetworkConnectChatControl`, `PartyChatControlSetPermissions`.
- Audio controls: `PartyChatControlSetAudioInput`, `PartyChatControlSetAudioOutput`, `PartyChatControlSetAudioInputMuted`, `PartyChatControlSetIncomingAudioMuted`, `PartyChatControlSetAudioRenderVolume`, `PartyChatControlGetChatIndicator`.

This is a linked native dependency, stronger evidence than a matching label or error string. It still does not prove which branch or transport is selected in a particular running session. `PartyWin.dll` additionally contains Opus/DTLS diagnostics; those literals do not specify an interoperable packet format. `Microsoft.Xbox.ChatAudio.dll` imports `XAudio2_9.dll` and `MMDevAPI.DLL`. Windows COM activation, WinRT devices and these DLLs cannot be treated as Linux-callable interfaces.

`XccWebRtc.dll` also exists in this package and has game-streaming-specific symbols. Its presence must not be used to conclude that the standalone consumer party protocol is ordinary browser WebRTC. The direct party dependency established here is `xCommsUwp` → `PartyWin`.

## Typed metadata contracts

The [typed WinMD parser](winmd-signatures.md) decoded these actual signature blobs. MethodDef row IDs below are local to the named WinMD, not global application IDs. `string` XUID parameters remain strings; native pointers and Windows interfaces are not portable handles.

| WinMD interface/member | MethodDef | Decoded contract |
|---|---:|---|
| `XboxPartyChatHost.IXCommsInterop.GetXCommsUwp` |2|`() → xCommsUwp.XCommsUwp`|
| `xCommsUwp.IXCommsUwp.InitializeAsync` |87|`(bool usePartyService, bool supportsDtcMode, IXCommsUwpDelegate xCommsDelegate) → IAsyncAction`|
| `IXCommsUwp.AcceptPartyInviteAsync` |91|`(UserConnectionInfo actingUserConnectionInfo, string handleId) → IAsyncAction`|
| `IXCommsUwp.JoinPartyAsync` |92|`(UserConnectionInfo actingUserConnectionInfo, string sessionId) → IAsyncAction`|
| `IXCommsUwp.InviteUserAsync` |93|`(UserConnectionInfo actingUserConnectionInfo, IVectorView<UserConnectionInfo> usersToInviteConnectionInfo) → IAsyncAction`|
| `IXCommsUwp.LeavePartyAsync` |94|`(string actingXuid) → IAsyncAction`|
| `IXCommsUwp.GetPartyDetails` |96|`() → PartyDetails`|
| `IXCommsUwp.SetNoiseSuppression` |110|`(string actingXuid, NoiseSuppressionType enabled) → void`|
| `IXCommsUwp.SetAudioEnabled` |111|`(bool enabled) → void`|
| `IXCommsUwp.SetMemberVolume` |112|`(string actingXuid, string targetXuid, float32 volume) → void`|
| `IXCommsUwp.SetPartyVolume` |113|`(float32 volume) → void`|
| `IXCommsUwp.ChatMessageReceived` |118|`(ChatSocketMessage message) → void`|
| `IXCommsUwp.SetAudioInputDeviceAsync` |119|`(string xuid, AudioDeviceSelectionMode audioDeviceSelectionMode, string deviceId) → IAsyncAction`|
| `IXCommsUwp.SetAudioOutputDeviceAsync` |120|`(string xuid, AudioDeviceSelectionMode audioDeviceSelectionMode, string deviceId) → IAsyncAction`|
| `IXCommsUwpDelegate.GetTokenAndSignatureData` |132|`(string xuid, string url, bool forceRefresh) → TokenAndSignatureData`|
| `IXCommsUwpDelegate.CheckUserPrivilege` |133|`(string xuid, int32 privilege) → PrivilegeCheckDenyReason`|
| `IXCommsUwpDelegate.SubscribeToChatSocketForXuid` |137|`(string xuid, IVectorView<string> chatSocketChannels) → void`|

`ConditionallyCreateNewPartyAsync` is MethodDef 90; its ten parameters are a creation condition, acting/invited `UserConnectionInfo`, six context strings and `LfgData`. Joinability is a separate MethodDef 100 operation taking `PartyJoinability`. The boolean `usePartyService` and party/MPSD error paths establish more than one supported native mode; this analysis has not established the live default or feature-gate selection.

The local connection interfaces expose `ConnectionId` and `ServerNonce`. Chat socket message types include `Party` and `WhoAmI`; the party payload exposes `SessionId` and `ChangeNumber`, and the who-am-I payload exposes `ConnectionId`/`ServerNonce`. PC callbacks report session, members, joinability, input/output device changes and audio-device failures. `ChatState` explicitly distinguishes connecting, muted, silent, talking, privilege/privacy denial and request failure. An implementation needs these states rather than a success flag inferred from microphone access.

The signed-token callback returns both `Token` and `Signature`. It does not prove that the current companion's bearer-only text-chat session is sufficient for every party request. Required relying parties, proof/signing behavior and privilege values must be established before implementing authenticated party operations.

## Signaling and original UI call sites

The Hermes v96 bundle SHA-256 is `4f9f633da95002aeab380f01813bb7da63bc7f938f7f1f26b401c0bb2b180b55`. Instruction offsets are relative to their function; the accompanying absolute offset refers to `index.bundle`.

| Evidence | Exact locator | Bounded conclusion |
|---|---|---|
| Game Bar request envelope |function 20899, offsets 22–38; file 11647361–11647377|Constructs an object with `type`/`payload`, JSON stringifies it, and passes it to `_sendMessageAsync` at offset 78. This is application IPC, not an audio transport.|
| Start party bridge |function 20855, offsets 9/28; file 11645414/11645433|Selects `_sendMessageToGameBarAsync` and the `StartParty` request type.|
| Voice settings bridge |function 20847, offsets 9/28; file 11645151/11645170|Selects the same bridge and `GetPartyVoiceSettings`, then parses returned payload JSON.|
| Push to talk bridge |function 20819, offsets 28/39; file 11644067/11644078|Selects `SetPartyPushToTalkSetting` with an `isPushToTalkEnabled` property.|
| Alternative UI path |function 46563, offsets 192/197 and 459–508; file 15351579/15351584 and 15351846–15351895|Tests `EnableSocialL2s` and contains secondary Party-window creation. This is evidence of UI branching, not proof all starts invoke the same IPC path.|
| Party request factory |function 49760, offsets 33/80; file 15888824/15888871|Builds a request factory for `https://party.xboxlive.com` and supplies contract version `107` plus JSON Accept headers.|
| Party session lookup |function 49764, offsets 25–62 and 76–102; file 15889018–15889055 and 15889069–15889095|Builds `serviceconfigs/7492BACA-C1B4-440D-A391-B7EF364A8D40/sessiontemplates/chat/sessions?xuid={xuid}&followed=true` and calls the request factory's `get`, then `execute`.|
| Party preview |function 49768, offsets 28–65 and 79–108; file 15889288–15889325 and 15889339–15889368|Builds the same service-config/template path with `/sessions/{sessionId}?nocommit=true&followed=true`; calls `put` with a newly created empty object, then `execute`. Do not replace this with a guessed GET or use it as party creation.|
| Chat socket authorization |function 24794, offsets 49/53/85–98/127; file 12096891/12096895/12096927–12096940/12096969|Constructs `https://chat.xboxlive.com/users/xuid({xuid})/chat/auth`, executes a GET request and extracts `AuthKey`.|
| Chat socket URL |function 24795, offsets 39/43/50; file 12097028/12097032/12097039|Builds `wss://chat.xboxlive.com/users/xuid({xuid})/chat/connect?AuthKey={key}`. The key must be kept out of logs and renderer state.|
| Party RTA resource name |function 42595, offsets 13/22; file 14862867/14862876|Builds `http://sessiondirectory.xboxlive.com/users/xuid({xuid})/partydetails`. This is a resource identifier; it is not evidence to send an insecure HTTP request.|

These are instruction sequences and versioned interface declarations. They have not been replayed against a service, and do not establish the complete current service protocol.

Additional **native string evidence** in `xCommsUwp.dll` narrows the remaining investigation:

| DLL file offset | Literal/candidate | What it establishes |
|---:|---|---|
|1745704|`https://party.xboxlive.com`|Native party-service base URL is present.|
|1745784, 1745840, 1745896, 1745932, 1745940|`/parties/create`, `/party/connection`, `/joinability`, `/kick`, `/leave`|Path components exist; HTTP methods, complete paths, headers and bodies are not recovered merely by finding these literals.|
|1749816, 1749840|`networkDescriptor`, `networkInvitation`|Named native JSON fields tie party/session data to network setup; exact schema and validation remain to be reconstructed.|
|1755256, 1755272|`connectionId`, `serverNonce`|Connection identity field names agree with the typed metadata.|
|1756072, 1756112, 1756152|`EntityToken`, `XboxToken`, `A667`|PlayFab authentication-related fields and a title identifier exist in this build. A different title must not be substituted and assumed interoperable.|
|1756440|`https://a667.playfabapi.com/Client/LoginWithXbox`|Specific native PlayFab login endpoint is present; this analysis has not called it or reconstructed its complete request policy.|
|1758448|`wss://rta.xboxlive.com/connect`|Native RTA WebSocket endpoint is present.|

## Proposed Linux adapter

The clean-room boundary should be a main-process-owned party service with a native media worker. The renderer receives sanitized party/member/device state and explicit commands. It should never receive Xbox tickets, proof keys, PlayFab entity tokens, chat `AuthKey` URLs or network invitations/descriptors.

The official [PlayFab Party Linux SDK v1.10.27](https://github.com/PlayFab/PlayFabParty/releases/tag/v1.10.27) provides a concrete native-media candidate. The reviewed `Microsoft.PlayFab.Party.Cpp.Linux.Release.zip` is 5,703,201 bytes with published SHA-256 `a6c078d55ce4ede5cfab7291289438fae33930646aec3737ba7b163fce35b16b`. Its `libParty.so` exports the required C identity/network/chat-control and audio operations, links PulseAudio and requires glibc symbols through 2.34. This was static inspection, not library initialization or consumer-party interoperability. The [pinned header](https://github.com/PlayFab/PlayFabParty/blob/dcf63eb9daf691bf6e0094652b0bb50c0a3b0535/include/Party.h) requires matching title/entity credentials. The [LoginWithXbox contract](https://learn.microsoft.com/en-us/rest/api/playfab/client/authentication/login-with-xbox?view=playfab-rest) requires an Xbox token for the PlayFab audience; the social adapter's `http://xboxlive.com` XSTS ticket must not be substituted. Legitimate matching entity credentials, descriptor/invitation parsing, roster/privacy and server acceptance remain open.

The current app adds a separate local microphone test in Sound settings and Guide Audio. Explicit capture permission, selected devices, meter, mute, local push to talk, noise processing and optional monitoring exercise the local capture/render chain. It does not initialize the Party SDK, join a session or transmit audio. Its implementation and reproducible fake-device verification are recorded in [the local audio integration report](../voice-audio-integration.md).

Maintain membership and media states separately:

```text
idle → authorizing → connecting-signaling → joining → waiting-media → connected
                                  ↘ error ←───────────────┘
active states → leaving → idle
account change / sign-out / worker failure → teardown → idle or error
```

`connected` must require acknowledged membership and media-worker network/chat-control readiness. Talking/silent/muted, local device failure and remote per-member state are separate observations. Membership success alone must not produce an audio-connected indicator.

Authentication must bind the selected account/XUID across awaits and cancel pending work on identity/backend changes. Preserve the existing companion's no-credential-migration rule when an older selected backend shares its keyring. Party authentication needing additional exchange/signing cannot silently renew or rewrite that backend's records. Network membership writes, invitations and microphone publication require their own user-triggered actions; state reads must not auto-create a party.

The worker should own library initialization, local user/entity-token lifetime, network descriptor/invitation handling, chat-control connection/permissions, state-change processing, capture/render devices and teardown. Wire mute, input/output selection, per-member/party volume and push to talk to actual worker operations. A main-process global mic permission grant or OS mixer slider must not masquerade as a party mute or device switch. Prevent parallel voice workers in the app and Guide: both windows observe the same session, with explicit device release when leaving or changing account.

## Implementation and verification order

1. Finish static request reconstruction for native party creation/join/connection and chat-socket payloads; preserve mode/contract differences. Confirm request signatures and privileges instead of guessing from text-chat access.
2. Verify a usable Linux media SDK and its lifetime/event-loop/audio interface using a synthetic standalone harness. Compile/link success is a prerequisite, not Xbox interoperability proof.
3. Add a bounded party adapter and worker IPC with fake transports, deterministic failure states, token redaction, account-change cancellation and teardown tests. No auto-join/invite or production endpoints in tests.
4. Implement user-triggered signaling and identity-bound party membership, initially with microphone publication off. Add actual network/chat-control readiness observations before enabling voice UI capability.
5. Connect device capture/playback, mute, push to talk, volumes and worker recovery; reuse one party session across app and Guide.
6. Perform two-participant acceptance with the available Xbox One X and a second account/device or another consenting participant. Joining the same account from two clients is not a substitute: this package contains single-point-of-presence enforcement paths.

Without a second participant we can verify parsing of fixture documents, permissions/denial, local device enumeration/capture indicators, worker event processing, cancellation and repeated join/leave cleanup. A deliberately local audio loopback can verify the capture/render chain only when explicitly enabled. None proves server media relay interoperability or remote audibility.

Audible acceptance requires both directions of speech, mute and push to talk, per-member/party volume, input/output changes, leave/rejoin, account change, network loss/recovery and termination cleanup, with privacy/privilege denial preserved. Record the party/membership and media states, while excluding credentials, messages, raw audio and token-bearing URLs from logs. Until those checks pass, report party voice as unavailable or experimental according to its actual capability.

## Reproduce and inspect local evidence

Raw reports remain ignored under `work/reference/library/party-voice/`: `native-party-evidence.json` includes PE imports and native literal offsets; `typed-native-members.json` includes exact WinMD blobs/parameters; `native-service-literals.json` retains bounded service-field candidates; `manifest-locators.json` records manifest line numbers; twelve `function-*.json` files contain annotated instructions. `summary.json` binds the pass to the bundle hash. No raw native/source dump is added to the public repository.

Existing reproducible readers can recheck the evidence without loading package code:

```sh
python3 scripts/analysis/xbox-reference-library.py files xComms
python3 scripts/analysis/xbox-reference-library.py member GetTokenAndSignatureData
python3 scripts/analysis/xbox-reference-library.py function 49760
python3 scripts/analysis/xbox-reference-library.py function 49764

python3 scripts/analysis/build-xbox-function-evidence.py work/reference/index.bundle \
  --opcodes work/reference/hermes-format/BytecodeList.def --function 49768

PYTHONPATH=work/reference/metadata-tools python3 scripts/analysis/inspect-xbox-components.py \
  work/reference/XboxAppPackage_2610.1001.20.0_x64.msix \
  --select xCommsUwp.dll --select XboxPartyChatHost.exe --select PartyWin.dll \
  --output work/reference/library/party-voice/components-recheck.json
```

The generic component reader indexes a narrower string vocabulary than this targeted pass; use PE imports and the stored offset reports for the additional voice-specific literals. Complete machine-code control/data flow, current service acceptance, mode selection, private descriptor/invitation schema, Linux media compatibility and successful cross-device audio remain open. No static-discovery count is a percentage of completed voice implementation.
