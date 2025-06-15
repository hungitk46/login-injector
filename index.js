const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const puppeteer = require('puppeteer');
const fetchModule = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
const { createProxyMiddleware } = require('http-proxy-middleware');
const fs = require('fs');
const path = require('path');
const cookieFilePath = path.join(__dirname, 'cookie.json');

const app = express();
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
// Middleware session
app.use(session({
  secret: 'your-secret-key', // thay bằng bí mật của bạn
  resave: false,
  saveUninitialized: true
}));
// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

// HTML giao diện chính
templateMain = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Demo Login Injector - Semrush</title>
</head>
<body>
  <h1>Demo Login Injector (Node.js + Puppeteer)</h1>
  <form id="configForm">
    <input type="text" id="url" value="https://www.semrush.com" style="width:300px"/><br/>
    <input type="text" id="username" value="hungnm.nazzy@gmail.com" placeholder="Email" style="width:300px"/><br/>    
    <input type="password" id="password" value="Sumo12345678x@X" placeholder="Password" style="width:300px"/><br/>
    <button type="button" onclick="loadInfo()">Load thông tin</button><br/><br/>
    <!-- Hiển thị cookie/localStorage để debug -->
    <textarea id="cookieData" style="width:400px;height:60px;" readonly></textarea><br/><br/>
    <button type="button" onclick="openTab()">Mở Semrush</button>
  </form>
  <script>
    async function loadInfo() {
      const payload = {
        url: document.getElementById('url').value,
        username: document.getElementById('username').value,
        password: document.getElementById('password').value
      };
      const res = await fetch('/load', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (data.error) { alert('Error: '+data.error); return; }
      // Hiển thị thông tin trong textarea cho mục đích debug
      document.getElementById('cookieData').value = data.debug;
      alert('Login thành công! Nhấn Mở Semrush');
    }
    function openTab() {
      const url = encodeURIComponent(document.getElementById('url').value);
      // Không cần truyền cookie/localStorage trong URL
      window.open('/demo?url=' + url, '_blank');
    }
  </script>
</body>
</html>`;
app.get('/', (req, res) => res.send(templateMain));

// API đăng nhập, lấy cookie và localStorage
app.post('/load', async (req, res) => {
  const { url, username, password } = req.body;
  if (!url || !username || !password)
    return res.json({ error: 'Thiếu thông tin' });
  try {
    const browser = await puppeteer.launch({ headless: false });
    const page = await browser.newPage();
    await page.goto('https://www.semrush.com/login/');
    await page.waitForSelector('input[name="email"]');
    await page.type('input[name="email"]', username);
    await page.type('input[name="password"]', password);
    await page.click('button[type="submit"]');
    try {
      await page.waitForNavigation({ waitUntil: 'networkidle0', timeout: 60000 });
    } catch (navErr) {
      await browser.close();
      return res.json({ error: 'Login timeout hoặc captcha. Vui lòng kiểm tra lại tài khoản hoặc thử lại sau.' });
    }
    // Lấy cookie
    const cookies = await page.cookies();
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');
    // Lấy localStorage (sẽ trả về 1 object chứa key-value)
    const localStore = await page.evaluate(() => {
      let data = {};
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        data[key] = localStorage.getItem(key);
      }
      return data;
    });
    // (Tùy chọn) Lấy thông tin IndexedDB nếu cần:
    const indexedDBList = await page.evaluate(async () => {
      if (indexedDB.databases) {
        return await indexedDB.databases();
      }
      return null;
    });
    await browser.close();

    // Lưu cookie và localStore vào file cookie.json
    const cookieData = {
      cookie: cookieStr,
      localStore: localStore,
      indexedDBList: indexedDBList
    };
    fs.writeFileSync(cookieFilePath, JSON.stringify(cookieData));

    res.json({ debug: `Cookie: ${cookieStr}\nLocalStorage: ${JSON.stringify(localStore)}\nIndexedDB: ${JSON.stringify(indexedDBList)}` });
  } catch (err) {
    res.json({ error: err.message });
  }
});

// Route proxy semrush sử dụng cookie và localStorage từ session
app.get('/demo', async (req, res) => {
  try {
    const target = req.query.url;
    // Đọc file cookie.json để lấy cookie và localStore
    if (!fs.existsSync(cookieFilePath)) {
      return res.status(400).send('Cookie file not found. Vui lòng login trước.');
    }
    const cookieData = JSON.parse(fs.readFileSync(cookieFilePath, 'utf8'));
    const cookie = cookieData.cookie;
    const localStore = cookieData.localStore;
    if (!target || !cookie)
      return res.status(400).send('Missing params');
    const headers = {
      'Cookie': cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36'
    };
    const resp = await fetchModule(target, { headers });
    let html = await resp.text();
    // Chèn <base> để các đường dẫn tương đối được load theo domain gốc
    html = html.replace(/<head>/i, `<head><base href="${target}">`);

    // Remove các thẻ script không cần thiết
    html = html.replace(/<script[^>]*src="https:\/\/www\.google-analytics\.com[^"]*"[^>]*><\/script>/gi, '');
    html = html.replace(/<script[^>]*src="https:\/\/www\.googletagmanager\.com[^"]*"[^>]*><\/script>/gi, '');
    html = html.replace(/https:\/\/www\.google-analytics\.com\/[^\s'"]+/gi, '');
    html = html.replace(/https:\/\/www\.googletagmanager\.com\/[^\s'"]+/gi, '');
    html = html.replace(/https:\/\/www\.google-analytics\.com\/[^\s"'<>]+/gi, '');
    html = html.replace(/https:\/\/www\.googletagmanager\.com\/[^\s"'<>]+/gi, '');
    
    // Chặn Google Analytics và Google Tag Manager
   const blockTrackingScripts = `
    <script>
      (function() {
        const blockedHosts = [
          'www.google-analytics.com',
          'www.googletagmanager.com',
          'google-analytics.com',
          'googletagmanager.com',
          'www.googleadservices.com',
          'connect.facebook.net',
          'static.hotjar.com',
          'cdn.segment.com',
          'bam.nr-data.net',
          'sentry.io'
        ];

        function isBlocked(url) {
          return blockedHosts.some(domain => url.includes(domain));
        }

        // Chặn fetch
        const originalFetch = window.fetch;
        window.fetch = function(resource, init) {
          const url = typeof resource === 'string' ? resource : resource.url;
          if (isBlocked(url)) {
            console.warn('[BLOCKED fetch]', url);
            return new Promise(() => {}); // never resolve
          }
          return originalFetch(resource, init);
        };

        // Chặn XMLHttpRequest
        const originalXHRopen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function(method, url) {
          if (isBlocked(url)) {
            console.warn('[BLOCKED XHR]', url);
            this.abort();
            return;
          }
          return originalXHRopen.apply(this, arguments);
        };

        // Chặn sendBeacon (rất hay dùng cho tracking)
        const originalSendBeacon = navigator.sendBeacon;
        navigator.sendBeacon = function(url, data) {
          if (isBlocked(url)) {
            console.warn('[BLOCKED Beacon]', url);
            return false;
          }
          return originalSendBeacon.apply(this, arguments);
        };
      })();
    </script>
    `;

    // Chèn script phục hồi localStorage và override fetch/XHR
    if (localStore) {
      const lsScript = `
        <script>
          (function() {
            const lsData = ${JSON.stringify(localStore)};
            for (const key in lsData) {
              localStorage.setItem(key, lsData[key]);
            }
          })();
        </script>
        <script>
          (function() {
            const originalFetch = window.fetch;
            window.fetch = function(resource, init) {
              if (typeof resource === 'string' && resource.startsWith('/')) {
                resource = '/proxy' + resource;
              }
              return originalFetch(resource, init);
            };

            const originalXHROpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url, async, user, password) {
              if (url.startsWith('/')) {
                url = '/proxy' + url;
              }
              originalXHROpen.call(this, method, url, async, user, password);
            };
          })();
        </script>`;
      html = html.replace(/<\/body>/i, lsScript + '</body>');
    }

    // Xóa phần header chứa thông tin người dùng
    html = html.replace(/<header[^>]*id=["']srf-header["'][\s\S]*?<\/header>/i, '')   

    // Rewrite các liên kết tuyệt đối từ semrush.com sang /proxy
    html = html.replace(/(src|href)="https:\/\/www\.semrush\.com/gi, '$1="/proxy');
    // Rewrite các liên kết tương đối cho các tài nguyên tĩnh (có đuôi file)
    html = html.replace(/(href|src|action|data-url|data-href|data-api-url)="\/(?!proxy)([^"]+\.(js|css|png|jpe?g|gif|svg|webp|png|ico))"/gi, (match, attr, path) => {
      return `${attr}="/proxy/${path}"`;
    });

    // Rewrite tất cả mọi thứ trong js và cả html
    html = html.replace(/(["'])\/(?!proxy)([^"']+\.(js|css|png|jpe?g|gif|svg|webp|ico))\1/gi, (match, quote, path) => {
      return `${quote}/proxy/${path}${quote}`;
    });

    // Rewrite các a tag
    html = html.replace(/<a\b[^>]*?href="\/(?!proxy)([^"]*)"/gi, (match, path) => {
      const baseOrigin = new URL(target).origin;
      const fullUrl = new URL('/' + path, baseOrigin).toString();
      return match.replace(/href="\/[^"]*"/, `href="/demo?url=${encodeURIComponent(fullUrl)}"`);
    });

    // Rewrite các liên kết còn lại (thường là các trang HTML)
    // Chỉ rewrite nếu URL không kết thúc bằng định dạng file tĩnh
    // Bỏ qua thẻ <a> để tránh rewrite các liên kết không cần thiết
    html = html.replace(/<(?!a\b)[^>]*\b(href|src)="\/(?!proxy)([^"]*)"/gi, (match, attr, path) => {
      if (/\.(js|css|png|jpe?g|gif|svg|webp|ico)$/.test(path)) return match;
      const baseOrigin = new URL(target).origin;
      const newUrl = new URL('/' + path, baseOrigin).toString();
      return match.replace(
        new RegExp(`${attr}="\\/[^"]*"`),
        `${attr}="/demo?url=${encodeURIComponent(newUrl)}"`
      );
    });

    // Chèn script chặn quảng cáo
    const adBlockerScript = `
    <script>
    (function() {
      const blockedDomains = [
        "doubleclick.net",
        "googleadservices.com",
        "googlesyndication.com",
        "adsafeprotected.com",
        "adsrvr.org",
        "adnxs.com",
        "criteo.com",
        "facebook.net",
        "fledge",
        "googletagmanager.com",
        "google-analytics.com",
        "scorecardresearch.com",
        "chartbeat.com",
        "taboola.com",
        "outbrain.com"
      ];

      function isAdUrl(url) {
        return blockedDomains.some(domain => url.includes(domain));
      }

      // Chặn fetch
      const origFetch = window.fetch;
      window.fetch = function(resource, init) {
        const url = typeof resource === 'string' ? resource : (resource.url || '');
        if (isAdUrl(url)) {
          console.warn('[AdBlock] fetch blocked:', url);
          return new Promise(() => {});
        }
        return origFetch.apply(this, arguments);
      };

      // Chặn XMLHttpRequest
      const origOpen = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function(method, url) {
        if (isAdUrl(url)) {
          console.warn('[AdBlock] XHR blocked:', url);
          return this.abort();
        }
        return origOpen.apply(this, arguments);
      };

      // Chặn navigator APIs liên quan đến quảng cáo
      navigator.joinAdInterestGroup = () => console.warn('[AdBlock] joinAdInterestGroup blocked');
      navigator.runAdAuction = () => console.warn('[AdBlock] runAdAuction blocked');
      navigator.enableAdAuction = () => console.warn('[AdBlock] enableAdAuction blocked');
    })();
    </script>
    `;

    //  Chèn script replace các thẻ script có src bắt đầu bằng /__static__/ thành /proxy/__static__/
    const patchScript = `
      <script>
      (function () {
        const originalCreateElement = document.createElement;

        document.createElement = function (tagName) {
          const el = originalCreateElement.call(document, tagName);

          if (tagName.toLowerCase() === 'script') {
            const originalSetAttribute = el.setAttribute;

            el.setAttribute = function (name, value) {
              if (name === 'src' && value.startsWith('/__static__/')) {
                console.warn('[REWRITE setAttribute] src → /proxy' + value);
                value = '/proxy' + value;
              }
              return originalSetAttribute.call(this, name, value);
            };

            Object.defineProperty(el, 'src', {
              set(value) {
                if (value.startsWith('/__static__/')) {
                  console.warn('[REWRITE .src] → /proxy' + value);
                  value = '/proxy' + value;
                }
                el.setAttribute('src', value);
              },
              get() {
                return el.getAttribute('src');
              },
              configurable: true
            });
          }

          return el;
        };
      })();
      </script>
      `;

    html = html.replace(/<\/body>/i, patchScript + blockTrackingScripts  + adBlockerScript + '</body>');

    res.set('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.use('/proxy', createProxyMiddleware({
  target: 'https://www.semrush.com',
  changeOrigin: true,
  pathRewrite: { '^/proxy': '' },
  onProxyRes: function(proxyRes, req, res) {
    proxyRes.headers['Access-Control-Allow-Origin'] = '*';
  }
}));

// Middleware để F5 tự động chuyển hướng đến serumsh.com
app.use((req, res, next) => {
  const isStatic = /\.(js|css|png|jpg|jpeg|gif|svg|ico|webp)$/i.test(req.path);
  const isHandled = req.path.startsWith('/proxy') || req.path.startsWith('/load') || req.path.startsWith('/demo');

  if (!isStatic && !isHandled) {
    const originalUrl = 'https://www.semrush.com' + req.path;
    return res.redirect('/demo?url=' + encodeURIComponent(originalUrl));
  }

  next();
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server on http://localhost:${PORT}`));

/*
Setup:
1. npm init -y
2. npm install express express-session body-parser puppeteer node-fetch http-proxy-middleware
3. SAVE this as index.js
4. node index.js
*/