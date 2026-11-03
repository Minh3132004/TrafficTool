const fs = require('fs');
const puppeteer = require('puppeteer-core');

function getExecutablePath() {
  const chromePaths = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
  ];
  for (const p of chromePaths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function test() {
  const exe = getExecutablePath();
  console.log('Testing Chrome launch:', exe);
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  console.log('Browser launched successfully!');
  const page = await browser.newPage();
  await page.goto('https://mayacacoffeem4.com/', { waitUntil: 'domcontentloaded', timeout: 15000 });
  const title = await page.title();
  console.log('Page Title:', title);
  await browser.close();
  console.log('Browser closed cleanly!');
}

test().catch(console.error);
