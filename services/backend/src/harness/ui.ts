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
 $('mode').textContent=snapshot.capabilities.evidence==='simulated'?'SIMULATION · NO REAL FUNDS MOVE':'TESTNET · CHECK LEDGER EVIDENCE';
 $('profile').value=snapshot.policy.profile;$('version').textContent='Policy v'+snapshot.version;
 $('pause').textContent=snapshot.policy.enabled?'Stop everything':'Resume';
 $('pause').className=snapshot.policy.enabled?'danger':'primary';
 $('bridge').checked=snapshot.policy.plugins.bridge;$('automation').checked=snapshot.policy.plugins.automation;
 $('editor').value=JSON.stringify(snapshot.policy,null,2);
 const options=$('target');options.replaceChildren();
 for(const g of snapshot.policy.grants){const o=document.createElement('option');o.value=JSON.stringify({action:g.action,targetId:g.targetId});o.textContent=g.label+' · '+g.action;options.append(o);}
 const flows=$('flow');flows.replaceChildren();for(const f of snapshot.policy.flows){const o=document.createElement('option');o.value=f.id;o.textContent=f.label;flows.append(o);}
 const pend=snapshot.proposals.filter(p=>p.status==='pending');$('pendingcount').textContent=pend.length+' WAITING';$('moxa-ask').hidden=!pend.length;$('moxa-paid').hidden=!!pend.length||!snapshot.policy.enabled;$('moxa-sleep').hidden=snapshot.policy.enabled||!!pend.length;$('stopped').hidden=snapshot.policy.enabled;
 const plist=$('proposals');plist.replaceChildren();
 if(!pend.length){const e=document.createElement('p');e.className='muted';e.textContent='Nothing waiting. When the agent proposes a payee, payment or standing limit, it appears here.';plist.append(e);}
 for(const p of pend){const box=document.createElement('div');box.className='proposal';const t=document.createElement('strong');t.textContent=p.kind.toUpperCase()+' · '+p.summary;box.append(t);
  if(p.data.note){const n=document.createElement('div');n.className='muted';n.textContent='Agent note (untrusted): '+p.data.note;box.append(n);}
  const r=document.createElement('div');r.className='row';const ok=document.createElement('button');ok.className='primary';ok.textContent='Confirm';ok.onclick=()=>run(async()=>{show(await api('/owner/proposals/confirm','POST',{proposalId:p.id}));await load();});
  const no=document.createElement('button');no.textContent='Reject';no.onclick=()=>run(async()=>{show(await api('/owner/proposals/reject','POST',{proposalId:p.id}));await load();});r.append(ok,no);box.append(r);plist.append(box);}
 const pt=$('payees');pt.replaceChildren();
 for(const p of snapshot.payees){const row=document.createElement('tr');for(const v of [p.name,p.address.slice(0,10)+'…',p.mandate?p.mandate.cap+' / '+p.mandate.period:'asks every time',p.mandate?p.mandate.spentThisPeriod:'—',p.mandate?p.mandate.remaining:'—']){const c=document.createElement('td');c.textContent=v;row.append(c);}pt.append(row);}
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
$('savebiz').onclick=()=>run(async()=>{show(await api('/owner/instructions','PUT',{text:$('business').value}));await load();});
$('rundue').onclick=()=>run(async()=>{show(await api('/owner/run-due','POST',{}));await load();});
setInterval(()=>{if(token&&!$('workspace').hidden&&document.activeElement!==$('business'))load().catch(()=>{});},5000);
$('logout').onclick=()=>{token='';snapshot=undefined;$('workspace').hidden=true;$('login').hidden=false;show({});};
`;
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shucamoxa · Owner console</title><style>
:root{--s0:#F2F2F0;--s1:#FFFFFF;--s2:#E6E6E3;--bd:#D6D6D2;--bds:#8C8C88;--ink:#111111;--mut:#5C5C5A;--blue:#0B5FD9;--blue2:#0849A8;--red:#E5202E;--redt:#FDE4E5;--ok:#157A3E;--okt:#E2F5E8;--rev:#8A5A00;--revt:#FFF1D1;--blk:#C4161C;--blkt:#FDE4E3;--dot:#CFCFCB;font-family:Inter,"SF Pro Text","Segoe UI",system-ui,sans-serif;color:var(--ink);background:var(--s0);font-size:16px}
[hidden]{display:none!important}*{box-sizing:border-box}body{margin:0;background:var(--s0)}
.dm{font-family:"Doto",ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace;font-weight:800;letter-spacing:.14em;text-transform:uppercase}
header{position:sticky;top:0;z-index:2;background:rgba(242,242,240,.92);backdrop-filter:blur(12px);padding:16px 5vw;display:flex;justify-content:space-between;align-items:center;gap:16px}
.wm{font-size:24px;font-weight:800;letter-spacing:-.03em;margin:0}.wm i{color:var(--red);font-style:normal}
main{max-width:1180px;margin:auto;padding:0 5vw 64px}
.hero{padding:64px 0 16px;gap:20px}.hero h1{font-size:44px;line-height:1.05;letter-spacing:-.035em;margin:12px 0 6px;font-weight:800}.hero p{margin:0;color:var(--mut);font-size:16px;line-height:1.5}
.eyebrow{font-size:12px;color:var(--red);margin:0}
h2{font-size:22px;letter-spacing:-.02em;margin:0;font-weight:800}
p{line-height:1.55}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:8px}
.card{background:var(--s1);border-radius:28px;padding:24px;box-shadow:0 1px 2px rgba(17,17,17,.04),0 8px 24px rgba(17,17,17,.06);display:flex;flex-direction:column;gap:14px}
.wide{grid-column:1/-1}
.row{display:flex;gap:12px;align-items:center;flex-wrap:wrap}.between{justify-content:space-between}
.muted{font-size:13px;color:var(--mut);margin:0;line-height:1.5}
.badge{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;border-radius:999px;padding:6px 12px;background:var(--okt);color:var(--ok);margin:0}
.badge::before{content:"";width:7px;height:7px;border-radius:99px;background:currentColor}
.mode{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:700;border-radius:999px;padding:6px 12px;background:var(--blkt);color:var(--blk);margin:0}
#mode{background:#111;color:#F5F5F3;font-size:11px}#mode::before{content:"";width:8px;height:8px;border-radius:99px;background:var(--red)}
#pendingcount{background:var(--revt);color:var(--rev)}
button,input,select,textarea{font:inherit;border-radius:18px;border:1.5px solid var(--bd);background:var(--s1);color:var(--ink);padding:12px 18px;min-height:48px}
button{cursor:pointer;font-weight:700;background:var(--s2);border-color:transparent}
button:hover{background:var(--bd)}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible{outline:2px solid var(--blue);outline-offset:2px}
.primary{background:var(--blue);color:#fff;border-color:var(--blue)}.primary:hover{background:var(--blue2)}
.danger{background:#111;color:#fff;border-color:#111;display:inline-flex;align-items:center;gap:10px}.danger::before{content:"";width:10px;height:10px;border-radius:99px;background:var(--red)}.danger:hover{background:#333}
select,textarea,input[type=password]{width:100%}
input[type=checkbox]{appearance:none;width:52px;height:32px;min-height:0;padding:0;border-radius:999px;background:var(--s2);border:1.5px solid var(--bds);position:relative;cursor:pointer;flex:none}
input[type=checkbox]::after{content:"";position:absolute;top:3px;left:3px;width:23px;height:23px;border-radius:99px;background:var(--mut);transition:transform .15s}
input[type=checkbox]:checked{background:var(--blue);border-color:var(--blue)}input[type=checkbox]:checked::after{transform:translateX(20px);background:#fff}
label{font-size:13px;font-weight:600;color:var(--mut)}
.toggle{display:flex;justify-content:space-between;align-items:center;gap:16px;border-top:1px solid var(--bd);padding:14px 0 2px}.toggle strong{font-size:15px}
.proposal{background:var(--revt);border-radius:22px;padding:18px;display:grid;gap:12px}.proposal strong{font-size:15px;line-height:1.45}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#111;color:#E6E6E3;padding:18px;border-radius:22px;max-height:340px;overflow:auto;font:12px/1.7 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;margin:0}
textarea{font:13px/1.6 "JetBrains Mono",ui-monospace,Menlo,Consolas,monospace;min-height:240px;resize:vertical}
table{width:100%;border-collapse:collapse;font-size:13px}td,th{padding:12px 6px;text-align:left;border-bottom:1px solid var(--bd)}th{font-size:11px;color:var(--mut);letter-spacing:.08em;text-transform:uppercase}
#head{overflow-wrap:anywhere;font:11px "JetBrains Mono",ui-monospace,monospace;color:var(--mut)}
#login{max-width:520px;margin:56px auto 0;gap:16px;padding:32px}
#login h1{font-size:44px;line-height:1.02;letter-spacing:-.035em;margin:0;font-weight:800}
.moxa{display:flex;align-items:center;gap:14px}.moxa p{margin:0}.moxa svg{display:block}
.dotgrid{background-image:radial-gradient(var(--dot) 2px,transparent 2.5px);background-size:16px 16px;border-radius:22px;display:flex;justify-content:center;padding:8px 0}
.stopped{background:var(--redt);border-radius:22px;padding:14px 18px;font-weight:700;color:var(--blk);margin:0 0 8px}
.cores{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:12px 0}
.core{background:var(--s1);border-radius:22px;padding:16px;display:flex;flex-direction:column;gap:4px}.core strong{font-size:15px}.core span{font-size:12px;color:var(--mut)}.core .dm{font-size:11px;color:var(--red)}
details{margin-top:4px}summary{cursor:pointer;color:var(--blue);font-weight:600;font-size:14px}
a{color:var(--blue);font-weight:600;text-decoration:none}
footer{padding:28px 0;color:var(--mut);font-size:12px}
@media(max-width:760px){.grid{grid-template-columns:1fr}.cores{grid-template-columns:1fr 1fr}.hero{padding-top:32px}.hero h1{font-size:34px}}
</style></head><body>
<header><p class="wm">shucamoxa<i>.</i></p><a href="http://localhost:3000" target="_blank" rel="noreferrer">Open WebUI ↗</a></header><main>
<section id="login" class="card"><div class="dotgrid"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="200" height="200" aria-hidden="true" aria-label="Moxa waving hello"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="67" cy="74" r="5" fill="#111111"/><circle cx="93" cy="74" r="5" fill="#111111"/><path d="M70 92 Q80 101 90 92" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M120 84 Q142 70 138 48" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M40 92 Q26 100 28 114" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></div><p class="dm eyebrow">Owner access</p><h1>Your agent.<br>Your rules.</h1><p class="muted">Paste the owner token from your private harness folder. It stays in this tab’s memory only.</p><input id="token" type="password" autocomplete="off" placeholder="Owner token" aria-label="Owner token"><button id="connect" class="primary">Open my console</button><p class="muted">The agent’s token can’t open this page. Every action still passes payees, limits, eligibility and the audit log.</p></section>
<div id="workspace" hidden>
<div class="hero row between" style="align-items:flex-end"><div><p id="mode" class="mode dm"></p><h1>Owner console</h1><p>Approve what Moxa asks for, set the rules, stop everything with one tap.</p></div><div class="row"><button id="refresh">Refresh</button><button id="logout">Lock</button><button id="pause" class="danger">Stop everything</button></div></div>
<p id="stopped" class="stopped" hidden>Everything is paused. Moxa can’t pay, buy or run schedules until you resume.</p>
<div class="cores">${[['Payment','Stored intent only'],['Policy','Independent checks'],['Eligibility','Owner evidence + expiry'],['Audit','Hash-linked, always on']].map(([t,d],i)=>`<div class="core"><span class="dm">0${i+1}</span><strong>${t}</strong><span>${d}</span></div>`).join('')}</div>
<div class="grid">
<section class="card wide"><div class="row between"><div class="moxa"><span id="moxa-ask" hidden><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="88" height="88" aria-hidden="true" aria-label="Moxa thinking: needs your decision"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="67" cy="74" r="5" fill="#111111"/><circle cx="93" cy="74" r="5" fill="#111111"/><path d="M72 96 Q80 92 88 96" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M120 92 Q112 104 96 104" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M128 30 Q128 18 140 18 Q152 18 152 30 Q152 38 140 42 V48" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="140" cy="58" r="3.5" fill="#E5202E"/><path d="M40 92 Q26 100 28 114" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span><span id="moxa-paid"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="88" height="88" aria-hidden="true" aria-label="Moxa holding a coin: paid"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><circle cx="67" cy="74" r="5" fill="#111111"/><circle cx="93" cy="74" r="5" fill="#111111"/><path d="M70 92 Q80 101 90 92" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><path d="M120 92 Q130 100 124 108" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="130" cy="114" r="16" fill="#FFC93C" stroke="#111111" stroke-width="4"/><circle cx="130" cy="114" r="4" fill="#111111"/><path d="M40 92 Q26 100 28 114" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span><span id="moxa-sleep" hidden><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="88" height="88" aria-hidden="true" aria-label="Moxa asleep: paused by the kill switch"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M61 76 Q67 81 73 76 M87 76 Q93 81 99 76" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/><circle cx="80" cy="96" r="4" fill="#111111"/><path d="M126 30 h14 l-14 16 h14 M140 10 h10 l-10 11 h10" stroke="#111111" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M40 96 Q30 104 34 116 M120 96 Q130 104 126 116" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span><div><h2>Waiting for you</h2><p class="muted">Moxa can only ask. Nothing here happens until you confirm. “Yes” in the chat doesn’t count.</p></div></div><span id="pendingcount" class="badge dm"></span></div><div id="proposals"></div></section>
<section class="card"><div class="row between"><h2>Payees &amp; limits</h2><button id="rundue">Run due payments</button></div><table><thead><tr><th>Payee</th><th>Address</th><th>Limit</th><th>Spent</th><th>Left</th></tr></thead><tbody id="payees"></tbody></table><p class="muted">Inside a limit Moxa pays without asking. Over it, or with no limit, it asks you. Scheduled payments run every 30 seconds when due.</p></section>
<section class="card"><div class="row between"><div class="moxa"><span id="moxa-stop" hidden><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160" width="88" height="88" aria-hidden="true" aria-label="Moxa holding up a hand: blocked"><path d="M80 36 V22" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="80" cy="17" r="7" fill="#E5202E"/>
<rect x="40" y="36" width="80" height="92" rx="36" fill="#FFFFFF" stroke="#111111" stroke-width="4"/>
<circle cx="57" cy="90" r="6" fill="#FFC93C"/><circle cx="103" cy="90" r="6" fill="#FFC93C"/>
<path d="M66 128 v10 h-8 M94 128 v10 h8" stroke="#111111" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/><path d="M60 66 L72 70 M100 66 L88 70" stroke="#111111" stroke-width="4" stroke-linecap="round"/><circle cx="67" cy="74" r="5" fill="#111111"/><circle cx="93" cy="74" r="5" fill="#111111"/><path d="M70 96 H90" stroke="#111111" stroke-width="4" stroke-linecap="round"/><path d="M120 84 L136 60" stroke="#111111" stroke-width="4" stroke-linecap="round"/><rect x="126" y="34" width="24" height="28" rx="10" fill="#FFFFFF" stroke="#111111" stroke-width="4"/><path d="M40 92 Q26 100 28 114" stroke="#111111" stroke-width="4" stroke-linecap="round" fill="none"/></svg></span><h2>Agent trust</h2></div><span id="trust"></span></div><p class="muted">Injection phrases, made-up IDs, broken calls and attempts on these controls are strikes. Five in ten minutes locks the agent out until you unlock it.</p><button id="unlock" class="primary" hidden>Unlock agent</button><h2 style="margin-top:8px">Master prompt</h2><p class="muted">Every model plugged in reads this first. The fixed rules always win.</p><details><summary>Fixed rules</summary><pre id="binding"></pre></details><label for="business">Your business instructions</label><textarea id="business" style="min-height:120px" spellcheck="false" placeholder="e.g. Cape Town importer. Suppliers paid monthly in RLUSD. Always repeat the wallet address."></textarea><button id="savebiz">Save instructions</button></section>
<section class="card"><div class="row between"><h2>Business profile</h2><span id="version" class="muted dm"></span></div><label for="profile">Who is this harness for?</label><select id="profile"><option value="importer">Importer</option><option value="university">University</option><option value="retailer">Retailer</option><option value="custom">Custom</option></select><p class="muted">The profile labels your installation. Payees, categories and evidence decide what’s allowed; the payment engine still enforces caps.</p><h2 style="margin-top:8px">Plugins</h2><div class="toggle"><div><strong>Automated flows</strong><p class="muted">Owner-made presets. Every step passes the same gates.</p></div><input id="automation" type="checkbox" aria-label="Automated flows"></div><div class="toggle"><div><strong>Bridge routing</strong><p class="muted">Quote only. Simulated in the demo.</p></div><input id="bridge" type="checkbox" aria-label="Bridge routing"></div></section>
<section class="card"><p class="dm eyebrow">Try it</p><h2>Ask the harness to act</h2><label for="target">Registered target</label><select id="target"></select><div class="row"><button id="preflight">Check</button><button id="execute" class="primary">Run it</button></div><p class="muted">Try the allowed payment, the over-cap one, the expired one, the article purchase and the bridge quote. Repeats keep the same payment.</p><label for="flow">Approved workflow</label><select id="flow"></select><button id="runflow">Run workflow once</button><div class="row"><input id="purchaseid" placeholder="Purchase ID from a result" aria-label="Purchase ID" style="flex:1;min-width:140px"><button id="reconcile">Reconcile</button><button id="content">Read</button></div></section>
<section class="card wide"><div class="row between"><h2>Result</h2><span class="muted">Shows whether it was simulated or Testnet</span></div><pre id="output">Pick something to run.</pre></section>
<section class="card wide"><div class="row between"><h2>Audit log</h2><div class="row"><span id="chain" class="badge"></span><button id="audit">Verify / export</button></div></div><table><thead><tr><th>#</th><th>Event</th><th>Target</th><th>Code</th></tr></thead><tbody id="events"></tbody></table><p class="muted">Keep the head below somewhere else to spot later tampering. A hash chain isn’t a legal certificate.</p><div id="head"></div><details><summary>Edit raw policy (advanced)</summary><p class="muted">Version-checked and audited. This can’t create payment authority in the backend.</p><textarea id="editor" spellcheck="false" aria-label="Owner policy JSON"></textarea><button id="save">Save policy</button></details></section>
</div><footer>Testnet prototype · no legal, regulatory or security certification implied. A model prompt can’t grant payment authority.</footer></div></main>
<script>${script}</script></body></html>`;
export const dashboard = { html, script };
