'use strict';
(()=>{
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
let state=null,timer,controller,sequence=0,availability=null,current=null;
const duration=s=>s==null?'':s<60?'Λιγότερο από 1 λεπτό':Math.ceil(s/60)+' λεπτά';
const meters=m=>m==null?'':m<1000?Math.round(m)+' μ.':(m/1000).toLocaleString('el-GR',{maximumFractionDigits:1})+' χλμ.';
function time(iso,localized){if(localized)return localized;if(!iso)return '';const d=new Date(iso);return Number.isNaN(d.getTime())?'':d.toLocaleTimeString('el-GR',{timeZone:'Europe/Athens',hour:'2-digit',minute:'2-digit'})}
function cancel(){clearTimeout(timer);controller?.abort();sequence++;}
function attribution(){return '<div class="googleattribution"><span>Οδηγίες από</span><img src="google-maps-logo.svg" alt="Google Maps" height="18"><a href="routing-privacy.html">Απόρρητο & όροι</a></div>'}
function formatRoute(route,destinationName){
 let transitCount=0;
 const steps=route.steps.map(s=>{
  const meta=[s.distanceText||meters(s.distanceMeters),s.durationText||duration(s.durationSeconds)].filter(Boolean).join(' · ');
  if(s.transit){const t=s.transit,departure=time(t.departureTime,t.departureTimeText),arrival=time(t.arrivalTime,t.arrivalTimeText),change=transitCount++>0;
   return '<li class="movement transitmovement"><h3>'+(change?'Μετεπιβίβαση · ':'')+(t.vehicleType==='BUS'?'Πάρε το λεωφορείο':'Επιβιβάσου')+(t.line?' <span class="badge">'+esc(t.line)+'</span>':'')+'</h3>'+(t.headsign?'<p><b>Προς '+esc(t.headsign)+'</b></p>':'')+'<p><b>Επιβίβαση:</b> '+esc(t.departureStop||'Δεν παρέχεται όνομα στάσης')+(departure?' · '+esc(departure):'')+'</p>'+(t.agencies.length?'<p class="movementmeta">'+esc(t.agencies.join(', '))+'</p>':'')+(t.stopCount!=null?'<p>Μείνε μέσα για '+esc(t.stopCount)+' στάσεις.</p>':'')+'<p><b>Κατέβα:</b> '+esc(t.arrivalStop||'Δεν παρέχεται όνομα στάσης')+(arrival?' · '+esc(arrival):'')+'</p>'+(meta?'<p class="movementmeta">'+esc(meta)+'</p>':'')+'</li>';
  }
  return '<li class="movement"><h3>'+esc(s.instruction||(s.mode==='WALK'?'Συνέχισε με τα πόδια':'Συνέχισε στη διαδρομή'))+'</h3>'+(meta?'<p class="movementmeta">'+esc(meta)+'</p>':'')+'</li>';
 }).join('');
 return '<div class="journeysummary"><div><b>'+esc(route.durationText||duration(route.durationSeconds)||'Χρόνος μη διαθέσιμος')+'</b><span>Συνολική εκτίμηση</span></div><div><b>'+esc(route.distanceText||meters(route.distanceMeters)||'—')+'</b><span>Απόσταση διαδρομής</span></div><div><b>'+esc(route.transfers)+'</b><span>Μετεπιβιβάσεις</span></div></div><ol class="movementsteps">'+steps+'</ol><div class="journeyarrival">✓ Άφιξη: '+esc(destinationName)+'</div>'+(route.warnings||[]).map(w=>'<p class="routewarning">'+esc(w)+'</p>').join('');
}
function display(data,selected=0){const panel=$('googleRoutePanel');if(!panel)return;const route=data.routes[selected];if(!route){panel.innerHTML='<h3>Δεν βρέθηκε διαθέσιμη διαδρομή</h3><p>Η Google Maps δεν επέστρεψε διαδρομή για τις συγκεκριμένες επιλογές και την τρέχουσα ώρα. Δοκίμασε άλλη αφετηρία ή τρόπο μετακίνησης.</p>'+attribution();return}
 panel.innerHTML='<div class="inlineguidehead"><span class="eyebrow">ΟΙ ΚΙΝΗΣΕΙΣ ΣΟΥ · ΒΗΜΑ ΒΗΜΑ</span>'+(state.originIsGps?'<p>Αφετηρία: η τρέχουσα θέση σου</p>':'')+'</div>'+(data.routes.length>1?'<label for="googleRouteChoice">Εναλλακτική διαδρομή</label><select id="googleRouteChoice">'+data.routes.map((r,i)=>'<option value="'+i+'">Διαδρομή '+(i+1)+' · '+esc(r.durationText||duration(r.durationSeconds))+' · '+r.transfers+' μετεπιβιβάσεις</option>').join('')+'</select>':'')+formatRoute(route,state.destinationName)+'<p class="hint">Υπολογισμός για αναχώρηση τώρα. Οι χρόνοι είναι εκτιμήσεις και μπορεί να αλλάξουν. Έλεγξε τις ενδείξεις και τη σωστή πλευρά του δρόμου.</p>'+attribution();
 if($('googleRouteChoice')){$('googleRouteChoice').value=String(selected);$('googleRouteChoice').onchange=e=>display(data,Number(e.target.value))}
 const saved=$('savedAccess');if(saved)saved.open=false;
}
async function calculate(force=false){
 const panel=$('googleRoutePanel');if(!panel||!state)return;const snapshot=state,signature=JSON.stringify(snapshot),ticket=++sequence;
 if(!snapshot.origin){panel.innerHTML='<h3>Επίλεξε την αφετηρία σου</h3><p>Διάλεξε στάση ή χρησιμοποίησε τον εντοπισμό θέσης για να εμφανιστούν εδώ οι κινήσεις μέχρι τον προορισμό.</p>';return;}
 if(!force&&current?.signature===signature&&Date.now()-current.at<120000){display(current.data);return}
 controller?.abort();controller=new AbortController();const signal=controller.signal;
 panel.innerHTML='<p role="status">Υπολογίζουμε τη διαδρομή σου…</p>';
 try{
  if(availability==null||force){const r=await fetch('/api/routes',{signal});if(!r.ok)throw Error('Η υπηρεσία διαδρομών δεν απαντά προσωρινά.');availability=await r.json();}
  if(ticket!==sequence)return;
  if(!availability.enabled){panel.innerHTML='<h3>Αναλυτική διαδρομή μέσα στην εφαρμογή</h3><p>Ο αυτόματος υπολογισμός οδηγιών δεν έχει ενεργοποιηθεί ακόμη. Παρακάτω μπορείς να δεις τα διαθέσιμα στοιχεία στάσεων και πρόσβασης.</p>';return;}
  const r=await fetch('/api/routes',{method:'POST',headers:{'Content-Type':'application/json'},signal,body:JSON.stringify({origin:snapshot.origin,destination:snapshot.destination,mode:snapshot.mode})});
  const data=await r.json();if(ticket!==sequence)return;if(!r.ok)throw Error(data.error||'Ο υπολογισμός δεν ολοκληρώθηκε.');if(!Array.isArray(data.routes))throw Error('Δεν επιστράφηκαν πληροφορίες διαδρομής.');
  current={signature,data,at:Date.now()};display(data);
 }catch(e){if(e.name==='AbortError'||ticket!==sequence)return;panel.innerHTML='<h3>Η διαδρομή δεν υπολογίστηκε</h3><p>'+esc(e.message||'Δοκίμασε ξανά.')+'</p><p class="hint">Πάτησε «Εμφάνιση αναλυτικής διαδρομής» για νέα προσπάθεια.</p>';}
}
function update(next){cancel();state=next;const panel=$('googleRoutePanel');if(panel)panel.innerHTML='<p role="status">Προετοιμασία οδηγιών…</p>';timer=setTimeout(()=>calculate(),350);}
function refresh(){cancel();calculate(true);}
window.StellarRouteGuide={update,cancel,refresh,formatRoute};
})();
