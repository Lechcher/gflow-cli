import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chromium, type Page } from "playwright";
import { GenerationBlockedError, GenerationFailedError, LoginRequiredError, ManualActionRequiredError, UiContractError } from "../src/errors.js";
import { MusicPage } from "../src/flow/music.js";

const FIXTURE = join(process.cwd(), "fixtures/flow-music/index.html");
const SESSION_URL = "https://www.flowmusic.app/session?t=true";

// Serve the fixture as the Flow Music studio so the music path runs offline. Failure
// modes are query-driven (see the fixture). SESSION_URL already carries ?t=true, so
// further modes join with &.
async function openSession(page: Page, query = ""): Promise<void> {
  const body = await readFile(FIXTURE, "utf8");
  await page.route("https://www.flowmusic.app/session**", async (route) => {
    await route.fulfill({ contentType: "text/html", body });
  });
  const url = query ? `${SESSION_URL}&${query.replace(/^[?&]/, "")}` : SESSION_URL;
  await page.goto(url);
}

async function launch(): Promise<{ context: Awaited<ReturnType<typeof chromium.launchPersistentContext>>; profileDir: string }> {
  const profileDir = await mkdtemp(join(tmpdir(), "gflow-music-"));
  const context = await chromium.launchPersistentContext(profileDir, { headless: true, acceptDownloads: true });
  return { context, profileDir };
}

const fieldState = (page: Page) =>
  page.evaluate(() => ({
    prompt: (document.querySelector('textarea[aria-label="Chat message"]') as HTMLTextAreaElement).value,
    lyrics: (document.querySelector('textarea[aria-label="Lyrics"]') as HTMLTextAreaElement).value,
    sound: (document.querySelector('textarea[aria-label="Sound description"]') as HTMLTextAreaElement).value,
    instrumental: document.querySelector('[aria-pressed]')?.getAttribute("aria-pressed") ?? null,
    songLink: document.querySelector('a[href^="/song/"]')?.textContent ?? null,
    // A finished song means the session section is showing; a hidden link in the DOM
    // does not count (the completion marker is visibility).
    songShown: document.getElementById("song-session")?.hidden === false
  }));

