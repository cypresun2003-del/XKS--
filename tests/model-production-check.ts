import {DatabaseSync} from 'node:sqlite';import {readFileSync,writeFileSync} from 'node:fs';import {CloudAI} from '../server/ai';
const db=new DatabaseSync('data/zhujian.sqlite',{readOnly:true});const connection=JSON.parse((db.prepare("SELECT data FROM settings WHERE key='connection'").get() as {data:string}).data);db.close();
const cases=JSON.parse(readFileSync('artifacts/model-comparison-refined.json','utf8')).cases;
const ai=new CloudAI();const outputs=[];
for(const item of cases){ const start=Date.now();const result=await ai.analyze({...connection,model:'gpt-5.4'},{independent:item.payload,risk:null});outputs.push({case:item.name,ms:Date.now()-start,result}); console.log(item.name,result.perspectives.map(p=>({title:p.title,length:p.plan.length,plan:p.plan})));}
const review=await ai.review({...connection,model:'gpt-5.4'},{认为有帮助的角度:'先核实公开课必要功能。',记录含义:'这仅表示有帮助，不代表采用。',我的实际反馈:'我们实际维持原有范围，演示按时完成，没有采用新增功能。',当前可提出更新建议的员工:[]});if(review.suggestions.length)throw Error('Invented employees');writeFileSync('artifacts/model-production-check.json',JSON.stringify({outputs,review},null,2));console.log('Production parser and review passed');
