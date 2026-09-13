import { chromium } from "playwright";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

async function shoot({ html, out, width, height }) {
  const url = pathToFileURL(resolve(html)).href;
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage({
      viewport: { width, height },
      deviceScaleFactor: 2,
    });
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => document.fonts.status === "loaded" && document.fonts.size > 0);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(200);
    await page.screenshot({ path: out, type: "png", omitBackground: false });
    const box = await page.evaluate(() => {
      const h1 = document.querySelector("h1");
      const p = document.querySelector("p");
      const mark = document.querySelector(".mark");
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom };
      };
      return { h1: r(h1), p: r(p), mark: r(mark), text: { title: h1?.textContent, tag: p?.textContent } };
    });
    console.log(JSON.stringify({ html, out, viewport: { width, height }, box }, null, 2));
  } finally {
    await browser.close();
  }
}

await shoot({
  html: "/workspace/.grok/og-compose/card.html",
  out: "/workspace/.grok/og-compose/card.png",
  width: 1200,
  height: 630,
});
await shoot({
  html: "/workspace/.grok/og-compose/banner.html",
  out: "/workspace/.grok/og-compose/banner.png",
  width: 1200,
  height: 264,
});
