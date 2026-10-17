'use strict';
const crypto=require('node:crypto');
const {promisify}=require('node:util');
const scrypt=promisify(crypto.scrypt);
const hash=s=>crypto.createHash('sha256').update(String(s)).digest('hex');
const same=(a,b)=>{const x=Buffer.from(String(a)),y=Buffer.from(String(b));return x.length===y.length&&crypto.timingSafeEqual(x,y)};
const problem=(status,message)=>Object.assign(new Error(message),{status});
const categories=['food','cafe','shopping','beauty','activities','stay','other'];
const text=(v,max=300)=>String(v??'').trim().slice(0,max);
function url(v){const s=text(v,1500);if(!s)return '';try{const u=new URL(s);if(u.protocol==='https:')return u.href}catch{}throw problem(400,'Οι σύνδεσμοι πρέπει να ξεκινούν με https://.');}
function validate(input,stops){
 const b={};
 for(const key of ['name','nameEn','address','phone','hours','hoursEn','direction','verifiedDate','expiresAt'])b[key]=text(input[key],key==='hours'||key==='hoursEn'?1500:300);
 for(const key of ['description','descriptionEn','accessNotes','accessNotesEn'])b[key]=text(input[key],4000);
 if(!b.name)throw problem(400,'Συμπλήρωσε την επωνυμία.');
 b.category=categories.includes(input.category)?input.category:'other';
 b.lat=Number(input.lat);b.lng=Number(input.lng);
 if(input.lat===''||input.lng===''||!Number.isFinite(b.lat)||!Number.isFinite(b.lng)||b.lat< -90||b.lat>90||b.lng< -180||b.lng>180)throw problem(400,'Όρισε έγκυρη τοποθεσία στον χάρτη.');
 b.email=text(input.email,254);if(b.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(b.email))throw problem(400,'Το email δεν είναι έγκυρο.');
 for(const key of ['website','booking'])b[key]=url(input[key]);
 for(const key of ['expiresAt','verifiedDate'])if(b[key]&&!/^\d{4}-\d{2}-\d{2}$/.test(b[key]))throw problem(400,'Μη έγκυρη ημερομηνία.');
 b.stopIds=[...new Set(Array.isArray(input.stopIds)?input.stopIds:[])].filter(id=>stops.some(s=>s.id===id)).slice(0,10);
 b.lines=text(input.lines,200);b.accessVerified=input.accessVerified===true;
 if(b.accessVerified&&(!b.stopIds.length||!b.verifiedDate||!b.accessNotes))throw problem(400,'Η ελεγμένη πρόσβαση χρειάζεται στάση, ημερομηνία και οδηγίες.');
 b.status=input.status==='published'?'published':'draft';b.sponsored=input.sponsored===true;
 b.photos=(Array.isArray(input.photos)?input.photos:[]).filter(p=>typeof p==='string'&&/^photos\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(p)).slice(0,6);
 return b;
}
function isPublic(b,now=Date.now()){
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Athens',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
 return b.status==='published'&&!b.archivedAt&&(!b.expiresAt||b.expiresAt>=today);
}
function createService(storage,{bootstrapHash,stops=[],now=Date.now}={}){
 const read=async p=>storage.read(p),write=async(p,data,etag)=>storage.write(p,data,etag);
 async function change(path,fn){for(let i=0;i<4;i++){const old=await read(path);const next=await fn(old?.data);try{await write(path,next,old?.etag);return next}catch(e){if(!storage.conflict(e)||i===3)throw e}}}
 async function session(token){if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;const r=await read('sessions/'+hash(token)+'.json');if(!r||r.data.expires<=now())return null;const admin=await read('auth/admin.json');return r.data.version===admin?.data.passwordHash?r.data:null;}
 async function makeSession(){const token=crypto.randomBytes(32).toString('base64url'),admin=await read('auth/admin.json');await write('sessions/'+hash(token)+'.json',{expires:now()+8*3600000,version:admin.data.passwordHash});return token;}
 async function throttle(ip){const key='limits/'+hash(ip+':'+Math.floor(now()/900000))+'.json';const value=await change(key,old=>({attempts:(old?.attempts||0)+1}));if(value.attempts>8)throw problem(429,'Πολλές προσπάθειες. Δοκίμασε ξανά σε 15 λεπτά.');}
 async function auth(action,body,token,ip){
  if(action==='status'){const admin=await read('auth/admin.json');return {initialized:!!admin,authenticated:!!await session(token)};}
  if(action==='logout'){if(token)await change('sessions/'+hash(token)+'.json',()=>({expires:0}));return {ok:true};}
  await throttle(ip);
  const existing=await read('auth/admin.json');
  if(action==='password'){
   if(!await session(token))throw problem(401,'Χρειάζεται σύνδεση διαχειριστή.');
   if(typeof body.currentPassword!=='string'||body.currentPassword.length>200||!same((await scrypt(body.currentPassword,existing.data.salt,64)).toString('hex'),existing.data.passwordHash))throw problem(401,'Ο τρέχων κωδικός δεν είναι σωστός.');
   if(typeof body.password!=='string'||body.password.length<12||body.password.length>200)throw problem(400,'Ο νέος κωδικός πρέπει να έχει τουλάχιστον 12 χαρακτήρες.');
   const salt=crypto.randomBytes(16).toString('hex'),passwordHash=(await scrypt(body.password,salt,64)).toString('hex');
   await write('auth/admin.json',{...existing.data,salt,passwordHash},existing.etag);
  }else if(action==='setup'){
   if(existing)throw problem(409,'Η αρχική ενεργοποίηση έχει ήδη ολοκληρωθεί.');
   if(!bootstrapHash||!same(hash(body.setupKey||''),bootstrapHash))throw problem(403,'Χρειάζεται ο ιδιωτικός σύνδεσμος αρχικής ενεργοποίησης.');
   if(typeof body.password!=='string'||body.password.length<12||body.password.length>200)throw problem(400,'Ο κωδικός πρέπει να έχει τουλάχιστον 12 χαρακτήρες.');
   const salt=crypto.randomBytes(16).toString('hex'),passwordHash=(await scrypt(body.password,salt,64)).toString('hex');
   await write('auth/admin.json',{salt,passwordHash,createdAt:new Date(now()).toISOString()});
  }else if(action==='login'){
   if(!existing||typeof body.password!=='string'||body.password.length>200)throw problem(401,'Ο κωδικός δεν είναι σωστός.');
   const candidate=(await scrypt(body.password,existing.data.salt,64)).toString('hex');if(!same(candidate,existing.data.passwordHash))throw problem(401,'Ο κωδικός δεν είναι σωστός.');
  }else throw problem(400,'Μη έγκυρη ενέργεια.');
  return {ok:true,token:await makeSession()};
 }
 async function all(){return (await read('data/businesses.json'))?.data||{revision:0,items:[]};}
 async function list(token,publicOnly=false){if(!publicOnly&&!await session(token))throw problem(401,'Χρειάζεται σύνδεση διαχειριστή.');const data=await all();return publicOnly?{items:data.items.filter(b=>isPublic(b,now())).map(({archivedAt,...b})=>b)}:data;}
 async function save(body,token){
  if(!await session(token))throw problem(401,'Χρειάζεται σύνδεση διαχειριστή.');
  const b=validate(body.business||{},stops);
  const record=await change('data/businesses.json',old=>{
   const data=old||{revision:0,items:[]};if(body.revision!==data.revision)throw problem(409,'Οι καταχωρίσεις άλλαξαν σε άλλη συσκευή. Ανανέωσε τη λίστα και δοκίμασε ξανά.');
   let prior=data.items.find(x=>x.id===body.id);if(body.id&&!prior)throw problem(404,'Η επιχείρηση δεν βρέθηκε.');
   if(!prior&&data.items.length>=500)throw problem(400,'Έφτασες το όριο των 500 επιχειρήσεων.');
   const item={...b,id:prior?.id||crypto.randomUUID(),createdAt:prior?.createdAt||new Date(now()).toISOString(),updatedAt:new Date(now()).toISOString(),archivedAt:prior?.archivedAt||null};
   return {revision:data.revision+1,items:prior?data.items.map(x=>x.id===item.id?item:x):[item,...data.items]};
  });return record;
 }
 async function archive(body,token){if(!await session(token))throw problem(401,'Χρειάζεται σύνδεση διαχειριστή.');return change('data/businesses.json',old=>{if(!old||body.revision!==old.revision)throw problem(409,'Ανανέωσε τη λίστα πριν συνεχίσεις.');if(!old.items.some(x=>x.id===body.id))throw problem(404,'Η επιχείρηση δεν βρέθηκε.');return {revision:old.revision+1,items:old.items.map(x=>x.id===body.id?{...x,archivedAt:body.restore?null:new Date(now()).toISOString()}:x)}});}
 async function upload(body,token){
  if(!await session(token))throw problem(401,'Χρειάζεται σύνδεση διαχειριστή.');
  const buffer=Buffer.from(typeof body.data==='string'?body.data:'','base64');let ext;
  if(buffer.length>0&&buffer.length<=2000000){if(buffer[0]===255&&buffer[1]===216&&buffer[2]===255)ext='jpg';else if(buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))ext='png';else if(buffer.toString('ascii',0,4)==='RIFF'&&buffer.toString('ascii',8,12)==='WEBP')ext='webp';}
  if(!ext)throw problem(400,'Επίλεξε εικόνα JPG, PNG ή WebP έως 2 MB.');
  const path='photos/'+crypto.randomUUID()+'.'+ext;await storage.image(path,buffer,'image/'+(ext==='jpg'?'jpeg':ext));return {path};
 }
 async function media(path,token){if(!/^photos\/[a-f0-9-]{36}\.(jpg|png|webp)$/.test(path||''))throw problem(404,'Δεν βρέθηκε.');const data=await all();if(!data.items.some(b=>isPublic(b,now())&&b.photos.includes(path))&&!await session(token))throw problem(404,'Δεν βρέθηκε.');return storage.media(path);}
 return {auth,list,save,archive,upload,media,session};
}
module.exports={createService,validate,isPublic,hash,problem};
