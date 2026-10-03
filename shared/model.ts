import { z } from 'zod';

export const contactPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+[.][A-Z]{2,}|(?<![0-9])(?:[+]?86[- ]?)?1[3-9][0-9]{9}(?![0-9])/gi;
export function hasContacts(value: string) { return new RegExp(contactPattern.source, 'gi').test(value); }
export function redactContacts(value: string) { return value.replace(new RegExp(contactPattern.source, 'gi'), '[联系方式已隐藏]'); }
const text = (max: number) => z.string().trim().max(max).refine(v => !hasContacts(v), '请先把文本中的邮箱或手机号替换为代号');
const required = (max: number) => text(max).refine(v => v.length > 0, '请填写这项内容');
export function meaningfulInitialPlan(value: string | null | undefined) {
  const normalized = (value ?? '').trim().replace(/[\s，。！？、,.!?；;：:]/g, '');
  return normalized.length > 0 && !['无', '没有', '暂无', '还没想好', '没想好', '不知道', '待定', '暂无想法', '无初判', '还没有'].includes(normalized);
}
export const channelSchema = z.enum(['trial', 'quick', 'full']);
export const newChannelSchema = z.enum(['quick', 'full']);
export type DecisionChannel = z.infer<typeof channelSchema>;
export const channelLabels = { trial: '早期快速分析', quick: '快速分析记录', full: '决策记录' };
export const angleTypes = ['人事安排', '流程规则', '节奏时机', '资源投入', '对外沟通', '暂不动作'] as const;
export const angleTypeSchema = z.enum(angleTypes);

