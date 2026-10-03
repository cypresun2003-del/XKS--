import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/app';
import { Store } from '../server/store';
import type { Server } from 'node:http';

test('员工分组：多组成员、版本冲突、归档限制、备份恢复和旧版兼容', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'second-perspective-groups-'));
  const file = join(dir, 'records.sqlite'), store = new Store(file);
  store.saveSetting('connection', { baseUrl: 'https://test.invalid', model: 'test', apiKey: 'group-test-secret' });
  const app = createApp(store);
  const server: Server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  async function request(path: string, method = 'GET', body?: unknown, extra = {}) {
    const r = await fetch(base + '/api' + path, { method, headers: { 'Content-Type': 'application/json', 'X-Zhujian-Client': 'local', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, value: await r.json() as any };
  }
  try {
    const a = (await request('/employees', 'POST', { nickname: 'A', role: '研发', description: '技术熟练。' })).value;
    const b = (await request('/employees', 'POST', { nickname: 'B', role: '协调', description: '沟通耐心。' })).value;
    const created = await request('/employee-groups', 'POST', { name: '项目组', employeeIds: [a.id, b.id] });
    assert.equal(created.status, 201);
    const group = created.value;
    const overlap = await request('/employee-groups', 'POST', { name: '研发组', employeeIds: [a.id] });
    assert.equal(overlap.status, 201);
    assert.equal((await request('/employee-groups', 'POST', { name: '项目组', employeeIds: [] })).status, 400);
    assert.equal((await request('/employee-groups', 'POST', { name: '重复成员', employeeIds: [a.id, a.id] })).status, 400);
    assert.equal((await request('/employee-groups', 'POST', { name: '缺失成员', employeeIds: ['00000000-0000-4000-8000-000000000000'] })).status, 404);
    const decision = (await request('/decisions', 'POST', { title: '保存成员快照', problem: '如何安排项目交付？', initialPlan: '我准备先让团队确认各自职责。', employeeIds: group.employeeIds })).value;
    const renamed = await request('/employee-groups/' + group.id, 'PUT', { name: '交付组', employeeIds: [a.id], version: 1 });
    assert.equal(renamed.status, 200); assert.equal(renamed.value.version, 2);
    assert.equal((await request('/employee-groups/' + group.id, 'PUT', { name: '过期修改', employeeIds: [], version: 1 })).status, 409);
    assert.deepEqual(store.decision(decision.id).employeeIds, [a.id, b.id]);
    await request('/employees/' + a.id + '/archive', 'POST', { archived: true, version: a.version });
    assert.equal((await request('/employee-groups', 'POST', { name: '归档检查', employeeIds: [a.id] })).status, 400);
    assert.equal((await request('/employee-groups/' + group.id, 'PUT', { name: '交付组', employeeIds: [a.id, b.id], version: 2 })).status, 200);
    assert.equal(store.employee(a.id).archived, true);
    const bootstrap = (await request('/bootstrap')).value;
    assert.equal(bootstrap.groups.length, 2);
    const backup = (await request('/backup')).value;
    assert.equal(backup.version, 3); assert.equal(backup.groups.length, 2);
    assert(!JSON.stringify(backup).includes('group-test-secret'));
    const invalid = structuredClone(backup); invalid.groups[0].employeeIds.push('00000000-0000-4000-8000-000000000000');
    assert.equal((await request('/backup/validate', 'POST', invalid)).status, 400);
    assert.equal((await request('/backup/restore', 'POST', invalid, { 'X-Confirm-Restore': 'replace' })).status, 400);
    assert.equal(store.groups().length, 2); assert.equal(store.decisions().length, 1);
    assert.equal((await request('/employee-groups/' + group.id, 'DELETE', undefined, { 'X-Group-Version': '1' })).status, 409);
    assert.equal((await request('/employee-groups/' + group.id, 'DELETE', undefined, { 'X-Group-Version': '3' })).status, 200);
    assert.deepEqual(store.decision(decision.id).employeeIds, [a.id, b.id]);
    await request('/data', 'DELETE', undefined, { 'X-Confirm-Clear': 'clear-local-data' });
    assert.equal(store.groups().length, 0); assert.equal(store.connection().apiKey, 'group-test-secret');
    const restored = await request('/backup/restore', 'POST', backup, { 'X-Confirm-Restore': 'replace' });
    assert.equal(restored.status, 200); assert.deepEqual(store.groups(), backup.groups);
    const secondStore = new Store(file);
    try { assert.deepEqual(secondStore.groups(), backup.groups); } finally { secondStore.close(); }
    for (const version of [1, 2]) {
      const legacy = { ...backup, version }; delete legacy.groups;
      const oldRestore = await request('/backup/restore', 'POST', legacy, { 'X-Confirm-Restore': 'replace' });
      assert.equal(oldRestore.status, 200); assert.equal(store.groups().length, 0);
      assert.equal(store.employees().length, 2); assert.equal(store.decisions().length, 1);
    }
  } finally {
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    store.close(); rmSync(dir, { recursive: true, force: true });
  }
});
