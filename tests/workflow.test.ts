import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Server } from 'node:http';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/app';
import { CloudAI, type Fetcher } from '../server/ai';
import { Store } from '../server/store';
import { hasContacts, redactContacts, type Decision } from '../shared/model';

const analysisResult = {
  riskSummary: '根据你的描述，A 的协作方式可能造成沟通成本，需要先确认分歧协调机制。',
  perspectives: [
    { angleType: '人事安排', title: '技术与协作分别负责', plan: '由 A 负责技术方案，B 负责协调进度，提前明确争议的协调人。', basis: '你认为 A 技术强，B 沟通较好；这是你目前的观察。', risks: '两位负责人职责不清时可能发生重复决策。', questions: '两人是否有共同负责项目的经历？' },
    { angleType: '节奏时机', title: '先以短任务验证配合', plan: '安排一个范围明确的小任务，由 A 牵头，B 协助，结束后再确定长期分工。', basis: '目前尚缺少实际协作证据，可以用小范围合作补充观察。', risks: '短任务的结果不一定代表长期表现。', questions: '当前时间安排是否允许先验证一次？' },
    { angleType: '流程规则', title: '先统一需求与争议处理规则', plan: '在启动前明确交付标准、需求确认人和争议升级路径，再按已有职责分工。', basis: '问题涉及跨部门合作，明确协作规则有助于减少重复确认。', risks: '规则过细会增加沟通成本。', questions: '哪些分歧需要由负责人协调？' },
  ], unknowns: ['两人可投入的时间尚未明确。'],
};
const headers = { 'Content-Type': 'application/json', 'X-Zhujian-Client': 'local' };
async function fixture() {
  const store = new Store(':memory:');
  let responder: (body: any) => Promise<Response> = async body => {
    if (body.messages[0].content.includes('复盘参谋')) {
      const payload = JSON.parse(body.messages[1].content);
      return success({ summary: '本次合作显示协调安排有帮助，还需继续观察。', suggestions: [{ employeeId: payload.当前可提出更新建议的员工[0].员工标识, proposedDescription: '技术能力强；在本次任务中配合预先约定的协调方式完成了交付。', reason: '只增加本次实际观察，不推断永久性格变化。', evidence: 'A 按约定完成交付' }] });
    }
    return success(analysisResult);
  };
  let calls = 0;
  const ai = new CloudAI((async (_url: unknown, options: any) => { calls++; return responder(JSON.parse(options.body)); }) as Fetcher);
  const app = createApp(store, ai), server: Server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const address = server.address(); assert(address && typeof address !== 'string');
  const base = 'http://127.0.0.1:' + address.port;
  async function request(path: string, method = 'GET', body?: unknown, extraHeaders: Record<string, string> = {}) {
    const response = await fetch(base + '/api' + path, { method, headers: { ...headers, ...extraHeaders }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value: any = await response.json(); return { status: response.status, value };
  }
  store.saveSetting('connection', { baseUrl: 'https://model.example.test/v1', model: 'test-model', apiKey: 'test-secret-only' });
  await request('/context', 'PUT', { industry: '软件服务', department: '研发与交付', description: '需要跨部门协作' });
  const { value: employee } = await request('/employees', 'POST', { description: '技术能力强，沟通时比较坚持自己的意见。' });
  const { value: decision } = await request('/decisions', 'POST', { title: '谁来牵头新项目', problem: '需要确定跨部门项目的分工。', employeeIds: [employee.id], initialPlan: '' });
  return { store, base, request, employee, decision: decision as Decision, calls: () => calls, setResponder: (fn: typeof responder) => { responder = fn; }, close: async () => { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close(); } };
}
function success(value: unknown) { return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }] }), { headers: { 'Content-Type': 'application/json' } }); }
async function prepare(f: Awaited<ReturnType<typeof fixture>>) {
  const { value: decision } = await f.request('/decisions/' + f.decision.id, 'PUT', { ...f.decision, initialPlan: '我准备让 A 负责技术，并提前约定协作规则。', revision: f.decision.revision });
  const { value: preview } = await f.request('/decisions/' + decision.id + '/analysis-preview');
  return { decision: decision as Decision, preview };
}

