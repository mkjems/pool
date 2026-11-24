# Voice chat in friend matches: handoff

Written 24 November 2026, in a chat with the user (Claude in the desktop app), for the next session in VS Code.
Steps 1 to 4 built 24 November (the user chose it before the cinematic break); step 5 waits on the user's
phones. See **As built** below for where it differs from the design.

## The idea

The two players of a friend match can talk to each other while they play, as if they stood at the same table.
Audio goes browser to browser with WebRTC; the relay only passes the few setup messages, as it passes shots.

## What was decided or discussed with the user

- **Friend matches only.** They start from an invite link or code, so the players know each other. No voice
  against strangers, ever (moderation, children, privacy): if matchmaking with strangers comes one day, it gets
  emotes or quick-chat instead, never voice.
- **Opt-in and off by default.** A mic button in a friend match; the browser asks for the microphone only when it
  is pressed (also required on phones: getUserMedia and audio playback need a tap). A mute button. It must be
  obvious when the other player can hear you, and whether the friend has voice on.
- **The frame loop must not suffer.** WebRTC encodes, decodes and cancels echo on its own native threads; our
  JavaScript only runs for the setup messages. Expect no change in fps, but measure it (60 fps is a goal).
- **Sound is the real risk, not speed.** With the mic on, iPhones switch to a call audio mode: the table's Web
  Audio sounds (src/audio/sound.ts) may get quieter, or play from the earpiece instead of the speaker, and echo
  cancellation may eat some of them. Test on an iPhone with voice on and off; the user judges by ear.
- **Server cost is nil.** Voice is about 30–50 kbit/s with Opus, peer to peer; the relay sees only setup messages.
- Players see each other's IP address (peer to peer). Acceptable between friends; mention it in a short line
  near the mic button only if the user wants that.

## Design, fitted to this code

**Relay (server/relay.mjs).** One new message type passed on and not kept, like `aim`:
`voice {d}` from a player → the same `voice {d}` to the other. `d` is one of `{description}` (offer/answer),
`{candidate}`, `{on: boolean}` (voice switched on/off, for the indicator), `{hangup: true}`. SDP is a few KB,
well under `maxPayload` (64 KB). Add `voice` to the message list in the header comment and a case in
tests/relay.test.ts.

**Browser (new `src/net/voice.ts`).** One `RTCPeerConnection` per match, created lazily (on pressing the mic
button, or on the first `voice` message from the friend, so you can hear them before switching your own mic on
if the user wants that; ask).
Use the "perfect negotiation" pattern so either side may start and simultaneous starts don't collide:
**seat 1 is polite, seat 0 is not**. Sketch (from the chat, to port to TypeScript):

```js
pc.onnegotiationneeded = async () => {
  makingOffer = true;
  try { await pc.setLocalDescription(); send({ description: pc.localDescription }); }
  finally { makingOffer = false; }
};
pc.onicecandidate = ({ candidate }) => candidate && send({ candidate });
pc.ontrack = ({ streams }) => { audioEl.srcObject = streams[0]; audioEl.play().catch(() => {}); };

async function onSignal(d) {
  if (d.description) {
    const collision = d.description.type === "offer" && (makingOffer || pc.signalingState !== "stable");
    ignoreOffer = !polite && collision;
    if (ignoreOffer) return;
    await pc.setRemoteDescription(d.description);
    if (d.description.type === "offer") { await pc.setLocalDescription(); send({ description: pc.localDescription }); }
  } else if (d.candidate) {
    try { await pc.addIceCandidate(d.candidate); } catch (e) { if (!ignoreOffer) throw e; }
  }
}
// mic: getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }),
// then pc.addTrack(track, stream) (triggers negotiation). Mute = track.enabled = false.
```

