const script = String.raw`
let token='', snapshot;
const $=id=>document.getElementById(id);
async function api(path,method='GET',body){
 const response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});
 const result=await response.json();if(!response.ok)throw new Error(result.code||'Request unavailable');return result;
}
function show(result){$('output').textContent=JSON.stringify(result,null,2);}
async function load(){
 snapshot=await api('/owner/state');$('login').hidden=true;$('workspace').hidden=false;
 $('mode').textContent=snapshot.capabilities.evidence==='simulated'?'Simulation · no real funds move':'Testnet · check ledger evidence';
 $('profile').value=snapshot.policy.profile;$('version').textContent='Policy v'+snapshot.version;
 $('pause').textContent=snapshot.policy.enabled?'Stop everything':'Resume';
 $('pause').className=snapshot.policy.enabled?'danger':'primary';
 $('bridge').checked=snapshot.policy.plugins.bridge;$('automation').checked=snapshot.policy.plugins.automation;
 $('editor').value=JSON.stringify(snapshot.policy,null,2);
 const options=$('target');options.replaceChildren();
 for(const g of snapshot.policy.grants){const o=document.createElement('option');o.value=JSON.stringify({action:g.action,targetId:g.targetId});o.textContent=g.label+' · '+g.action;options.append(o);}
 const flows=$('flow');flows.replaceChildren();for(const f of snapshot.policy.flows){const o=document.createElement('option');o.value=f.id;o.textContent=f.label;flows.append(o);}
 const pend=snapshot.proposals.filter(p=>p.status==='pending');$('pendingcount').textContent=(pend.length?pend.length+' waiting':'All clear');$('moxa-ask').hidden=!pend.length;$('moxa-paid').hidden=!!pend.length||!snapshot.policy.enabled;$('moxa-sleep').hidden=snapshot.policy.enabled||!!pend.length;$('stopped').hidden=snapshot.policy.enabled;
 const plist=$('proposals');plist.replaceChildren();
 if(!pend.length){const e=document.createElement('p');e.className='muted';e.textContent='Nothing waiting. When the agent proposes a payee, payment or standing limit, it appears here.';plist.append(e);}
 for(const p of pend){const box=document.createElement('div');box.className='proposal';const t=document.createElement('strong');t.textContent=p.kind.toUpperCase()+' · '+p.summary;box.append(t);
  if(p.data.note){const n=document.createElement('div');n.className='muted';n.textContent='Agent note (untrusted): '+p.data.note;box.append(n);}
  const r=document.createElement('div');r.className='row';const ok=document.createElement('button');ok.className='primary';ok.textContent='Confirm';ok.onclick=()=>run(async()=>{show(await api('/owner/proposals/confirm','POST',{proposalId:p.id}));await load();});
  const no=document.createElement('button');no.textContent='Reject';no.onclick=()=>run(async()=>{show(await api('/owner/proposals/reject','POST',{proposalId:p.id}));await load();});r.append(ok,no);box.append(r);plist.append(box);}
 const pt=$('payees');pt.replaceChildren();
 for(const p of snapshot.payees){const row=document.createElement('tr');for(const v of [p.name,p.address.slice(0,10)+'…',p.mandate?p.mandate.cap+' / '+p.mandate.period:'asks every time',p.mandate?p.mandate.spentThisPeriod:'—',p.mandate?p.mandate.remaining:'—']){const c=document.createElement('td');c.textContent=v;row.append(c);}pt.append(row);}
 const al=$('agentlist');al.replaceChildren();
 for(const a of snapshot.agents){const row=document.createElement('div');row.className='arow';const t=document.createElement('strong');t.textContent=a.name;
  const tag=document.createElement('span');tag.className='tag'+(a.revoked?' off':a.locked?' lock':'');tag.textContent=a.revoked?'revoked':a.locked?'locked':a.tools.length+' tools';t.append(tag);
  const m=document.createElement('p');m.className='muted';m.textContent=(a.description||'')+(a.description?' · ':'')+a.strikes+' strike(s) · last active '+(a.lastActive?a.lastActive.slice(11,16)+' UTC':'never');
  const acts=document.createElement('div');acts.className='acts';
  if(a.locked&&!a.revoked){const u=document.createElement('button');u.className='primary';u.textContent='Unlock';u.onclick=()=>run(async()=>{show(await api('/owner/agent/unlock','POST',{agentId:a.id}));await load();});acts.append(u);}
  if(!a.builtIn&&!a.revoked){const r=document.createElement('button');r.textContent='Revoke key';r.onclick=()=>run(async()=>{show(await api('/owner/agents/revoke','POST',{agentId:a.id}));await load();});acts.append(r);}
  row.append(t,acts,m);al.append(row);}
 if(!$('toolpick').childElementCount){const groups=[['Read','get_instructions get_capabilities get_policy list_payees list_proposals get_audit_log get_transfer_status'],['Ask the owner','propose_payee propose_payment propose_mandate'],['Pay','pay_payee pay'],['Buy (x402)','purchase_resource reconcile_purchase read_purchased_resource'],['Checks','policy_check compliance_check'],['Automation','run_flow bridge_quote']];
  for(const [g,names] of groups){const h=document.createElement('p');h.className='grp';h.textContent=g;const c=document.createElement('div');c.className='chips';
   for(const n of names.split(' ')){const l=document.createElement('label');l.className='chip';const i=document.createElement('input');i.type='checkbox';i.value=n;l.append(i,document.createTextNode(n));c.append(l);}
   $('toolpick').append(h,c);}applyTpl();}
 const sec=snapshot.agentSecurity;$('trust').textContent=sec.locked?'LOCKED · '+(sec.reason||''):'Trusted · '+sec.strikes.length+' recent strike(s) of 5';$('trust').className=sec.locked?'mode':'badge';$('unlock').hidden=!sec.locked;$('moxa-stop').hidden=!sec.locked;
 $('binding').textContent=snapshot.instructions.bindingRules;if(document.activeElement!==$('business'))$('business').value=snapshot.instructions.businessInstructions;
 $('chain').textContent=snapshot.audit.count+' events · chain verified';$('head').textContent=snapshot.audit.head;
 const rows=$('events');rows.replaceChildren();
 for(const e of snapshot.entries.slice().reverse()){
  const row=document.createElement('tr');for(const value of [String(e.seq),e.event,e.targetId?e.targetId.slice(0,14):'—',e.code]){const cell=document.createElement('td');cell.textContent=value;row.append(cell);}rows.append(row);
 }
}
async function update(policy){await api('/owner/policy','PUT',{expectedVersion:snapshot.version,policy});await load();}
async function run(fn){try{await fn();}catch(e){show({error:e.message});}}
$('connect').onclick=()=>run(async()=>{token=$('token').value.trim();$('token').value='';await load();});
$('token').onkeydown=e=>{if(e.key==='Enter')$('connect').click();};
$('pause').onclick=()=>run(()=>update({...snapshot.policy,enabled:!snapshot.policy.enabled}));
for(const id of ['bridge','automation'])$(id).onchange=()=>run(()=>update({...snapshot.policy,plugins:{...snapshot.policy.plugins,[id]:$(id).checked}}));
$('profile').onchange=()=>run(()=>update({...snapshot.policy,profile:$('profile').value}));
$('refresh').onclick=()=>run(load);
$('preflight').onclick=()=>run(async()=>{show(await api('/tools/compliance_check','POST',JSON.parse($('target').value)));await load();});
$('execute').onclick=()=>run(async()=>{const t=JSON.parse($('target').value);const map={pay:['pay',{intentId:t.targetId}],purchase:['purchase_resource',{resourceId:t.targetId}],bridge:['bridge_quote',{routeId:t.targetId}]};const [name,body]=map[t.action];show(await api('/tools/'+name,'POST',body));await load();});
$('runflow').onclick=()=>run(async()=>{show(await api('/tools/run_flow','POST',{flowId:$('flow').value}));await load();});
$('save').onclick=()=>run(()=>update(JSON.parse($('editor').value)));
$('audit').onclick=()=>run(()=>api('/tools/get_audit_log','POST',{}).then(show));
$('reconcile').onclick=()=>run(()=>api('/tools/reconcile_purchase','POST',{purchaseId:$('purchaseid').value.trim()}).then(show));
$('content').onclick=()=>run(()=>api('/tools/read_purchased_resource','POST',{purchaseId:$('purchaseid').value.trim()}).then(show));
$('unlock').onclick=()=>run(async()=>{show(await api('/owner/agent/unlock','POST',{}));await load();});
const TPL={ap:{name:'AP Clerk',role:'Pays approved suppliers inside their limits',inst:'Only pay suppliers already in the payee list. Repeat the wallet address before any new payee.',tools:'get_instructions get_capabilities list_payees list_proposals get_audit_log propose_payee propose_payment propose_mandate pay_payee'},
 research:{name:'Research buyer',role:'Buys approved articles and data per use',inst:'Buy only registered resources. Never subscribe. Report the price before buying.',tools:'get_instructions get_capabilities get_policy list_proposals purchase_resource reconcile_purchase read_purchased_resource'},
 auditor:{name:'Auditor',role:'Reads everything, changes nothing',inst:'Read and summarise. Never propose or pay.',tools:'get_instructions get_capabilities get_policy list_payees list_proposals get_audit_log get_transfer_status'},
 blank:{name:'',role:'',inst:'',tools:'get_instructions'}};
function applyTpl(){const t=TPL[$('tpl').value];$('aname').value=t.name;$('arole').value=t.role;$('ainst').value=t.inst;const on=t.tools.split(' ');for(const i of $('toolpick').querySelectorAll('input'))i.checked=on.includes(i.value);}
$('tpl').onchange=applyTpl;
$('mkagent').onclick=()=>run(async()=>{const tools=[...$('toolpick').querySelectorAll('input:checked')].map(i=>i.value);
 const r=await api('/owner/agents','POST',{name:$('aname').value.trim(),description:$('arole').value.trim(),instructions:$('ainst').value,tools});
 const k=$('newkey');k.replaceChildren();const b=document.createElement('b');b.textContent='Key for '+r.agentId+' (shown once): ';k.append(b,document.createTextNode(r.token));k.hidden=false;await load();});
$('savebiz').onclick=()=>run(async()=>{show(await api('/owner/instructions','PUT',{text:$('business').value}));await load();});
$('rundue').onclick=()=>run(async()=>{show(await api('/owner/run-due','POST',{}));await load();});
setInterval(()=>{if(token&&!$('workspace').hidden&&document.activeElement!==$('business'))load().catch(()=>{});},5000);
$('logout').onclick=()=>{token='';snapshot=undefined;$('workspace').hidden=true;$('login').hidden=false;show({});};
`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shucamoxa · Owner console</title><style>
:root{--bg:#F4F4F2;--panel:#FFFFFF;--sunk:#EEEEEB;--bd:#E2E2DE;--bds:#C9C9C4;--ink:#141414;--mut:#666662;--faint:#8E8E89;--blue:#0B5FD9;--blue2:#0849A8;--bluet:#EAF1FD;--red:#E5202E;--ok:#157A3E;--rev:#8A5A00;--revt:#FFF6E0;--blk:#B3261E;--blkt:#FCEBEA;font-family:Inter,"SF Pro Text","Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--bg);font-size:14px;-webkit-font-smoothing:antialiased}
[hidden]{display:none!important}*{box-sizing:border-box}body{margin:0;background:var(--bg)}
p{margin:0;line-height:1.5}h2{font-size:15px;font-weight:650;letter-spacing:-.01em;margin:0}
.mono{font-family:"JetBrains Mono",ui-monospace,Menlo,Consolas,monospace}
.muted{font-size:13px;color:var(--mut);line-height:1.5}
.wm{font-size:17px;font-weight:750;letter-spacing:-.03em;margin:0}.wm i{color:var(--red);font-style:normal}
button,input,select,textarea{font:inherit;font-size:13px;color:var(--ink)}
button{cursor:pointer;height:34px;padding:0 14px;border-radius:8px;border:1px solid var(--bds);background:var(--panel);font-weight:550;white-space:nowrap}
button:hover{background:var(--sunk)}
button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.primary{background:var(--blue);border-color:var(--blue);color:#fff}.primary:hover{background:var(--blue2)}
.danger{background:var(--ink);border-color:var(--ink);color:#fff;display:inline-flex;align-items:center;gap:8px}.danger::before{content:"";width:7px;height:7px;border-radius:50%;background:var(--red)}.danger:hover{background:#333}
input,select,textarea{width:100%;border:1px solid var(--bds);border-radius:8px;background:var(--panel);padding:8px 10px;min-height:34px}
textarea{font:12px/1.6 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;min-height:180px;resize:vertical}
label{display:block;font-size:12px;font-weight:550;color:var(--mut);margin:12px 0 6px}
a{color:var(--blue);text-decoration:none}a:hover{text-decoration:underline}
/* login */
#login{max-width:400px;margin:12vh auto 0;padding:32px;background:var(--panel);border:1px solid var(--bd);border-radius:14px}
#login h1{font-size:26px;letter-spacing:-.03em;margin:16px 0 6px;font-weight:750}
#login button{width:100%;margin-top:12px;height:38px}
#login .moxa svg{width:72px;height:72px}
/* app */
.top{position:sticky;top:0;z-index:5;background:rgba(244,244,242,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--bd);height:52px;display:flex;align-items:center;justify-content:space-between;padding:0 20px;gap:16px}
.top .l{display:flex;align-items:center;gap:18px}.top .r{display:flex;align-items:center;gap:8px}
#mode{font:500 11px/1 "JetBrains Mono",ui-monospace,monospace;color:var(--mut);display:inline-flex;align-items:center;gap:6px;margin:0}
#mode::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--red)}
.app{display:grid;grid-template-columns:200px 1fr;max-width:1320px;margin:0 auto}
.side{position:sticky;top:52px;align-self:start;padding:20px 12px;display:flex;flex-direction:column;gap:2px}
.side a{color:var(--ink);font-size:13px;padding:7px 10px;border-radius:6px;display:flex;justify-content:space-between}
.side a:hover{background:var(--sunk);text-decoration:none}
.side .sep{height:1px;background:var(--bd);margin:10px 10px}
.side .foot{font-size:11px;color:var(--faint);padding:0 10px;line-height:1.5}
.main{padding:24px 28px 64px;display:flex;flex-direction:column;gap:20px;min-width:0}
.pagehead h1{font-size:22px;font-weight:700;letter-spacing:-.025em;margin:0 0 4px}
.stopped{background:var(--blkt);border:1px solid #F3C9C5;color:var(--blk);border-radius:10px;padding:10px 14px;font-weight:550;font-size:13px}
.sec{background:var(--panel);border:1px solid var(--bd);border-radius:12px;scroll-margin-top:68px}
.sh{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--bd)}
.sh .t{display:flex;align-items:center;gap:10px}
.sb{padding:16px 18px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.two>.sec{margin:0}
.moxa{display:inline-flex}.moxa svg{width:30px;height:30px;display:block}
.badge,.mode{font-size:12px;font-weight:550;color:var(--ok);margin:0;display:inline-flex;align-items:center;gap:6px}
.badge::before,.mode::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.mode{color:var(--blk)}
#pendingcount{color:var(--mut)}
.proposal{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;border-top:1px solid var(--bd)}
.proposal:first-child{border-top:0}
.proposal strong{font-size:13px;font-weight:550;line-height:1.45}
.proposal .row{flex:none}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
table{width:100%;border-collapse:collapse;font-size:13px}
th{font-size:11px;font-weight:550;color:var(--faint);text-align:left;padding:0 10px 8px 0;border-bottom:1px solid var(--bd)}
td{padding:10px 10px 10px 0;border-bottom:1px solid var(--bd);font-variant-numeric:tabular-nums}
tr:last-child td{border-bottom:0}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#151515;color:#DADAD6;padding:14px;border-radius:8px;max-height:300px;overflow:auto;font:12px/1.65 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;margin:0}
#head{overflow-wrap:anywhere;font:11px "JetBrains Mono",ui-monospace,monospace;color:var(--faint);margin-top:8px}
details{margin-top:12px}summary{cursor:pointer;color:var(--blue);font-size:13px}
.toggle{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;border-top:1px solid var(--bd)}
.toggle strong{font-size:13px;font-weight:550}
input[type=checkbox]{appearance:none;width:34px;height:20px;min-height:0;padding:0;border-radius:10px;background:var(--bds);border:0;position:relative;cursor:pointer;flex:none}
input[type=checkbox]::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}
input[type=checkbox]:checked{background:var(--blue)}input[type=checkbox]:checked::after{transform:translateX(14px)}
/* agents */
.agents{display:block}
#agentlist{padding:4px 18px}
.arow{display:grid;grid-template-columns:1fr auto;gap:2px 12px;padding:12px 0;border-top:1px solid var(--bd)}
.arow:first-child{border-top:0}
.arow strong{font-size:13px;font-weight:600}.arow .muted{grid-column:1/2;font-size:12px}
.arow .acts{grid-row:1/3;grid-column:2;display:flex;gap:6px;align-items:center}
.tag{font-size:11px;font-weight:500;color:var(--faint);margin-left:8px}
.tag.lock{color:var(--blk)}.tag.off{text-decoration:line-through}
.newagent{border-top:1px solid var(--bd);padding:0 18px;background:#FAFAF8;border-radius:0 0 12px 12px;margin:0}
.newagent summary{padding:13px 0;font-weight:600;color:var(--blue);font-size:13px}
.newagent[open]{padding-bottom:18px}
.nagrid{display:grid;grid-template-columns:320px 1fr;gap:28px}
.nagrid label:first-child{margin-top:0}
.newagent h2{margin-bottom:2px}
.grp{font-size:11px;font-weight:600;color:var(--faint);margin:12px 0 2px}.grp:first-child{margin-top:0}
.chips{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 12px}
.chip{display:flex;align-items:center;gap:8px;font:12px/1.2 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;color:var(--ink);padding:5px 0;cursor:pointer;margin:0}
.chip input[type=checkbox]{appearance:auto;width:14px;height:14px;border-radius:3px;background:none;accent-color:var(--blue)}
.chip input[type=checkbox]::after{display:none}
#mkagent{margin-top:16px}
.keybox{background:#151515;color:#EDEDEA;border-radius:8px;padding:12px;font:12px/1.6 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;overflow-wrap:anywhere;margin-top:10px}
.keybox b{color:#FFC93C;font-weight:500}
footer{font-size:11px;color:var(--faint);padding:8px 2px}
@media(max-width:900px){.app{grid-template-columns:1fr}.side{display:none}.two,.nagrid{grid-template-columns:1fr}.chips{grid-template-columns:1fr 1fr}.top #mode{display:none}}
</style></head><body>
<section id="login"><div class="moxa"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="200" height="200" aria-hidden="true" aria-label="Moxa waving hello"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="67" cy="74" r="5" fill="#111111"/><circle cx="93" cy="74" r="5" fill="#111111"/><path d="M70 92 Q80 101 90 92" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M120 84 Q142 70 138 48" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M40 92 Q26 100 28 114" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></div><h1>Owner console</h1><p class="muted">Paste the owner token from your private harness folder. It stays in this tab’s memory only; the agent’s key can’t open this page.</p><label for="token">Owner token</label><input id="token" type="password" autocomplete="off" aria-label="Owner token"><button id="connect" class="primary">Open console</button><p class="muted" style="margin-top:16px"><span class="wm">shucamoxa<i>.</i></span></p></section>
<div id="workspace" hidden>
<div class="top"><div class="l"><p class="wm">shucamoxa<i>.</i></p><p id="mode"></p></div><div class="r"><a href="http://localhost:3000" target="_blank" rel="noreferrer">Open WebUI ↗</a><button id="refresh">Refresh</button><button id="logout">Lock</button><button id="pause" class="danger">Stop everything</button></div></div>
<div class="app">
<nav class="side" aria-label="Sections"><a href="#s-approvals">Approvals</a><a href="#s-agents">Agents</a><a href="#s-payees">Payees &amp; limits</a><a href="#s-rules">Rules &amp; trust</a><a href="#s-try">Try a target</a><a href="#s-activity">Activity</a><div class="sep"></div><p class="foot">Agents propose. You decide. Every call passes payees, limits, eligibility and the audit log.</p></nav>
<main class="main">
<div class="pagehead"><h1>Overview</h1><p class="muted">Approve what agents ask for, set the rules, and stop everything in one tap.</p></div>
<p id="stopped" class="stopped" hidden>Everything is paused. Agents can’t pay, buy or run schedules until you resume.</p>
<section class="sec" id="s-approvals"><div class="sh"><div class="t"><span class="moxa" id="moxa-ask" hidden><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="88" height="88" aria-hidden="true" aria-label="Moxa thinking: needs your decision"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="67" cy="74" r="5" fill="#111111"/><circle cx="93" cy="74" r="5" fill="#111111"/><path d="M72 96 Q80 92 88 96" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M120 92 Q112 104 96 104" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M128 30 Q128 18 140 18 Q152 18 152 30 Q152 38 140 42 V48" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="140" cy="58" r="3.5" fill="#E5202E"/><path d="M40 92 Q26 100 28 114" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span><span class="moxa" id="moxa-paid"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="88" height="88" aria-hidden="true" aria-label="Moxa holding a coin: paid"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="67" cy="74" r="5" fill="#111111"/><circle cx="93" cy="74" r="5" fill="#111111"/><path d="M70 92 Q80 101 90 92" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M120 92 Q130 100 124 108" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="130" cy="114" r="16" fill="#FFC93C" stroke="#111111" stroke-width="4"/><circle cx="130" cy="114" r="4" fill="#111111"/><path d="M40 92 Q26 100 28 114" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span><span class="moxa" id="moxa-sleep" hidden><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="88" height="88" aria-hidden="true" aria-label="Moxa asleep: paused by the kill switch"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M61 76 Q67 81 73 76 M87 76 Q93 81 99 76" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="80" cy="96" r="4" fill="#111111"/><path d="M126 30 h14 l-14 16 h14 M140 10 h10 l-10 11 h10" stroke="#111111" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M40 96 Q30 104 34 116 M120 96 Q130 104 126 116" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span><h2>Waiting for you</h2></div><span id="pendingcount" class="badge"></span></div><div class="sb"><div id="proposals"></div><p class="muted" style="margin-top:10px">Only this page confirms. “Yes” in a chat does nothing.</p></div></section>
<section class="sec" id="s-agents"><div class="sh"><h2>Agents</h2><p class="muted">Each agent: its own key, role and tools. Any model can sit behind a key.</p></div>
<div class="agents"><div id="agentlist"></div>
<details class="newagent"><summary>New agent</summary><div class="nagrid"><div><label for="tpl">Template</label><select id="tpl"><option value="ap">Accounts payable clerk</option><option value="research">Research buyer (x402)</option><option value="auditor">Read-only auditor</option><option value="blank">Blank</option></select>
<label for="aname">Name</label><input id="aname"><label for="arole">Role</label><input id="arole" placeholder="What this agent is for">
<label for="ainst">Instructions</label><textarea id="ainst" style="min-height:96px" spellcheck="false"></textarea></div>
<div><div id="toolpick"></div><button id="mkagent" class="primary">Create agent and key</button><p id="newkey" class="keybox" hidden></p></div></div></details></div></section>
<section class="sec" id="s-payees"><div class="sh"><h2>Payees &amp; limits</h2><button id="rundue">Run due payments</button></div><div class="sb"><table><thead><tr><th>Payee</th><th>Address</th><th>Limit</th><th>Spent</th><th>Left</th></tr></thead><tbody id="payees"></tbody></table><p class="muted" style="margin-top:12px">Inside a limit the agent pays without asking. Over it, or with no limit, it asks you. Due scheduled payments run every 30 seconds.</p></div></section>
<div class="two" id="s-rules">
<section class="sec"><div class="sh"><div class="t"><span class="moxa" id="moxa-stop" hidden><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="88" height="88" aria-hidden="true" aria-label="Moxa holding up a hand: blocked"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M60 66 L72 70 M100 66 L88 70" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="67" cy="74" r="5" fill="#111111"/><circle cx="93" cy="74" r="5" fill="#111111"/><path d="M70 96 H90" stroke="#111111" stroke-width="4" stroke-linecap="round"/><path d="M120 84 L136 60" stroke="#111111" stroke-width="4" stroke-linecap="round"/><rect x="126" y="34" width="24" height="28" rx="10" fill="#FFFFFF" stroke="#111111" stroke-width="4"/><path d="M40 92 Q26 100 28 114" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span><h2>Trust &amp; instructions</h2></div><span id="trust"></span></div><div class="sb"><p class="muted">Injection phrases, made-up IDs, broken calls and probes of these controls are strikes. Five in ten minutes locks the default agent until you unlock it.</p><button id="unlock" class="primary" hidden style="margin-top:10px">Unlock default agent</button>
<details><summary>Fixed rules every model reads</summary><pre id="binding" style="margin-top:8px"></pre></details>
<label for="business">Business instructions</label><textarea id="business" style="min-height:96px" spellcheck="false" placeholder="Cape Town importer. Suppliers paid monthly in RLUSD. Always repeat the wallet address."></textarea><button id="savebiz" style="margin-top:10px">Save instructions</button></div></section>
<section class="sec"><div class="sh"><h2>Profile &amp; plugins</h2><span id="version" class="muted mono"></span></div><div class="sb"><label for="profile" style="margin-top:0">Business profile</label><select id="profile"><option value="importer">Importer</option><option value="university">University</option><option value="retailer">Retailer</option><option value="custom">Custom</option></select><p class="muted" style="margin:8px 0 6px">A label for this installation. Payees, categories and evidence decide what’s allowed.</p>
<div class="toggle"><div><strong>Automated flows</strong><p class="muted">Owner-made presets; every step passes the same gates.</p></div><input id="automation" type="checkbox" aria-label="Automated flows"></div><div class="toggle"><div><strong>Bridge routing</strong><p class="muted">Quote only; simulated in the demo.</p></div><input id="bridge" type="checkbox" aria-label="Bridge routing"></div></div></section>
</div>
<section class="sec" id="s-try"><div class="sh"><h2>Try a target</h2><p class="muted">Allowed, over cap, expired, article purchase, bridge quote.</p></div><div class="sb"><div class="row" style="flex-wrap:nowrap"><select id="target"></select><button id="preflight">Check</button><button id="execute" class="primary">Run</button></div>
<div class="row" style="flex-wrap:nowrap;margin-top:10px"><select id="flow"></select><button id="runflow">Run workflow once</button></div>
<div class="row" style="flex-wrap:nowrap;margin-top:10px"><input id="purchaseid" placeholder="Purchase ID from a result" aria-label="Purchase ID"><button id="reconcile">Reconcile</button><button id="content">Read</button></div>
<pre id="output" style="margin-top:14px">Pick something to run.</pre></div></section>
<section class="sec" id="s-activity"><div class="sh"><h2>Activity</h2><div class="row"><span id="chain" class="badge"></span><button id="audit">Verify / export</button></div></div><div class="sb"><table><thead><tr><th>#</th><th>Event</th><th>Target</th><th>Code</th></tr></thead><tbody id="events"></tbody></table><div id="head"></div><details><summary>Edit raw policy (advanced)</summary><textarea id="editor" spellcheck="false" aria-label="Owner policy JSON" style="margin-top:8px"></textarea><button id="save" style="margin-top:8px">Save policy</button></details></div></section>
<footer>Testnet prototype · no legal, regulatory or security certification implied. Keep the audit head elsewhere to spot tampering.</footer>
</main></div></div>
<script>${script}</script></body></html>`;
export const dashboard = { html, script };
