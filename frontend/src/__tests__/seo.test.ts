import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("WatchWithMi discovery", () => {
  it("publishes canonical metadata, crawler policy, and agent summary", async () => {
    const [layout, robots, llms, sitemap] = await Promise.all([
      readFile("src/app/layout.tsx", "utf8"),
      readFile("public/robots.txt", "utf8"),
      readFile("public/llms.txt", "utf8"),
      readFile("src/app/sitemap.ts", "utf8"),
    ]);
    expect(layout).toContain("metadataBase");
    expect(layout).toContain("alternates: { canonical");
    expect(layout).toContain("openGraph");
    expect(layout).toContain("twitter");
    expect(layout).toContain("c3b832b326f54435bdb39fecfef3b1df");
    expect(robots).toContain("User-agent: GPTBot\nDisallow: /");
    expect(robots).toContain("Sitemap: https://watchwithmi.tn07.dev/sitemap.xml");
    expect(llms).toContain("# WatchWithMi");
    expect(sitemap).toContain("https://watchwithmi.tn07.dev/");
  });
});
