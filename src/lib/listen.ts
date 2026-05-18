// Live audio capture + transcription orchestration.
//
// Captures the user's microphone AND macOS system audio as TWO SEPARATE
// streams (not mixed). Each stream is downsampled to 16 kHz mono PCM,
// chunked, and shipped to a single shared Whisper Web Worker. Each chunk
// is tagged with its source so downstream consumers can label utterances
// as "me" (mic) vs "them" (system audio = the remote caller).
//
// POC quality — energy-based silence detection, no real VAD, no speaker
// diarization within a source.

export type Source = "me" | "them";

export type ListenStatus =
  | { kind: "idle" }
  | { kind: "loading-model"; progress: number }   // 0..1
  | { kind: "listening" }
  | { kind: "transcribing" }
  | { kind: "error"; message: string };

export interface TranscriptEvent {
  source: Source;
  text: string;
  ts: number;          // epoch ms when chunk was captured
}

export interface ListenEvents {
  status: (s: ListenStatus) => void;
  transcript: (e: TranscriptEvent) => void;
  // RMS 0..1 per source, for UI meters.
  level: (l: { source: Source; rms: number }) => void;
}

// 3 s windows: short enough to keep end-to-end latency under ~3 s, long
// enough that Whisper has useful context (model still internally pads to 30 s).
const CHUNK_SECONDS = 3;
const SAMPLE_RATE = 16000;
// Skip windows quieter than this — Whisper hallucinates on silence.
const SILENCE_RMS = 0.012;
const MIN_VOICED_FRACTION = 0.15;

interface SourceState {
  source: Source;
  stream: MediaStream;
  processor: ScriptProcessorNode;
  buffer: Float32Array[];
  bufferLen: number;
  voicedFrames: number;
  totalFrames: number;
}

interface QueueItem {
  source: Source;
  samples: Float32Array;
  ts: number;
}

export class Listener {
  private ctx: AudioContext | null = null;
  private silentGain: GainNode | null = null;
  private sources: Map<Source, SourceState> = new Map();

  private worker: Worker | null = null;
  private workerReady = false;
  private queue: QueueItem[] = [];
  private inFlight: QueueItem | null = null;
  private sentWindows = 0;
  private droppedWindows = 0;
  private device: string = "unknown";

  private listeners: Partial<ListenEvents> = {};
  private chunkSamples = SAMPLE_RATE * CHUNK_SECONDS;
  private static LOG = "[stt:listener]";

  on<K extends keyof ListenEvents>(event: K, cb: ListenEvents[K]): void {
    this.listeners[event] = cb;
  }

  private emit<K extends keyof ListenEvents>(event: K, ...args: Parameters<ListenEvents[K]>): void {
    const cb = this.listeners[event];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (cb) (cb as any)(...args);
  }

  async start(opts: { mic: boolean; system: boolean }): Promise<void> {
    if (this.ctx) return;
    if (!opts.mic && !opts.system) throw new Error("Must enable at least mic or system audio");

    this.emit("status", { kind: "loading-model", progress: 0 });
    await this.ensureWorker();

    try {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE });
      this.silentGain = this.ctx.createGain();
      this.silentGain.gain.value = 0;
      this.silentGain.connect(this.ctx.destination);

