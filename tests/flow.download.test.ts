import { describe, expect, it } from "vitest";
import { mediaIdFromSrc, qualityMenuPattern, extensionFor } from "../src/flow/download.js";

describe("download helpers", () => {
  it("extracts media id from a redirect src", () => {
    expect(mediaIdFromSrc("https://labs.google/fx/api/trpc/media.getMediaUrlRedirect?name=01595e2d-e380-4b8a-9700-7ccbadbe4b64"))
      .toBe("01595e2d-e380-4b8a-9700-7ccbadbe4b64");
  });
  it("returns undefined for data urls", () => {
    expect(mediaIdFromSrc("data:image/png;base64,AAAA")).toBeUndefined();
  });
  it("maps quality to a menu pattern", () => {
    expect(qualityMenuPattern("original").test("1KOriginal size")).toBe(true);
    expect(qualityMenuPattern("2k").test("2KUpscaled")).toBe(true);
    expect(qualityMenuPattern("4k").test("4KUpscaledUpgrade")).toBe(true);
  });
  it("derives extensions from content type", () => {
    expect(extensionFor("video", "video/mp4")).toBe(".mp4");
    expect(extensionFor("image", "image/jpeg")).toBe(".jpg");
    expect(extensionFor("image", undefined)).toBe(".png");
  });

  it("derives audio extensions from content type", () => {
    expect(extensionFor("audio", "audio/mpeg")).toBe(".mp3");
    expect(extensionFor("audio", "audio/mp3")).toBe(".mp3");
    expect(extensionFor("audio", "audio/wav")).toBe(".wav");
    expect(extensionFor("audio", "audio/flac")).toBe(".flac");
    expect(extensionFor("audio", "audio/ogg")).toBe(".ogg");
    expect(extensionFor("audio", "audio/aac")).toBe(".aac");
    expect(extensionFor("audio", "audio/mp4")).toBe(".m4a");
    expect(extensionFor("audio", undefined)).toBe(".mp3");
  });
});