describe("Flow Music studio", () => {
  it("(a) prompt-only song completes, downloads audio, and records metadata", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page);
      const music = new MusicPage(page);

      const result = await music.runSong({
        id: "lofi",
        prompt: "a short rainy lo-fi hip hop beat for studying",
        outDir
      });

      expect(result.artifacts).toHaveLength(1);
      const [assetPath, metadataPath] = [result.artifacts[0]!.path, result.artifacts[0]!.metadataPath];
      expect(assetPath.endsWith(".mp3")).toBe(true);
      expect(assetPath).toContain("lofi-001");
      const bytes = await readFile(assetPath);
      expect(bytes.byteLength).toBeGreaterThan(0);

      const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
      expect(metadata).toMatchObject({
        jobId: "lofi",
        type: "music",
        prompt: "a short rainy lo-fi hip hop beat for studying",
        requestedOutputs: 1,
        source: "google-flow-music-browser",
        status: "downloaded"
      });
      expect(metadata.style).toBeUndefined();
      expect(metadata.lyrics).toBeUndefined();
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(b) structured fields (style, lyrics, instrumental) land in the request", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page);
      const music = new MusicPage(page);

      await music.runSong({
        id: "lofi-2",
        prompt: "a rainy lo-fi beat",
        style: "lo-fi hip hop, mellow piano, vinyl crackle",
        lyrics: "rain keeps me company",
        instrumental: true,
        duration: 30,
        outDir
      });

      const state = await fieldState(page);
      expect(state.sound).toBe("lo-fi hip hop, mellow piano, vinyl crackle");
      expect(state.lyrics).toBe("rain keeps me company");
      expect(state.instrumental).toBe("true");
      expect(state.prompt).toBe("a rainy lo-fi beat");

      const metadata = JSON.parse(await readFile(join(outDir, "lofi-2-001.json"), "utf8"));
      expect(metadata.style).toBe("lo-fi hip hop, mellow piano, vinyl crackle");
      expect(metadata.lyrics).toBe("rain keeps me company");
      expect(metadata.instrumental).toBe(true);
      expect(metadata.duration).toBe(30);
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(b2) a lyrics file is read into the lyrics panel", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    const lyricsFile = join(await mkdtemp(join(tmpdir(), "gflow-music-lyrics-")), "lyrics.txt");
    await writeFile(lyricsFile, "rain keeps me company\nall night long", "utf8");
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page);
      const music = new MusicPage(page);

      await music.runSong({ id: "lofi-3", prompt: "a rainy lo-fi beat", lyricsFile, outDir });

      const state = await fieldState(page);
      expect(state.lyrics).toBe("rain keeps me company\nall night long");
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(b3) collapsed sections are opened before typing", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      // ?collapsed=1 starts with both sections collapsed: the section buttons are the
      // fallback openers before focus+type.
      await openSession(page, "?collapsed=1");
      const music = new MusicPage(page);

      await music.runSong({
        id: "lofi-4",
        prompt: "a rainy lo-fi beat",
        style: "lo-fi hip hop, mellow piano",
        lyrics: "rain keeps me company",
        outDir
      });

      const state = await fieldState(page);
      expect(state.sound).toBe("lo-fi hip hop, mellow piano");
      expect(state.lyrics).toBe("rain keeps me company");
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(c) a block marker fails loudly before any artifact is written", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page, "?blocked=1");
      const music = new MusicPage(page);

      await expect(
        music.runSong({ id: "blocked", prompt: "a stormy track", outDir })
      ).rejects.toBeInstanceOf(GenerationBlockedError);
      expect(await readdir(outDir)).toEqual([]);
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(c2) a song that never completes times out with generation-failed", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page, "?never-completes=1");
      const music = new MusicPage(page);

      await expect(
        music.runSong({ id: "never", prompt: "a stormy track", outDir, timeout: 3 })
      ).rejects.toBeInstanceOf(GenerationFailedError);
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(d) a signed-out session fails with login-required before submitting", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page, "?signed-out=1");
      const music = new MusicPage(page);

      await expect(
        music.runSong({ id: "anon", prompt: "a stormy track", outDir })
      ).rejects.toBeInstanceOf(LoginRequiredError);
      const state = await fieldState(page);
      expect(state.prompt).toBe("");
      // No song was produced: the session section never opened.
      expect(state.songShown).toBe(false);
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(d2) a consent prompt fails with manual-action-required", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page, "?consent=1");
      const music = new MusicPage(page);

      await expect(
        music.runSong({ id: "consent", prompt: "a stormy track", outDir })
      ).rejects.toBeInstanceOf(ManualActionRequiredError);
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(e) a field the surface cannot apply aborts before generation", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page, "?no-lyrics-panel=1");
      const music = new MusicPage(page);

      await expect(
        music.runSong({ id: "no-panel", prompt: "a stormy track", lyrics: "words", outDir })
      ).rejects.toBeInstanceOf(UiContractError);
      expect(await readdir(outDir)).toEqual([]);
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);

  it("(f) a missing download format fails loudly", async () => {
    const { context, profileDir } = await launch();
    const outDir = await mkdtemp(join(tmpdir(), "gflow-music-out-"));
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      await openSession(page, "?no-format=1");
      const music = new MusicPage(page);

      await expect(
        music.runSong({ id: "no-format", prompt: "a stormy track", outDir })
      ).rejects.toBeInstanceOf(UiContractError);
      expect(await readdir(outDir)).toEqual([]);
    } finally {
      await context.close();
      await writeFile(join(profileDir, ".done"), "");
    }
  }, 60000);
});