      if (opts.mic) {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
          video: false,
        });
        this.attachSource("me", stream);
      }

      if (opts.system) {
        try {
          const stream = await navigator.mediaDevices.getDisplayMedia({
            audio: true,
            video: { width: 1, height: 1 },
          });
          const audioTracks = stream.getAudioTracks();
          if (audioTracks.length === 0) {
            stream.getTracks().forEach((t) => t.stop());
          } else {
            stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
            this.attachSource("them", stream);
          }
        } catch (err) {
          if (!opts.mic) throw err;
          console.warn("[listen] system audio capture failed:", err);
        }
      }

      if (this.sources.size === 0) throw new Error("No audio sources available");

      this.emit("status", { kind: "listening" });
    } catch (err) {
      this.stop();
      this.emit("status", { kind: "error", message: (err as Error).message });
      throw err;
    }
  }

  private attachSource(source: Source, stream: MediaStream): void {
    if (!this.ctx || !this.silentGain) return;
    const node = this.ctx.createMediaStreamSource(stream);
    const processor = this.ctx.createScriptProcessor(4096, 1, 1);
    const state: SourceState = {
      source,
      stream,
      processor,
      buffer: [],
      bufferLen: 0,
      voicedFrames: 0,
      totalFrames: 0,
    };
    processor.onaudioprocess = (e) => this.onAudio(state, e);
    node.connect(processor);
    processor.connect(this.silentGain);
    this.sources.set(source, state);
  }

  stop(): void {
    for (const s of this.sources.values()) {
      try { s.processor.disconnect(); } catch {}
      s.processor.onaudioprocess = null;
      s.stream.getTracks().forEach((t) => t.stop());
    }
    this.sources.clear();
    if (this.silentGain) { try { this.silentGain.disconnect(); } catch {} }
    if (this.ctx) { try { this.ctx.close(); } catch {} }
    this.silentGain = null;
    this.ctx = null;
    this.queue = [];
    this.inFlight = null;
    this.emit("status", { kind: "idle" });
  }

  private onAudio(state: SourceState, e: AudioProcessingEvent): void {
    const input = e.inputBuffer.getChannelData(0);
    let sum = 0;
    for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!;
    const rms = Math.sqrt(sum / input.length);
    this.emit("level", { source: state.source, rms: Math.min(1, rms * 4) });

    state.buffer.push(new Float32Array(input));
    state.bufferLen += input.length;
    state.totalFrames += 1;
    if (rms > SILENCE_RMS) state.voicedFrames += 1;

    if (state.bufferLen >= this.chunkSamples) {
      const merged = new Float32Array(state.bufferLen);
      let offset = 0;
      for (const b of state.buffer) { merged.set(b, offset); offset += b.length; }
      const voicedFraction = state.totalFrames > 0 ? state.voicedFrames / state.totalFrames : 0;
      const ts = Date.now();
      state.buffer = [];
      state.bufferLen = 0;
      state.voicedFrames = 0;
      state.totalFrames = 0;

      if (voicedFraction < MIN_VOICED_FRACTION) {
        console.log(`${Listener.LOG} drop=silence source=${state.source} voiced=${(voicedFraction * 100).toFixed(0)}%`);
        return;
      }
      this.enqueue({ source: state.source, samples: merged, ts });
    }
  }

  private enqueue(item: QueueItem): void {
    // Bound queue: drop oldest if it grows past 4. Backpressure happens when
    // Whisper can't keep up with both streams talking; we'd rather drop a
    // stale window than fall further behind.
    if (this.queue.length >= 4) {
      this.droppedWindows += 1;
      const dropped = this.queue.shift()!;
      console.warn(`${Listener.LOG} drop=backpressure source=${dropped.source} totalDropped=${this.droppedWindows}`);
    }
    this.queue.push(item);
    this.pump();
  }

  private pump(): void {
    if (this.inFlight) return;
    if (!this.worker || !this.workerReady) return;
    const item = this.queue.shift();
    if (!item) return;
    this.inFlight = item;
    this.sentWindows += 1;
    this.emit("status", { kind: "transcribing" });
    const sentAt = performance.now();
    this.worker.postMessage(
      { type: "audio", samples: item.samples, sentAt, source: item.source, ts: item.ts },
      [item.samples.buffer],
    );
  }

  private async ensureWorker(): Promise<void> {
    if (this.worker && this.workerReady) return;
    if (!this.worker) {
      this.worker = new Worker(new URL("./transcribe.worker.ts", import.meta.url), { type: "module" });
      this.worker.addEventListener("message", (e) => this.onWorkerMessage(e));
    }
    if (this.workerReady) return;

    await new Promise<void>((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        const msg = e.data;
        if (msg.type === "ready") {
          this.worker?.removeEventListener("message", handler);
          this.workerReady = true;
          resolve();
        } else if (msg.type === "error") {
          this.worker?.removeEventListener("message", handler);
          reject(new Error(msg.message));
        }
      };
      this.worker!.addEventListener("message", handler);
      this.worker!.postMessage({ type: "init" });
    });
  }

  private onWorkerMessage(e: MessageEvent): void {
    const msg = e.data;
    if (msg.type === "progress") {
      const pct = typeof msg.payload?.progress === "number" ? msg.payload.progress / 100 : 0;
      this.emit("status", { kind: "loading-model", progress: pct });
      if (msg.payload?.status === "device" && typeof msg.payload?.device === "string") {
        this.device = msg.payload.device;
        console.log(`${Listener.LOG} model ready device=${this.device}`);
      }
    } else if (msg.type === "transcript") {
      const item = this.inFlight;
      this.inFlight = null;
      const source: Source = (msg.source as Source) ?? item?.source ?? "me";
      const ts: number = typeof msg.ts === "number" ? msg.ts : (item?.ts ?? Date.now());
      const text = (msg.text ?? "").trim();
      if (text) this.emit("transcript", { source, text, ts });
      this.emit("status", this.ctx ? { kind: "listening" } : { kind: "idle" });
      this.pump();
    } else if (msg.type === "error") {
      this.inFlight = null;
      console.error(`${Listener.LOG} worker error:`, msg.message);
      this.emit("status", { kind: "error", message: msg.message });
      this.pump();
    }
  }
}
