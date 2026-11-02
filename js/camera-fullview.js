/* GradeDock full-screen camera UI — no point picker, no browser Fullscreen API required. */
(function () {
  function init() {
    const mode = document.getElementById('cameraMode');
    const toggle = document.getElementById('cameraFullViewBtn');
    const close = document.getElementById('closeFullViewBtn');
    if (!mode || !toggle || !close) return;
    let previousFocus = null;
    let previousScroll = 0;

    function setFullView(open) {
      open = Boolean(open);
      if (open && !document.getElementById('page-scan')?.classList.contains('active')) return;
      if (open && !mode.classList.contains('is-fullview')) {
        previousFocus = document.activeElement;
        previousScroll = window.scrollY;
      }
      mode.classList.toggle('is-fullview', open);
      document.body.classList.toggle('gd-camera-fullview-active', open);
      toggle.setAttribute('aria-pressed', String(open));
      toggle.textContent = open ? '↙ Normal view' : '⛶ Full view';
      if (open) close.focus({preventScroll:true});
      else if (previousFocus?.isConnected && !mode.contains(previousFocus)) previousFocus.focus({preventScroll:true});
      if (!open && previousScroll && window.scrollY !== previousScroll) window.scrollTo({top:previousScroll,behavior:'instant'});
    }

    toggle.addEventListener('click', () => setFullView(!mode.classList.contains('is-fullview')));
    close.addEventListener('click', () => setFullView(false));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && mode.classList.contains('is-fullview')) {
        e.preventDefault(); setFullView(false);
      }
    });
    document.querySelectorAll('.nav-item[data-page], #uploadTab, #signoutBtn').forEach(button => {
      button.addEventListener('click', () => setFullView(false));
    });
    // Close only after successful recognition so teachers can see/review the score.
    const result = document.getElementById('scanResult');
    if (result && typeof MutationObserver !== 'undefined') {
      new MutationObserver(() => {
        if (mode.classList.contains('is-fullview') && !result.classList.contains('hidden')) {
          setFullView(false);
          result.scrollIntoView({block:'start',behavior:'smooth'});
        }
      }).observe(result,{attributes:true,attributeFilter:['class']});
    }
    window.GradeDockCameraView = {close:()=>setFullView(false)};
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded',init);
  else init();
})();
