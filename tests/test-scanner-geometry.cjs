// Run: node tests/test-scanner-geometry.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname,'../js/scanner.js'),'utf8');
const context = {window:{},console};
vm.runInNewContext(source,context);
const scanner=context.window.GradeDockScanner;
const squares=[
  {x:100,y:110,side:18,area:300,fill:0.93},
  {x:770,y:125,side:18,area:310,fill:0.94},
  {x:75,y:865,side:18,area:300,fill:0.94},
  {x:800,y:850,side:18,area:305,fill:0.94},
  {x:400,y:400,side:3,area:6,fill:0.98},
  {x:600,y:320,side:7,area:49,fill:0.70}
];
const ordered=scanner._chooseMarkerQuad(squares,900,1000);
assert(ordered, 'four squares should form a valid page');
for(let i=0;i<4;i++)assert(Math.hypot(ordered[i].x-squares[i].x,ordered[i].y-squares[i].y)<2, 'corner order must be TL,TR,BL,BR');
const dst=[[52,52],[948,52],[52,1362],[948,1362]];
const src=ordered.map(p=>[p.x,p.y]);
const H=scanner.solveHomography(dst,src);
for(let i=0;i<4;i++){
 const p=scanner.map(H,...dst[i]);
 assert(Math.hypot(p.x-src[i][0],p.y-src[i][1])<0.001, 'perspective homography must map markers');
}
assert.equal(scanner._chooseMarkerQuad([{x:2,y:3,side:8,area:64,fill:1}],900,1000),null);
console.log('PASS: marker geometry, ordering, outliers, and homography');
