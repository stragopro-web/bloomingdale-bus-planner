'use strict';
const {problem}=require('./admin-core.cjs');
const endpoint='https://routes.googleapis.com/directions/v2:computeRoutes';
const fieldMask='routes.duration,routes.distanceMeters,routes.localizedValues,routes.warnings,routes.legs.steps.travelMode,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.navigationInstruction,routes.legs.steps.localizedValues,routes.legs.steps.transitDetails';
const point=p=>({location:{latLng:{latitude:p.lat,longitude:p.lng}}});
function checkedPoint(p){const lat=Number(p?.lat),lng=Number(p?.lng);if(p?.lat==null||p?.lng==null||p.lat===''||p.lng===''||!Number.isFinite(lat)||!Number.isFinite(lng)||lat<34.5||lat>36||lng<23||lng>25.5)throw problem(400,'Η αφετηρία πρέπει να βρίσκεται στην περιοχή εξυπηρέτησης των Χανίων. Επίλεξε στάση από τη λίστα.');return {lat,lng};}
function seconds(value){const n=parseFloat(value);return Number.isFinite(n)?Math.max(0,n):null;}
function normalizeResponse(data,now=Date.now()){
 return {provider:'Google Maps',calculatedAt:new Date(now).toISOString(),routes:(data.routes||[]).slice(0,3).map((route,index)=>{
  const steps=(route.legs||[]).flatMap(leg=>leg.steps||[]).map(step=>{
   const td=step.transitDetails,sd=td?.stopDetails||{},line=td?.transitLine||{};
   return {mode:step.travelMode||'WALK',instruction:String(step.navigationInstruction?.instructions||''),maneuver:step.navigationInstruction?.maneuver||'',distanceMeters:step.distanceMeters??null,durationSeconds:seconds(step.staticDuration),distanceText:step.localizedValues?.distance?.text||'',durationText:step.localizedValues?.staticDuration?.text||'',...(td?{transit:{line:line.nameShort||line.name||'',lineName:line.name||'',vehicle:line.vehicle?.name?.text||'',vehicleType:line.vehicle?.type||'',headsign:td.headsign||'',departureStop:sd.departureStop?.name||'',arrivalStop:sd.arrivalStop?.name||'',departureTime:sd.departureTime||'',arrivalTime:sd.arrivalTime||'',departureTimeText:td.localizedValues?.departureTime?.time?.text||'',arrivalTimeText:td.localizedValues?.arrivalTime?.time?.text||'',stopCount:td.stopCount??null,agencies:(line.agencies||[]).map(a=>String(a.name||''))}}:{})};
  });
  return {id:index,durationSeconds:seconds(route.duration),durationText:route.localizedValues?.duration?.text||'',distanceMeters:route.distanceMeters??null,distanceText:route.localizedValues?.distance?.text||'',warnings:(route.warnings||[]).map(String),steps,transfers:Math.max(0,steps.filter(s=>s.transit).length-1)};
 })};
}
async function callGoogle(key,body,{fetcher=fetch,now=Date.now()}={}){
 let response;try{response=await fetcher(endpoint,{method:'POST',headers:{'Content-Type':'application/json','X-Goog-Api-Key':key,'X-Goog-FieldMask':fieldMask},body:JSON.stringify(body),signal:AbortSignal.timeout(18000)});}catch{throw problem(504,'Ο υπολογισμός της διαδρομής καθυστέρησε. Δοκίμασε ξανά.');}
 let data;try{data=await response.json()}catch{throw problem(502,'Η υπηρεσία διαδρομών δεν επέστρεψε έγκυρη απάντηση.');}
 if(!response.ok){if(response.status===429)throw problem(429,'Η υπηρεσία διαδρομών έφτασε το όριο χρήσης της. Δοκίμασε αργότερα.');if(response.status===400||response.status===403)throw problem(503,'Η σύνδεση Google Maps χρειάζεται έλεγχο από τον διαχειριστή (κλειδί, ενεργό Routes API και χρέωση).');throw problem(502,'Δεν ήταν δυνατός ο υπολογισμός διαδρομής από την υπηρεσία Google Maps.');}
 return normalizeResponse(data,now);
}
function createRouting({storage,session,stops,businesses,now=Date.now,fetcher=fetch,env=process.env}){
 async function settings(){const saved=(await storage.read('settings/google-routes.json'))?.data;return {key:env.GOOGLE_ROUTES_API_KEY||saved?.key||'',enabled:saved?.enabled??!!env.GOOGLE_ROUTES_API_KEY,dailyLimit:saved?.dailyLimit||200};}
 async function status(){const s=await settings();return {configured:!!s.key,enabled:!!s.key&&s.enabled};}
 async function adminStatus(token){if(!await session(token))throw problem(401,'Χρειάζεται σύνδεση διαχειριστή.');const s=await settings();return {configured:!!s.key,enabled:!!s.key&&s.enabled,dailyLimit:s.dailyLimit,source:env.GOOGLE_ROUTES_API_KEY?'environment':'admin'};}
 async function saveSettings(body,token){
  if(!await session(token))throw problem(401,'Χρειάζεται σύνδεση διαχειριστή.');
  const old=await storage.read('settings/google-routes.json'),key=typeof body.key==='string'&&body.key.trim()?body.key.trim():(env.GOOGLE_ROUTES_API_KEY||old?.data.key||'');
  const dailyLimit=Number(body.dailyLimit);if(!Number.isInteger(dailyLimit)||dailyLimit<1||dailyLimit>5000)throw problem(400,'Το ημερήσιο όριο πρέπει να είναι από 1 έως 5.000 υπολογισμούς.');
  if(body.enabled&&!/^AIza[A-Za-z0-9_-]{25,100}$/.test(key))throw problem(400,'Συμπλήρωσε έγκυρο κλειδί Google Maps API.');
  if(body.enabled)await callGoogle(key,{origin:point({lat:35.5114,lng:24.018}),destination:point({lat:35.5119,lng:24.019}),travelMode:'WALK',languageCode:'el',units:'METRIC'},{fetcher,now:now()});
  await storage.write('settings/google-routes.json',{key:env.GOOGLE_ROUTES_API_KEY?'':key,enabled:body.enabled===true,dailyLimit,updatedAt:new Date(now()).toISOString()},old?.etag);
  return adminStatus(token);
 }
 async function takeLimit(path,max){for(let i=0;i<4;i++){const old=await storage.read(path),count=(old?.data.count||0)+1;if(count>max)throw problem(429,'Συμπληρώθηκε το διαθέσιμο όριο υπολογισμών διαδρομής. Δοκίμασε αργότερα.');try{await storage.write(path,{count},old?.etag);return}catch(e){if(!storage.conflict(e)||i===3)throw e}}}
 async function compute(body,ip){
  const config=await settings();if(!config.enabled||!config.key)throw Object.assign(problem(503,'Ο αυτόματος υπολογισμός αναλυτικής διαδρομής δεν έχει ενεργοποιηθεί ακόμη.'),{code:'NOT_CONFIGURED'});
  const mode={transit:'TRANSIT',walking:'WALK',driving:'DRIVE'}[body.mode];if(!mode)throw problem(400,'Επίλεξε έγκυρο τρόπο μετακίνησης.');
  const origin=body.origin?.stopId?stops.find(s=>s.id===body.origin.stopId):checkedPoint(body.origin);if(!origin)throw problem(400,'Η αφετηρία δεν βρέθηκε.');
  let destination;
  if(body.destination==='spa')destination={address:'Bloomingdale Spa, Stalos, Chania, Greece'};
  else if(typeof body.destination==='string'&&body.destination.startsWith('business:')){const b=(await businesses()).find(b=>'business:'+b.id===body.destination);if(!b)throw problem(404,'Η επιχείρηση δεν είναι διαθέσιμη.');destination=point(b);}
  else{const stop=stops.find(s=>s.id===body.destination);if(!stop)throw problem(400,'Ο προορισμός δεν βρέθηκε.');destination=point(stop);}
  const {createHash}=require('node:crypto');
  await takeLimit('routing-limits/ip-'+createHash('sha256').update(String(ip)).digest('hex')+'-'+Math.floor(now()/60000)+'.json',20);
  await takeLimit('routing-limits/day-'+new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Athens',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now()))+'.json',config.dailyLimit);
  return callGoogle(config.key,{origin:point(origin),destination,travelMode:mode,languageCode:'el',units:'METRIC',computeAlternativeRoutes:true,...(mode==='TRANSIT'?{departureTime:new Date(now()).toISOString(),transitPreferences:{allowedTravelModes:['BUS'],routingPreference:'FEWER_TRANSFERS'}}:{})},{fetcher,now:now()});
 }
 return {status,adminStatus,saveSettings,compute};
}
module.exports={createRouting,normalizeResponse,callGoogle,checkedPoint};
