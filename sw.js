const CACHE='fanta-random-v3';
const ASSETS=['./','./index.html','./style.css','./app.js?v=3','./manifest.webmanifest','./icons/icon-180.png','./icons/icon-192.png','./icons/icon-512.png'];

self.addEventListener('install',e=>e.waitUntil(
  caches.open(CACHE).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())
));

self.addEventListener('activate',e=>e.waitUntil(
  caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())
));

self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);

  // Le sorgenti esterne del listone devono poter essere aggiornate realmente.
  // I dati normalizzati restano poi salvati in locale dall'app per l'uso offline.
  if(url.origin!==self.location.origin){
    e.respondWith(fetch(e.request));
    return;
  }

  // Per i file dell'app preferiamo sempre la versione del server: la cache è
  // solo un fallback offline, così una correzione non lascia l'utente bloccato
  // su una vecchia app.js.
  e.respondWith(
    fetch(e.request).then(resp=>{
      const copy=resp.clone();
      caches.open(CACHE).then(c=>c.put(e.request,copy));
      return resp;
    }).catch(()=>caches.match(e.request).then(cached=>cached||caches.match('./index.html')))
  );
});
