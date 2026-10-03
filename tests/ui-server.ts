// Isolated UI verification only: in-memory data and a deterministic model transport.
// Never imported by the application or its production entry point.
import express from 'express';
import { resolve } from 'node:path';
import { Store } from '../server/store';
import { createApp } from '../server/app';
import { CloudAI, type Fetcher } from '../server/ai';

const store = new Store(':memory:');
store.saveSetting('connection', { baseUrl: 'https://ui-test.invalid', model: '仅供自动化检查的测试模型', apiKey: 'test-only-not-a-real-key' });
const ai = new CloudAI((async (_url: unknown, options: any) => {
  const request = JSON.parse(options.body);
  const payload = JSON.parse(request.messages[1].content);
  const result = request.messages[0].content.includes('本次唯一任务') ? { riskSummary: 'A 牵头时，跨部门意见不一致可能增加协调成本。应提前约定分歧协调方式，并确认两人的可投入时间。' } : request.messages[0].content.includes('复盘参谋') ? {
    summary: '本次任务中，提前约定协调机制帮助团队完成交付。这是一次具体观察，还不能泛化到所有项目。',
    suggestions: payload.当前可提出更新建议的员工.length ? [{ employeeId: payload.当前可提出更新建议的员工[0].员工标识, proposedDescription: '研发能力强，观点比较坚定。本次项目中，在提前约定协调规则后按时完成交付；建议继续观察不同情境下的协作表现。', reason: '增加本次反馈中的实际观察，保留情境限制。', evidence: 'A 按时完成交付' }] : [],
  } : {
    riskSummary: '根据你目前对 A 的描述，如果让他牵头，跨部门意见不一致时可能增加协调成本。建议先明确分歧由谁协调，这仍需实际合作来验证。',
    perspectives: [
      { angleType: '目标取舍', title: '先区分交付与新增承诺', plan: '把已约定的核心演示和新增要求分开核对，先问清公开课实际需要演示什么。如果新增功能并非本次必须，可单独约定后续验证时间；如果是必要条件，再明确本周能展示的替代方式。', basis: '你认为 A 技术强、B 沟通较好。这个安排依据你的主观观察，尚未验证两人的实际配合。', risks: '如果责任边界不清，可能出现重复确认，拖慢进度。', questions: 'B 是否有足够时间协调？两人是否认可职责边界？' },
      { angleType: '节奏时机', title: '先用短任务验证协作', plan: '先用现有演示复现客户的课堂场景，记录真正卡住使用的环节。如果现有功能能完成课堂目标，新增开发就不必绑在这周的交付里；如果不能，再缩小需补齐的部分。', basis: '目前缺少实际合作证据，小任务可以帮助你补充观察。', risks: '小任务可能无法暴露长期协作问题，而且需要预留验证时间。', questions: '交付时间是否允许这两天的试运行？什么结果算验证通过？' },
      { angleType: '流程规则', title: '先明确分歧处理规则', plan: '把开发估算和客户承诺放在同一张清单里，逐项标明本周能交付什么、什么仍需验证。只有客户确认接受的范围才作为承诺，后续新增项另行确认时间。', basis: '跨部门合作容易出现信息差，预先明确规则有助于减少重复沟通。', risks: '规则过细或审批过多可能拖慢简单问题的处理。', questions: '哪些问题团队可以自主决定，哪些需要你介入？' },
    ],
    unknowns: ['两位员工当前的工作负荷。', '以往类似项目中，争议通常如何解决。'],
  };
  if (result.perspectives) {
    if (payload.可提取临时画像 && String(payload.本次情况).includes('员工A技术强')) (result as any).profileCandidates = [{ alias: '员工A', description: '技术强。', evidence: '员工A技术强' }];
  }
  return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }] }), { headers: { 'Content-Type': 'application/json' } });
}) as Fetcher);
const app = createApp(store, ai);
app.use(express.static(resolve('dist')));
app.listen(4318, '127.0.0.1', () => console.log('Isolated UI test server: http://127.0.0.1:4318 — memory only, not a real model'));
