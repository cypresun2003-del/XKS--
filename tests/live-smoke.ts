// Opt-in relay verification. Reads only connection settings and sends synthetic data.
// Never reads business records or writes test data into the user's database.
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
import { CloudAI } from '../server/ai';
import type { ConnectionSettings } from '../shared/model';

const db = new DatabaseSync('data/zhujian.sqlite', { readOnly: true });
const row = db.prepare('SELECT data FROM settings WHERE key = ?').get('connection') as { data: string };
db.close();
const connection: ConnectionSettings = JSON.parse(row.data);
const independent = {
  用户画像: { 称呼: '测试用户', 行业: '教学演示', 日常决策介绍: '这是虚构的接口测试场景。' },
  本次情况: '', 当前难题: '这是虚构测试：一个三人小组要在两周内完成演示，时间有限，如何安排准备节奏？',
  我目前对相关员工的看法: [], 方案数量: 3, 可提取临时画像: false,
};
const ai = new CloudAI();
try {
  const result = await ai.analyze(connection, { independent, risk: { ...independent, 我的初步打算: '我计划先用一周完成内容，再用一周进行排练和修订。' } });
  assert.equal(result.perspectives.length, 3);
  assert.equal(new Set(result.perspectives.map(p => p.angleType)).size, 3);
  assert(result.riskSummary && !result.riskError);
  console.log(JSON.stringify({ analysis: 'passed', perspectives: 3, distinctAngles: true, separateRiskCheck: true, model: connection.model, syntheticDataOnly: true }));
  const review = await ai.review(connection, {
    当时的用户画像: independent.用户画像, 当前难题: independent.当前难题,
    我的最终决定: '先完成内容，再进行排练。', 我的实际反馈: '演示按时完成，但排练时间偏少。', 满意度: 4,
    当前可提出更新建议的员工: [],
  });
  assert(review.summary && Array.isArray(review.suggestions));
  assert.equal(review.suggestions.length, 0);
  console.log(JSON.stringify({ review: 'passed', noInventedEmployees: true }));
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Live verification failed');
  process.exitCode = 1;
}
