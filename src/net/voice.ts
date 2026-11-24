// Voice chat in friend matches (docs/Voice.md). The audio goes browser to browser (WebRTC, Opus); the relay only
// passes the few setup messages, as `voice {d}`, the way it passes shots. Off until the player turns their mic on.
//
// Seat 0 always makes the offer and seat 1 always answers, so two offers never cross. Seat 0 makes a connection
// when either mic is on and the friend is there (it hears of seat 1's mic by its `on`); seat 1 asks with `want`
// only after a connection failed. Each connection has an id (`c`): messages of an older one are dropped, and
// seat 1 takes up a new one whenever an offer with a new id arrives. The connection carries one audio
// track each way from the start; turning the mic on or off only swaps the track on it, with no new offer.
// The friend is heard as soon as their mic is on, through an <audio> element of its own (not the game's Web
// Audio, so the Sound button doesn't silence the friend).

export type VoiceSignal =
  | { on: boolean } // the sender's mic is on or off: the friend's indicator
  | { want: true } // seat 1 asks seat 0 for a new connection (theirs failed)
  | { c: string; description: RTCSessionDescriptionInit }
  | { c: string; candidate: RTCIceCandidateInit };

/** Our side: mic off; on, connecting to the friend; on, and the friend hears us. */
export type VoiceStatus = "off" | "connecting" | "on";

const ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export class Voice {
  /** Our mic is on. */
  mic = false;
  /** The friend's mic is on. */
  friendOn = false;
  onChange: () => void = () => {};
  onError: (message: string) => void = () => {};

  private pc: RTCPeerConnection | null = null;
  private id = "";
  private tx: RTCRtpTransceiver | null = null;
  private track: MediaStreamTrack | null = null;
  private pending: RTCIceCandidateInit[] = [];
  private present = false;
  private retried = false;
  private closed = false;
  /** Signals are handled one at a time, in order (each waits on the connection). */
  private queue = Promise.resolve();
  /** Bumped by every mic switch, so a slow getUserMedia can't turn the mic on after it was turned off again. */
  private micTurn = 0;
  private audio = document.createElement("audio");
  private resume = () => { if (this.audio.srcObject && this.audio.paused) this.audio.play().catch(() => {}); };

  /** Voice needs a secure page (https, or localhost) and WebRTC. */
  static available() {
    return !!navigator.mediaDevices?.getUserMedia && typeof RTCPeerConnection !== "undefined";
  }

  constructor(private send: (d: VoiceSignal) => void, private offerer: boolean) {
    this.audio.autoplay = true;
    this.audio.setAttribute("playsinline", "");
    this.audio.hidden = true;
    document.body.append(this.audio);
    // A page nobody has touched yet (after a reload) may not play sound: it starts at the next tap.
    document.addEventListener("pointerdown", this.resume);
  }

  get status(): VoiceStatus {
    if (!this.mic) return "off";
    return this.pc?.connectionState === "connected" ? "on" : "connecting";
  }

  /** The friend's audio reaches us (their mic is on and the connection is up). */
  get hearing() {
    return this.friendOn && this.pc?.connectionState === "connected";
  }

  async setMic(on: boolean) {
    if (on === this.mic || this.closed) return;
    const turn = ++this.micTurn;
    if (!on) {
      this.mic = false;
      this.track?.stop();
      this.track = null;
      void this.tx?.sender.replaceTrack(null).catch(() => {});
      this.send({ on: false });
      this.onChange();
      return;
    }
    let track: MediaStreamTrack;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      track = stream.getAudioTracks()[0];
    } catch (e) {
      const denied = e instanceof DOMException && e.name === "NotAllowedError";
      this.onError(denied ? "The microphone is blocked. Allow it in the browser's site settings." : "No microphone found");
      return;
    }
    if (turn !== this.micTurn || this.closed) { track.stop(); return; }
    this.mic = true;
    this.track = track;
    this.send({ on: true });
    if (this.tx && this.live()) await this.tx.sender.replaceTrack(track).catch(() => {});
    else this.need();
    this.onChange();
  }

  /** A setup message from the friend. */
  signal(d: VoiceSignal) {
    this.queue = this.queue.then(() => this.handle(d)).catch((e) => console.info("voice:", e));
  }

  /** The friend is connected to the relay, or not. Away: the connection closes; back: it is made again. */
  setPresent(here: boolean) {
    if (here === this.present) return;
    this.present = here;
    if (!here) { this.hangUp(); this.friendOn = false; this.onChange(); return; }
    this.send({ on: this.mic });
    if (this.mic) this.need();
  }

  /** We were away from the relay ourselves (the friend closed their side meanwhile): start over. */
  rejoined(here: boolean) {
    this.hangUp();
    this.present = false;
    this.friendOn = false;
    this.setPresent(here);
    this.onChange();
  }

  /** The match is over for us: mic off, connection closed, nothing more. */
  close() {
    this.closed = true;
    this.track?.stop();
    this.track = null;
    this.mic = false;
    this.hangUp();
    document.removeEventListener("pointerdown", this.resume);
    this.audio.remove();
  }

  /** For the browser tests: the connection's state and how much of the friend's audio has arrived. */
  async stats() {
    let received = 0;
    if (this.pc) (await this.pc.getStats()).forEach((r) => { if (r.type === "inbound-rtp" && r.kind === "audio") received += r.bytesReceived ?? 0; });
    return { mic: this.mic, friendOn: this.friendOn, state: this.pc?.connectionState ?? null, id: this.id, received, playing: !this.audio.paused };
  }

  private live() {
    const s = this.pc?.connectionState;
    return !!s && s !== "failed" && s !== "closed";
  }

  /** Seat 0: someone's mic is on, the friend is there, and there is no working connection: make one. */
  private need() {
    if (this.offerer && this.present && !this.closed && !this.live() && (this.mic || this.friendOn)) void this.offer();
  }

  private async offer() {
    const pc = this.open(Math.random().toString(36).slice(2, 10));
    this.tx = pc.addTransceiver("audio", { direction: "sendrecv" });
    if (this.track) await this.tx.sender.replaceTrack(this.track);
    await pc.setLocalDescription(await pc.createOffer());
    if (pc === this.pc) this.send({ c: this.id, description: pc.localDescription!.toJSON() });
  }

  private async handle(d: VoiceSignal) {
    if (this.closed) return;
    if ("on" in d) {
      this.friendOn = d.on;
      this.need();
      this.onChange();
    } else if ("want" in d) {
      if (this.offerer && this.present) await this.offer();
    } else if ("description" in d) {
      if (d.description.type === "offer" && !this.offerer) {
        const pc = d.c === this.id && this.pc ? this.pc : this.open(d.c);
        await pc.setRemoteDescription(d.description);
        this.tx = pc.getTransceivers().find((t) => t.receiver.track.kind === "audio") ?? null;
        if (this.tx) {
          this.tx.direction = "sendrecv";
          if (this.track) await this.tx.sender.replaceTrack(this.track);
        }
        await pc.setLocalDescription(await pc.createAnswer());
        if (pc === this.pc) this.send({ c: this.id, description: pc.localDescription!.toJSON() });
        await this.flush();
      } else if (d.description.type === "answer" && this.offerer && d.c === this.id && this.pc?.signalingState === "have-local-offer") {
        await this.pc.setRemoteDescription(d.description);
        await this.flush();
      }
    } else if ("candidate" in d) {
      if (d.c !== this.id || !this.pc) return;
      if (!this.pc.remoteDescription) this.pending.push(d.candidate);
      else await this.pc.addIceCandidate(d.candidate).catch(() => {});
    }
  }

  private async flush() {
    const pc = this.pc;
    for (const c of this.pending.splice(0)) await pc?.addIceCandidate(c).catch(() => {});
  }

  /** A new connection with this id, in place of any earlier one. */
  private open(id: string) {
    this.hangUp();
    const pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc = pc;
    this.id = id;
    pc.onicecandidate = (e) => { if (e.candidate && pc === this.pc) this.send({ c: id, candidate: e.candidate.toJSON() }); };
    pc.ontrack = (e) => {
      if (pc !== this.pc) return;
      this.audio.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      this.resume();
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === "connected") this.retried = false;
      if (pc.connectionState === "failed") {
        // Once more from scratch; then say so (some mobile networks need a TURN relay, docs/Voice.md).
        this.hangUp();
        if (!this.retried && (this.mic || this.friendOn)) {
          this.retried = true;
          if (this.offerer) this.need(); else this.send({ want: true });
        } else if (this.mic || this.friendOn) this.onError("Voice couldn't connect to your friend");
      }
      this.onChange();
    };
    return pc;
  }

  private hangUp() {
    const pc = this.pc;
    this.pc = null;
    this.tx = null;
    this.pending.length = 0;
    pc?.close();
    this.audio.srcObject = null;
  }
}
