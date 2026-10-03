import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { persistFinalArtifact } from "../src/job-manager.js";

test("uploads rendered MP4 to configured durable storage callback", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "demo-studio-artifact-"));
  const artifact = path.join(root, "final.mp4");
  await writeFile(artifact, Buffer.from("fake-mp4-payload"));

  let receivedPath = "";
  let receivedAuth = "";
  let receivedBody = Buffer.alloc(0);

  const server = createServer(async (request, response) => {
    receivedPath = request.url ?? "";
    receivedAuth = request.headers.authorization ?? "";

    const chunks: Buffer[] = [];
    for await (const chunk of request) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    receivedBody = Buffer.concat(chunks);

    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"ok":true}');
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test server did not expose a TCP address.");
  }

  const previousUrl = process.env.DEMO_STUDIO_ARTIFACT_UPLOAD_URL;
  const previousToken = process.env.DEMO_STUDIO_ARTIFACT_UPLOAD_TOKEN;

  try {
    process.env.DEMO_STUDIO_ARTIFACT_UPLOAD_URL =
      "http://127.0.0.1:" + address.port + "/internal/artifacts";
    process.env.DEMO_STUDIO_ARTIFACT_UPLOAD_TOKEN = "test-upload-token";

    const persisted = await persistFinalArtifact(
      "11111111-1111-4111-8111-111111111111",
      artifact,
    );

    assert.equal(persisted, true);
    assert.equal(
      receivedPath,
      "/internal/artifacts/11111111-1111-4111-8111-111111111111",
    );
    assert.equal(receivedAuth, "Bearer test-upload-token");
    assert.equal(receivedBody.toString("utf8"), "fake-mp4-payload");
  } finally {
    if (previousUrl === undefined) delete process.env.DEMO_STUDIO_ARTIFACT_UPLOAD_URL;
    else process.env.DEMO_STUDIO_ARTIFACT_UPLOAD_URL = previousUrl;

    if (previousToken === undefined) delete process.env.DEMO_STUDIO_ARTIFACT_UPLOAD_TOKEN;
    else process.env.DEMO_STUDIO_ARTIFACT_UPLOAD_TOKEN = previousToken;

    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(root, { recursive: true, force: true });
  }
});
