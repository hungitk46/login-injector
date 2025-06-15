import express from 'express';
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import NodeCache from 'node-cache';

const app = express();
const PORT = 3000;

const sessionPath = path.resolve('./session');
const cache = new NodeCache({ stdTTL: 300 }); // Cache 5 phút

function parseCookieString(rawCookie, domain) {
  return rawCookie.split(';').map(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    const value = rest.join('=');
    return {
      name,
      value,
      domain,
      path: '/'
    };
  });
}

app.get('*', async (req, res) => {
  const targetPath = req.originalUrl;
  const cacheKey = `html:${targetPath}`;

  if (cache.has(cacheKey)) {
    console.log('⚡ Cache hit:', targetPath);
    return res.send(cache.get(cacheKey));
  }

  try {
    const browser = await chromium.launchPersistentContext(sessionPath, {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();

    // Load session data (cookie + localStorage)
    const rawData = await fs.readFile('./data/cookie.json', 'utf-8');
    const parsed = JSON.parse(rawData);

    // Only set cookies at first
    if (browser.pages().length <= 1 && parsed.cookie) {
      const cookies = parseCookieString(parsed.cookie, '.semrush.com');
      await context.addCookies(cookies); // context is browser in this case
    }

    if (parsed.localStore) {
      await page.addInitScript(storage => {
        for (const [key, value] of Object.entries(storage)) {
          localStorage.setItem(key, value);
        }
      }, parsed.localStore);
    }

    const targetUrl = `https://www.semrush.com${targetPath}`;
    console.log('🌐 Navigating to:', targetUrl);
    await page.goto(targetUrl, { waitUntil: 'networkidle' });

    let html = await page.content();
    if (html.includes('<head>')) {
      html = html.replace('<head>', '<head><base href="https://www.semrush.com/">');
    }

    await page.close();
    cache.set(cacheKey, html);
    res.send(html);
  } catch (err) {
    console.error('❌ Error rendering:', err);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Proxy running at http://localhost:${PORT}`);
});
