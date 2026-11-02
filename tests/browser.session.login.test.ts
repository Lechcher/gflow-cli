import { rm } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterAll, describe, expect, it, vi } from "vitest";
import { launchLoginChrome } from "../src/browser/session.js";

// launchLoginChrome spawns a real Chrome; mock child_process so the test asserts the
// sign-in window's arguments without opening a browser. Kept in its own file so the
// ps-backed session tests keep the real execFile.
vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => ({ unref: vi.fn() })),
  execFile: vi.fn()
}));

const PROFILE = "vitest-login";

afterAll(async () => {
  await rm(join(process.cwd(), ".gflow", "profiles", PROFILE), { recursive: true, force: true });
});

describe("launchLoginChrome", () => {
  it("opens both Google Flow and Flow Music in the plain sign-in window", async () => {
    const profileDir = await launchLoginChrome(PROFILE);

    const call = vi.mocked(spawn).mock.calls.at(-1);
    expect(call).toBeDefined();
    const args = (call?.[1] ?? []) as string[];

    // One login covers both surfaces (Flow Music needs its own Google sign-in).
    expect(args).toContain("https://flow.google.com");
    expect(args).toContain("https://www.flowmusic.app");
    // Sign-in must happen in a plain window: no remote debugging port.
    expect(args.some((a) => a.includes("remote-debugging-port"))).toBe(false);
    // The launch targets the gflow profile dir.
    expect(String(call?.[1]?.[0])).toContain(`--user-data-dir=${profileDir}`);
  });
});
