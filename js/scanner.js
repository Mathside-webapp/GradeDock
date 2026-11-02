(function () {
  const Scanner = {
    stream: null,
    facingMode: 'environment',
    orientation: 'portrait',

    async startCamera(video) {
      this.stopCamera(video);
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        throw new Error('Camera needs HTTPS. Open GradeDock using your GitHub Pages link, or use Take photo instead.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera not supported here. Use Take photo instead or Upload image.');
      }
      const portrait = this.orientation === 'portrait';
      const preferred = {audio:false, video:{
        facingMode:{ideal:this.facingMode},
        width:{ideal:portrait ? 1440 : 1920},
        height:{ideal:portrait ? 1920 : 1440},
        frameRate:{ideal:24,max:30}
      }};
      try {
        try { this.stream = await navigator.mediaDevices.getUserMedia(preferred); }
        catch (err) {
          if (['OverconstrainedError','NotFoundError','TypeError'].includes(err?.name)) {
            this.stream = await navigator.mediaDevices.getUserMedia({video:true,audio:false});
          } else { throw err; }
        }
        video.muted = true;
        video.playsInline = true;
        video.setAttribute('playsinline','');
        video.srcObject = this.stream;
        try {
          const track=this.stream.getVideoTracks()[0];
          const caps=track?.getCapabilities?.() || {};
          const advanced={};
          for (const [name,value] of Object.entries({focusMode:'continuous',exposureMode:'continuous',whiteBalanceMode:'continuous'})) {
            if (Array.isArray(caps[name]) && caps[name].includes(value)) advanced[name]=value;
          }
          if (Object.keys(advanced).length) await track.applyConstraints({advanced:[advanced]});
        } catch (_) { /* Optional controls are not supported on all phones. */ }

        // 'loadedmetadata' can fire while videoWidth is still zero on iOS.
        // Wait for a real frame rather than displaying a black rectangle as ready.
        const ready = new Promise((resolve,reject) => {
          let complete=false;
          const finish=(error) => {
            if(complete)return; complete=true;
            clearTimeout(timer);
            video.removeEventListener('loadeddata',check);
            video.removeEventListener('playing',check);
            video.removeEventListener('error',failed);
            error ? reject(error) : resolve();
          };
          const check=()=>{if(video.videoWidth>0 && video.videoHeight>0 && video.readyState>=2)finish();};
          const failed=()=>finish(new Error('The camera preview failed to start. Try Restart camera or Take photo instead.'));
          const timer=setTimeout(()=>finish(new Error('The camera did not provide a picture. Check camera permissions or use Take photo instead.')),8000);
          video.addEventListener('loadeddata',check);
          video.addEventListener('playing',check);
          video.addEventListener('error',failed);
          check();
        });
        await Promise.all([video.play(),ready]);
        return true;
      } catch(err) {
        this.stopCamera(video);
        if (['NotAllowedError','SecurityError','PermissionDeniedError'].includes(err?.name))
          throw new Error('Camera permission denied. Allow camera access in site settings, or tap Take photo instead.');
        if (['NotReadableError','TrackStartError','AbortError'].includes(err?.name))
          throw new Error('The camera may be in use by another app. Close it and retry, or tap Take photo instead.');
        throw err;
      }
    },

    stopCamera(video) {
      if (this.stream) this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
      if (video) video.srcObject = null;
    },

    async switchCamera(video) {
      this.facingMode = this.facingMode === 'environment' ? 'user' : 'environment';
      return this.startCamera(video);
    },

    setOrientation(value) {
      this.orientation = value === 'portrait' ? 'portrait' : 'landscape';
      return this.orientation;
    },

    toggleOrientation() {
      return this.setOrientation(this.orientation === 'portrait' ? 'landscape' : 'portrait');
    },

    inspectFrame(video) {
      const vw = Number(video?.videoWidth || 0), vh = Number(video?.videoHeight || 0);
      if (!vw || !vh) {
        return { state: 'starting', ready: false, title: 'Camera is focusing…', text: 'Hold the phone steady and keep the paper in view.' };
      }

      // Live quality check: low-resolution enough to stay smooth on phones, but
      // large enough to see the printed registration markers and paper detail.
      const maxW = 640;
      const scale = Math.min(1, maxW / vw);
      const w = Math.max(1, Math.round(vw * scale));
      const h = Math.max(1, Math.round(vh * scale));
      if (!this._assistCanvas) this._assistCanvas = document.createElement('canvas');
      const canvas = this._assistCanvas;
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;
      const grayAt = (x, y) => {
        const i = (y * w + x) * 4;
        return data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114;
      };

      let sum = 0, samples = 0, edge = 0, veryBright = 0, veryDark = 0;
      const step = 5;
      for (let y = step; y < h - step; y += step) {
        for (let x = step; x < w - step; x += step) {
          const g = grayAt(x, y);
          sum += g; samples++;
          if (g > 250) veryBright++;
          if (g < 28) veryDark++;
          edge += Math.abs(g - grayAt(x + step, y)) + Math.abs(g - grayAt(x, y + step));
        }
      }
      const mean = samples ? sum / samples : 0;
      const sharpness = samples ? edge / (samples * 2) : 0;
      const glare = samples ? veryBright / samples : 0;
      const darkRatio = samples ? veryDark / samples : 0;

      if (mean < 42) {
        return { state: 'warn', ready: false, title: 'Too dark to scan', text: 'Add soft light or move out of the shadow.', mean, sharpness };
      }
      if (glare > .26 && mean > 188) {
        return { state: 'warn', ready: false, title: 'Glare detected', text: 'Tilt the phone or move away from direct light.', mean, sharpness, glare };
      }
      if (sharpness < 2.8) {
        return { state: 'focus', ready: false, title: 'Image is not focused', text: 'Hold still and wait for the camera to focus.', mean, sharpness };
      }
      if (darkRatio > .60) {
        return { state: 'warn', ready: false, title: 'Paper is partly covered', text: 'Keep fingers and dark objects away from the answer sheet.', mean, sharpness };
      }

      // Do not continuously perform expensive registration detection on every
      // video frame. Recognition happens once when Capture & check is tapped.
      return {
        state: 'ready', ready: true,
        title: 'Camera ready',
        text: 'Fit the entire paper in the picture, then tap Capture & check.',
        mean, sharpness, glare
      };
    },

    capture(video, canvas) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) throw new Error('Camera is not ready yet.');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      return canvas;
    },

    async captureBestFrame(video, canvas) {
      const track = this.stream?.getVideoTracks?.()[0];
      // On supported Android/Chromium devices, takePhoto can use a higher-quality
      // still image than the live preview. Fall back safely everywhere else.
      if (track && typeof window.ImageCapture === 'function') {
        try {
          const imageCapture = new ImageCapture(track);
          if (typeof imageCapture.takePhoto === 'function') {
            const blob = await imageCapture.takePhoto();
            const bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(() => createImageBitmap(blob));
            const max = 2600, scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.max(1, Math.round(bitmap.width * scale));
            canvas.height = Math.max(1, Math.round(bitmap.height * scale));
            canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            bitmap.close?.();
            return { canvas, blob, highQuality: true };
          }
        } catch (_) {}
      }
      this.capture(video, canvas);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .96));
      return { canvas, blob, highQuality: false };
    },

    async fileToCanvas(file, canvas) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      try {
        await new Promise((resolve,reject) => { img.onload=resolve; img.onerror=()=>reject(new Error('Could not read this image. Use a JPG or PNG photo.')); img.src=url; });
        const max=2800,scale=Math.min(1,max/Math.max(img.naturalWidth,img.naturalHeight));
        canvas.width=Math.max(1,Math.round(img.naturalWidth*scale));
        canvas.height=Math.max(1,Math.round(img.naturalHeight*scale));
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        return canvas;
      } finally {URL.revokeObjectURL(url);}
    },

    // GradeDock uses four printed registration squares, not just page edges.
    // Adaptive local contrast handles shadows and nonwhite desks without OpenCV/WASM.
    // Analyse a bounded copy so live mobile scanning stays responsive.
    findMarkers(canvas, maxSize = 960) {
      const scale=Math.min(1,maxSize/Math.max(canvas.width,canvas.height));
      const w=Math.max(1,Math.round(canvas.width*scale));
      const h=Math.max(1,Math.round(canvas.height*scale));
      const temp=document.createElement('canvas');temp.width=w;temp.height=h;
      const ctx=temp.getContext('2d',{willReadFrequently:true});
      ctx.drawImage(canvas,0,0,w,h);
      const rgba=ctx.getImageData(0,0,w,h).data;
      const gray=new Uint8Array(w*h);
      for(let i=0;i<gray.length;i++)gray[i]=Math.round(rgba[i*4]*.299+rgba[i*4+1]*.587+rgba[i*4+2]*.114);
      const integral=new Float64Array((w+1)*(h+1)),stride=w+1;
      for(let y=0;y<h;y++){
        let row=0,cur=(y+1)*stride,prev=y*stride;
        for(let x=0;x<w;x++){row+=gray[y*w+x];integral[cur+x+1]=integral[prev+x+1]+row;}
      }
      const radius=Math.max(15,Math.round(Math.min(w,h)*.034));
      const mask=new Uint8Array(w*h),stack=new Int32Array(w*h);
      const candidates=[];
      const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
      const add=(c)=>{
        const old=candidates.find(o=>dist(o,c)<Math.max(5,Math.min(o.side,c.side)*.85));
        if(old){if(c.fill>old.fill || c.area>old.area*1.2)Object.assign(old,c);}
        else candidates.push(c);
      };
      // Pass 1 is adaptive; passes 2 and 3 cover photos whose contrast is
      // already flat/strong (for example a scanned PNG or heavily exposed sheet).
      for (const mode of ['adaptive','dark','medium']) {
        if(mode==='adaptive') {
          for(let y=0;y<h;y++){
            const top=Math.max(0,y-radius),bottom=Math.min(h-1,y+radius);
            const base=y*w,ra=top*stride,rb=(bottom+1)*stride;
            for(let x=0;x<w;x++){
              const l=Math.max(0,x-radius),r=Math.min(w-1,x+radius);
              const avg=(integral[rb+r+1]-integral[ra+r+1]-integral[rb+l]+integral[ra+l])/((r-l+1)*(bottom-top+1));
              mask[base+x]=gray[base+x]<Math.min(205,avg-27)?1:0;
            }
          }
        } else {
          const threshold=mode==='dark'?110:172;
          for(let i=0;i<gray.length;i++)mask[i]=gray[i]<threshold?1:0;
        }
        for(let seed=0;seed<mask.length;seed++){
          if(!mask[seed])continue;
          let length=1,area=0,minX=w,maxX=-1,minY=h,maxY=-1;
          stack[0]=seed;mask[seed]=0;
          while(length){
            const i=stack[--length],x=i%w,y=(i/w)|0;
            area++;
            if(x<minX)minX=x;if(x>maxX)maxX=x;
            if(y<minY)minY=y;if(y>maxY)maxY=y;
            const a=x?i-1:-1,b=x<w-1?i+1:-1,c=y?i-w:-1,d=y<h-1?i+w:-1;
            if(a>=0&&mask[a]){mask[a]=0;stack[length++]=a;}
            if(b>=0&&mask[b]){mask[b]=0;stack[length++]=b;}
            if(c>=0&&mask[c]){mask[c]=0;stack[length++]=c;}
            if(d>=0&&mask[d]){mask[d]=0;stack[length++]=d;}
          }
          const bw=maxX-minX+1,bh=maxY-minY+1;
          const fill=area/(bw*bh),ratio=bw/bh;
          if(area<14||Math.min(bw,bh)<4||Math.max(bw,bh)>Math.min(w,h)*.115||
             ratio<.48||ratio>2.05||fill<.57||area>Math.min(w,h)**2*.014)continue;
          add({x:(minX+maxX)/2,y:(minY+maxY)/2,side:Math.sqrt(area),fill,area});
        }
        if(candidates.length>=4) {
          // Not every set of four candidates is a sheet; validate the geometry.
          const best=this._chooseMarkerQuad(candidates,w,h);
          if(best)return best.map((p,i)=>({x:p.x/scale,y:p.y/scale,name:['tl','tr','bl','br'][i]}));
        }
      }
      // Make one higher-resolution attempt only when automatic registration fails.
      if (maxSize === 960 && Math.max(canvas.width,canvas.height) > 1100) return this.findMarkers(canvas, 1440);
      throw new Error('Could not align this photo automatically. Keep the whole answer sheet in view, add soft lighting, and try Capture & check again or Take photo instead.');
    },

    _chooseMarkerQuad(candidates,w,h) {
      const pool=[...candidates].sort((a,b)=>b.area-a.area).slice(0,28);
      const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
      let best=null;
      for(let a=0;a<pool.length-3;a++)for(let b=a+1;b<pool.length-2;b++)
      for(let c=b+1;c<pool.length-1;c++)for(let d=c+1;d<pool.length;d++){
        const points=[pool[a],pool[b],pool[c],pool[d]];
        const center={x:points.reduce((t,p)=>t+p.x,0)/4,y:points.reduce((t,p)=>t+p.y,0)/4};
        points.sort((p,q)=>Math.atan2(p.y-center.y,p.x-center.x)-Math.atan2(q.y-center.y,q.x-center.x));
        const sides=points.map((p,i)=>distance(p,points[(i+1)%4]));
        const short=Math.min(...sides),long=Math.max(...sides);
        if(short<Math.min(w,h)*.20||long/short>2.8||
          sides[0]/sides[2]<.43||sides[0]/sides[2]>2.3||
          sides[1]/sides[3]<.43||sides[1]/sides[3]>2.3)continue;
        const sizes=points.map(p=>p.side),meanSize=sizes.reduce((t,n)=>t+n,0)/4;
        if(Math.max(...sizes)/Math.min(...sizes)>2.6||meanSize/short<.012||meanSize/short>.11)continue;
        let area=0,convex=true;
        for(let i=0;i<4;i++){
          const p=points[i],q=points[(i+1)%4],r=points[(i+2)%4];
          area+=p.x*q.y-p.y*q.x;
          if((q.x-p.x)*(r.y-q.y)-(q.y-p.y)*(r.x-q.x)<=0)convex=false;
        }
        area=Math.abs(area)/2;
        if(!convex||area<w*h*.075)continue;
        const relative=meanSize/short;
        const fit=Math.abs(relative-30/896);
        const fill=points.reduce((t,p)=>t+p.fill,0)/4;
        const score=area*(1-Math.min(.6,fit*9))*(.7+.3*fill);
        if(!best||score>best.score)best={points:[...points],score};
      }
      if(!best)return null;
      const points=best.points;
      const first=points.reduce((b,p,i)=>p.x+p.y<points[b].x+points[b].y?i:b,0);
      const cycle=Array.from({length:4},(_,i)=>points[(first+i)%4]);
      return [cycle[0],cycle[1],cycle[3],cycle[2]];
    },

    solveHomography(dstPts, srcPts) {
      const A=[];
      for(let i=0;i<4;i++){
        const [x,y]=dstPts[i], [u,v]=srcPts[i];
        A.push([x,y,1,0,0,0,-u*x,-u*y,u]);
        A.push([0,0,0,x,y,1,-v*x,-v*y,v]);
      }
      for(let col=0;col<8;col++){
        let pivot=col; for(let r=col+1;r<8;r++) if(Math.abs(A[r][col])>Math.abs(A[pivot][col])) pivot=r;
        [A[col],A[pivot]]=[A[pivot],A[col]]; const div=A[col][col]; if(Math.abs(div)<1e-9) throw new Error('The paper is too tilted to read reliably. Hold the camera more directly above the sheet and try again.');
        for(let c=col;c<9;c++) A[col][c]/=div;
        for(let r=0;r<8;r++){ if(r===col)continue; const f=A[r][col]; for(let c=col;c<9;c++) A[r][c]-=f*A[col][c]; }
      }
      const h=A.map(r=>r[8]); h.push(1); return h;
    },

    map(H,x,y){ const d=H[6]*x+H[7]*y+H[8]; return {x:(H[0]*x+H[1]*y+H[2])/d, y:(H[3]*x+H[4]*y+H[5])/d}; },

    transformCanonicalPoint(x, y, transform = 'identity') {
      // The four registration squares are geometrically symmetric. Some mobile
      // browsers/cameras can therefore deliver a horizontally mirrored frame
      // without the markers revealing it. That exact failure makes A look like D
      // (and B like C). Keep the correction explicit so every downstream reader
      // uses the same canonical orientation.
      let u=(x-52)/896,v=(y-52)/1310;
      const mirrored=transform.startsWith('mirror');
      if(mirrored)u=1-u;
      const rotation=Number(transform.replace('mirror','').replace('rotate',''))||0;
      if(transform==='flipX')u=1-u;
      if(transform==='flipY')v=1-v;
      if(rotation===90)[u,v]=[1-v,u];
      if(rotation===180)[u,v]=[1-u,1-v];
      if(rotation===270)[u,v]=[v,1-u];
      return {x:52+u*896,y:52+v*1310};
    },

    extractNameRegion(canvas, H, orientationTransform = 'identity') {
      // Canonical GradeDock sheet coordinates for the handwritten Name line.
      // We intentionally stop just above the printed underline so OCR sees
      // mostly handwriting instead of a long horizontal rule.
      const x0 = 118, y0 = 142, x1 = 604, y1 = 190;
      const scale = 3;
      const out = document.createElement('canvas');
      out.width = Math.round((x1 - x0) * scale);
      out.height = Math.round((y1 - y0) * scale);
      const octx = out.getContext('2d', { willReadFrequently: true });
      const src = canvas.getContext('2d', { willReadFrequently: true });
      const srcImg = src.getImageData(0, 0, canvas.width, canvas.height);
      const dst = octx.createImageData(out.width, out.height);
      const sp = srcImg.data, dp = dst.data;

      for (let oy = 0; oy < out.height; oy++) {
        const cy = y0 + oy / scale;
        for (let ox = 0; ox < out.width; ox++) {
          const cx = x0 + ox / scale;
          const t = this.transformCanonicalPoint(cx, cy, orientationTransform);
          const p = this.map(H, t.x, t.y);
          const sx = Math.max(0, Math.min(canvas.width - 1, Math.round(p.x)));
          const sy = Math.max(0, Math.min(canvas.height - 1, Math.round(p.y)));
          const si = (sy * canvas.width + sx) * 4;
          const di = (oy * out.width + ox) * 4;
          const g = Math.round(sp[si] * .299 + sp[si + 1] * .587 + sp[si + 2] * .114);
          // Gentle contrast boost for pencil/pen handwriting while keeping paper white.
          const v = g < 205 ? Math.max(0, Math.round((g - 45) * 1.22)) : 255;
          dp[di] = dp[di + 1] = dp[di + 2] = v;
          dp[di + 3] = 255;
        }
      }
      octx.putImageData(dst, 0, 0);
      return out;
    },

    async readStudentName(canvas, H, orientationTransform = 'identity') {
      if (!window.Tesseract?.createWorker) {
        return { text: '', available: false, reason: 'OCR library unavailable' };
      }
      try {
        if (!this._ocrWorkerPromise) {
          this._ocrWorkerPromise = window.Tesseract.createWorker('eng').then(async worker => {
            await worker.setParameters({
              tessedit_pageseg_mode: '7',
              preserve_interword_spaces: '1',
              tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz .'-"
            });
            return worker;
          });
        }
        const worker = await this._ocrWorkerPromise;
        const nameCanvas = this.extractNameRegion(canvas, H, orientationTransform);
        const result = await worker.recognize(nameCanvas);
        let text = String(result?.data?.text || '')
          .replace(/[_|]+/g, ' ')
          .replace(/[^A-Za-z .'-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim();
        // Avoid filling obvious OCR noise into the name field.
        const letters = (text.match(/[A-Za-z]/g) || []).length;
        if (letters < 2) text = '';
        return { text, available: true, confidence: Number(result?.data?.confidence || 0), crop: nameCanvas };
      } catch (err) {
        console.warn('Name OCR failed:', err);
        return { text: '', available: true, reason: err?.message || 'Name OCR failed' };
      }
    },

    analyze(canvas, exam, answerKey=[], options={}) {
      const markers = options.markers || this.findMarkers(canvas);
      if (!Array.isArray(markers) || markers.length !== 4 || markers.some(p => !Number.isFinite(p.x)||!Number.isFinite(p.y))) {
        throw new Error('The printed sheet could not be aligned. Try again with the entire paper visible.');
      }
      const polygonArea = Math.abs((markers[0].x*markers[1].y-markers[0].y*markers[1].x) +
        (markers[1].x*markers[3].y-markers[1].y*markers[3].x) +
        (markers[3].x*markers[2].y-markers[3].y*markers[2].x) +
        (markers[2].x*markers[0].y-markers[2].y*markers[0].x))/2;
      if (polygonArea < canvas.width*canvas.height*.045)
        throw new Error('The paper appears too far away or partly outside the photo. Move closer while keeping the entire page visible.');
      const src = markers.map(m => [m.x, m.y]);
      const L = window.GradeDockSheet.layout(Number(exam.question_count), Number(exam.choice_count));
      const dst = L.markers.map(m => [m.x, m.y]);
      const H = this.solveHomography(dst, src);

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pix = image.data;

      // Registration is geometric. Never require OCR of tiny item numbers:
      // even GradeDock-generated sheets lose that detail in ordinary phone photos.
      // The printed bubble circles and section frames provide stronger landmarks.

      const clamp = (v, a=0, b=1) => Math.max(a, Math.min(b, v));
      const quantile = (values, q) => {
        if (!values.length) return 0;
        const a = [...values].sort((x, y) => x - y);
        const pos = (a.length - 1) * q;
        const lo = Math.floor(pos), hi = Math.ceil(pos);
        if (lo === hi) return a[lo];
        const t = pos - lo;
        return a[lo] * (1 - t) + a[hi] * t;
      };
      const median = values => quantile(values, .5);

      // Bilinear sampling is noticeably more stable than rounding to one source
      // pixel when a phone photo is skewed. This reduces false choice shifts near
      // bubble edges after perspective correction.
      const grayAtSource = (x, y) => {
        x = clamp(x, 0, canvas.width - 1);
        y = clamp(y, 0, canvas.height - 1);
        const x0 = Math.floor(x), y0 = Math.floor(y);
        const x1 = Math.min(canvas.width - 1, x0 + 1), y1 = Math.min(canvas.height - 1, y0 + 1);
        const tx = x - x0, ty = y - y0;
        const g = (xx, yy) => {
          const i = (yy * canvas.width + xx) * 4;
          return pix[i] * .299 + pix[i + 1] * .587 + pix[i + 2] * .114;
        };
        const a = g(x0,y0) * (1-tx) + g(x1,y0) * tx;
        const b = g(x0,y1) * (1-tx) + g(x1,y1) * tx;
        return a * (1-ty) + b * ty;
      };
      // Estimate paper brightness from the captured page. We use a high quantile,
      // not a fixed 255, so shadows and slightly gray paper do not destroy the
      // contrast calculations.
      const pageBrightnessSamples = [];
      for (let y = 0; y < canvas.height; y += Math.max(10, Math.floor(canvas.height / 55))) {
        for (let x = 0; x < canvas.width; x += Math.max(10, Math.floor(canvas.width / 45))) {
          pageBrightnessSamples.push(grayAtSource(x, y));
        }
      }
      const pagePaper = Math.max(120, quantile(pageBrightnessSamples, .82));

      // Registration squares are symmetric: they locate the sheet, but do not
      // establish its reading direction. Compare the actual *printed layout*
      // across all 8 orientations; no OCR, tiny number decoding or answer-key
      // matching is used. Circle outlines, box borders and header rules are
      // independent of whether the student shaded A, B, C, or D.
      const orientationScore = (transform) => {
        const at=(x,y)=>{
          const xy=this.transformCanonicalPoint(x,y,transform);
          const p=this.map(H,xy.x,xy.y);
          return grayAtSource(p.x,p.y);
        };
        let ringTotal=0, rings=0;
        const step=Math.max(1,Math.floor(L.items.length/20));
        for(let n=0;n<L.items.length;n+=step){
          const item=L.items[n];
          for(const b of item.bubbles){
            for(let k=0;k<12;k++){
              const a=k*Math.PI/6,co=Math.cos(a),si=Math.sin(a);
              // Printed ring has radius 12. The area immediately outside it
              // should be paper regardless of the filled choice.
              const inside=at(b.x+12*co,b.y+12*si);
              const outside=at(b.x+18*co,b.y+18*si);
              ringTotal+=clamp((outside-inside)/90,-.6,1);
              rings++;
            }
          }
        }
        // Top header and rectangular answer panels are not rotationally
        // symmetric. Compare known dark border lines with nearby white paper.
        let frameTotal=0,frames=0;
        const edge=(x,y,ox,oy)=>{
          frameTotal+=clamp((at(x+ox,y+oy)-at(x,y))/90,-.6,1);
          frames++;
        };
        // Top name / section lines and direction-box border.
        for(let x=125;x<595;x+=25)edge(x,190,0,-8);
        for(let x=692;x<916;x+=25)edge(x,190,0,-8);
        for(let x=86;x<918;x+=28)edge(x,215,0,-8);
        // Both column outlines; different positions for single-column exams.
        const lefts=L.columns===2?[58,526]:[252];
        const widths=L.columns===2?[416,416]:[496];
        for(let j=0;j<lefts.length;j++){
          const left=lefts[j],right=left+widths[j];
          for(let y=370;y<1240;y+=38){
            edge(left,y,9,0);edge(right,y,-9,0);
          }
          for(let x=left+24;x<right-14;x+=27)edge(x,334,0,8);
        }
        return {transform, ring:ringTotal/Math.max(1,rings),frame:frameTotal/Math.max(1,frames),
          score:.75*ringTotal/Math.max(1,rings)+.25*frameTotal/Math.max(1,frames)};
      };
      const orientationCandidates=['identity','rotate90','rotate180','rotate270',
        'mirror0','mirror90','mirror180','mirror270']
        .map(orientationScore).sort((a,b)=>b.score-a.score);
      const winner=orientationCandidates[0],runnerUp=orientationCandidates[1];
      // Do not reject a photograph because fine print is blurry. When the
      // structural score is inconclusive the sheet may be blurred, too small,
      // or missing; grading still has the independent circle alignment gate
      // below, and every low-confidence answer must be reviewed manually.
      const orientationTransform=winner.transform;
      const orientationAmbiguous=winner.score<.045 || winner.score-runnerUp.score<.014;
      const normalOrientationScore=orientationCandidates.find(x=>x.transform==='identity').score;
      const mirroredOrientationScore=orientationCandidates.find(x=>x.transform==='mirror0').score;

      const mapCanonical = (x, y) => {
        const t = this.transformCanonicalPoint(x, y, orientationTransform);
        return this.map(H, t.x, t.y);
      };

      // Register the printed circle outlines, never the student's chosen answer.
      // Row and individual-circle offsets stay below half the choice spacing.
      const rowOffsets = new Map();
      const bubbleOffsets = new Map();
      let alignedRows = 0;
      const ringFit=(b,ox,oy)=>{
        let sum=0;
        for(let k=0;k<24;k++){
          const angle=k*Math.PI/12;
          const sample=radius=>{
            const p=mapCanonical(b.x+ox+Math.cos(angle)*radius,b.y+oy+Math.sin(angle)*radius);
            return grayAtSource(p.x,p.y);
          };
          sum+=(sample(16)-sample(12))/255;
        }
        return sum/24;
      };
      // Paper curl can move a row more than a few pixels after a four-corner
      // warp. Search less than half a row/choice spacing, then refine each ring.
      const rowGap=L.rows>1?(L.rowBottom-L.rowTop)/(L.rows-1):48;
      const maxY=Math.min(18,Math.floor(rowGap*.36));
      for(const item of L.items){
        let best={score:-Infinity,x:0,y:0};
        const evaluate=(ox,oy)=>{
          const score=median(item.bubbles.map(b=>ringFit(b,ox,oy)))-.00002*(ox*ox+oy*oy);
          if(score>best.score)best={score,x:ox,y:oy};
        };
        for(let oy=-maxY;oy<=maxY;oy+=2)for(let ox=-16;ox<=16;ox+=2)evaluate(ox,oy);
        const coarse={...best};
        for(let oy=coarse.y-1;oy<=coarse.y+1;oy++)for(let ox=coarse.x-1;ox<=coarse.x+1;ox++)evaluate(ox,oy);
        rowOffsets.set(item.number,best);
        if(best.score>.10)alignedRows++;
        for(const bubble of item.bubbles){
          let fit={score:-Infinity,x:best.x,y:best.y};
          for(let dy=-3;dy<=3;dy++)for(let dx=-3;dx<=3;dx++){
            const score=ringFit(bubble,best.x+dx,best.y+dy)-.001*(dx*dx+dy*dy);
            if(score>fit.score)fit={score,x:best.x+dx,y:best.y+dy};
          }
          bubbleOffsets.set(bubble,fit);
        }
      }
      if (alignedRows < Math.ceil(L.items.length * .70)) {
        throw new Error('GradeDock found the printed corner marks, but the bubble-circle outlines could not be aligned confidently. Try uploading the original full-resolution photo, or retake it with the entire page sharp and evenly lit.');
      }

      const bubbleInk = (cx, cy, offset) => {
        const sample = (dx,dy) => {
          const p = mapCanonical(cx + offset.x + dx, cy + offset.y + dy);
          return grayAtSource(p.x,p.y);
        };
        const bg = [];
        for (let k=0;k<32;k++) {
          const angle=k*Math.PI/16;
          bg.push(sample(17*Math.cos(angle),17*Math.sin(angle)));
        }
        const paper = quantile(bg,.75);
        const span = Math.max(60,paper-25);
        let count=0, dark=0, contrast=0;
        const sectors=Array.from({length:4},()=>({n:0,dark:0}));
        // Use identical writable areas for A through E. Exclude the entire
        // printed-letter rectangle (PDF/PNG/browser fonts differ), plus the
        // circle boundary. Do not hunt for the darkest neighbouring pixels.
        for(let dy=-9;dy<=9;dy++) for(let dx=-9;dx<=9;dx++) {
          if(dx*dx+dy*dy>90.25 || (Math.abs(dx)<=5.5 && Math.abs(dy)<=7.5)) continue;
          const delta=Math.max(0,paper-sample(dx,dy));
          const marked=delta>Math.max(22,span*.14);
          const sector=(dy>=0?2:0)+(dx>=0?1:0);
          sectors[sector].n++;
          if(marked){dark++;sectors[sector].dark++;}
          contrast+=clamp(delta/span);
          count++;
        }
        const coverage=count?dark/count:0;
        const meanContrast=count?contrast/count:0;
        const supportedSectors=sectors.filter(s=>s.n && s.dark/s.n>=.30).length;
        return {score:.70*coverage+.30*meanContrast, coverage, meanContrast,
          supportedSectors, paper, total:count};
      };
      const measured=L.items.map(item=>({item,raw:item.bubbles.map(b=>{
        const metric=bubbleInk(b.x,b.y,bubbleOffsets.get(b));
        return {choice:b.choice,score:metric.score,metric};
      })}));
      const markThreshold=.16, lightMarkThreshold=.24, strongMarkThreshold=.40;
      const discriminationMargin=.14;
      const noise=0, globalBase=0;

      const detected = [];
      let uncertain = 0, correct = 0;

      for (const row of measured) {
        const scores = row.raw.map(x => ({...x,rawScore:x.score})).sort((a,b)=>b.score-a.score);
        const best=scores[0], second=scores[1];
        const margin=best.score-second.score;
        const hasMark = x => x.score>=lightMarkThreshold &&
          x.metric.coverage>=.30 && x.metric.supportedSectors>=2;
        let answer='', state='blank';
        if (hasMark(best) && hasMark(second)) {
          // Two marks remain unresolved even if one is darker. Never choose
          // an answer based on the answer key or silently pick the darkest.
          state='multiple';
        } else if (hasMark(best)) {
          answer=best.choice;
          state=best.score>=strongMarkThreshold && margin>=discriminationMargin &&
            best.metric.coverage>=.50 && best.metric.supportedSectors>=3 ? 'ok' : 'low';
        } else if (best.score>=markThreshold) {
          state='low';
        }
        if (rowOffsets.get(row.item.number).score <= .10 || orientationAmbiguous) {
          // An uncertain physical orientation must never be automatically scored.
          // Offer the teacher a review rather than guessing by the answer key.
          answer=''; state='low';
        }
        if (state!=='ok') uncertain++;

        const key = answerKey[row.item.number - 1] || '';
        const isCorrect = state === 'ok' && answer === key;
        if (isCorrect) correct++;
        detected.push({
          question: row.item.number,
          answer,
          key,
          isCorrect,
          state,
          scores,
          thresholds: {
            mark: markThreshold,
            light: lightMarkThreshold,
            strong: strongMarkThreshold,
            discrimination: discriminationMargin
          }
        });
      }

      const confidence = Math.round(100 * (L.items.length - uncertain) / L.items.length);
      return {
        markers,
        answers: detected,
        correct,
        total: L.items.length,
        percentage: Math.round(correct / L.items.length * 10000) / 100,
        uncertain,
        confidence,
        homography: H,
        orientationTransform,
        cameraMirrorCorrected: orientationTransform !== 'identity',
        orientationAmbiguous,
        orientationScores: { normal: normalOrientationScore, mirrored: mirroredOrientationScore },
        alignment: { alignedRows, totalRows: L.items.length },
        sensitivity: {
          markThreshold,
          lightMarkThreshold,
          strongMarkThreshold,
          discriminationMargin,
          noise,
          globalBase
        }
      };
    }
  };
  window.GradeDockScanner=Scanner;
})();
