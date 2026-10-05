import assert from "node:assert/strict";
import test from "node:test";
import {
  parallelVoiceoverEnabled,
  runCaptureWithOptionalVoiceover,
} from "../src/concurrent-media.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test("parallel voiceover is enabled by default and can be disabled", () => {
  assert.equal(parallelVoiceoverEnabled({}), true);
  assert.equal(
    parallelVoiceoverEnabled({ DEMO_STUDIO_PARALLEL_VOICEOVER: "false" }),
    false,
  );
  assert.equal(
    parallelVoiceoverEnabled({ DEMO_STUDIO_PARALLEL_VOICEOVER: "0" }),
    false,
  );
  assert.equal(
    parallelVoiceoverEnabled({ DEMO_STUDIO_PARALLEL_VOICEOVER: "true" }),
    true,
  );
});

test("capture and voiceover start concurrently and both are joined", async () => {
  const capture = deferred<string>();
  const voice = deferred<string>();
  const events: string[] = [];
  let settled = false;

  const result = runCaptureWithOptionalVoiceover({
    capture: async () => {
      events.push("capture-start");
      return capture.promise;
    },
    voiceover: async () => {
      events.push("voice-start");
      return voice.promise;
    },
  }).then((value) => {
    settled = true;
    return value;
  });

  await Promise.resolve();
  assert.deepEqual(events, ["capture-start", "voice-start"]);

  capture.resolve("capture-ok");
  await Promise.resolve();
  assert.equal(settled, false);

  voice.resolve("/tmp/voice.mp3");
  assert.deepEqual(await result, {
    capture: "capture-ok",
    voiceoverPath: "/tmp/voice.mp3",
  });
});

test("capture failure waits for voice task before propagating", async () => {
  const capture = deferred<string>();
  const voice = deferred<string>();
  let settled = false;

  const result = runCaptureWithOptionalVoiceover({
    capture: () => capture.promise,
    voiceover: () => voice.promise,
  });
  void result.finally(() => {
    settled = true;
  }).catch(() => undefined);

  capture.reject(new Error("capture failed"));
  await Promise.resolve();
  assert.equal(settled, false);

  voice.resolve("/tmp/voice.mp3");
  await assert.rejects(result, /capture failed/);
});

test("sequential fallback preserves capture-then-voice ordering", async () => {
  const events: string[] = [];
  const result = await runCaptureWithOptionalVoiceover({
    parallel: false,
    capture: async () => {
      events.push("capture");
      return "capture-ok";
    },
    voiceover: async () => {
      events.push("voice");
      return "/tmp/voice.mp3";
    },
  });

  assert.deepEqual(events, ["capture", "voice"]);
  assert.deepEqual(result, {
    capture: "capture-ok",
    voiceoverPath: "/tmp/voice.mp3",
  });
});


test("successful capture hook runs before a parallel voice failure is propagated", async () => {
  const events: string[] = [];

  const result = runCaptureWithOptionalVoiceover({
    capture: async () => "capture-ok",
    voiceover: async () => {
      throw new Error("voice failed");
    },
    onCapture: async (value) => {
      events.push("capture:" + value);
    },
    onVoiceover: async () => {
      events.push("voice-hook");
    },
  });

  await assert.rejects(result, /voice failed/);
  assert.deepEqual(events, ["capture:capture-ok"]);
});
