import express, { type ErrorRequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { contextSchema, employeeInputSchema, employeeGroupInputSchema, draftSchema, finalInputSchema, reviewInputSchema, meaningfulInitialPlan, resultStatusLabels, type Decision } from '../shared/model';
import { AppError, Store, now, id } from './store';
import { CloudAI, analysisPreview, reviewPreview, snapshot, validBaseUrl } from './ai';

export function createApp(store: Store, ai = new CloudAI()) {
  const app = express();
  const jobs = new Set<string>();
  const requestJobs = new Set<string>();
  app.disable('x-powered-by');
  app.use((_req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer'); res.setHeader('X-Frame-Options', 'DENY'); next(); });
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    const host = req.headers.host?.split(':')[0];
    if (!host || !['localhost', '127.0.0.1'].includes(host)) return next(new AppError(403, '此版本仅支持本机访问。'));
    if (req.headers.origin) {
      try { if (new URL(req.headers.origin).host !== req.headers.host) return next(new AppError(403, '已拒绝其他网站发起的请求。')); }
      catch { return next(new AppError(403, '请求来源无效。')); }
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.get('X-Zhujian-Client') !== 'local') return next(new AppError(403, '请通过第二视角页面执行这项操作。'));
    next();
  });
  app.use(express.json({ limit: '15mb' }));
  const checkRevision = (d: Decision, revision: number | undefined) => { if (d.revision !== revision) throw new AppError(409, '记录已在其他操作中更新。请重新打开记录后再保存，当前输入不会被清空。'); };
  const touch = (d: Decision) => { d.revision++; d.updatedAt = now(); store.putDecision(d); return d; };
  const checkEmployees = (ids: string[]) => {
    if (new Set(ids).size !== ids.length) throw new AppError(400, '员工选择不能重复。');
    for (const employeeId of ids) store.employee(employeeId);
  };
  const noJobs = () => { if (jobs.size) throw new AppError(409, '还有分析正在进行，请等待完成后再操作。'); };
  const startJob = (decisionId: string, requestId: string) => {
    if (jobs.has(decisionId) || requestJobs.has(requestId)) throw new AppError(409, '这条记录正在分析中，请等待当前请求完成。');
    jobs.add(decisionId); requestJobs.add(requestId);
  };
  const replay = (requestId: string, operation: string, target: string, expectedFingerprint: string, decisionId: string) => {
    const saved = store.completedRequest(requestId);
    if (!saved) return null;
    if (saved.operation !== operation || saved.target !== target || saved.decision.id !== decisionId || saved.fingerprint !== expectedFingerprint) throw new AppError(409, '这个请求标识已经用于不同的内容，请重新查看并确认发送内容。');
    return saved.decision;
  };
  const analysisInput = z.object({ fingerprint: z.string().min(1), revision: z.number().int().positive(), consent: z.literal(true), requestId: z.string().uuid().optional() });
  const autoTitle = (title: string, problem: string, channel: Decision['channel']) => title || (channel === 'full' ? '' : problem.slice(0, 60));

  app.get('/api/health', (_req, res) => res.json({ ok: true, product: '第二视角', version: '0.2.1' }));
  app.get('/api/bootstrap', (_req, res) => res.json({ context: store.context(), employees: store.employees(), groups: store.groups(), decisions: store.decisions(), connection: store.publicConnection() }));
  app.put('/api/context', (req, res) => { const context = contextSchema.parse(req.body); store.saveSetting('context', context); res.json(context); });
  app.post('/api/employees', (req, res) => {
    const input = employeeInputSchema.parse(req.body), time = now();
    const employee = { id: id(), alias: store.nextAlias(), nickname: input.nickname, role: input.role, description: input.description, version: 1, archived: false, createdAt: time, updatedAt: time };
    store.putEmployee(employee); res.status(201).json(employee);
  });
  app.put('/api/employees/:id', (req, res) => {
    const input = employeeInputSchema.parse(req.body), employee = store.employee(req.params.id);
    if (input.version !== employee.version) throw new AppError(409, '这份画像已有更新，请重新核对后保存。');
    if (input.description === employee.description && input.nickname === employee.nickname && input.role === employee.role) return res.json(employee);
    store.transaction(() => { store.addHistory(employee, input.description, 'manual', null); employee.nickname = input.nickname; employee.role = input.role; employee.description = input.description; employee.version++; employee.updatedAt = now(); store.putEmployee(employee); });
    res.json(employee);
  });
  app.post('/api/employees/:id/archive', (req, res) => {
    const input = z.object({ archived: z.boolean(), version: z.number().int() }).parse(req.body), employee = store.employee(req.params.id);
    if (input.version !== employee.version) throw new AppError(409, '这份画像已有更新，请刷新后重试。');
    employee.archived = input.archived; employee.version++; employee.updatedAt = now(); store.putEmployee(employee); res.json(employee);
  });
  app.get('/api/employees/:id/history', (req, res) => { store.employee(req.params.id); res.json(store.history(req.params.id)); });

  const checkGroup = (input: z.infer<typeof employeeGroupInputSchema>, groupId?: string) => {
    checkEmployees(input.employeeIds);
    if (store.groups().some(g => g.id !== groupId && g.name === input.name)) throw new AppError(400, '已有同名分组，请换一个名称。');
  };
  app.post('/api/employee-groups', (req, res) => {
    const input = employeeGroupInputSchema.parse(req.body); checkGroup(input);
    if (input.employeeIds.some(e => store.employee(e).archived)) throw new AppError(400, '请选择当前员工创建分组。');
    const time = now(), group = { ...input, id: id(), version: 1, createdAt: time, updatedAt: time };
    store.putGroup(group); res.status(201).json(group);
  });
  app.put('/api/employee-groups/:id', (req, res) => {
    const input = employeeGroupInputSchema.extend({ version: z.number().int().positive() }).parse(req.body), group = store.group(req.params.id);
    if (input.version !== group.version) throw new AppError(409, '分组已有更新，请重新打开后再修改。');
    checkGroup(input, group.id);
    if (input.employeeIds.some(e => store.employee(e).archived && !group.employeeIds.includes(e))) throw new AppError(400, '不能向分组新增已归档员工。');
    store.putGroup({ ...group, name: input.name, employeeIds: input.employeeIds, version: group.version + 1, updatedAt: now() });
    res.json(store.group(group.id));
  });
  app.delete('/api/employee-groups/:id', (req, res) => {
    const group = store.group(req.params.id);
    if (Number(req.get('X-Group-Version')) !== group.version) throw new AppError(409, '分组已有更新，请刷新后再删除。');
    store.deleteGroup(group.id); res.json({ ok: true });
  });

  app.post('/api/decisions', (req, res) => {
    if (req.body.channel === 'trial') throw new AppError(400, '试用已合并为快速分析，请使用快速分析或深度决策。');
    const input = draftSchema.parse(req.body);
    if (input.channel === 'quick' && input.employeeIds.length) throw new AppError(400, '快速分析只使用本次描述，不携带员工档案。需要结合档案时，请使用深度决策。');
    checkEmployees(input.employeeIds);
    const time = now();
    const decision: Decision = { id: id(), channel: input.channel, temporaryContext: input.temporaryContext, title: autoTitle(input.title, input.problem, input.channel), problem: input.problem, employeeIds: input.employeeIds, initialPlan: input.initialPlan, originalPlan: null, revision: 1, status: 'draft', createdAt: time, updatedAt: time, analyses: [], finals: [], reviews: [] };
    store.putDecision(decision); res.status(201).json(decision);
  });
  app.get('/api/decisions/:id', (req, res) => res.json(store.decision(req.params.id)));
  app.put('/api/decisions/:id', (req, res) => {
    const input = draftSchema.parse(req.body), decision = store.decision(req.params.id); checkRevision(decision, input.revision); checkEmployees(input.employeeIds);
    if (req.body.channel !== undefined && req.body.channel !== decision.channel) throw new AppError(400, '决策通道不能通过编辑改变。快速分析可补齐资料后升级为深度决策，深度决策不能降级。');
    if (decision.channel !== 'full' && input.employeeIds.length) throw new AppError(400, '快速分析只使用本次描述，不携带员工档案。需要结合档案时，请使用深度决策。');
    input.title = autoTitle(input.title, input.problem, decision.channel);
    const changed = ['title', 'problem', 'initialPlan', 'employeeIds', 'temporaryContext'].some(key => JSON.stringify(input[key as keyof typeof input]) !== JSON.stringify(decision[key as keyof Decision]));
    if (!changed) return res.json(decision);
    Object.assign(decision, { title: input.title, problem: input.problem, initialPlan: input.initialPlan, employeeIds: input.employeeIds, temporaryContext: input.temporaryContext, status: 'draft' });
    res.json(touch(decision));
  });
  app.post('/api/decisions/:id/upgrade', (req, res) => {
    const input = z.object({ employeeIds: z.array(z.string().uuid()).max(100), initialPlan: draftSchema.shape.initialPlan, revision: z.number().int().positive() }).parse(req.body);
    const decision = store.decision(req.params.id); checkRevision(decision, input.revision);
    if (decision.channel === 'full') throw new AppError(400, '这条记录已经是深度决策。');
    if (!meaningfulInitialPlan(input.initialPlan)) throw new AppError(400, '升级为深度决策前，请写下你目前的初步打算。');
    checkEmployees(input.employeeIds);
    if (input.employeeIds.some(employeeId => store.employee(employeeId).archived)) throw new AppError(400, '请选择未归档的员工。');
    decision.channel = 'full'; decision.employeeIds = input.employeeIds; decision.initialPlan = input.initialPlan; decision.status = 'draft';
    res.json(touch(decision));
  });
  app.delete('/api/decisions/:id', (req, res) => {
    if (jobs.has(req.params.id)) throw new AppError(409, '请等待当前分析结束后再删除。');
    const decision = store.decision(req.params.id); checkRevision(decision, Number(req.get('X-Decision-Revision'))); store.deleteDecision(req.params.id); res.json({ ok: true });
  });
  app.get('/api/decisions/:id/analysis-preview', (req, res) => {
    const preview = analysisPreview(store, store.decision(req.params.id)); res.json({ kind: preview.kind, payload: preview.payload, fingerprint: preview.fingerprint });
  });
  app.post('/api/decisions/:id/analyze', async (req, res) => {
    const input = analysisInput.parse(req.body), requestId = input.requestId ?? id();
    const completed = replay(requestId, 'analysis', req.params.id, input.fingerprint, req.params.id);
    if (completed) return res.json(completed);
    const decision = store.decision(req.params.id); checkRevision(decision, input.revision);
    const preview = analysisPreview(store, decision);
    if (input.fingerprint !== preview.fingerprint) throw new AppError(409, '将发送的内容已有变化，请重新查看并确认。');
    const connection = store.connection(); startJob(decision.id, requestId);
    try {
      const { profileCandidates, ...result } = await ai.analyze(connection, preview.payload);
      const current = store.decision(decision.id); checkRevision(current, input.revision);
      if (analysisPreview(store, current).fingerprint !== preview.fingerprint) throw new AppError(409, '分析期间资料发生了变化。请重新确认后分析，旧资料的结果未写入。');
      if (meaningfulInitialPlan(current.initialPlan)) current.originalPlan ??= current.initialPlan;
      current.analyses.push({ id: id(), createdAt: now(), model: connection.model, fingerprint: preview.fingerprint, snapshot: preview.snapshot, sentPayload: preview.payload, requestId, result, profileCandidates: profileCandidates.map(candidate => ({ ...candidate, id: id(), status: 'pending', employeeId: null })) });
      current.status = 'analyzed'; res.json(touch(current));
    } finally { jobs.delete(decision.id); requestJobs.delete(requestId); }
  });
  app.post('/api/decisions/:id/candidates/:candidateId/resolve', (req, res) => {
    const input = z.object({ action: z.enum(['save', 'skip']), description: employeeInputSchema.shape.description.optional(), revision: z.number().int().positive() }).parse(req.body);
    const decision = store.decision(req.params.id); checkRevision(decision, input.revision);
    const candidate = decision.analyses.filter(a => a.snapshot.channel !== 'full').flatMap(a => a.profileCandidates).find(c => c.id === req.params.candidateId);
    if (!candidate) throw new AppError(404, '找不到这条临时画像建议。');
    if (candidate.status !== 'pending') throw new AppError(409, '这条临时画像已经处理过了。');
    store.transaction(() => {
      if (input.action === 'save') {
        const time = now();
        const employee = { id: id(), alias: store.nextAlias(), nickname: candidate.alias, role: '', description: input.description ?? candidate.description, version: 1, archived: false, createdAt: time, updatedAt: time };
        store.putEmployee(employee); candidate.description = employee.description; candidate.employeeId = employee.id; candidate.status = 'saved';
      } else candidate.status = 'skipped';
      touch(decision);
    });
    res.json(decision);
  });
  app.post('/api/decisions/:id/finals', (req, res) => {
    const input = finalInputSchema.parse(req.body), decision = store.decision(req.params.id); checkRevision(decision, input.revision);
    if (decision.channel !== 'full') throw new AppError(400, '快速分析只保留分析记录。请补充员工与初判，升级为深度决策后再拍板。');
    const data = snapshot(store, decision);
    if (input.mode === 'maintain' && (!meaningfulInitialPlan(decision.initialPlan) || input.text !== decision.initialPlan.trim())) throw new AppError(400, '维持原判时，请保留有明确内容的初判原文。修改内容请先调整初判或选择吸收建议。');
    if (input.mode !== 'maintain' && !input.analysisId) throw new AppError(400, '请先取得分析，或使用维持原判保存自己的决定。');
    if (input.mode === 'maintain' && input.adoptedOptionId) throw new AppError(400, '维持原判时不记录采纳的 AI 角度。');
    if (input.adoptedOptionId && !input.analysisId) throw new AppError(400, '采纳角度必须属于本次分析。');
    if (input.analysisId) {
      const analysis = decision.analyses.find(a => a.id === input.analysisId);
      if (!analysis) throw new AppError(400, '找不到选中的分析记录。');
      if (analysis.fingerprint !== analysisPreview(store, decision).fingerprint) throw new AppError(409, '这份分析的背景或画像已变化。请重新分析，或独立保存当前初判。');
      if (input.adoptedOptionId && !analysis.result.perspectives.some(p => p.id === input.adoptedOptionId)) throw new AppError(400, '选中的角度不属于这次分析。');
    }
    if (meaningfulInitialPlan(decision.initialPlan)) decision.originalPlan ??= decision.initialPlan;
    const followupDays = decision.channel === 'full' ? input.followupDays === undefined ? 30 : input.followupDays : null;
    decision.finals.push({ id: id(), createdAt: now(), mode: input.mode, text: input.text, analysisId: input.analysisId, adoptedOptionId: input.adoptedOptionId, snapshot: data, followup: { dueAt: followupDays === null ? null : new Date(Date.now() + followupDays * 86400000).toISOString(), status: followupDays === null ? 'none' : 'pending' } });
    decision.status = 'decided'; res.json(touch(decision));
  });
  app.post('/api/decisions/:id/reviews', (req, res) => {
    const input = reviewInputSchema.parse(req.body), decision = store.decision(req.params.id); checkRevision(decision, input.revision);
    if (decision.channel !== 'full') throw new AppError(400, '回访仅适用于深度决策。快速分析可先升级。');
    if (input.resultStatus === null && !input.outcome?.trim()) throw new AppError(400, '请选择这次的实际结果，再保存回访。');
    const final = decision.finals.at(-1); if (!final) throw new AppError(400, '先确认最终决定，再记录实际结果。');
    if (final.snapshot.channel !== 'full' || decision.status === 'draft' || decision.status === 'analyzed') throw new AppError(400, '请先确认当前深度决策版本的最终决定，再记录回访。');
    const outcome = input.outcome?.trim() || ['结果：' + (input.resultStatus === null ? '历史反馈' : resultStatusLabels[input.resultStatus]), '意外情况：' + (input.surprise || '未填写'), '回看当初判断：' + (input.hindsight || '未填写')].join('\n');
    decision.reviews.push({ id: id(), finalId: final.id, outcome, resultStatus: input.resultStatus, surprise: input.surprise, hindsight: input.hindsight, satisfaction: input.satisfaction, createdAt: now(), summary: null, model: null, suggestions: [], requestId: null, fingerprint: null });
    final.followup = input.resultStatus === 'pending' ? { dueAt: new Date(Date.now() + 14 * 86400000).toISOString(), status: 'pending' } : { ...final.followup, status: 'done' };
    decision.status = input.resultStatus === 'pending' ? 'decided' : 'reviewed'; res.json(touch(decision));
  });
  app.get('/api/decisions/:id/reviews/:reviewId/preview', (req, res) => {
    const decision = store.decision(req.params.id), review = decision.reviews.find(r => r.id === req.params.reviewId);
    if (!review) throw new AppError(404, '找不到这条反馈。');
    const preview = reviewPreview(store, decision, review); res.json({ kind: preview.kind, payload: preview.payload, fingerprint: preview.fingerprint });
  });
  app.post('/api/decisions/:id/reviews/:reviewId/analyze', async (req, res) => {
    const input = analysisInput.parse(req.body), requestId = input.requestId ?? id();
    const completed = replay(requestId, 'review', req.params.reviewId, input.fingerprint, req.params.id);
    if (completed) return res.json(completed);
    const decision = store.decision(req.params.id); checkRevision(decision, input.revision);
    const review = decision.reviews.find(r => r.id === req.params.reviewId); if (!review) throw new AppError(404, '找不到这条反馈。');
    if (review.summary !== null) throw new AppError(409, '这条反馈已经分析过。如有新的实际结果，请补充一条反馈。');
    const preview = reviewPreview(store, decision, review);
    if (preview.fingerprint !== input.fingerprint) throw new AppError(409, '复盘资料已有变化，请重新查看并确认。');
    const connection = store.connection(); startJob(decision.id, requestId);
    try {
      const result = await ai.review(connection, preview.payload), current = store.decision(decision.id); checkRevision(current, input.revision);
      const target = current.reviews.find(r => r.id === review.id)!;
      if (reviewPreview(store, current, target).fingerprint !== input.fingerprint) throw new AppError(409, '分析期间画像有变化，请重新核对后复盘。');
      const seen = new Set<string>();
      const suggestions = result.suggestions.map(s => {
        const employee = preview.employees.find(e => e.id === s.employeeId);
        if (!employee || seen.has(s.employeeId) || !review.outcome.includes(s.evidence) || s.proposedDescription === employee.description) throw new AppError(502, '模型的画像建议缺少有效依据或存在重复，没有保存这次分析。请重试。');
        seen.add(s.employeeId);
        return { ...s, id: id(), alias: employee.alias, previousDescription: employee.description, baseVersion: employee.version, status: 'pending' as const };
      });
      target.summary = result.summary; target.model = connection.model; target.suggestions = suggestions; target.requestId = requestId; target.fingerprint = input.fingerprint; res.json(touch(current));
    } finally { jobs.delete(decision.id); requestJobs.delete(requestId); }
  });
  app.post('/api/decisions/:id/suggestions/:suggestionId/resolve', (req, res) => {
    const input = z.object({ action: z.enum(['accept', 'reject']), description: employeeInputSchema.shape.description.optional(), expectedVersion: z.number().int().optional(), acknowledgeChanged: z.boolean().optional(), revision: z.number().int() }).parse(req.body);
    const decision = store.decision(req.params.id); checkRevision(decision, input.revision);
    const suggestion = decision.reviews.flatMap(r => r.suggestions).find(s => s.id === req.params.suggestionId);
    if (!suggestion) throw new AppError(404, '找不到这条画像建议。');
    if (suggestion.status !== 'pending') throw new AppError(409, '这条建议已经处理过了。');
    store.transaction(() => {
      if (input.action === 'accept') {
        const employee = store.employee(suggestion.employeeId);
        if (employee.archived) throw new AppError(409, '员工已经归档。请先恢复员工，再考虑这条建议。');
        if (input.expectedVersion !== employee.version || (employee.version !== suggestion.baseVersion && !input.acknowledgeChanged)) throw new AppError(409, '这份画像已有新版本。请重新打开建议，核对当前画像后再确认。');
        const description = input.description ?? suggestion.proposedDescription;
        store.addHistory(employee, description, 'review', decision.id);
        employee.description = description; employee.version++; employee.updatedAt = now(); store.putEmployee(employee);
        suggestion.status = 'accepted'; suggestion.appliedDescription = description;
      } else suggestion.status = 'rejected';
      suggestion.resolvedAt = now(); touch(decision);
    });
    res.json(decision);
  });

  app.get('/api/settings/connection', (_req, res) => res.json(store.publicConnection()));
  app.put('/api/settings/connection', (req, res) => {
    const input = z.object({ baseUrl: z.string().trim().max(500).refine(validBaseUrl, '请输入 HTTPS 模型接口地址，或本机 HTTP 地址'), model: z.string().trim().min(1).max(150), apiKey: z.string().trim().max(2000).optional(), clearKey: z.boolean().optional() }).parse(req.body);
    noJobs();
    const previous = store.connection();
    if (input.baseUrl !== previous.baseUrl && !input.apiKey && previous.apiKey && !input.clearKey) throw new AppError(400, '更换接口地址时，请重新填写对应密钥，避免把旧密钥发送给其他服务。');
    store.saveSetting('connection', { baseUrl: input.baseUrl.replace(/[/]+$/, ''), model: input.model, apiKey: input.clearKey ? '' : input.apiKey || previous.apiKey }); res.json(store.publicConnection());
  });
  app.post('/api/settings/connection/test', async (_req, res) => { await ai.test(store.connection()); res.json({ ok: true, message: '连接成功，模型可以正常响应。测试未发送业务资料。' }); });
  app.get('/api/backup', (_req, res) => { res.setHeader('Content-Disposition', 'attachment; filename="zhujian-backup-' + now().slice(0, 10) + '.json"'); res.json(store.export()); });
  app.post('/api/backup/validate', (req, res) => { const backup = store.validateBackup(req.body); res.json({ employees: backup.employees.length, groups: backup.groups.length, decisions: backup.decisions.length, exportedAt: backup.exportedAt }); });
  app.post('/api/backup/restore', (req, res) => { noJobs(); if (req.get('X-Confirm-Restore') !== 'replace') throw new AppError(400, '请先确认整库恢复。'); const backup = store.validateBackup(req.body); store.restore(backup); res.json({ ok: true }); });
  app.delete('/api/data', (req, res) => { noJobs(); if (req.get('X-Confirm-Clear') !== 'clear-local-data') throw new AppError(400, '请先确认清空。'); store.clear(); res.json({ ok: true }); });
  app.use('/api', (_req, _res, next) => next(new AppError(404, '找不到这个操作。')));
  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ZodError) { res.status(400).json({ error: error.issues[0]?.message || '输入内容不完整，请检查后重试。' }); return; }
    if (error instanceof AppError) { res.status(error.status).json({ error: error.message }); return; }
    if (error?.type === 'entity.too.large') { res.status(413).json({ error: '内容过大，请使用小于 15 MB 的备份。' }); return; }
    if (error?.type === 'entity.parse.failed') { res.status(400).json({ error: '请求内容格式无效。' }); return; }
    res.status(500).json({ error: '本地操作未能完成，请稍后重试。已有记录没有清空。' });
  };
  app.use(errorHandler);
  return app;
}