export const contextSchema = z.object({
  nickname: text(80).default(''), industry: text(120).default(''), persona: text(2000).default(''),
  department: text(120).default(''), description: text(2000).default(''),
}).transform(value => ({ ...value, persona: value.persona || [value.department, value.description].filter(Boolean).join('；') }));
export type TeamContext = z.infer<typeof contextSchema>;
export const employeeInputSchema = z.object({ nickname: text(80).default(''), role: text(120).default(''), description: required(3000), version: z.number().int().optional() });
export const employeeSchema = z.object({
  id: z.string().uuid(), alias: z.string().regex(/^员工[A-Z]{1,3}$/), nickname: text(80).default(''), role: text(120).default(''), description: required(3000),
  version: z.number().int().positive(), archived: z.boolean(), createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type Employee = z.infer<typeof employeeSchema>;
export const employeeGroupInputSchema = z.object({
  name: required(60), employeeIds: z.array(z.string().uuid()).max(10000),
});
export const employeeGroupSchema = employeeGroupInputSchema.extend({
  id: z.string().uuid(), version: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type EmployeeGroup = z.infer<typeof employeeGroupSchema>;
export const draftSchema = z.object({
  channel: newChannelSchema.default('full'), temporaryContext: text(4000).default(''),
  title: text(100).default(''), problem: text(8000), employeeIds: z.array(z.string().uuid()).max(100).default([]),
  initialPlan: text(8000).default(''), revision: z.number().int().positive().optional(),
});
export type DraftInput = z.infer<typeof draftSchema>;
export const perspectiveSchema = z.object({
  id: required(100), angleType: angleTypeSchema.nullable(), title: required(100), plan: required(1800),
  basis: required(1200), risks: required(1200), questions: required(1000),
});
export const qualityFlagsSchema = z.object({ angleTypesDuplicated: z.boolean(), degraded: z.boolean() });
export const analysisResultSchema = z.object({
  riskSummary: required(1600).nullable(), riskError: z.string().max(2000).nullable().default(null),
  perspectives: z.array(perspectiveSchema).min(1).max(3), unknowns: z.array(required(500)).max(6),
  qualityFlags: qualityFlagsSchema,
});
export type AnalysisResult = z.infer<typeof analysisResultSchema>;
export const snapshotSchema = z.object({
  channel: channelSchema.default('full'), temporaryContext: text(4000).default(''),
  context: contextSchema, employees: z.array(employeeSchema), title: text(100), problem: required(8000), initialPlan: text(8000).default(''),
});
export type DecisionSnapshot = z.infer<typeof snapshotSchema>;
export const sentPayloadSchema = z.object({ independent: z.record(z.string(), z.unknown()), risk: z.record(z.string(), z.unknown()).nullable() });
export type AnalysisPayload = z.infer<typeof sentPayloadSchema>;
export const profileCandidateSchema = z.object({
  id: z.string().uuid(), alias: z.string().regex(/^员工[A-Z]{1,3}$/), description: required(3000), evidence: required(1500),
  status: z.enum(['pending', 'saved', 'skipped']), employeeId: z.string().uuid().nullable(),
});
export type ProfileCandidate = z.infer<typeof profileCandidateSchema>;
export const analysisSchema = z.object({
  id: z.string().uuid(), createdAt: z.string().datetime(), model: z.string(), fingerprint: z.string(), snapshot: snapshotSchema, result: analysisResultSchema,
  requestId: z.string().uuid().nullable().default(null), sentPayload: sentPayloadSchema.nullable().default(null),
  profileCandidates: z.array(profileCandidateSchema).max(20).default([]),
});
export type Analysis = z.infer<typeof analysisSchema>;
export const finalInputSchema = z.object({
  mode: z.enum(['maintain', 'revise', 'adopt']), text: required(12000), analysisId: z.string().uuid().nullable(),
  adoptedOptionId: z.string().max(100).nullable().default(null), followupDays: z.union([z.literal(14), z.literal(30), z.literal(90), z.null()]).optional(),
  revision: z.number().int().positive(),
});
export const followupSchema = z.object({ dueAt: z.string().datetime().nullable(), status: z.enum(['pending', 'done', 'none']) });
export const finalSchema = finalInputSchema.omit({ revision: true, followupDays: true }).extend({
  id: z.string().uuid(), createdAt: z.string().datetime(), snapshot: snapshotSchema,
  followup: followupSchema.default({ dueAt: null, status: 'none' }),
});
export type FinalDecision = z.infer<typeof finalSchema>;
export const suggestionSchema = z.object({
  id: z.string().uuid(), employeeId: z.string().uuid(), alias: z.string(), previousDescription: required(3000),
  proposedDescription: required(3000), reason: required(1500), evidence: required(1500), baseVersion: z.number().int().positive(),
  status: z.enum(['pending', 'accepted', 'rejected']), appliedDescription: z.string().optional(), resolvedAt: z.string().datetime().optional(),
});
export type ProfileSuggestion = z.infer<typeof suggestionSchema>;
export const resultStatusSchema = z.enum(['smooth', 'mixed', 'problem', 'pending']);
export const resultStatusLabels = { smooth: '顺利', mixed: '有波折', problem: '出问题', pending: '还没结果' };
export const reviewInputSchema = z.object({
  resultStatus: resultStatusSchema.nullable().default(null), surprise: text(3000).default(''), hindsight: text(3000).default(''),
  outcome: text(8000).optional(), satisfaction: z.number().int().min(1).max(5).default(3), revision: z.number().int().positive(),
});
export const reviewSchema = z.object({
  id: z.string().uuid(), finalId: z.string().uuid(), outcome: required(8000), satisfaction: z.number().int().min(1).max(5).default(3), createdAt: z.string().datetime(),
  resultStatus: resultStatusSchema.nullable().default(null), surprise: text(3000).default(''), hindsight: text(3000).default(''),
  summary: z.string().nullable(), model: z.string().nullable(), suggestions: z.array(suggestionSchema),
  requestId: z.string().uuid().nullable().default(null), fingerprint: z.string().nullable().default(null),
});
export type Review = z.infer<typeof reviewSchema>;
export const reviewResultSchema = z.object({
  summary: required(2000),
  suggestions: z.array(z.object({ employeeId: z.string().uuid(), proposedDescription: required(3000), reason: required(1500), evidence: required(1500) })).max(8),
});
export const decisionSchema = z.object({
  id: z.string().uuid(), channel: channelSchema.default('full'), temporaryContext: text(4000).default(''),
  title: text(100), problem: text(8000), employeeIds: z.array(z.string().uuid()).max(100), initialPlan: text(8000).default(''),
  originalPlan: z.string().nullable(), revision: z.number().int().positive(), status: z.enum(['draft', 'analyzed', 'decided', 'reviewed']),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), analyses: z.array(analysisSchema), finals: z.array(finalSchema), reviews: z.array(reviewSchema),
});
export type Decision = z.infer<typeof decisionSchema>;
export const historySchema = z.object({ id: z.string().uuid(), employeeId: z.string().uuid(), previousDescription: z.string(), description: z.string(), source: z.enum(['manual', 'review']), decisionId: z.string().uuid().nullable(), createdAt: z.string().datetime() });
export type ProfileHistory = z.infer<typeof historySchema>;

/** Preserve legacy facts; old analyses had no angle labels or exact sent-payload record. */
export function migrateDecision(input: unknown): unknown {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return input;
  const decision = structuredClone(input) as Record<string, any>;
  if (!('channel' in decision) && Array.isArray(decision.analyses)) {
    for (const analysis of decision.analyses) {
      if (!analysis?.result || !Array.isArray(analysis.result.perspectives)) continue;
      analysis.result.perspectives = analysis.result.perspectives.map((p: Record<string, unknown>, i: number) => ({ ...p, id: p.id ?? 'legacy-' + (i + 1), angleType: p.angleType ?? null }));
      analysis.result.qualityFlags ??= { angleTypesDuplicated: false, degraded: true };
    }
  }
  // The entry point was merged; immutable historical snapshots retain their original channel.
  if (decision.channel === 'trial') decision.channel = 'quick';
  return decision;
}
export const backupSchema = z.object({
  format: z.literal('zhujian-backup'), version: z.union([z.literal(1), z.literal(2), z.literal(3)]), exportedAt: z.string().datetime(),
  context: contextSchema, employees: z.array(employeeSchema).max(10000),
  groups: z.array(employeeGroupSchema).max(10000).default([]),
  decisions: z.array(z.preprocess(migrateDecision, decisionSchema)).max(10000), history: z.array(historySchema).max(100000),
});
export type Backup = z.infer<typeof backupSchema>;
export interface ConnectionSettings { baseUrl: string; model: string; apiKey: string }
export interface PublicConnection { baseUrl: string; model: string; hasKey: boolean }
export interface Bootstrap { context: TeamContext; employees: Employee[]; groups: EmployeeGroup[]; decisions: Decision[]; connection: PublicConnection }
export const modeLabels = { maintain: '维持原判', revise: '吸收建议修改', adopt: '采纳新视角' };
export const statusLabels = { draft: '思考中', analyzed: '待确认', decided: '已确认', reviewed: '已复盘' };
