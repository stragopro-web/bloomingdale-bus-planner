const fs=require('node:fs');
fs.mkdirSync('public',{recursive:true});
for(const name of ['index.html','style.css','app.js','stops.json','bloomingdale.html','manifest.json','admin.html','admin.css','admin.js','businesses.html','businesses.js'])fs.copyFileSync(name,'public/'+name);
