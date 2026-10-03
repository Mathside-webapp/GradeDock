(function () {
  const Scanner = {
    stream: null,
    facingMode: 'environment',
    orientation: 'landscape',

    async startCamera(video) {
      this.stopCamera(video);
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        throw new Error('Live camera requires HTTPS or localhost. If you opened index.html directly, use a local server/GitHub Pages or choose Take photo instead.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Live camera is not available in this browser. Use Take photo instead or Upload image.');
      }

      const portrait = this.orientation === 'portrait';
      const preferred = {
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: portrait ? 1080 : 1920 },
          height: { ideal: portrait ? 1920 : 1080 },
          aspectRatio: { ideal: portrait ? 0.75 : (4 / 3) }
        },
        audio: false
      };

      try {
        this.stream = await navigator.mediaDevices.getUserMedia(preferred);
      } catch (err) {
        // Some desktop cameras reject facingMode/size constraints. Retry with a plain video request.
        if (['OverconstrainedError', 'NotFoundError'].includes(err?.name)) {
          this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        } else if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
          throw new Error('Camera permission was blocked. Allow camera access in your browser, then press Start camera again.');
        } else if (err?.name === 'NotReadableError') {
          throw new Error('The camera is already being used by another app or browser tab. Close it there and try again.');
        } else {
          throw err;
        }
      }

      video.srcObject = this.stream;
      // Ask supported mobile cameras to keep focus/exposure/white balance moving
      // continuously while the teacher positions the paper. Unsupported browsers
      // simply ignore these optional constraints.
      try {
        const track = this.stream.getVideoTracks?.()[0];
        const caps = track?.getCapabilities?.() || {};
        const advanced = {};
        if (Array.isArray(caps.focusMode) && caps.focusMode.includes('continuous')) advanced.focusMode = 'continuous';
        if (Array.isArray(caps.exposureMode) && caps.exposureMode.includes('continuous')) advanced.exposureMode = 'continuous';
        if (Array.isArray(caps.whiteBalanceMode) && caps.whiteBalanceMode.includes('continuous')) advanced.whiteBalanceMode = 'continuous';
        if (Object.keys(advanced).length) await track.applyConstraints({ advanced: [advanced] });
      } catch (_) {}
      await new Promise((resolve, reject) => {
        if (video.readyState >= 1) return resolve();
        const onLoaded = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('The camera opened but the video preview could not start.')); };
        const cleanup = () => { video.removeEventListener('loadedmetadata', onLoaded); video.removeEventListener('error', onError); };
        video.addEventListener('loadedmetadata', onLoaded, { once: true });
        video.addEventListener('error', onError, { once: true });
      });
      await video.play();
      return true;
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
      const maxW = 520;
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

      if (mean < 48) {
        return { state: 'warn', ready: false, title: 'Too dark to scan', text: 'Add soft light or move out of the shadow.', mean, sharpness };
      }
      if (glare > .26 && mean > 188) {
        return { state: 'warn', ready: false, title: 'Glare detected', text: 'Tilt the phone or move away from direct light.', mean, sharpness, glare };
      }
      if (sharpness < 3.5) {
        return { state: 'focus', ready: false, title: 'Image is not focused', text: 'Hold still and wait for the camera to focus.', mean, sharpness };
      }
      if (darkRatio > .35) {
        return { state: 'warn', ready: false, title: 'Paper is partly covered', text: 'Keep fingers and dark objects away from the answer sheet.', mean, sharpness };
      }

      try {
        const markers = this.findMarkers(canvas);
        return {
          state: 'ready', ready: true,
          title: 'Good to scan',
          text: 'Paper is visible and focused. Tap Capture & check.',
          markers, mean, sharpness, glare
        };
      } catch (err) {
        return {
          state: 'searching', ready: false,
          title: 'Not ready to scan',
          text: 'Show the entire answer sheet, including all four printed black corner marks.',
          mean, sharpness, reason: err?.message || ''
        };
      }
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
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const max = 2400, scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      return canvas;
    },

    findMarkers(canvas) {
      const maxW = 900, scale = Math.min(1, maxW / canvas.width);
      const sw = Math.max(1, Math.round(canvas.width * scale)), sh = Math.max(1, Math.round(canvas.height * scale));
      const temp = document.createElement('canvas'); temp.width = sw; temp.height = sh;
      const tctx = temp.getContext('2d', { willReadFrequently: true });
      tctx.drawImage(canvas, 0, 0, sw, sh);
      const data = tctx.getImageData(0, 0, sw, sh).data;
      const gray = (x,y) => { const i=(y*sw+x)*4; return data[i]*.299 + data[i+1]*.587 + data[i+2]*.114; };
      const q = (a, p) => {
        if (!a.length) return 0;
        const b=[...a].sort((x,y)=>x-y), pos=(b.length-1)*p, lo=Math.floor(pos), hi=Math.ceil(pos);
        return lo===hi ? b[lo] : b[lo]*(hi-pos)+b[hi]*(pos-lo);
      };
      const regions = [
        [0,0,Math.floor(sw*.38),Math.floor(sh*.30),'tl'], [Math.floor(sw*.62),0,sw,Math.floor(sh*.30),'tr'],
        [0,Math.floor(sh*.70),Math.floor(sw*.38),sh,'bl'], [Math.floor(sw*.62),Math.floor(sh*.70),sw,sh,'br']
      ];
      const out = [];
      for (const [x0,y0,x1,y1,name] of regions) {
        const rw=x1-x0, rh=y1-y0;
        const sampled=[];
        for(let y=y0;y<y1;y+=3) for(let x=x0;x<x1;x+=3) sampled.push(gray(x,y));
        const low=q(sampled,.06), paper=q(sampled,.62);
        // Adaptive threshold keeps the black markers visible even when one side of
        // the paper sits in a shadow. It is intentionally capped so normal text
        // does not merge into huge components.
        const threshold=Math.max(48,Math.min(142,low+(paper-low)*.30));
        const seen=new Uint8Array(rw*rh), comps=[];
        const idx=(x,y)=>(y-y0)*rw+(x-x0);
        for(let y=y0;y<y1;y++) for(let x=x0;x<x1;x++) {
          const si=idx(x,y); if(seen[si] || gray(x,y)>threshold) continue;
          const stack=[[x,y]]; seen[si]=1; let area=0,minX=x,maxX=x,minY=y,maxY=y;
          while(stack.length){
            const [cx,cy]=stack.pop(); area++;
            if(cx<minX)minX=cx;if(cx>maxX)maxX=cx;if(cy<minY)minY=cy;if(cy>maxY)maxY=cy;
            for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){
              if(nx<x0||nx>=x1||ny<y0||ny>=y1) continue;
              const ni=idx(nx,ny); if(seen[ni]) continue; seen[ni]=1;
              if(gray(nx,ny)<=threshold) stack.push([nx,ny]);
            }
          }
          const bw=maxX-minX+1,bh=maxY-minY+1,box=bw*bh,ratio=bw/bh,fill=area/Math.max(1,box);
          const minSide=Math.min(bw,bh), maxSide=Math.max(bw,bh);
          if(area>28 && ratio>.50 && ratio<1.95 && fill>.32 && minSide>3 && maxSide<Math.max(rw,rh)*.30) {
            comps.push({area,bw,bh,cx:(minX+maxX)/2,cy:(minY+maxY)/2,fill,ratio});
          }
        }
        if(!comps.length) throw new Error('The full answer sheet is not visible yet.');
        const corner=name==='tl'?[x0,y0]:name==='tr'?[x1,y0]:name==='bl'?[x0,y1]:[x1,y1];
        const diag=Math.hypot(rw,rh) || 1;
        comps.forEach(c=>{
          const d=Math.hypot(c.cx-corner[0],c.cy-corner[1])/diag;
          const square=1-Math.min(1,Math.abs(Math.log(Math.max(.01,c.ratio))));
          const side=Math.min(c.bw,c.bh)/Math.max(1,Math.min(rw,rh));
          const sizeFit=1-Math.min(1,Math.abs(side-.075)/.075);
          c.score=(1-d)*5 + c.fill*2.2 + square*2 + sizeFit*1.4 + Math.min(1,c.area/(rw*rh*.015));
        });
        comps.sort((a,b)=>b.score-a.score);
        const best=comps[0];
        out.push({ x: best.cx/scale, y: best.cy/scale, name });
      }
      return out;
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

    extractNameRegion(canvas, H) {
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
          const p = this.map(H, cx, cy);
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

    async readStudentName(canvas, H) {
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
        const nameCanvas = this.extractNameRegion(canvas, H);
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

    analyze(canvas, exam, answerKey=[]) {
      const markers = this.findMarkers(canvas);
      const src = markers.map(m => [m.x, m.y]);
      const L = window.GradeDockSheet.layout(Number(exam.question_count), Number(exam.choice_count));
      const dst = L.markers.map(m => [m.x, m.y]);
      const H = this.solveHomography(dst, src);

      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const pix = image.data;

      // Build a clean GradeDock reference sheet once for this scan. We use its
      // white pixels as a mask, so the printed A/B/C/D letter inside the bubble
      // and the circle outline are not mistaken for a student's mark.
      const reference = window.GradeDockSheet.renderCanvas({
        title: '',
        question_count: Number(exam.question_count),
        choice_count: Number(exam.choice_count)
      }, '', 1);
      const rctx = reference.getContext('2d', { willReadFrequently: true });
      const refData = rctx.getImageData(0, 0, reference.width, reference.height).data;

      const grayAtSource = (x, y) => {
        const sx = Math.max(0, Math.min(canvas.width - 1, Math.round(x)));
        const sy = Math.max(0, Math.min(canvas.height - 1, Math.round(y)));
        const i = (sy * canvas.width + sx) * 4;
        return pix[i] * .299 + pix[i + 1] * .587 + pix[i + 2] * .114;
      };
      const grayAtReference = (x, y) => {
        const rx = Math.max(0, Math.min(reference.width - 1, Math.round(x)));
        const ry = Math.max(0, Math.min(reference.height - 1, Math.round(y)));
        const i = (ry * reference.width + rx) * 4;
        return refData[i] * .299 + refData[i + 1] * .587 + refData[i + 2] * .114;
      };
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

      const bubbleInk = (cx, cy) => {
        // Sample a bubble against the paper immediately around it. This local
        // contrast approach is deliberately shadow-tolerant: a pencil mark is
        // compared with nearby paper, not with one fixed global gray value.
        const sampleAt = (ox = 0, oy = 0) => {
          const bg = [];
          for (let dy = -22; dy <= 22; dy += 2) {
            for (let dx = -22; dx <= 22; dx += 2) {
              const d2 = dx * dx + dy * dy;
              if (d2 < 225 || d2 > 484) continue; // radius 15..22
              if (grayAtReference(cx + dx + ox, cy + dy + oy) < 244) continue;
              const p = this.map(H, cx + dx + ox, cy + dy + oy);
              bg.push(grayAtSource(p.x, p.y));
            }
          }
          const paper = quantile(bg, .80) || quantile(bg, .65) || 255;
          const denom = Math.max(58, paper - 35);
          const inside = [];
          let inkSum = 0, dark12 = 0, dark20 = 0, dark32 = 0, total = 0;
          for (let dy = -11; dy <= 11; dy++) {
            for (let dx = -11; dx <= 11; dx++) {
              if (dx * dx + dy * dy > 112) continue;
              // Ignore the printed bubble outline/letter using the clean template,
              // while keeping as much writable white area as possible.
              if (grayAtReference(cx + dx + ox, cy + dy + oy) < 224) continue;
              const p = this.map(H, cx + dx + ox, cy + dy + oy);
              const g = grayAtSource(p.x, p.y);
              inside.push(g);
              inkSum += Math.max(0, Math.min(1, (paper - g) / denom));
              if (g < paper - 12) dark12++;
              if (g < paper - 20) dark20++;
              if (g < paper - 32) dark32++;
              total++;
            }
          }
          if (!total) return { score: 0, paper, total: 0 };
          const darkestBand = Math.max(0, Math.min(1, (paper - quantile(inside, .18)) / denom));
          const meanInk = inkSum / total;
          // Multiple complementary signals make faint graphite much less likely
          // to be called blank, while local normalization suppresses shadows.
          const score = .28 * meanInk + .20 * (dark12 / total) + .25 * (dark20 / total) + .12 * (dark32 / total) + .15 * darkestBand;
          return { score, paper, meanInk, dark12: dark12 / total, dark20: dark20 / total, darkestBand, total };
        };

        // Small homography/camera errors can move a bubble a couple of pixels.
        // Measure nearby offsets and retain the strongest legitimate ink signal.
        const samples = [[0,0],[-2,0],[2,0],[0,-2],[0,2]].map(([ox,oy]) => sampleAt(ox,oy));
        samples.sort((a,b) => b.score - a.score);
        return samples[0] || { score: 0 };
      };

      // Measure every bubble first. Final decisions use both sheet-wide noise and
      // the difference between choices in the same row. Uncertain light marks are
      // preserved for teacher confirmation rather than silently changed to blank.
      const measured = L.items.map(item => ({
        item,
        raw: item.bubbles.map(b => {
          const metric = bubbleInk(b.x, b.y);
          return { choice: b.choice, score: metric.score, metric };
        })
      }));
      const allRaw = measured.flatMap(m => m.raw.map(x => x.score));
      const globalBase = quantile(allRaw, .25);
      const lowBand = allRaw.filter(v => v <= quantile(allRaw, .60));
      const lowMedian = median(lowBand);
      const mad = median(lowBand.map(v => Math.abs(v - lowMedian)));
      const noise = Math.max(.0012, mad * 1.4826);

      // A very small amount of extra ink is kept as a possible light mark instead
      // of becoming blank. Strong marks still need a healthy lead over #2.
      const blankThreshold = Math.max(.0030, noise * .72);
      const weakThreshold = Math.max(.0060, noise * 1.20);
      const strongThreshold = Math.max(.0170, noise * 2.25);

      const detected = [];
      let uncertain = 0, correct = 0;

      for (const row of measured) {
        const adjusted = row.raw.map(x => ({
          choice: x.choice,
          rawScore: x.score,
          metric: x.metric,
          adjusted: Math.max(0, x.score - globalBase)
        }));
        const sortedAdjusted = adjusted.map(x => x.adjusted).sort((a, b) => a - b);
        const lowCount = Math.max(2, Math.floor(sortedAdjusted.length / 2));
        const rowBase = sortedAdjusted.slice(0, lowCount).reduce((a, b) => a + b, 0) / lowCount;
        const scores = adjusted.map(x => ({
          choice: x.choice,
          score: Math.max(0, x.adjusted - rowBase),
          rawScore: x.rawScore,
          metric: x.metric
        })).sort((a, b) => b.score - a.score);

        const best = scores[0] || { choice: '', score: 0 };
        const second = scores[1] || { choice: '', score: 0 };
        let answer = '';
        let state = 'ok';

        const margin = Math.max(0, best.score - second.score);
        if (best.score < blankThreshold) {
          state = 'blank';
          uncertain++;
        } else if (second.score >= weakThreshold && second.score >= best.score * .55) {
          // Two bubbles contain comparable local ink. Never guess between them.
          answer = best.choice;
          state = 'multiple';
          uncertain++;
        } else {
          answer = best.choice;
          if (best.score < strongThreshold || margin < weakThreshold) {
            // Preserve faint/partial shading as the likely answer and surface it
            // for teacher confirmation instead of incorrectly calling it blank.
            state = 'low';
            uncertain++;
          }
        }

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
          thresholds: { blank: blankThreshold, weak: weakThreshold, strong: strongThreshold }
        });
      }

      const confidence = Math.max(0, Math.round(100 - (uncertain / L.items.length * 62)));
      return {
        markers,
        answers: detected,
        correct,
        total: L.items.length,
        percentage: Math.round(correct / L.items.length * 10000) / 100,
        uncertain,
        confidence,
        homography: H,
        sensitivity: { blankThreshold, weakThreshold, strongThreshold, noise, globalBase }
      };
    }
  };
  window.GradeDockScanner=Scanner;
})();
