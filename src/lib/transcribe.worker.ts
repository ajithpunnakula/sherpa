// Whisper transcription worker.
//
// Loads Xenova/whisper-tiny.en on first init message. Receives 16 kHz mono
// Float32Array windows and emits transcript text. POC quality.

/// <reference lib="webworker" />

import { pipeline, env, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

// Always fetch from HF Hub rather than expecting a local model file.
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriber: AutomaticSpeechRecognitionPipeline | null = null;
let initializing: Promise<void> | null = null;
let activeDevice: "webgpu" | "wasm" | "unknown" = "unknown";
let inferenceCount = 0;
const LOG = "[stt:worker]";

// Known Whisper hallucinations on silence — strip them if a window is only this.
const HALLUCINATION_PATTERN = /^(\s*(you|thank you|thanks for watching|bye|\.|,|-|\s)+\s*)$/i;
function scrubHallucinations(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (HALLUCINATION_PATTERN.test(trimmed)) return "";
  return trimmed;
}

async function ensureModel(): Promise<void> {
  if (transcriber) return;
  if (initializing) return initializing;
  initializing = (async () => {
    // onnx-community/whisper-base is the actively maintained ONNX export and
    // ships scale tensors the Xenova quantized weights are missing on newer
    // onnxruntime-web versions. fp32 avoids the qdq_actions.cc crash entirely.
    // Try WebGPU first (3-5x faster on Apple Silicon); fall back to WASM if unavailable.
    const tryLoad = async (device: "webgpu" | "wasm") => {
      return (await pipeline(
        "automatic-speech-recognition",
        "onnx-community/whisper-small.en",
        {
          device,
          dtype: { encoder_model: "fp32", decoder_model_merged: "fp32" },
          progress_callback: (payload: unknown) => {
            (self as DedicatedWorkerGlobalScope).postMessage({ type: "progress", payload });
          },
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) as any) as AutomaticSpeechRecognitionPipeline;
    };
    const loadStart = performance.now();
    try {
      transcriber = await tryLoad("webgpu");
      activeDevice = "webgpu";
      const ms = (performance.now() - loadStart).toFixed(0);
      console.log(`${LOG} model loaded device=webgpu loadMs=${ms}`);
      (self as DedicatedWorkerGlobalScope).postMessage({ type: "progress", payload: { status: "device", device: "webgpu", loadMs: Number(ms) } });
    } catch (err) {
      console.warn(`${LOG} webgpu load failed, falling back to wasm:`, (err as Error).message);
      (self as DedicatedWorkerGlobalScope).postMessage({ type: "progress", payload: { status: "device", device: "wasm", reason: (err as Error).message } });
      const wasmStart = performance.now();
      transcriber = await tryLoad("wasm");
      activeDevice = "wasm";
      console.log(`${LOG} model loaded device=wasm loadMs=${(performance.now() - wasmStart).toFixed(0)}`);
    }
  })();
  return initializing;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      await ensureModel();
      (self as DedicatedWorkerGlobalScope).postMessage({ type: "ready" });
      return;
    }
    if (msg.type === "audio") {
      if (!transcriber) await ensureModel();
      if (!transcriber) return;
      const samples = msg.samples as Float32Array;
      const audioSec = samples.length / 16000;
      const id = ++inferenceCount;
      const t0 = performance.now();
      const out = await transcriber(samples, {
        return_timestamps: false,
        // Prevent each window's text from biasing the next — kills "you you you" loops.
        condition_on_previous_text: false,
        // Block immediate token repetition ("Thank you. Thank you. Thank you.").
        no_repeat_ngram_size: 3,
      } as Record<string, unknown>);
      const inferMs = performance.now() - t0;
      const rawText = Array.isArray(out)
        ? out.map((o) => (typeof o === "object" && o && "text" in o ? (o as { text: string }).text : "")).join(" ")
        : (out as { text?: string }).text ?? "";
      const text = scrubHallucinations(rawText);
      const rtf = inferMs / 1000 / audioSec; // real-time factor: <1 = faster than realtime
      const sentAt = typeof msg.sentAt === "number" ? msg.sentAt : null;
      const queueMs = sentAt !== null ? t0 - sentAt : null;
      // Per-window perf line — one every ~3s when listening. Demote to debug,
      // but escalate to warn if we're slower than realtime (that's actionable).
      const perfLine =
        `${LOG} #${id} device=${activeDevice} audioSec=${audioSec.toFixed(1)} ` +
        `inferMs=${inferMs.toFixed(0)} rtf=${rtf.toFixed(2)}x ` +
        (queueMs !== null ? `queueMs=${queueMs.toFixed(0)} ` : "") +
        `chars=${text.length}`;
      if (rtf > 1) console.warn(`${perfLine} SLOW(>realtime)`);
      else console.debug(perfLine);
      (self as DedicatedWorkerGlobalScope).postMessage({
        type: "transcript",
        text,
        inferMs,
        audioSec,
        device: activeDevice,
        source: msg.source,
        ts: msg.ts,
      });
    }
  } catch (err) {
    (self as DedicatedWorkerGlobalScope).postMessage({ type: "error", message: (err as Error).message });
  }
};