test('完整闭环：初判门槛、真实接口适配、确认拍板、复盘不擅自改画像', async () => {
  const f = await fixture();
  try {
    const missing = await f.request('/decisions/' + f.decision.id + '/analyze', 'POST', { fingerprint: 'invalid', revision: 1, consent: true });
    assert.equal(missing.status, 400); assert.equal(f.calls(), 0);
    const { decision, preview } = await prepare(f);
    assert(!JSON.stringify(preview.payload).includes('test-secret-only'));
    const noConsent = await f.request('/decisions/' + decision.id + '/analyze', 'POST', { fingerprint: preview.fingerprint, revision: decision.revision, consent: false });
    assert.equal(noConsent.status, 400); assert.equal(f.calls(), 0);
    let result = await f.request('/decisions/' + decision.id + '/analyze', 'POST', { fingerprint: preview.fingerprint, revision: decision.revision, consent: true });
    assert.equal(result.status, 200); assert.equal(result.value.analyses[0].result.perspectives.length, 3);
    let current: Decision = result.value;
    assert.equal(current.originalPlan, decision.initialPlan);
    assert.equal(current.finals.length, 0);
    result = await f.request('/decisions/' + decision.id + '/finals', 'POST', { mode: 'adopt', text: analysisResult.perspectives[0].plan, analysisId: current.analyses[0].id, revision: current.revision });
    assert.equal(result.status, 200); current = result.value;
    result = await f.request('/decisions/' + decision.id + '/reviews', 'POST', { outcome: 'A 按约定完成交付，预先明确的协调方式减少了争议。', satisfaction: 4, revision: current.revision });
    assert.equal(result.status, 200); current = result.value;
    const review = current.reviews[0];
    const rp = await f.request('/decisions/' + decision.id + '/reviews/' + review.id + '/preview');
    result = await f.request('/decisions/' + decision.id + '/reviews/' + review.id + '/analyze', 'POST', { fingerprint: rp.value.fingerprint, revision: current.revision, consent: true });
    assert.equal(result.status, 200); current = result.value;
    assert.equal(f.store.employee(f.employee.id).description, f.employee.description);
    const suggestion = current.reviews[0].suggestions[0]; assert.equal(suggestion.status, 'pending');
    const edit = await f.request('/employees/' + f.employee.id, 'PUT', { description: '技术能力强，最近有新观察。', version: 1 });
    assert.equal(edit.status, 200);
    const conflict = await f.request('/decisions/' + decision.id + '/suggestions/' + suggestion.id + '/resolve', 'POST', { action: 'accept', expectedVersion: 1, revision: current.revision });
    assert.equal(conflict.status, 409);
    assert.equal(f.store.employee(f.employee.id).version, 2);
    result = await f.request('/decisions/' + decision.id + '/suggestions/' + suggestion.id + '/resolve', 'POST', { action: 'accept', expectedVersion: 2, acknowledgeChanged: true, description: '技术能力强；本次按约定完成交付，继续观察协作表现。', revision: current.revision });
    assert.equal(result.status, 200); current = result.value;
    assert.equal(f.store.employee(f.employee.id).version, 3);
    assert.equal(current.reviews[0].suggestions[0].status, 'accepted');
    assert.equal(current.analyses[0].snapshot.employees[0].version, 1);
    assert.equal(current.finals[0].snapshot.employees[0].description, f.employee.description);
    assert.equal(f.store.history(f.employee.id).length, 2);
    const duplicate = await f.request('/decisions/' + decision.id + '/suggestions/' + suggestion.id + '/resolve', 'POST', { action: 'accept', expectedVersion: 3, revision: current.revision });
    assert.equal(duplicate.status, 409); assert.equal(f.store.employee(f.employee.id).version, 3);
  } finally { await f.close(); }
});

test('保留自己的初判不依赖模型；决定修订保留版本；拒绝无分析的采纳', async () => {
  const f = await fixture();
  try {
    const { decision } = await prepare(f);
    f.store.saveSetting('connection', { baseUrl: 'https://api.deepseek.com', model: 'test', apiKey: '' });
    let r = await f.request('/decisions/' + decision.id + '/finals', 'POST', { mode: 'adopt', text: '新的决定', analysisId: null, revision: decision.revision });
    assert.equal(r.status, 400);
    r = await f.request('/decisions/' + decision.id + '/finals', 'POST', { mode: 'maintain', text: decision.initialPlan, analysisId: null, revision: decision.revision });
    assert.equal(r.status, 200); const original = r.value;
    r = await f.request('/decisions/' + decision.id, 'PUT', { ...original, initialPlan: '我决定先用短任务观察配合。' });
    assert.equal(r.status, 200);
    r = await f.request('/decisions/' + decision.id + '/finals', 'POST', { mode: 'maintain', text: r.value.initialPlan, analysisId: null, revision: r.value.revision });
    assert.equal(r.status, 200); assert.equal(r.value.finals.length, 2); assert.equal(r.value.finals[0].text, decision.initialPlan); assert.equal(f.calls(), 0);
  } finally { await f.close(); }
});

