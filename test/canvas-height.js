// Real Chromium layout: feed reported heights back into the iframe just as
// CanvasView does. A DOM mock cannot expose viewport-unit resize feedback.
// Run with: npx electron test/canvas-height.js
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');

const hero = '<main class="hero"></main><footer style="height:300px"></footer>';
const fixtures = {
  head: ['<style>.hero { height:100vh }</style>', hero],
  body: ['', '<style>.hero { height:100svh }</style>' + hero],
  inline: ['', '<main class="hero" style="height:100dvh !important"></main><footer style="height:300px"></footer>'],
  variable: ['', '<style>:root { --screen:100lvh } .hero {height:var(--screen)}</style>' + hero],
  nested: ['<style>@layer page { body { & > .hero { height:100svh } } }</style>', hero],
  imported: ['<style>@import url("/import.css") layer(page);</style>', hero],
  cascade: ['<style>.hero {height:100vh} .hero {height:400px}</style>', hero],
  media: ['<style>.hero {height:100vh} @media (max-width:800px) {.hero {height:50vh}}</style>', hero],
};

app.on('window-all-closed', () => {});
app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/import.css') {
      res.writeHead(200, { 'content-type': 'text/css' });
      res.end('.hero { height:100svh }');
      return;
    }
    const [head, body] = fixtures[req.url.slice(1)] || ['', ''];
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(`<!doctype html><html><head><style>body {margin:0}</style>${head}</head><body>${body}</body></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.resolve(__dirname, '../electron/preload.js'),
      nodeIntegrationInSubFrames: true,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });
  try {
    await win.loadURL(`http://127.0.0.1:${server.address().port}/`);
    const results = await win.webContents.executeJavaScript(`(async () => {
      const settle = () => new Promise(resolve => setTimeout(resolve, 350));
      const results = [];
      for (const [width, viewport] of [[1440,900], [768,1024], [375,812]]) {
        for (const name of ${JSON.stringify(Object.keys(fixtures))}) {
          const frame = document.createElement('iframe');
          frame.style.cssText = 'width:' + width + 'px;height:' + viewport + 'px;border:0';
          const heights = [];
          const listen = e => {
            if (e.source !== frame.contentWindow || e.data.type !== 'avb:page-height') return;
            heights.push(e.data.height);
            frame.style.height = Math.min(30000, e.data.height) + 'px';
          };
          window.addEventListener('message', listen);
          await new Promise(resolve => {
            frame.onload = () => {
              frame.contentWindow.postMessage({type:'avb:set-vh', px:viewport}, '*');
              resolve();
            };
            frame.src = '/' + name + '#avb-design';
            document.body.append(frame);
          });
          await settle();
          const doc = frame.contentDocument;
          const initial = heights.at(-1);
          const heroHeight = doc.querySelector('.hero').getBoundingClientRect().height;
          await settle();
          const stable = heights.at(-1) === initial;
          // HMR replacement of a body stylesheet, then an inline change.
          const style = doc.createElement('style');
          style.textContent = '.hero {height:50svh !important}';
          doc.body.append(style);
          doc.querySelector('.hero').removeAttribute('style');
          await settle();
          const shrunk = heights.at(-1);
          style.textContent = '.hero {height:25dvh !important}';
          await settle();
          const hmr = heights.at(-1);
          doc.querySelector('.hero').style.setProperty('height', '75lvh', 'important');
          await settle();
          const inlineUpdate = heights.at(-1);
          results.push({name, width, viewport, initial, heroHeight, stable, shrunk, hmr, inlineUpdate});
          window.removeEventListener('message', listen);
          frame.remove();
        }
      }
      // Single-device/interactive previews receive no set-vh message.
      const frame = document.createElement('iframe');
      frame.style.height = '900px';
      await new Promise(resolve => {
        frame.onload = resolve;
        frame.src = '/head';
        document.body.append(frame);
      });
      frame.style.height = '1200px';
      await settle();
      results.push({interactiveHeight:frame.contentDocument.querySelector('.hero').getBoundingClientRect().height});
      frame.remove();
      return results;
    })()`);
    for (const result of results) {
      if ('interactiveHeight' in result) {
        assert.equal(result.interactiveHeight, 1200, 'interactive preview keeps native viewport units');
        continue;
      }
      const { name, width, viewport } = result;
      const label = `${name} at ${width}px`;
      const expectedHero = name === 'cascade' ? 400 : name === 'media' && width <= 800 ? viewport / 2 : viewport;
      assert.equal(result.heroHeight, expectedHero, `${label}: viewport height and cascade`);
      assert.equal(result.initial, expectedHero + 300, `${label}: full content height`);
      assert.equal(result.stable, true, `${label}: no resize feedback`);
      assert.equal(result.shrunk, viewport / 2 + 300, `${label}: can shrink after a body style is added`);
      assert.equal(result.hmr, viewport / 4 + 300, `${label}: stylesheet replacement`);
      assert.equal(result.inlineUpdate, viewport * 0.75 + 300, `${label}: inline update`);
    }
    console.log(`canvas-height: ${results.length - 1} canvas scenarios and interactive preview passed`);
  } finally {
    win.destroy();
    server.close();
  }
}).then(() => app.exit(0), error => {
  console.error(error);
  app.exit(1);
});
