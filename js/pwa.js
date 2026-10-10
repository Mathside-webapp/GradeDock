/* GradeDock installable app — UI layer only; scanner/Supabase code untouched. */
(()=>{
  'use strict';
  const $=id=>document.getElementById(id);
  const buttons=['gdInstallAuthBtn','gdInstallSideBtn','gdInstallSettingsBtn'].map($).filter(Boolean);
  const guide=$('gdPwaGuide');
  const update=$('gdPwaUpdate');
  const standalone=()=>matchMedia('(display-mode: standalone)').matches || navigator.standalone===true;
  const ios=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||
    (navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
  const android=()=>/android/i.test(navigator.userAgent);
  const safari=()=>/safari/i.test(navigator.userAgent)&&!/crios|fxios|edgios|opios|duckduckgo/i.test(navigator.userAgent);
  const secure=()=>location.protocol==='https:' || /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  let deferred=null, registration=null, reloading=false;

  function show(dialog){
    if(!dialog)return;
    if(typeof dialog.showModal==='function'&&!dialog.open)dialog.showModal();
    else dialog.setAttribute('open','');
  }
  function hide(dialog){if(dialog?.open&&typeof dialog.close==='function')dialog.close();else dialog?.removeAttribute('open');}
  function refresh(){
    const installed=standalone();
    buttons.forEach(btn=>{
      btn.hidden=installed;
      btn.setAttribute('aria-hidden',String(installed));
    });
    if($('gdPwaStatus'))$('gdPwaStatus').textContent=installed ?
      'GradeDock is installed and running as an app.' :
      secure() ? 'GradeDock can be installed from this website.' : 'Open GradeDock over HTTPS to install it.';
  }
  function displayGuide(){
    const title=$('gdPwaGuideTitle'), intro=$('gdPwaGuideIntro'),steps=$('gdPwaGuideSteps');
    const copy=$('gdPwaCopyLinkBtn');
    let values=[];
    copy.hidden=true;
    if(!secure()){
      title.textContent='Open GradeDock securely';
      intro.textContent='Installation and live camera access require HTTPS (GitHub Pages already provides it) or localhost.';
      values=['Publish GradeDock on your GitHub Pages address.','Open that HTTPS website in your browser.','Select Install GradeDock again.'];
    } else if(ios()){
      title.textContent='Add GradeDock to your iPhone';
      intro.textContent=safari() ? 'Use Safari’s Share menu to install GradeDock.' :
        'Open this GradeDock page in Safari first, then follow the steps.';
      values=['Open the GradeDock website in Safari.','Tap Share (square with an upward arrow).','Choose Add to Home Screen, then tap Add.'];
      copy.hidden=safari();
    } else if(android()){
      title.textContent='Install GradeDock on Android';
      intro.textContent='Install GradeDock from your browser to open it like an app.';
      values=['Open the browser menu (⋮).','Choose Install app or Add to Home screen.','Confirm Install or Add.'];
    } else {
      title.textContent='Install GradeDock on your computer';
      intro.textContent='Install the site as an app from a supported browser.';
      values=['Open GradeDock in Chrome or Edge.','Use the Install icon near the address bar, or the browser menu → Install GradeDock.','Open GradeDock from your desktop or applications list.'];
    }
    steps.replaceChildren(...values.map(step=>{const li=document.createElement('li');li.textContent=step;return li;}));
    show(guide);
  }
  async function install(){
    if(standalone())return;
    if(deferred){
      const event=deferred;deferred=null;
      try{await event.prompt();await event.userChoice;}catch(err){console.info('GradeDock install prompt unavailable:',err);displayGuide();}
      refresh();
    }else displayGuide();
  }
  buttons.forEach(btn=>btn.addEventListener('click',install));
  $('gdPwaGuideCloseBtn')?.addEventListener('click',()=>hide(guide));
  $('gdPwaCopyLinkBtn')?.addEventListener('click',async()=>{
    const btn=$('gdPwaCopyLinkBtn');
    try{await navigator.clipboard.writeText(location.href);btn.textContent='Link copied';}
    catch(_){window.prompt('Copy this GradeDock link, then open it in Safari:',location.href);}
  });
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferred=event;refresh();});
  window.addEventListener('appinstalled',()=>{deferred=null;hide(guide);refresh();});
  refresh();

  const banner=$('gdOfflineBanner');
  function networkStatus(){if(banner)banner.hidden=navigator.onLine;}
  window.addEventListener('offline',networkStatus);
  window.addEventListener('online',networkStatus);
  networkStatus();

  function offerUpdate(){if(navigator.serviceWorker.controller)show(update);}
  $('gdPwaUpdateLaterBtn')?.addEventListener('click',()=>hide(update));
  $('gdPwaUpdateNowBtn')?.addEventListener('click',async()=>{
    const btn=$('gdPwaUpdateNowBtn');
    if(btn.disabled)return;
    btn.disabled=true;btn.textContent='Updating…';
    hide(update);
    try {
      registration=registration||await navigator.serviceWorker.getRegistration('./');
      if(registration?.waiting)registration.waiting.postMessage({type:'SKIP_WAITING'});
      else location.reload();
    } catch(_){location.reload();}
  });

  if('serviceWorker' in navigator && secure()){
    navigator.serviceWorker.addEventListener('controllerchange',()=>{
      if(reloading)return;
      const btn=$('gdPwaUpdateNowBtn');
      if(btn?.disabled){reloading=true;location.reload();}
    });
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('./service-worker.js',{scope:'./'}).then(reg=>{
        registration=reg;
        if(reg.waiting&&navigator.serviceWorker.controller)offerUpdate();
        reg.addEventListener('updatefound',()=>{
          const worker=reg.installing;
          worker?.addEventListener('statechange',()=>{
            if(worker.state==='installed'&&navigator.serviceWorker.controller)offerUpdate();
          });
        });
      }).catch(err=>console.info('GradeDock app installation unavailable:',err));
    });
  }
})();
