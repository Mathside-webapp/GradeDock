(function () {
  const Scanner = {
    stream: null,
    facingMode: 'environment',

    async startCamera(video) {
      this.stopCamera(video);
      if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        throw new Error('Live camera requires HTTPS or localhost. If you opened index.html directly, use a local server/GitHub Pages or choose Take photo instead.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Live camera is not available in this browser. Use Take photo instead or Upload image.');
      }

      const preferred = {
        video: {
          facingMode: { ideal: this.facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
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

    capture(video, canvas) {
      const w = video.videoWidth, h = video.videoHeight;
      if (!w || !h) throw new Error('Camera is not ready yet.');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      return canvas;
    },

    async fileToCanvas(file, canvas) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; });
      const max = 1800, scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
      canvas.width = Math.round(img.naturalWidth * scale); canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      return canvas;
    },

    findMarkers(canvas) {
      const maxW = 700, scale = Math.min(1, maxW / canvas.width);
      const sw = Math.round(canvas.width * scale), sh = Math.round(canvas.height * scale);
      const temp = document.createElement('canvas'); temp.width = sw; temp.height = sh;
      const tctx = temp.getContext('2d', { willReadFrequently: true }); tctx.drawImage(canvas, 0, 0, sw, sh);
      const data = tctx.getImageData(0, 0, sw, sh).data;
      const gray = (x,y) => { const i=(y*sw+x)*4; return (data[i]*.299 + data[i+1]*.587 + data[i+2]*.114); };
      const regions = [
        [0,0,Math.floor(sw*.36),Math.floor(sh*.28),'tl'], [Math.floor(sw*.64),0,sw,Math.floor(sh*.28),'tr'],
        [0,Math.floor(sh*.72),Math.floor(sw*.36),sh,'bl'], [Math.floor(sw*.64),Math.floor(sh*.72),sw,sh,'br']
      ];
      const out = [];
      for (const [x0,y0,x1,y1,name] of regions) {
        const rw=x1-x0, rh=y1-y0, seen=new Uint8Array(rw*rh), comps=[];
        const idx=(x,y)=>(y-y0)*rw+(x-x0);
        for(let y=y0;y<y1;y+=1){ for(let x=x0;x<x1;x+=1){
          const si=idx(x,y); if(seen[si] || gray(x,y)>90) continue;
          const stack=[[x,y]]; seen[si]=1; let area=0,minX=x,maxX=x,minY=y,maxY=y;
          while(stack.length){ const [cx,cy]=stack.pop(); area++; if(cx<minX)minX=cx;if(cx>maxX)maxX=cx;if(cy<minY)minY=cy;if(cy>maxY)maxY=cy;
            for(const [nx,ny] of [[cx+1,cy],[cx-1,cy],[cx,cy+1],[cx,cy-1]]){ if(nx<x0||nx>=x1||ny<y0||ny>=y1) continue; const ni=idx(nx,ny); if(seen[ni])continue; seen[ni]=1; if(gray(nx,ny)<=90) stack.push([nx,ny]); }
          }
          const bw=maxX-minX+1,bh=maxY-minY+1,box=bw*bh, ratio=bw/bh, fill=area/box;
          if(area>35 && ratio>.55 && ratio<1.65 && fill>.45 && bw<rw*.35 && bh<rh*.35) comps.push({area,bw,bh,cx:(minX+maxX)/2,cy:(minY+maxY)/2,fill});
        }}
        if(!comps.length) throw new Error(`Could not find the ${name.toUpperCase()} registration marker. Keep all four black squares visible.`);
        const corner = name==='tl'?[0,0]:name==='tr'?[sw,0]:name==='bl'?[0,sh]:[sw,sh];
        comps.forEach(c=>{const d=Math.hypot(c.cx-corner[0],c.cy-corner[1]);c.score=c.area*2-d*.35;});
        comps.sort((a,b)=>b.score-a.score); const best=comps[0];
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
        [A[col],A[pivot]]=[A[pivot],A[col]]; const div=A[col][col]; if(Math.abs(div)<1e-9) throw new Error('Could not correct page perspective. Retake the photo more directly above the sheet.');
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
        // Estimate the local paper brightness just outside the printed bubble.
        // This compensates for shadows and uneven phone-camera lighting.
        const bg = [];
        for (let dy = -18; dy <= 18; dy += 2) {
          for (let dx = -18; dx <= 18; dx += 2) {
            const d2 = dx * dx + dy * dy;
            if (d2 < 196 || d2 > 324) continue; // radius 14..18
            const p = this.map(H, cx + dx, cy + dy);
            bg.push(grayAtSource(p.x, p.y));
          }
        }
        const paper = quantile(bg, .75) || 255;
        const denom = Math.max(90, paper - 45);

        let inkSum = 0, darkCount = 0, total = 0;
        for (let dy = -10; dy <= 10; dy++) {
          for (let dx = -10; dx <= 10; dx++) {
            const d2 = dx * dx + dy * dy;
            if (d2 > 92) continue;

            // Only inspect areas that are white on the generated template.
            // This removes almost all baseline darkness from the printed letter.
            const refGray = grayAtReference(cx + dx, cy + dy);
            if (refGray < 238) continue;

            const p = this.map(H, cx + dx, cy + dy);
            const g = grayAtSource(p.x, p.y);
            const ink = Math.max(0, Math.min(1, (paper - g) / denom));
            inkSum += ink;
            if (g < paper - 28) darkCount++;
            total++;
          }
        }
        if (!total) return 0;
        return .62 * (inkSum / total) + .38 * (darkCount / total);
      };

      // Measure every bubble first. The final decision is relative to the sheet's
      // own noise level and to the other choices on the same question. This is
      // much more sensitive to a light/small shade than a fixed threshold.
      const measured = L.items.map(item => ({
        item,
        raw: item.bubbles.map(b => ({ choice: b.choice, score: bubbleInk(b.x, b.y) }))
      }));
      const allRaw = measured.flatMap(m => m.raw.map(x => x.score));
      const globalBase = quantile(allRaw, .30);
      const lowBand = allRaw.filter(v => v <= quantile(allRaw, .65));
      const lowMedian = median(lowBand);
      const mad = median(lowBand.map(v => Math.abs(v - lowMedian)));
      const noise = Math.max(.0015, mad * 1.4826);

      // weak: enough evidence to read the letter, but require teacher confirmation.
      // strong: safe enough to accept automatically.
      const weakThreshold = Math.max(.0045, noise * 1.55);
      const strongThreshold = Math.max(.0105, noise * 3.1);

      const detected = [];
      let uncertain = 0, correct = 0;

      for (const row of measured) {
        const adjusted = row.raw.map(x => ({
          choice: x.choice,
          rawScore: x.score,
          adjusted: Math.max(0, x.score - globalBase)
        }));
        const sortedAdjusted = adjusted.map(x => x.adjusted).sort((a, b) => a - b);
        const lowCount = Math.max(2, Math.floor(sortedAdjusted.length / 2));
        const rowBase = sortedAdjusted.slice(0, lowCount).reduce((a, b) => a + b, 0) / lowCount;
        const scores = adjusted.map(x => ({
          choice: x.choice,
          score: Math.max(0, x.adjusted - rowBase),
          rawScore: x.rawScore
        })).sort((a, b) => b.score - a.score);

        const best = scores[0] || { choice: '', score: 0 };
        const second = scores[1] || { choice: '', score: 0 };
        let answer = '';
        let state = 'ok';

        if (best.score < weakThreshold) {
          state = 'blank';
          uncertain++;
        } else if (second.score >= weakThreshold && (second.score >= best.score * .42 || second.score >= strongThreshold * 1.6)) {
          // Two choices both contain meaningful extra ink. Never guess: keep the
          // strongest as a preview, but require the teacher to confirm one choice.
          answer = best.choice;
          state = 'multiple';
          uncertain++;
        } else {
          answer = best.choice;
          if (best.score < strongThreshold) {
            // A light/small shade was detected. We keep the detected letter instead
            // of treating it as blank, but ask the teacher to confirm it once.
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
          thresholds: { weak: weakThreshold, strong: strongThreshold }
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
        sensitivity: { weakThreshold, strongThreshold, noise, globalBase }
      };
    }
  };
  window.GradeDockScanner=Scanner;
})();
