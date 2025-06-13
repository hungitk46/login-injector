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

    // Rewrite các liên kết tuyệt đối từ semrush.com sang /proxy
    html = html.replace(/(src|href)="https:\/\/www\.semrush\.com/gi, '$1="/proxy');
    // Rewrite các liên kết tương đối cho các tài nguyên tĩnh (có đuôi file)
    html = html.replace(/(href|src)="\/(?!proxy)([^"]+\.(js|css|png|jpe?g|gif|svg|webp|png|ico))"/gi, (match, attr, path) => {
      return `${attr}="/proxy/${path}"`;
    });
    // Rewrite các liên kết còn lại (thường là các trang HTML)
    // Chỉ rewrite nếu URL không kết thúc bằng định dạng file tĩnh
    html = html.replace(/(href|src)="\/(?!proxy)([^"]*)"/gi, (match, attr, path) => {
      if (/\.(js|css|png|jpe?g|gif|svg|webp|png|ico)$/.test(path)) return match;
      const newUrl = target.replace(/\/+$/, '') + '/' + path;
      return `${attr}="/demo?url=${encodeURIComponent(newUrl)}"`;
    });
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