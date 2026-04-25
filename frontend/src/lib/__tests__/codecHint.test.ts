import { describe, it, expect } from "vitest";
import { detectCodec, byPlayability, explainPlaybackFailure } from "../codecHint";

describe("detectCodec", () => {
  it("flags x264 as good", () => {
    const r = detectCodec("Some Movie 2024 1080p WEB-DL X264-RARBG");
    expect(r.codec).toBe("H.264");
    expect(r.severity).toBe("good");
    expect(r.label).toBe("H264");
  });

  it("flags x265 as warn", () => {
    const r = detectCodec("Some Movie 2024 1080p BluRay X265-AOC");
    expect(r.codec).toBe("H.265");
    expect(r.severity).toBe("warn");
  });

  it("flags hevc as warn even without explicit x265", () => {
    expect(detectCodec("Show.S01E01.1080p.HEVC.AAC").severity).toBe("warn");
  });

  it("flags 10-bit as warn even on a good codec", () => {
    const r = detectCodec("Movie.2024.1080p.WEB-DL.10bit.X264-GROUP");
    expect(r.is10Bit).toBe(true);
    expect(r.severity).toBe("warn");
    expect(r.label).toBe("H264 10-BIT");
  });

  it("flags MKV container as warn", () => {
    expect(detectCodec("Movie.2024.1080p.MKV").severity).toBe("warn");
  });

  it("treats MP4 as good", () => {
    const r = detectCodec("Movie.2024.720p.MP4");
    expect(r.container).toBe("MP4");
    expect(r.severity).toBe("good");
  });

  it("returns unknown when nothing matches", () => {
    const r = detectCodec("Big.Buck.Bunny.2008");
    expect(r.severity).toBe("unknown");
    expect(r.label).toBeNull();
  });

  it("handles empty string", () => {
    const r = detectCodec("");
    expect(r.severity).toBe("unknown");
    expect(r.label).toBeNull();
  });

  it("any 'warn' input wins over a 'good' signal in the same title", () => {
    // X264 (good) + 10bit (warn) → warn
    expect(detectCodec("Movie X264 10bit").severity).toBe("warn");
    // X264 (good) + MKV (warn) → warn (this is correct: Firefox can't play it)
    expect(detectCodec("Movie X264 MKV").severity).toBe("warn");
  });

  it("title with avc (uppercase boundary) is recognised", () => {
    expect(detectCodec("Movie.2024.AVC.MP4").codec).toBe("H.264");
  });
});

describe("byPlayability", () => {
  it("bubbles good results above warn", () => {
    const input = [
      { title: "Movie X265-A" }, // warn
      { title: "Movie X264-B" }, // good
      { title: "Movie HEVC-C" }, // warn
      { title: "Movie X264 MP4-D" }, // good
    ];
    const sorted = [...input].sort(byPlayability);
    expect(sorted.map(x => x.title)).toEqual([
      "Movie X264-B",
      "Movie X264 MP4-D",
      "Movie X265-A",
      "Movie HEVC-C",
    ]);
  });

  it("treats unknown as middle bucket", () => {
    const input = [
      { title: "Mystery Release" }, // unknown
      { title: "X265 release" }, // warn
      { title: "X264 release" }, // good
    ];
    const sorted = [...input].sort(byPlayability);
    expect(sorted[0].title).toBe("X264 release");
    expect(sorted[1].title).toBe("Mystery Release");
    expect(sorted[2].title).toBe("X265 release");
  });

  it("does not mutate the input array", () => {
    const input = [{ title: "X265 a" }, { title: "X264 b" }];
    const original = [...input];
    [...input].sort(byPlayability);
    expect(input).toEqual(original);
  });
});

describe("explainPlaybackFailure", () => {
  it("returns null for known-good titles", () => {
    expect(explainPlaybackFailure("Movie X264 MP4")).toBeNull();
  });

  it("returns null for unknown titles", () => {
    expect(explainPlaybackFailure("Some Old Bootleg")).toBeNull();
  });

  it("explains HEVC", () => {
    const msg = explainPlaybackFailure("Movie 1080p X265-A");
    expect(msg).toMatch(/HEVC/);
    expect(msg).toMatch(/X264|MP4/);
  });

  it("explains MKV container even with H.264 inside", () => {
    const msg = explainPlaybackFailure("Movie X264 MKV");
    expect(msg).toMatch(/MKV/);
  });

  it("explains 10-bit", () => {
    const msg = explainPlaybackFailure("Movie X265 10bit");
    expect(msg).toMatch(/10-bit/i);
  });
});
