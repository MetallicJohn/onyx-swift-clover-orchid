import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { overlayDialAllowed } from "../../../deploy/vps/overlay-dial.mjs";
import { decodeSentence, encodeSentence, encodeWord, openRouterSocket, parseReplies } from "./routeros-api.ts";

test("overlay dial allows router API addresses only", () => {
  assert.equal(overlayDialAllowed("10.200.0.2", 8728, {}), true);
  assert.equal(overlayDialAllowed("10.200.0.1", 8728, {}), false);
  assert.equal(overlayDialAllowed("10.200.0.2", 8291, {}), false);
  assert.equal(overlayDialAllowed("172.18.0.5", 8728, {}), false);
});

test("overlay dial carries the API from the host network", async () => {
  const dir = await mkdtemp(join(tmpdir(), "isp-dial-"));
  const sock = join(dir, "overlay-dial.sock");
  const fake = createServer((socket) => {
    socket.once("data", (buf) => {
      const text = buf.toString();
      socket.end(text.startsWith("ISPDIAL") ? "leaked" : text === "ping" ? "pong" : "bad");
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, "127.0.0.1", () => resolve()));
  const port = (fake.address() as AddressInfo).port;
  const child = spawn(process.execPath, ["deploy/vps/overlay-dial.mjs"], {
    cwd: join(import.meta.dirname, "../../.."),
    env: { ...process.env, DIAL_SOCK: sock, DIAL_ANY: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const previous = process.env.ISPSOLUTIONS_OVERLAY_DIAL;
  const previousRequired = process.env.ISPSOLUTIONS_OVERLAY_DIAL_REQUIRED;
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("dialer did not listen")), 4000);
      const ready = (chunk: Buffer) => {
        if (!chunk.toString().includes("listening")) return;
        clearTimeout(timer);
        resolve();
      };
      child.stdout?.on("data", ready);
      child.stderr?.on("data", ready);
      child.once("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`dialer exited ${code}`));
      });
    });
    process.env.ISPSOLUTIONS_OVERLAY_DIAL = sock;
    process.env.ISPSOLUTIONS_OVERLAY_DIAL_REQUIRED = "1";
    const socket = await openRouterSocket("127.0.0.1", port, 3000);
    const body = await new Promise<string>((resolve, reject) => {
      socket.once("data", (buf) => resolve(buf.toString()));
      socket.once("error", reject);
      socket.write("ping");
    });
    assert.equal(body, "pong");
    socket.destroy();
  } finally {
    if (previous == null) delete process.env.ISPSOLUTIONS_OVERLAY_DIAL;
    else process.env.ISPSOLUTIONS_OVERLAY_DIAL = previous;
    if (previousRequired == null) delete process.env.ISPSOLUTIONS_OVERLAY_DIAL_REQUIRED;
    else process.env.ISPSOLUTIONS_OVERLAY_DIAL_REQUIRED = previousRequired;
    child.kill();
    fake.close();
    await rm(dir, { recursive: true, force: true });
  }
});


test("RouterOS API sentences round-trip", () => {
  const sent = encodeSentence(["/login", "=name=ispsolutions-agent", "=password=secret"]);
  const decoded = decodeSentence(sent);
  assert.deepEqual(decoded.words, ["/login", "=name=ispsolutions-agent", "=password=secret"]);
  assert.equal(decoded.rest.length, 0);
  assert.ok(encodeWord("x").length >= 2);
});

test("trap replies are parsed without leaking extra fields", () => {
  const reply = parseReplies([["!trap", "=message=invalid user name or password"], ["!done"]]);
  assert.equal(reply.type, "trap");
  assert.equal(reply.attrs.message, "invalid user name or password");
});
