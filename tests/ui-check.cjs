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
    const fixture = await (await page.request.get('http://127.0.0.1:4318/api/bootstrap')).json();
    assert.equal(fixture.connection.baseUrl, 'https://ui-test.invalid', 'Never reset a real database');
    assert.equal((await page.request.delete('http://127.0.0.1:4318/api/data', { headers: { 'X-Zhujian-Client': 'local', 'X-Confirm-Clear': 'clear-local-data' } })).status(), 200);
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
      await page.getByLabel('你遇到了什么问题？', { exact: true }).fill('团队下周需要交付一个跨部门项目，怎样安排负责人？');
      assert(await page.locator('[data-guide="analyze"]').isDisabled());
      await page.getByLabel('你打算怎么做？', { exact: true }).fill('我准备让 A 负责技术推进，由 B 协调沟通，并每天检查进度。');
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
      const oldLogo = await page.locator('.brand-mark').evaluate(el => getComputedStyle(el).backgroundColor);
      await page.locator('[data-guide="settings"]').click();
      await page.getByRole('button', { name: '蓝白', exact: true }).click();
      assert.equal(await page.locator('.app-shell').getAttribute('data-theme'), 'blue');
      assert.notEqual(await page.locator('.brand-mark').evaluate(el => getComputedStyle(el).backgroundColor), oldLogo);
      assert.equal(await page.getByLabel('API 密钥', { exact: true }).count(), 0);
      assert.equal(await page.getByLabel('模型名称', { exact: true }).count(), 0);
      assert.equal(await page.getByLabel('接口基础地址', { exact: true }).count(), 0);
      assert((await page.getByRole('link', { name: '写邮件', exact: true }).getAttribute('href')).startsWith('mailto:cypresun2003@gmail.com'));
      assert.deepEqual(await page.locator('.settings-row h2').allTextContents(), ['外观', '备份与恢复', '清空本机业务记录']);
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
    await check('named groups and mixed employee selection', async () => {
      await page.locator('[data-guide="team"]').click();
      for (const name of ['B', 'C']) {
        await page.getByRole('button', { name: '添加员工', exact: true }).first().click();
        const editor = page.getByRole('dialog', { name: '添加员工画像', exact: true });
        await editor.getByLabel('昵称', { exact: true }).fill(name);
        await editor.getByLabel('职责', { exact: true }).fill('协作');
        await editor.locator('textarea').fill('沟通耐心，善于协调。');
        await editor.getByRole('button', { name: '保存画像' }).click();
        await editor.waitFor({ state: 'detached' });
        await page.locator('.employee-card h3').filter({ hasText: new RegExp('^' + name + '$') }).waitFor();
      }
      for (const [name, members] of [['项目组', ['A', 'B']], ['协作组', ['B', 'C']]]) {
        await page.getByRole('button', { name: '新建分组', exact: true }).click();
        const editor = page.getByRole('dialog', { name: '新建员工分组', exact: true });
        await editor.getByLabel('分组名称').fill(name);
        for (const member of members) await editor.getByRole('checkbox', { name: new RegExp('选择员工：' + member + ' ·') }).check();
        await editor.getByRole('button', { name: '保存分组', exact: true }).click();
        await editor.waitFor({ state: 'detached' });
        await page.getByRole('button', { name: '编辑分组：' + name, exact: true }).waitFor();
      }
      await page.screenshot({ path: path.join(dir, 'employee-groups.png') });
      await closePanel();
      await page.locator('[data-guide="employees"]').click();
      const picker = page.locator('.employee-popover');
      await picker.getByRole('tab', { name: '分组', exact: true }).click();
      await picker.getByRole('checkbox', { name: '选择分组：项目组', exact: true }).click();
      assert.equal(await page.locator('.profile-chip').count(), 2);
      await picker.getByRole('checkbox', { name: '选择分组：协作组', exact: true }).click();
      assert.equal(await page.locator('.profile-chip').count(), 3);
      await picker.getByRole('tab', { name: '员工', exact: true }).click();
      await picker.getByRole('checkbox', { name: /选择员工：B ·/ }).uncheck();
      await picker.getByRole('tab', { name: '分组', exact: true }).click();
      assert.equal(await picker.getByRole('checkbox', { name: '选择分组：项目组', exact: true }).getAttribute('aria-checked'), 'mixed');
      await picker.getByRole('checkbox', { name: '全选当前员工', exact: true }).click();
      assert.equal(await page.locator('.profile-chip').count(), 3);
      await picker.getByRole('checkbox', { name: '全选当前员工', exact: true }).click();
      assert.equal(await page.locator('.profile-chip').count(), 0);
      await picker.getByRole('checkbox', { name: '选择分组：项目组', exact: true }).check();
      await picker.getByRole('button', { name: '完成', exact: true }).click();
      await page.locator('[data-guide="team"]').click();
      await page.getByRole('button', { name: '编辑分组：项目组', exact: true }).click();
      const groupEditor = page.getByRole('dialog', { name: '编辑员工分组', exact: true });
      await groupEditor.getByLabel('分组名称').fill('交付组');
      await groupEditor.getByRole('checkbox', { name: /选择员工：B ·/ }).uncheck();
      await groupEditor.getByRole('button', { name: '保存分组', exact: true }).click();
      await groupEditor.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '编辑分组：交付组', exact: true }).waitFor();
      await page.locator('.employee-card').filter({ has: page.getByRole('heading', { name: 'C', exact: true }) }).click();
      const employeeEditor = page.getByRole('dialog', { name: '员工C · 编辑画像', exact: true });
      await employeeEditor.getByRole('button', { name: '归档员工', exact: true }).click();
      await employeeEditor.waitFor({ state: 'detached' });
      await page.getByRole('button', { name: '删除分组：协作组', exact: true }).click();
      const deleteGroup = page.getByRole('dialog', { name: '删除这个分组？', exact: true });
      await deleteGroup.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await page.getByRole('button', { name: '删除分组：协作组', exact: true }).count(), 1);
      await page.getByRole('button', { name: '删除分组：协作组', exact: true }).click();
      await deleteGroup.getByRole('button', { name: '确认删除分组', exact: true }).click();
      await deleteGroup.waitFor({ state: 'detached' });
      await closePanel();
      // Editing/deleting a group never retroactively alters the selected employee list.
      assert.equal(await page.locator('.profile-chip').count(), 2);
      await page.locator('[data-guide="employees"]').click();
      assert.equal(await picker.getByRole('checkbox', { name: /选择员工：C ·/ }).count(), 0);
      assert.equal(await picker.getByRole('checkbox', { name: '选择分组：协作组', exact: true }).count(), 0);
      await page.screenshot({ path: path.join(dir, 'employee-picker.png') });
      await picker.getByRole('button', { name: '完成', exact: true }).click();
    });
    await check('direct analysis, four rows, helpful record and confirmed profile feedback', async () => {
      await page.getByLabel('你遇到了什么问题？', { exact: true }).fill('跨部门交付测试：需要在下周完成核心演示，如何处理新增要求？');
      await page.getByLabel('你打算怎么做？', { exact: true }).fill('先核实公开课的必须功能，保留原有交付承诺。');
      await page.locator('[data-guide="analyze"]').click();
      await page.locator('.ai-angle').last().waitFor();
      assert.equal(await page.locator('.angle-row').count(), 4);
      assert.equal(await page.getByRole('dialog', { name: '确认发送资料', exact: true }).count(), 0);
      assert(!(await page.locator('.focused-results').innerText()).includes('风险'));
      await page.screenshot({ path: path.join(dir, 'analysis-overlay.png') });
      await page.locator('.ai-angle').first().getByRole('button', {name:'有帮助',exact:true}).click();
      const done = page.getByRole('dialog', {name:'希望能帮助到你',exact:true});
      await done.waitFor();
      await done.getByRole('button', {name:'完成',exact:true}).click();
      await page.locator('dialog.workspace-panel').waitFor({state:'detached'});
      await page.locator('[data-guide="library"]').click();
      assert((await page.locator('.decision-row').first().innerText()).includes('待回看'));
      await page.locator('.decision-row').first().getByRole('button',{name:'编辑',exact:true}).click();
      assert.equal(await page.locator('.recorded-angle').count(), 1);
      const feedback=page.locator('.inline-feedback');
      await feedback.getByRole('button',{name:'部分有效',exact:true}).click();
      await feedback.getByLabel('补充反馈（可选）').fill('A 按时完成交付，先核实演示要求有帮助。');
      await feedback.getByRole('button',{name:'生成完整复盘',exact:true}).click();
      await page.getByRole('button',{name:'查看并修改',exact:true}).waitFor();
      let data=await (await page.request.get('http://127.0.0.1:4318/api/bootstrap')).json();
      assert.equal(data.decisions[0].finals.length,0);
      assert.equal(data.decisions[0].helpfulSelections.length,1);
      assert.equal(data.employees[0].version,1);
      await page.getByRole('button',{name:'查看并修改',exact:true}).click();
      await page.getByRole('button',{name:'确认更新画像',exact:true}).click();
      await page.getByText('画像已更新',{exact:true}).waitFor();
      assert.equal(data.decisions[0].status, 'helpful');
      await page.getByRole('button',{name:'确认完成复盘',exact:true}).click();
      await page.locator('.decision-row').first().waitFor();
      await closePanel();
    });
    await check('compact library edit, cancel deletion and confirmed deletion', async () => {
      await page.locator('[data-guide="library"]').click();
      const row = page.locator('.decision-row').first();
      await row.waitFor();
      assert((await row.boundingBox()).height <= 70);
      assert((await row.innerText()).includes('已复盘'));
      assert((await row.innerText()).includes('A、B'));
      await page.screenshot({ path: path.join(dir, 'library-desktop.png') });
      await row.getByRole('button', { name: '编辑', exact: true }).click();
      await page.getByRole('button', {name:'编辑',exact:true}).click();
      const edit=page.getByRole('dialog',{name:'编辑这次问题',exact:true});
      await edit.getByLabel('决策名称').fill('项目交付安排');
      await edit.getByRole('button',{name:'保存',exact:true}).click();
      await edit.waitFor({state:'detached'});
      await closePanel();
      await page.locator('[data-guide="library"]').click();
      await page.getByRole('button', { name: '项目交付安排', exact: true }).waitFor();
      await row.getByRole('button', { name: '删除', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: '删除这条决策？', exact: true });
      await confirm.getByRole('button', { name: '取消', exact: true }).click();
      assert.equal(await page.locator('.decision-row').count(), 1);
      await closePanel();
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
        assert(await mobile.locator('dialog.workspace-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
        if (target === 'library' || target === 'settings') await mobile.screenshot({ path: path.join(dir, target + '-mobile.png') });
        await mobile.locator('dialog.workspace-panel > .modal-header').getByRole('button', { name: '关闭弹窗' }).click();
      }
      await mobile.screenshot({ path: path.join(dir, 'graphite-mobile.png') });
    });
    await check('mobile four perspectives remain readable and within viewport', async () => {
      await mobile.locator('[data-guide="library"]').click();
      await mobile.locator('.decision-row').first().getByRole('button',{name:'编辑',exact:true}).click();
      await mobile.locator('.angle-row').last().waitFor();
      assert.equal(await mobile.locator('.angle-row').count(),4);
      assert(await mobile.locator('dialog.workspace-panel').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await mobile.screenshot({path:path.join(dir,'results-mobile.png')});
      await mobile.locator('dialog.workspace-panel > .modal-header').getByRole('button',{name:'关闭弹窗'}).click();
    });
    await check('delete from library and unavailable service support', async () => {
      await page.locator('[data-guide="library"]').click();
      await page.locator('.decision-row').first().getByRole('button', { name: '删除', exact: true }).click();
      const confirm = page.getByRole('dialog', { name: '删除这条决策？', exact: true });
      await confirm.getByRole('button', { name: '确认删除决策', exact: true }).click();
      await confirm.waitFor({ state: 'detached' });
      await page.locator('.decision-row').waitFor({ state: 'detached' });
      await closePanel();
      await page.route('**/api/decisions/*/analyze', route => route.fulfill({ status: 502, contentType: 'application/json', body: JSON.stringify({ error: '分析服务暂不可用，请联系支持。' }) }));
      await page.locator('[data-guide="analyze"]').click();
      const support = page.locator('.focused-results').getByRole('link', { name: '联系支持', exact: true });
      await support.waitFor();
      assert((await support.getAttribute('href')).startsWith('mailto:cypresun2003@gmail.com'));
      assert.equal(await page.getByRole('dialog', {name:'确认发送资料',exact:true}).count(),0);
      await closePanel();
    });
    assert.deepEqual(errors, []);
    console.log('ALL UI CHECKS PASSED');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
