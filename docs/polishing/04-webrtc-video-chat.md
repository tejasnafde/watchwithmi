# WebRTC Video Chat

Polish for the WebRTC peer-to-peer video chat path. Connection establishment works; these items address edge cases and mobile layout.

## High

- [x] **Stream changes after mount use direct DOM mutation** — `frontend/src/components/VideoChat.tsx:65-69`
  - Fixed: the remote-tile path now binds `srcObject` in a `useEffect` keyed on `videoStream` and `isLocal`. The same `<video>` element gets its stream rebound without remount; `play()` is guarded against jsdom's unimplemented return value.

- [x] **`stopVideoChat` closes resources before emitting toggle events** — `frontend/src/hooks/useWebRTC.ts:300-326`
  - Fixed: extracted `stopVideoChatInOrder` (`frontend/src/lib/webrtcHelpers.ts`), which emits `toggle_video` + `toggle_audio` before stopping tracks and closing peer connections. Pure helper; unit-tested separately.

- [x] **Glare resolution only handles `stable` / `have-local-offer`** — `frontend/src/hooks/useWebRTC.ts:198-206`
  - Fixed: extracted `resolveGlareAction` that returns one of `ignore` / `rollback-accept` / `accept` / `create-new` for every `RTCSignalingState` including `closed` and `have-remote-offer`. `handleOffer` now dispatches on the action instead of inlining the two-state branch.

## Medium

- [x] **Peer cleanup on mid-stream disconnect**
  - Fixed: `createPeerConnection` now attaches `oniceconnectionstatechange` in addition to `onconnectionstatechange`. Both route through a single `dropConnection()` closure; the ICE handler uses the new `shouldCleanupOnIceState` helper (drops on `failed` / `disconnected` / `closed`).

- [ ] **Video tiles overflow on mobile** — sidebar is 40% max-height
  - Deferred to `07-accessibility-mobile.md`. The real fix (stack sidebar vertically on mobile, give tiles a real min-height) is the responsive-sidebar item owned there; addressing it here would duplicate that work.
