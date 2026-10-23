// Renders ad.html frame by frame (deterministic animation seek) into an MP4 via ffmpeg.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire('/home/user/Dateos/e2e/package.json');
const { chromium } = require('playwright');
const [lang, out, onlyFrames] = process.argv.slice(2);
const FPS = 30;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
await page.goto(`file://${process.cwd()}/ad.html?lang=${lang}`);
await page.evaluate(() => document.fonts.ready);
await page.waitForFunction(() => [...document.images].every((i) => i.complete));
const total = await page.evaluate(() => window.TOTAL);
if (onlyFrames) {
  for (const s of onlyFrames.split(',')) {
    await page.evaluate((ms) => window.seek(ms), Number(s) * 1000);
    await page.screenshot({ path: `still-${lang}-${s}.png` });
  }
} else {
  const ff = spawn(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-f',
      'image2pipe',
      '-framerate',
      String(FPS),
      '-i',
      '-',
      '-c:v',
      'libx264',
      '-pix_fmt',
      'yuv420p',
      '-crf',
      '20',
      '-preset',
      'medium',
      '-movflags',
      '+faststart',
      out,
    ],
    { stdio: ['pipe', 'inherit', 'inherit'] },
  );
  const frames = Math.round(total * FPS);
  for (let f = 0; f < frames; f++) {
    await page.evaluate((ms) => window.seek(ms), (f / FPS) * 1000);
    const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`${out}: ${frames} frames, ${total}s`);
}
await browser.close();
