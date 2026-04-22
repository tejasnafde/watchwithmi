# WebRTC Video Chat

Polish for the WebRTC peer-to-peer video chat path. Connection establishment works; these items address edge cases and mobile layout.

## High

- [ ] **Stream changes after mount use direct DOM mutation** — `frontend/src/components/VideoChat.tsx:65-69`
  - Assigning `videoEl.srcObject = stream` imperatively bypasses React's render model; subsequent stream swaps can leave a stale binding.
  - Fix: drive `srcObject` from a `useEffect` keyed on `videoStream`.

- [ ] **`stopVideoChat` closes resources before emitting toggle events** — `frontend/src/hooks/useWebRTC.ts:300-326`
  - Peers see the tracks vanish before the "I'm leaving" event, producing a brief "disconnected" flicker.
  - Fix: emit the toggle/leave event first, then close tracks and peer connections.

- [ ] **Glare resolution only handles `stable` / `have-local-offer`** — `frontend/src/hooks/useWebRTC.ts:198-206`
  - `have-remote-offer` and `closed` aren't handled explicitly; behavior is implementation-defined.
  - Fix: add explicit branches (or early-return) for those states.

## Medium

- [ ] **Peer cleanup on mid-stream disconnect**
  - Verify `RTCPeerConnection.oniceconnectionstatechange` removes the entry from the connections map on `failed` / `disconnected`, and that `ontrack` references don't hold the peer alive.
  - Fix: audit the handler; add removal if missing; add a test.

- [ ] **Video tiles overflow on mobile** — sidebar is 40% max-height
  - On small screens tiles shrink below a usable size.
  - Fix: tied to `07-accessibility-mobile.md` sidebar work — when sidebar stacks vertically on mobile, give video tiles a real min-height.
