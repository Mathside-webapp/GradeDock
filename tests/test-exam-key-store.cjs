const fs = require('fs');
const vm = require('vm');
const assert = require('node:assert/strict');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname, '../js/store.js'),'utf8');
function createStore(options = {}) {
  const calls=[];
  const mock={
    auth: {getSession: async () => ({data:{session:{user:{id:'teacher-123'}}}})},
    from(table) {
      const query = {
        insert(payload) {
          calls.push({op:'insert', table, payload});
          if(table==='exam_keys') return Promise.resolve({error: options.keyInsertError || null});
          return { select(){ return { single: async () => ({data:{id:'exam-abc',title:'Quarterly Exam',question_count:5, choice_count:4},error:null}) }; } };
        },
        upsert(payload, config) { calls.push({op:'upsert', table, payload, config}); return Promise.resolve({error: options.keyUpsertError||null}); },
        delete() { calls.push({op:'delete',table}); return {eq(column, value) {calls.push({op:'eq',column,value});return {gt(column, value){calls.push({op:'gt',column,value});return Promise.resolve({error:options.deleteError||null})}}}}; }
      };
      return query;
    }
  };
  const window={ GRADEDOCK_CONFIG:{supabaseUrl:'test',supabasePublishableKey:'key'}, supabase:{createClient(){return mock}}};
  vm.runInNewContext(script, {window, console});
  return {Store:window.GradeDockStore,calls};
}
(async()=>{
  let x=createStore();
  let msg=x.Store.friendlyError({code:'PGRST205',message:"Could not find the table 'public.exam_keys' in the schema cache"});
  assert.match(msg, /exam_keys/);
  assert.match(msg, /05_REPAIR_EXAM_KEYS_EXISTING/);
  console.log('PASS: table-specific schema-cache error');
  x=createStore();
  const exam=await x.Store.createExam({title:'Quarterly Exam',question_count:5,choice_count:4},['A','B','C','D','A']);
  assert.equal(exam.id,'exam-abc');
  assert.equal(x.calls.filter(c=>c.op==='insert').length,2);
  console.log('PASS: create exam plus complete key');
  x=createStore({keyInsertError:{code:'PGRST205',message:"Could not find the table 'public.exam_keys' in the schema cache"}});
  let thrown;
  try { await x.Store.createExam({title:'Quarterly Exam',question_count:5,choice_count:4},['A','B','C','D','A']); } catch(e){thrown=e;}
  assert.equal(thrown.createdExam.id,'exam-abc');
  assert.match(thrown.message,/Exam created, but its answer key was not saved/);
  assert.equal(x.calls.filter(c=>c.op==='delete').length,0);
  console.log('PASS: partial save reports exam ID and preserves exam');
  x=createStore({keyUpsertError:{code:'42501',message:'Permission denied'}});
  await assert.rejects(()=>x.Store.replaceExamKey('exam-abc',['A','B','C','D','A']));
  assert.equal(x.calls.filter(c=>c.op==='delete').length,0);
  console.log('PASS: failed key update never deletes existing key');
  x=createStore();
  await x.Store.replaceExamKey('exam-abc',['A','B','C','D','A']);
  assert.equal(x.calls.filter(c=>c.op==='upsert').length,1);
  assert.equal(x.calls.filter(c=>c.op==='delete').length,1);
  assert.equal(x.calls.filter(c=>c.op==='gt').length,1);
  console.log('PASS: successful update upserts and prunes trailing answers');
})().catch(e=>{console.error(e);process.exit(1)});