Playback through a hidden `<audio autoplay playsinline>` element (not through the game's AudioContext, so the
volume button for table sounds doesn't mute the friend; ask the user if they want a separate voice volume).

**Dropouts and rejoin (src/net/net.ts, src/main.ts).** The relay already handles reloads and lost connections
(`left`, `back`, `catchup`, `gone`). Voice should follow: on `left`/`gone` close the peer connection; on `back`
or our own `catchup`, if voice was on, start a fresh peer connection (simplest is a new one each time rather
than ICE restarts). `pc.connectionState === "failed"` → `pc.restartIce()` once, then give up and show it.
Remember "voice was on" only for the page's life; after a reload the player taps the mic again (browsers require it).

**ICE servers.** Start with `stun:stun.l.google.com:19302`. Some mobile networks need a TURN relay; if voice
fails on 4G/5G but works on Wi-Fi, that's why. Options to put to the user: Cloudflare Realtime TURN or Metered
(free tiers, credentials fetched from our server so they are not in the page), or coturn in Docker next to the
game. Not needed for the first version.

**UI (src/main.ts, src/style.css).** A mic button in the top bar only in friend matches: off → on (unmuted) →
muted. A small indicator by the friend's name: voice on, and speaking (an AnalyserNode on the incoming stream,
throttled; optional). Keep it out of the way on phones in portrait.

## Testing

- `tests/relay.test.ts`: `voice` is passed to the other seat only, not stored, not sent back.
- `npm run browser`: Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` gives a
  fake mic and no permission prompt; a scenario where both players turn voice on and each page sees
  `connectionState === "connected"` and an incoming track. Also: one player reloads mid-call and voice comes back.
- By hand, with the user: two phones on mobile data; an iPhone for the table sounds while voice is on; fps with
  voice on (`chrome://webrtc-internals` shows the call's bitrate).

## Steps

- [x] 1. Relay: pass `voice` on; test. (24 November)
- [x] 2. `src/net/voice.ts`: peer connection, mic, hangup. (24 November; no perfect negotiation, see below)
- [x] 3. Mic button and the friend's voice indicator; wire into friend matches, dropouts and rejoin. (24 November)
- [x] 4. Browser test with the fake mic. (24 November; "friend match: voice chat both ways, and back after a
  reload", in 2-3 s)
- [ ] 5. The user tries it on two phones (Wi-Fi and mobile data, an iPhone); table sounds and fps checked.
- [ ] 6. TURN, if step 5 shows it is needed (ask the user which).

## As built (24 November)

- **No perfect negotiation.** Seat 0 always makes the offer, seat 1 always answers, so two offers never cross.
  Seat 0 makes a connection whenever the friend is there and either mic is on (it hears of seat 1's mic by its
  `{on}`); seat 1 sends `{want}` only after a connection failed. Each connection has an id (`c` on descriptions
  and candidates): a message of an older connection is dropped; an offer with a new id makes seat 1 start over.
- **The connection carries one audio track each way from the start** (`sendrecv`). Turning a mic on or off only
  swaps the track (`replaceTrack`), with no new offer. Off stops the track, so the browser's mic light goes out.
  So no separate mute: the button is **Voice: off / connecting / on** (on = connected, the friend hears you), V
  on the keyboard. "Connecting" also shows while the friend is away.
- **You hear the friend as soon as their mic is on**, without turning yours on; a toast says "Anna turned voice
  on. Press Voice to talk." The friend's mic shows in amber by their name (dim while connecting).
- The friend's voice plays through a hidden `<audio>` element: the Sound button doesn't silence it. A page
  nobody has tapped since a reload may not play it until the next tap (`resume` on pointerdown).
- Dropouts: `left`/`gone` close the connection; `back` makes a new one (seat 0) if a mic is on; our own
  `catchup` starts over (`rejoined`). After a reload the mic is off again (browsers need a tap).
  `pc.connectionState === "failed"`: one new connection, then a toast "Voice couldn't connect to your friend".
- Voice needs a secure page: on `npm run dev` it works on localhost, but **not on a phone opening the Mac's
  address over the local network** (http): the button is hidden there. Try it on the phones through
  https://pool.mkjems.dk once pushed.
- 60 fps unchanged with voice on both ways (16.7 ms median frame, headless Chromium, 1440 × 820 × 2).
- Also fixed: shortcut keys (M, G, C, V) no longer fire while typing a name or a code (typing "Magnus" muted the
  sound).
- Not done, perhaps later: a "speaking" light (an AnalyserNode on the friend's stream), a separate voice volume,
  TURN (step 6).
