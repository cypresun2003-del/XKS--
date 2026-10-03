// Run against tests/ui-server.ts only. All records are disposable in-memory data.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const dir = path.resolve('artifacts'); fs.mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const check = async (label, fn) => { await fn(); console.log('PASS ' + label); };
  const closePanel = async () => { await page.locator('dialog.workspace-panel > .modal-header').getByRole('button', { name: '关闭弹窗' }).click(); await page.locator('dialog.workspace-panel').waitFor({ state: 'detached' }); };
  try {
    await page.goto('http://127.0.0.1:4318');
    await page.locator('.tour-card').waitFor({ state: 'visible' });
    await page.screenshot({ path: path.join(dir, 'guide-desktop.png') });
    for (let step = 0; step < 8; step++) {
      await check('desktop guide step ' + (step + 1), async () => {
        const box = await page.locator('.tour-card').boundingBox();
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1441 && box.y + box.height <= 901);
        assert((await page.locator('.tour-arrow').getAttribute('d')).startsWith('M '));
        if (step === 7) await page.getByRole('button', { name: '开始使用', exact: true }).click();
        else await page.getByRole('button', { name: '下一步', exact: true }).click();
      });
    }
    await check('wireframe shapes and unboxed input regions', async () => {
      const shapes = await page.evaluate(() => {
        const p = document.querySelector('.nav-profile'), s = document.querySelector('.sidebar'), q = document.querySelector('#decision-problem');
        return { width: p.offsetWidth, height: p.offsetHeight, radius: getComputedStyle(p).borderRadius, side: getComputedStyle(s).backgroundColor, border: getComputedStyle(q).borderWidth, outline: document.querySelectorAll('.question-composer').length };
      });
      assert.equal(shapes.width, shapes.height); assert.equal(shapes.radius, '50%'); assert.equal(shapes.side, 'rgba(0, 0, 0, 0)'); assert.equal(shapes.border, '0px'); assert.equal(shapes.outline, 1);
    });
    await page.screenshot({ path: path.join(dir, 'graphite-desktop.png') });
    await check('required initial decision', async () => {
      await page.getByLabel('用户输入问题区', { exact: true }).fill('团队下周需要交付一个跨部门项目，怎样安排负责人？');
      assert(await page.locator('[data-guide="analyze"]').isDisabled());
      await page.getByLabel('我的初步决定', { exact: true }).fill('我准备让 A 负责技术推进，由 B 协调沟通，并每天检查进度。');
      assert(await page.locator('[data-guide="analyze"]').isEnabled());
    });
    for (const name of ['profile', 'team', 'library', 'settings']) {
      await check(name + ' overlay preserves workspace', async () => {
        await page.locator('[data-guide="' + name + '"]').click();
        await page.locator('dialog.workspace-panel').waitFor({ state: 'visible' });
        assert.equal(await page.locator('.question-composer').count(), 1);
        await closePanel();
        assert((await page.locator('#decision-problem').inputValue()).includes('跨部门'));
        assert((await page.locator('#decision-plan').inputValue()).includes('检查进度'));
      });
    }
    await check('distinct blue theme and persistence', async () => {
      const old = await page.locator('.app-shell').evaluate(el => getComputedStyle(el).backgroundColor);
      await page.locator('[data-guide="settings"]').click();
      await page.getByRole('button', { name: '蓝白', exact: true }).click();
      assert.equal(await page.locator('.app-shell').getAttribute('data-theme'), 'blue');
      await page.screenshot({ path: path.join(dir, 'settings-overlay.png') });
      await closePanel();
      assert.notEqual(await page.locator('.app-shell').evaluate(el => getComputedStyle(el).backgroundColor), old);
      await page.screenshot({ path: path.join(dir, 'blue-desktop.png') });
      await page.reload();
      await page.locator('#decision-problem').waitFor();
      assert.equal(await page.locator('.app-shell').getAttribute('data-theme'), 'blue');
      assert.equal(await page.locator('.tour-root').count(), 0);
    });
    await check('create and associate employee in place', async () => {
      await page.locator('[data-guide="employees"]').click();
      await page.getByRole('button', { name: '新增员工画像', exact: true }).click();
      const modal = page.getByRole('dialog', { name: '添加员工画像', exact: true });
      await modal.getByLabel('昵称', { exact: true }).fill('A');
      await modal.getByLabel('职责', { exact: true }).fill('研发');
      await modal.locator('textarea').fill('研发能力强，观点比较坚定。');
      await modal.getByRole('button', { name: '保存并关联' }).click();
      await modal.waitFor({ state: 'detached' });
      await page.locator('.profile-chip').first().waitFor({ state: 'visible' });
      assert.equal(await page.locator('.profile-chip').count(), 1);
    });
    await check('analysis three options and human initial decision', async () => {
      await page.locator('#decision-problem').fill('团队下周需要交付一个跨部门项目，A 技术强但观点坚定，B 擅长沟通。怎样安排？');
      await page.locator('#decision-plan').fill('我准备让 A 负责技术推进，由 B 协调沟通，并每天检查进度。');
      await page.locator('[data-guide="analyze"]').click();
      const preview = page.getByRole('dialog', { name: '确认发送资料', exact: true });
      await preview.waitFor({ state: 'visible' });
      await preview.locator('input[type="checkbox"]').check();
      await preview.locator('.modal-actions .primary').click();
      await preview.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.advisor-column .perspective-card').count(), 3);
      assert.equal(await page.locator('.owner-decision-card').count(), 1);
      await page.screenshot({ path: path.join(dir, 'analysis-overlay.png') });
      await page.getByRole('button', { name: '按我的打算确认', exact: true }).click();
      await page.locator('dialog.modal').filter({ has: page.locator('.final-mode-tabs') }).last().locator('.modal-actions .primary').click();
      await page.locator('.final-card').waitFor({ state: 'visible' });
      await page.getByLabel('有没有意外？').fill('A 按时完成交付');
      await page.getByLabel('回头看，当初的判断怎么样？').fill('协调规则有帮助，下次继续观察合作情况。');
      await page.getByRole('button', { name: '保存结果并复盘', exact: true }).click();
      const review = page.getByRole('dialog', { name: '确认复盘资料', exact: true });
      await review.locator('input[type="checkbox"]').check();
      await review.getByRole('button', { name: '发送并复盘', exact: true }).click();
      await review.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '核对并更新', exact: true }).click();
      const suggestion = page.locator('dialog.modal').filter({ has: page.locator('.profile-comparison') }).last();
      await suggestion.waitFor({ state: 'visible' });
      await suggestion.locator('.modal-actions .primary').click();
      await suggestion.waitFor({ state: 'detached' });
      assert.equal(await page.locator('.suggestion-status.accepted').count(), 1);
      await closePanel();
      assert((await page.locator('#decision-problem').inputValue()).includes('跨部门'));
    });
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
    mobile.on('pageerror', e => errors.push(e.message));
    await mobile.goto('http://127.0.0.1:4318');
    await mobile.locator('.tour-card').waitFor({ state: 'visible' });
    await mobile.screenshot({ path: path.join(dir, 'guide-mobile.png') });
    for (let step = 0; step < 8; step++) {
      const b = await mobile.locator('.tour-card').boundingBox();
      assert(b.x >= 0 && b.x + b.width <= 391 && b.y >= 0 && b.y + b.height <= 845, 'mobile tour ' + step);
      await mobile.getByRole('button', { name: step === 7 ? '开始使用' : '下一步', exact: true }).click();
    }
    await check('mobile no overflow and all overlays close', async () => {
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      for (const target of ['profile', 'team', 'library', 'settings']) {
        await mobile.locator('[data-guide="' + target + '"]').click();
        const box = await mobile.locator('dialog.workspace-panel').boundingBox();
        assert(box.x >= 0 && box.x + box.width <= 391);
        await mobile.locator('dialog.workspace-panel > .modal-header').getByRole('button', { name: '关闭弹窗' }).click();
      }
      await mobile.screenshot({ path: path.join(dir, 'graphite-mobile.png') });
    });
    assert.deepEqual(errors, []);
    console.log('ALL UI CHECKS PASSED');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
