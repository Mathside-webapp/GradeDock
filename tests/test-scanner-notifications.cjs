const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const src = fs.readFileSync(require('node:path').join(__dirname, '../js/app.js'), 'utf8');
const part = src.slice(src.indexOf('  function setCameraAssistStatus('), src.indexOf('  function switchScanMode('));

function makeClassList(initial = []) {
  const values = new Set(initial);
  return {
    add: (...names) => names.forEach(name => values.add(name)),
    remove: (...names) => names.forEach(name => values.delete(name)),
    contains: name => values.has(name)
  };
}
const label = {textContent: ''};
const box = {classList: makeClassList(['hidden']), style: {values: {}, setProperty(key, value) { this.values[key] = value; }},
  querySelector: () => label, offsetWidth: 123};
const title = {textContent: ''}, text = {textContent: ''}, icon = {textContent: ''};
const nodes = { '#cameraScanAssist': box, '#cameraScanAssistTitle': title, '#cameraScanAssistText': text, '#cameraScanAssistIcon': icon, '#cameraVideo': {videoWidth: 1000} };
let nextId = 1;
let jobs = new Map();
const timeout = (fn, ms) => {const id=nextId++;jobs.set(id,{fn,ms});return id};
const context = {
  cameraAssistTimer: null, cameraAssistBusy: false, cameraAssistLastState: '',
  cameraAssistLastStatusKey: '',cameraAssistHideTimer:null,cameraAssistPendingKey:'',cameraAssistPendingCount:0,
  navigator: {vibrate: () => {}}, window: {GradeDockScanner: {stream:{},inspectFrame:()=>({state:'ready', title:'Good to scan', text:'Ready'})}},
  $: selector=>nodes[selector],setTimeout:timeout,clearTimeout:id=>jobs.delete(id),
  setInterval:timeout,clearInterval:id=>jobs.delete(id)
};
vm.createContext(context);
vm.runInContext(part,context);
function runThreeSeconds() {for(const [id,job] of [...jobs]) if(job.ms===3000){jobs.delete(id);job.fn();}}
context.setCameraAssistStatus({state:'warn',title:'Not ready to scan',text:'Corners missing'});
assert.equal(box.classList.contains('hidden'), false);
assert.equal(box.classList.contains('state-warn'), true);
runThreeSeconds();
assert.equal(box.classList.contains('hidden'), true,'warning hides after 3 seconds');
context.setCameraAssistStatus({state:'warn',title:'Not ready to scan',text:'Corners missing'});
assert.equal(box.classList.contains('hidden'), true,'unchanged warning must not reappear');
context.setCameraAssistStatus({state:'ready',title:'Good to scan',text:'Ready'});
assert.equal(box.classList.contains('hidden'), false,'a new condition is shown');
runThreeSeconds();
assert.equal(box.classList.contains('hidden'), true,'green banner also hides after 3 seconds');
context.stopCameraAssist();
context.startCameraAssist();
context.updateCameraAssist();
context.updateCameraAssist();
assert.equal(box.classList.contains('state-ready'), true,'ready state remains detectable');
context.stopCameraAssist();
assert.equal(box.classList.contains('hidden'), true,'stopping camera hides the notice');
console.log('PASS: red/green notices expire after three seconds; unchanged conditions do not repeat.');
