import { readFileSync, writeFileSync } from 'node:fs';
import { Store } from '../server/store';
import { CloudAI, independentPrompt } from '../server/ai';
const store = new Store('data/zhujian.sqlite');
const connection = store.connection(); store.close();
const oldSource = readFileSync('artifacts/ai-before-simplify.txt', 'utf8');
const oldPrompt = oldSource.match(/const independentPrompt = '(.*?)';/s)![1];
const cases = [
 { name:'交付承诺', payload:{用户画像:{行业:'教学设备',日常决策介绍:'负责学校客户交付'},当前难题:'虚构案例：学校下周公开课要用演示设备，已签约的核心演示能按时完成。客户昨天新增离线语音功能，开发预计至少两周。销售担心拒绝会影响后续采购，客户还没有说明新增功能是否是公开课必须使用的内容。不能增加本周人手。应该如何处理这次承诺？',我目前对相关员工的看法:[{代号:'员工A',职责:'开发',主观描述:'技术经验多，表达直接。'},{代号:'员工B',职责:'客户联系',主观描述:'善于沟通，容易先答应客户。'}],方案数量:3,可提取临时画像:false}},
 { name:'个人选择信息不足', payload:{当前难题:'虚构案例：我拿到了一个年薪高百分之二十的新工作，单程通勤从二十分钟变为七十分钟，试用期六个月。现在的工作收入稳定但成长慢。我没有提供家庭情况、积蓄和新团队实际工作情况。怎么考虑是否换工作？',方案数量:3,可提取临时画像:false}}
];
const ai = new CloudAI();
const variants=[{name:'新提示词 / gpt-4o-mini',model:'gpt-4o-mini',prompt:independentPrompt},{name:'新提示词 / gpt-4.1',model:'gpt-4.1',prompt:independentPrompt},{name:'新提示词 / gpt-5.4',model:'gpt-5.4',prompt:independentPrompt}];
const results=await Promise.all(cases.flatMap(c=>variants.map(async variant=>{
 const start=Date.now();
 try {const raw=await ai.request({...connection,model:variant.model},variant.prompt,c.payload,true,AbortSignal.timeout(45000)); return {case:c.name,variant:variant.name,ms:Date.now()-start,output:JSON.parse(raw)};}
 catch(e){return {case:c.name,variant:variant.name,ms:Date.now()-start,error:e instanceof Error?e.message:'failed'};}
})));
writeFileSync('artifacts/model-comparison-refined.json',JSON.stringify({note:'仅虚构资料，第三方转发模型标识无法独立验证底层权重。单次比较不是统计评测。',cases,results},null,2));
console.log(JSON.stringify(results,null,2));
