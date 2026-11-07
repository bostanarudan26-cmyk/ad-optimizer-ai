document.addEventListener('DOMContentLoaded', () => {
  window.__vibecheckReady = true;
  const $ = (id) => document.getElementById(id);
  const el = {
    input: $('imageInput'), drop: $('dropzone'), preview: $('previewContainer'), img: $('imagePreview'),
    resImg: $('resultImagePreview'), analyze: $('analyzeBtn'), reset: $('resetBtn'), err: $('uploadError'),
    upload: $('ecran-upload'), loading: $('ecran-loading'), results: $('ecran-rezultate'),
    loadText: $('loadingText'), bar: $('progressBar'), grid: $('segmentsGrid'),
  };
  let file = null, report = null, radar = null, donut = null, sortBy = 'risk';

  /* ============ CONTRACT CU BACKEND ============
     Backend-ul trebuie să returneze exact structura de mai jos.
     risk = 0..100 (procent de risc pe segment). Scorul total se calculează aici. */
  const MOCK_REPORT = {
    verdict: 'Reclama folosește un ton ironic care, scos din context, poate fi citit ca o ironizare a unui grup. Imaginea e puternică, dar sloganul transformă o glumă de brand într-un risc de reputație.',
    segments: [
      { name: 'Gen Z', emoji: '📱', risk: 90, comment: 'Boicot probabil pe TikTok, mesajul e perceput ca „cringe".' },
      { name: 'Millennials', emoji: '💻', risk: 65, comment: 'Nostalgie amestecată cu scepticism față de ton.' },
      { name: 'Părinți', emoji: '👨‍👩‍👧‍👦', risk: 75, comment: 'Mesajul pare nepotrivit pentru copii.' },
      { name: 'Seniori', emoji: '🧓', risk: 55, comment: 'Textul mic și referințele online îi exclud.' },
      { name: 'Studenți', emoji: '🎓', risk: 48, comment: 'Reacție mixtă, depinde de preț și de umor.' },
      { name: 'Antreprenori', emoji: '🚀', risk: 40, comment: 'Judecă campania prin ROI și oportunitate.' },
      { name: 'Corporatiști', emoji: '💼', risk: 20, comment: 'Ignorare activă, impact redus.' },
      { name: 'Activiști', emoji: '✊', risk: 95, comment: 'Țintă ideală pentru o campanie de „cancel".' },
    ],
    sentiment: { pozitiv: 18, neutru: 27, negativ: 55 },
    checks: [
      { label: 'Stereotipuri despre grupuri sociale', status: 'fail' },
      { label: 'Limbaj ambiguu sau ofensator', status: 'warn' },
      { label: 'Reprezentare și incluziune', status: 'warn' },
      { label: 'Afirmații înșelătoare', status: 'pass' },
      { label: 'Lizibilitate și contrast text', status: 'pass' },
    ],
    fixes: [
      { prio: 'Critic', risk: 90, text: 'Schimbă sloganul: elimină glumele bazate pe stereotipuri.' },
      { prio: 'Ridicat', risk: 70, text: 'Înlocuiește personajul principal cu o scenă neutră sau diversă.' },
      { prio: 'Moderat', risk: 50, text: 'Mărește textul legal și mesajul secundar pentru seniori.' },
    ],
    slogans: ['Alegerea ta, stilul tău.', 'Pentru fiecare zi care contează.', 'Fă-l al tău.'],
  };

  const toBase64 = (f) => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(',')[1]);
    r.onerror = () => rej(new Error('Nu am putut citi imaginea'));
    r.readAsDataURL(f);
  });

  // Dacă backend-ul lipsește sau dă eroare, arătăm date de exemplu și spunem clar de ce
  let demoReason = '';
  function setPill(isDemo) {
    const p = $('statusPill');
    p.textContent = isDemo ? 'Mod demo' : 'System Online';
    p.className = 'px-3 py-1 text-xs font-bold rounded-full border ' + (isDemo ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-green-500/10 text-green-400 border-green-500/20');
  }
  function demo(reason) {
    demoReason = reason;
    console.warn('Mod demo: ' + reason);
    setPill(true);
    return new Promise((res) => setTimeout(() => res(MOCK_REPORT), 800));
  }
  async function fetchAnalysis(f) {
    demoReason = '';
    if (location.protocol === 'file:') return demo('pagina e deschisă direct din folder, fără server');
    if (location.search.includes('mock')) return demo('ai cerut modul demo (?mock)');
    try {
      const r = await fetch('/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: f.data, mediaType: f.mediaType }) });
      const data = await r.json().catch(() => ({}));
      if (!r.ok) return demo(data.error || 'serverul a răspuns cu eroarea ' + r.status);
      setPill(false);
      return data;
    } catch (e) { return demo('nu mă pot conecta la server (' + e.message + ')'); }
  }

  /* ============ HELPERI ============ */
  const level = (r) => r >= 80 ? ['risk-crit', 'CRITIC'] : r >= 60 ? ['risk-high', 'RIDICAT'] : r >= 35 ? ['risk-mid', 'MODERAT'] : ['risk-low', 'SCĂZUT'];
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const totalScore = (segs) => {
    const rs = segs.map((s) => s.risk);
    return Math.round(0.5 * (rs.reduce((a, b) => a + b, 0) / rs.length) + 0.5 * Math.max(...rs));
  };
  function countUp(node, to, onTick) {
    const t0 = performance.now(), dur = 1200;
    (function step(now) {
      const k = Math.min((now - t0) / dur, 1), v = Math.round(to * (1 - Math.pow(1 - k, 3)));
      node.textContent = v; if (onTick) onTick(v);
      if (k < 1) requestAnimationFrame(step);
    })(t0);
  }

  /* ============ UPLOAD ============ */
  function showError(msg) { el.err.textContent = msg; el.err.classList.remove('hidden'); }
  // Micșorăm orice poză la maxim 1600px (JPG): nu mai există limită de mărime și încape în limita API-ului
  function handleFile(f) {
    el.err.classList.add('hidden');
    if (!f) return;
    const url = URL.createObjectURL(f), im = new Image();
    im.onload = () => {
      const k = Math.min(1, 1600 / Math.max(im.width, im.height)), c = document.createElement('canvas');
      c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(im, 0, 0, c.width, c.height);
      const dataUrl = c.toDataURL('image/jpeg', 0.88);
      URL.revokeObjectURL(url);
      file = { data: dataUrl.split(',')[1], mediaType: 'image/jpeg' };
      el.img.src = el.resImg.src = dataUrl;
      el.preview.classList.remove('hidden'); el.preview.classList.add('flex');
      el.drop.classList.add('hidden');
    };
    im.onerror = () => { URL.revokeObjectURL(url); showError('Nu pot citi această imagine. Încearcă un fișier JPG, PNG sau WEBP.'); };
    im.src = url;
  }
  el.input.addEventListener('change', (e) => handleFile(e.target.files[0]));
  ['dragover', 'dragleave', 'drop'].forEach((ev) => el.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    el.drop.classList.toggle('border-red-500', ev === 'dragover');
    if (ev === 'drop' && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  }));

  /* ============ ANALIZĂ + LOADING ============ */
  const steps = ['> Extracting visual semantics...', '> Initializing OCR text detection...', '> Running sociological risk models...', '> Simulating audience reactions...', '> Aggregating brand safety score...', '> Finalizing report...'];
  el.analyze.addEventListener('click', async () => {
    el.upload.classList.add('hidden'); el.loading.classList.remove('hidden'); el.loading.classList.add('flex');
    let p = 0, i = 0, done = false;
    const timer = setInterval(() => {
      p = Math.min(p + 2, done ? 100 : 92); // se oprește la 92% până răspunde backend-ul
      el.bar.style.width = p + '%';
      const idx = Math.min(Math.floor(p / 17), steps.length - 1);
      if (idx !== i || p === 2) { i = idx; el.loadText.textContent = steps[idx]; }
      if (p >= 100) { clearInterval(timer); setTimeout(() => render(report), 300); }
    }, 70);
    try { report = await fetchAnalysis(file); done = true; }
    catch (e) {
      clearInterval(timer); el.loading.classList.add('hidden'); el.loading.classList.remove('flex');
      el.upload.classList.remove('hidden'); showError('Analiza a eșuat: ' + e.message + '. Încearcă din nou.');
    }
  });

  /* ============ RANDARE REZULTATE ============ */
  function render(r) {
    el.loading.classList.add('hidden'); el.loading.classList.remove('flex'); el.results.classList.remove('hidden');
    let note = $('demoNotice');
    if (!note) { note = document.createElement('p'); note.id = 'demoNotice'; note.className = 'text-sm text-yellow-400 text-center mb-6'; el.results.prepend(note); }
    note.textContent = demoReason ? 'Date de exemplu, nu o analiză reală. Motiv: ' + demoReason + '.' : '';
    const score = totalScore(r.segments), [cls, label] = level(score);

    const ring = $('scoreRing'); ring.className = 'score-ring ' + cls;
    $('scoreBadge').className = 'mt-5 px-4 py-1.5 font-bold rounded-full border text-sm ' + cls;
    $('scoreBadge').textContent = label;
    $('scoreHint').textContent = 'Medie ponderată între riscul mediu și cel mai expus segment.';
    countUp($('scoreValue'), score, (v) => ring.style.setProperty('--p', v));

    $('verdictText').textContent = r.verdict;
    $('observedText').textContent = r.observed ? 'Ce a văzut AI-ul: ' + r.observed : '';
    $('fixesList').innerHTML = r.fixes.map((f) => `<li class="fix-item ${level(f.risk)[0]}"><b>${esc(f.prio)}</b><span>${esc(f.text)}</span></li>`).join('');

    const st = { fail: ['risk-crit', 'Problemă'], warn: ['risk-mid', 'Atenție'], pass: ['risk-low', 'În regulă'] };
    $('checksList').innerHTML = r.checks.map((c) => `<li class="check-item ${st[c.status][0]}"><span class="check-dot"></span><span class="flex-1">${esc(c.label)}</span><span class="pct text-xs">${st[c.status][1]}</span></li>`).join('');

    $('slogansList').innerHTML = r.slogans.map((s) => `<li class="slogan-item" tabindex="0" role="button" title="Click pentru a copia">${esc(s)}</li>`).join('');
    document.querySelectorAll('.slogan-item').forEach((n) => {
      const copy = () => { navigator.clipboard?.writeText(n.textContent); n.textContent = 'Copiat ✓'; setTimeout(() => (n.textContent = n.dataset.t), 1200); };
      n.dataset.t = n.textContent; n.addEventListener('click', copy); n.addEventListener('keydown', (e) => e.key === 'Enter' && copy());
    });

    renderSegments(); renderCharts(r);
  }

  function renderSegments() {
    const segs = [...report.segments].sort((a, b) => sortBy === 'risk' ? b.risk - a.risk : a.name.localeCompare(b.name, 'ro'));
    el.grid.innerHTML = segs.map((s) => {
      const [cls, label] = level(s.risk);
      return `<article class="seg-card glass-card ${cls}" data-tilt data-tilt-max="6">
        <div class="flex items-center justify-between mb-3"><h4 class="text-white font-bold">${esc(s.name)} ${s.emoji}</h4><span class="level-tag text-[10px] font-bold px-2 py-0.5 rounded-full">${label}</span></div>
        <div class="flex items-end justify-between mb-2"><span class="pct text-3xl"><span data-count="${s.risk}">0</span>%</span><span class="text-xs text-gray-500">risc</span></div>
        <div class="bar-track mb-3" role="progressbar" aria-valuenow="${s.risk}" aria-valuemin="0" aria-valuemax="100" aria-label="Risc ${esc(s.name)}"><div class="bar-fill" data-w="${s.risk}"></div></div>
        <p class="text-gray-400 text-xs leading-relaxed">${esc(s.comment)}</p></article>`;
    }).join('');
    requestAnimationFrame(() => {
      el.grid.querySelectorAll('.bar-fill').forEach((b) => (b.style.width = b.dataset.w + '%'));
      el.grid.querySelectorAll('[data-count]').forEach((n) => countUp(n, +n.dataset.count));
    });
    if (window.VanillaTilt) VanillaTilt.init(el.grid.querySelectorAll('[data-tilt]'));
  }
  document.querySelectorAll('.sort-btn').forEach((b) => b.addEventListener('click', () => {
    sortBy = b.dataset.sort; document.querySelectorAll('.sort-btn').forEach((x) => x.classList.toggle('active', x === b)); renderSegments();
  }));

  function renderCharts(r) {
    radar?.destroy(); donut?.destroy();
    const ctx = $('demographicsChart').getContext('2d');
    const g = ctx.createLinearGradient(0, 0, 0, 400);
    g.addColorStop(0, 'rgba(239,68,68,0.8)'); g.addColorStop(1, 'rgba(239,68,68,0.1)');
    radar = new Chart(ctx, {
      type: 'radar',
      data: { labels: r.segments.map((s) => s.name), datasets: [{ label: 'Nivel de risc', data: r.segments.map((s) => s.risk), backgroundColor: g, borderColor: '#ef4444', pointBackgroundColor: '#fff', pointBorderColor: '#ef4444', borderWidth: 2, pointRadius: 4 }] },
      options: { responsive: true, maintainAspectRatio: false, scales: { r: { min: 0, max: 100, angleLines: { color: 'rgba(255,255,255,0.1)' }, grid: { color: 'rgba(255,255,255,0.1)' }, pointLabels: { color: '#9ca3af', font: { size: 11, weight: 'bold' } }, ticks: { display: false } } }, plugins: { legend: { display: false } } },
    });
    donut = new Chart($('sentimentChart').getContext('2d'), {
      type: 'doughnut',
      data: { labels: ['Pozitiv', 'Neutru', 'Negativ'], datasets: [{ data: [r.sentiment.pozitiv, r.sentiment.neutru, r.sentiment.negativ], backgroundColor: ['#22c55e', '#64748b', '#ef4444'], borderColor: '#0f1524', borderWidth: 3 }] },
      options: { responsive: true, maintainAspectRatio: false, cutout: '68%', plugins: { legend: { position: 'right', labels: { color: '#9ca3af' } } } },
    });
  }

  /* ============ EXPORT, COPIERE, RESET ============ */
  $('exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ score: totalScore(report.segments), ...report }, null, 2)], { type: 'application/json' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'vibecheck-raport.json' });
    a.click(); URL.revokeObjectURL(a.href);
  });
  $('copyBtn').addEventListener('click', (e) => {
    const top = [...report.segments].sort((a, b) => b.risk - a.risk).slice(0, 3).map((s) => `${s.name} ${s.risk}%`).join(', ');
    navigator.clipboard?.writeText(`VibeCheck AI: scor risc ${totalScore(report.segments)}/100 (${level(totalScore(report.segments))[1]}). Cele mai expuse segmente: ${top}.\n${report.verdict}`);
    e.target.textContent = 'Copiat ✓'; setTimeout(() => (e.target.textContent = 'Copiază rezumatul'), 1500);
  });
  el.reset.addEventListener('click', () => {
    el.results.classList.add('hidden'); el.input.value = ''; el.img.src = el.resImg.src = ''; file = report = null;
    el.bar.style.width = '0%'; el.loadText.textContent = 'Așteptare input...';
    el.preview.classList.add('hidden'); el.preview.classList.remove('flex');
    el.drop.classList.remove('hidden'); el.upload.classList.remove('hidden');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
});