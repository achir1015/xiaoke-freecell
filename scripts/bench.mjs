import { Game, msDeal, cardName } from '../src/renderer/js/rules.js';
import { Solver, verify } from '../src/renderer/js/solver.js';
const d1 = msDeal(1);
const rows=[];for(let r=0;r<7;r++)rows.push(d1.map(c=>c[r]!==undefined?cardName(c[r]):'').join(' '));
console.log(rows.join('\n'));
const prof = process.argv[2]||'fast', N=Number(process.argv[3]||100);
const s = new Solver();
let tot=0, fails=[], len=0, maxms=0, nodes=0;
const t0=Date.now();
for (let no=1; no<=N; no++){
  const t=Date.now();
  const r = s.solve(new Game(no), process.env.G ? { w: 1, g: Number(process.env.G), nodes: 200000 } : prof);
  const ms=Date.now()-t; maxms=Math.max(maxms,ms);
  if(!r){fails.push(no);continue;}
  if(!verify(no,r.moves)) { console.log('VERIFY FAIL', no); }
  len+=r.moves.length; nodes+=r.nodes; tot++;
}
console.log(prof, 'solved',tot,'/',N,'avg len',(len/tot).toFixed(1),'avg nodes',(nodes/tot).toFixed(0),'total ms',Date.now()-t0,'max ms',maxms,'fails',fails.join(','));
