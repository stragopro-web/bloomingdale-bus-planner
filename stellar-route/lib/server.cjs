'use strict';
const {createService,problem}=require('./admin-core.cjs');
const stops=require('../stops.json');
const {createRouting}=require('./google-routes.cjs');
const bootstrapHash='28a0ea06ca210670b4b9de8a36b227f7053a1ce3607efcdcbc54f0852fcb3919';
let service;
function getService(){if(service)return service;const blob=require('@vercel/blob');const storage={
 async read(path){const result=await blob.get(path,{access:'private',useCache:false});if(!result)return null;if(result.statusCode!==200)throw Error('Storage read failed');return {data:await new Response(result.stream).json(),etag:result.blob.etag};},
 async write(path,data,etag){return blob.put(path,JSON.stringify(data),{access:'private',contentType:'application/json',addRandomSuffix:false,allowOverwrite:!!etag,...(etag?{ifMatch:etag}:{}),cacheControlMaxAge:60});},
 conflict(e){return /Precondition|AlreadyExists/.test(e.name)||/already exists|etag|precondition/i.test(e.message);},
 async image(path,buffer,contentType){return blob.put(path,buffer,{access:'private',contentType,addRandomSuffix:false});},
 async media(path){return blob.get(path,{access:'private',useCache:false});}
};service=createService(storage,{bootstrapHash,stops});service.routing=createRouting({storage,session:service.session,stops,businesses:async()=>(await service.list('',true)).items});return service;}
const cookie=req=>{const m=(req.headers.cookie||'').match(/(?:^|;\s*)stellar_admin=([A-Za-z0-9_-]{43})(?:;|$)/);return m?.[1]||'';};
async function handle(req,res,kind){
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
 try{
  const service=getService(),token=cookie(req);
  if(kind==='businesses'){if(req.method!=='GET')throw problem(405,'Μη επιτρεπτή μέθοδος.');return res.status(200).json(await service.list(token,true));}
  if(kind==='media'){if(req.method!=='GET')throw problem(405,'Μη επιτρεπτή μέθοδος.');const result=await service.media(req.query.path,token);if(!result||result.statusCode!==200)throw problem(404,'Δεν βρέθηκε.');res.setHeader('Content-Type',result.blob.contentType);return res.status(200).send(Buffer.from(await new Response(result.stream).arrayBuffer()));}
  const action=req.query.action||'status';
  if(kind==='routes'&&req.method==='GET')return res.status(200).json(await service.routing.status());
  if(req.method==='GET'&&action==='routing-settings')return res.status(200).json(await service.routing.adminStatus(token));
  if(req.method==='GET'&&action==='status')return res.status(200).json(await service.auth('status',{},token));
  if(req.method==='GET'&&action==='list')return res.status(200).json(await service.list(token));
  if(req.method!=='POST')throw problem(405,'Μη επιτρεπτή μέθοδος.');
  if(!['https://route.stellar-solutions.gr','https://stellar-route-chania.vercel.app'].includes(req.headers.origin))throw problem(403,'Μη επιτρεπτή προέλευση αιτήματος.');
  if(!String(req.headers['content-type']||'').startsWith('application/json'))throw problem(415,'Χρειάζεται JSON.');
  let body=typeof req.body==='string'?JSON.parse(req.body):req.body||{};
  if(JSON.stringify(body).length>2900000)throw problem(413,'Το αρχείο είναι πολύ μεγάλο.');
  let result;
  if(kind==='routes')return res.status(200).json(await service.routing.compute(body,String(req.headers['x-forwarded-for']||'unknown').split(',')[0]));
  if(action==='routing-settings')result=await service.routing.saveSettings(body,token);
  else if(['setup','login','logout','password'].includes(action)){
   result=await service.auth(action,body,token,String(req.headers['x-forwarded-for']||'unknown').split(',')[0]);
   if(result.token){res.setHeader('Set-Cookie','stellar_admin='+result.token+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=28800');delete result.token;}
   if(action==='logout')res.setHeader('Set-Cookie','stellar_admin=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
  }else if(action==='save')result=await service.save(body,token);
  else if(action==='archive')result=await service.archive(body,token);
  else if(action==='upload')result=await service.upload(body,token);
  else throw problem(400,'Μη έγκυρη ενέργεια.');
  return res.status(200).json(result);
 }catch(e){const status=e.status||(/Precondition|AlreadyExists/.test(e.name)?409:503);if(status===503)console.error('Stellar storage failure',e.name,e.message);return res.status(status).json({...(e.code?{code:e.code}:{}),error:e.status?e.message:status===409?'Η καταχώριση άλλαξε. Ανανέωσε και δοκίμασε ξανά.':'Η αποθήκευση δεν είναι διαθέσιμη προσωρινά. Δοκίμασε ξανά.'});}
}
module.exports={handle};
