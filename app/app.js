// import express from 'express';
// import { chromium } from 'playwright'; // playwright
// import fs from 'fs/promises';


const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs').promises;



const app = express();
const PORT = 3000;

app.get('/', async (req, res) => {
  const browser = await chromium.launch({
    headless: true
  });

  const context = await browser.newContext();

  // Load cookie từ file
  const cookieJson = await fs.readFile('./data/cookie.json', 'utf-8');
  const cookies = JSON.parse(cookieJson);
  await context.addCookies(cookies);

  const page = await context.newPage();

  await page.goto('https://www.semrush.com', { waitUntil: 'networkidle' });

  // Inject localStorage nếu có
  const localStorageScript = await fs.readFile('./data/localStorage.txt', 'utf-8');
  await page.addInitScript(localStorageScript);

  const content = await page.content();

  await browser.close();

  res.send(content);
});

app.listen(PORT, () => {
  console.log(`App running at http://localhost:${PORT}`);
});