test('模型失败、异常结构和过期预览均不产生分析或丢失草稿', async () => {
  const f = await fixture();
  try {
    const { decision, preview } = await prepare(f);
    const call = () => f.request('/decisions/' + decision.id + '/analyze', 'POST', { fingerprint: preview.fingerprint, revision: decision.revision, consent: true });
    f.setResponder(async () => new Response('{}', { status: 401 }));
    let result = await call(); assert.equal(result.status, 502); assert.match(result.value.error, /联系支持/);
    f.setResponder(async () => success({ riskSummary: '只有一个字段' }));
    result = await call(); assert.equal(result.status, 502);
    f.setResponder(async () => { throw new DOMException('timeout', 'TimeoutError'); });
    result = await call(); assert.equal(result.status, 504);
    assert.equal(f.store.decision(decision.id).analyses.length, 0); assert.equal(f.store.decision(decision.id).initialPlan, decision.initialPlan);
    await f.request('/context', 'PUT', { industry: '制造业', department: '研发', description: '' });
    result = await call(); assert.equal(result.status, 409); assert.equal(f.calls(), 6);
  } finally { await f.close(); }
});

test('同一决策禁止重复分析，资料变化时丢弃过时结果', async () => {
  const f = await fixture();
  let finish!: () => void, started!: () => void;
  const waiting = new Promise<void>(resolve => { finish = resolve; }), entered = new Promise<void>(resolve => { started = resolve; });
  try {
    const { decision, preview } = await prepare(f);
    f.setResponder(async () => { started(); await waiting; return success(analysisResult); });
    const body = { fingerprint: preview.fingerprint, revision: decision.revision, consent: true };
    const first = f.request('/decisions/' + decision.id + '/analyze', 'POST', body); await entered;
    const duplicate = await f.request('/decisions/' + decision.id + '/analyze', 'POST', body); assert.equal(duplicate.status, 409);
    const clear = await f.request('/data', 'DELETE', undefined, { 'X-Confirm-Clear': 'clear-local-data' }); assert.equal(clear.status, 409);
    await f.request('/employees/' + f.employee.id, 'PUT', { description: '新的观察。', version: 1 });
    finish(); const result = await first;
    assert.equal(result.status, 409); assert.equal(f.store.decision(decision.id).analyses.length, 0);
  } finally { finish(); await f.close(); }
});

test('备份恢复、重启持久性、隐私边界和跨站请求保护', async () => {
  const f = await fixture();
  const temp = mkdtempSync(join(tmpdir(), 'zhujian-test-'));
  try {
    const backup = await f.request('/backup');
    assert.equal(backup.status, 200); assert(!JSON.stringify(backup.value).includes('test-secret-only'));
    const bootstrap = await f.request('/bootstrap'); assert(!JSON.stringify(bootstrap.value).includes('test-secret-only'));
    const crossSite = await f.request('/employees', 'POST', { description: '测试' }, { Origin: 'https://untrusted.example' }); assert.equal(crossSite.status, 403);
    const wrongHost = await new Promise<number | undefined>((resolve, reject) => {
      const req = httpRequest(f.base + '/api/bootstrap', { headers: { Host: 'untrusted.example' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      req.on('error', reject); req.end();
    });
    assert.equal(wrongHost, 403);
    const noHeader = await f.request('/employees', 'POST', { description: '测试' }, { 'X-Zhujian-Client': '' }); assert.equal(noHeader.status, 403);
    const contact = await f.request('/employees', 'POST', { description: '邮箱 name@example.com' }); assert.equal(contact.status, 400);
    const bad = structuredClone(backup.value); bad.employees.push(bad.employees[0]);
    assert.equal((await f.request('/backup/restore', 'POST', bad, { 'X-Confirm-Restore': 'replace' })).status, 400);
    assert.equal(f.store.employees().length, 1);
    const path = join(temp, 'data.sqlite'); let reopened = new Store(path); reopened.restore(reopened.validateBackup(backup.value)); reopened.close();
    reopened = new Store(path); assert.equal(reopened.employees().length, 1); assert.equal(reopened.decisions().length, 1); reopened.close();
    assert.equal((await f.request('/data', 'DELETE', undefined, { 'X-Confirm-Clear': 'clear-local-data' })).status, 200);
    assert.equal(f.store.decisions().length, 0);
    assert.equal((await f.request('/backup/restore', 'POST', backup.value, { 'X-Confirm-Restore': 'replace' })).status, 200);
    assert.equal(f.store.decisions().length, 1); assert.equal(f.store.connection().apiKey, 'test-secret-only');
    assert.equal((await f.request('/settings/connection', 'PUT', { baseUrl: 'https://another.example/v1', model: 'new' })).status, 400);
    assert.equal(f.store.connection().baseUrl, 'https://model.example.test/v1');
  } finally { await f.close(); rmSync(temp, { recursive: true, force: true }); }
});

test('本地联系方式检查可识别手机号和邮箱，保留正常描述', () => {
  assert(hasContacts('请联系 name@example.com'));
  assert(hasContacts('联系电话：13800138000'));
  assert.equal(redactContacts('邮箱 name@example.com，手机13800138000'), '邮箱 [联系方式已隐藏]，手机[联系方式已隐藏]');
  assert.equal(hasContacts('员工 A 负责研发，共有 6 位同事。'), false);
});
