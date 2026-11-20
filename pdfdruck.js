/* Drucken in der iPad-Home-Bildschirm-App (und in Bluefy):
   Apple lässt window.print() dort nicht zu. Stattdessen wird ein PDF erzeugt
   und über das Teilen-Menü angeboten – dort gibt es "Drucken" und "In Dateien sichern". */
(function () {
  'use strict';
  var LIBS = [
    ['jspdf', 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'],
    ['html2canvas', 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js']
  ];

  function forced() { try { return localStorage.getItem('vb-pdfdruck') === '1'; } catch (e) { return false; } }
  function needsPdf() {
    if (forced()) return true;
    var ua = navigator.userAgent || '';
    if (/Bluefy/i.test(ua)) return true;
    var ios = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && 'ontouchend' in document);
    var standalone = navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
    return ios && standalone;
  }

  function loadScript(src) {
    return new Promise(function (ok, bad) {
      var s = document.createElement('script');
      s.src = src; s.async = true; s.crossOrigin = 'anonymous';
      s.onload = ok; s.onerror = function () { bad(new Error('load')); };
      document.head.appendChild(s);
    });
  }
  function libsReady() { return !!(window.jspdf && window.jspdf.jsPDF && window.html2canvas); }
  function loadLibs() {
    if (libsReady()) return Promise.resolve();
    return LIBS.reduce(function (p, l) {
      return p.then(function () { if (l[0] === 'jspdf' ? (window.jspdf && window.jspdf.jsPDF) : window.html2canvas) return; return loadScript(l[1]); });
    }, Promise.resolve());
  }

  /* ---- kleine Oberfläche ---- */
  var box;
  function ui(html, buttons) {
    if (!box) {
      box = document.createElement('div');
      box.className = 'no-print';
      box.setAttribute('role', 'dialog');
      box.setAttribute('aria-live', 'polite');
      box.style.cssText = 'position:fixed;left:50%;bottom:calc(20px + env(safe-area-inset-bottom,0px));transform:translateX(-50%);z-index:9999;' +
        'background:#1b2331;color:#fff;border-radius:10px;padding:12px 14px;box-shadow:0 8px 28px rgba(0,0,0,.35);' +
        'font:15px/1.35 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:calc(100vw - 32px)';
      document.body.appendChild(box);
    }
    box.innerHTML = '<span style="flex:1 1 220px">' + html + '</span>';
    (buttons || []).forEach(function (b) {
      var el = document.createElement('button');
      el.type = 'button'; el.textContent = b[0];
      el.style.cssText = 'font:inherit;font-weight:600;padding:8px 14px;border-radius:7px;border:0;cursor:pointer;' +
        (b[2] ? 'background:#fff;color:#1b2331' : 'background:transparent;color:#fff;border:1px solid rgba(255,255,255,.5)');
      el.onclick = b[1];
      box.appendChild(el);
    });
    box.hidden = false;
  }
  function close() { if (box) box.hidden = true; }

  /* ---- Inhalt vorbereiten ---- */
  function stageFor(root, widthPx) {
    var st = document.createElement('div');
    st.className = 'vb-pdfstage';
    st.style.cssText = 'position:absolute;left:-10000px;top:0;width:' + widthPx + 'px;background:#fff;color:#1b2331;padding:0;margin:0';
    var c = root.cloneNode(true);
    c.hidden = false; c.removeAttribute('hidden');
    c.querySelectorAll('.no-print,[hidden],script,dialog').forEach(function (e) { e.remove(); });
    // Formularwerte in den Kopien übernehmen
    var srcI = root.querySelectorAll('input,textarea,select'), dstI = c.querySelectorAll('input,textarea,select');
    for (var i = 0; i < Math.min(srcI.length, dstI.length); i++) {
      if (dstI[i].tagName === 'SELECT') dstI[i].value = srcI[i].value; else dstI[i].setAttribute('value', srcI[i].value);
    }
    st.appendChild(c);
    document.body.appendChild(st);
    return st;
  }
  function waitImages(el) {
    var imgs = [].slice.call(el.querySelectorAll('img'));
    return Promise.all(imgs.map(function (im) {
      if (im.complete) return null;
      return new Promise(function (ok) { im.onload = im.onerror = ok; setTimeout(ok, 4000); });
    }));
  }
  function breakPoints(stage, sel) {
    var top = stage.getBoundingClientRect().top, pts = [];
    stage.querySelectorAll(sel).forEach(function (e) {
      var r = e.getBoundingClientRect();
      if (r.height > 0) { pts.push(r.top - top); pts.push(r.bottom - top); }
    });
    return pts.sort(function (a, b) { return a - b; });
  }

  function withLightTheme(fn) {
    var de = document.documentElement, old = de.getAttribute('data-theme');
    de.setAttribute('data-theme', 'light');
    de.classList.add('vb-pdf');
    var done = function () { if (old === null) de.removeAttribute('data-theme'); else de.setAttribute('data-theme', old); de.classList.remove('vb-pdf'); };
    return Promise.resolve().then(fn).then(function (r) { done(); return r; }, function (e) { done(); throw e; });
  }

  /* Fließtext (Nähzettel, Aufmaßblatt …) auf A4-Seiten verteilen, möglichst nicht mitten in einem Block teilen */
  function flowPdf(o) {
    var J = window.jspdf.jsPDF;
    var pw = o.pageW || 210, ph = o.pageH || 297, mg = o.margin == null ? 8 : o.margin;
    var cw = pw - 2 * mg, chh = ph - 2 * mg, widthPx = o.widthPx || 794;
    return withLightTheme(function () {
      var stage = stageFor(o.root, widthPx);
      return waitImages(stage).then(function () {
        var pts = breakPoints(stage, o.avoid || 'section,article,tr,.bhead,.cgrp,.blk,.am-pos,.pos,figure,h2,h3');
        var forced = [];                                    // feste Seitenwechsel (z. B. jede Position neue Seite)
        if (o.breakBefore) {
          var st0 = stage.getBoundingClientRect().top;
          stage.querySelectorAll(o.breakBefore).forEach(function (e) { var t = e.getBoundingClientRect().top - st0; if (t > 1) forced.push(t); });
          forced.sort(function (a, b) { return a - b; });
        }
        return window.html2canvas(stage, { scale: 2, backgroundColor: '#ffffff', useCORS: true, logging: false, windowWidth: widthPx }).then(function (cv) {
          stage.remove();
          var k = cv.width / widthPx;                    // Canvas-Pixel je CSS-Pixel
          var pxPerMm = widthPx / cw, pagePx = chh * pxPerMm, total = cv.height / k;
          var pdf = new J({ orientation: pw > ph ? 'l' : 'p', unit: 'mm', format: [pw, ph] });
          var y = 0, first = true;
          while (y < total - 1) {
            var end = Math.min(total, y + pagePx);
            var fb = null;
            for (var fi = 0; fi < forced.length; fi++) if (forced[fi] > y + 1 && forced[fi] <= end) { fb = forced[fi]; break; }
            if (fb) end = fb;
            else if (end < total) {                         // passende Bruchstelle suchen
              var best = null;
              for (var i = 0; i < pts.length; i++) if (pts[i] > y + pagePx * 0.35 && pts[i] <= end) best = pts[i];
              if (best) end = best;
            }
            var h = end - y, part = document.createElement('canvas');
            part.width = cv.width; part.height = Math.max(1, Math.round(h * k));
            var g = part.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, part.width, part.height);
            g.drawImage(cv, 0, Math.round(y * k), cv.width, part.height, 0, 0, cv.width, part.height);
            if (!first) pdf.addPage([pw, ph], pw > ph ? 'l' : 'p');
            pdf.addImage(part.toDataURL('image/jpeg', 0.92), 'JPEG', mg, mg, cw, h / pxPerMm);
            first = false; y = end;
          }
          return pdf;
        });
      });
    });
  }

  /* Jedes Element eine eigene Seite (Etiketten) */
  function pagesPdf(o) {
    var J = window.jspdf.jsPDF, pw = o.pageW, ph = o.pageH;
    return withLightTheme(function () {
      var els = [].slice.call(o.root.querySelectorAll(o.pages));
      var pdf = new J({ orientation: pw > ph ? 'l' : 'p', unit: 'mm', format: [pw, ph] });
      var chain = Promise.resolve(), n = 0;
      els.forEach(function (el) {
        chain = chain.then(function () {
          return window.html2canvas(el, { scale: 3, backgroundColor: '#ffffff', logging: false }).then(function (cv) {
            if (n++) pdf.addPage([pw, ph], pw > ph ? 'l' : 'p');
            pdf.addImage(cv.toDataURL('image/jpeg', 0.95), 'JPEG', 0, 0, pw, ph);
          });
        });
      });
      return chain.then(function () { return pdf; });
    });
  }

  function offer(pdf, name) {
    var blob = pdf.output('blob');
    var file = null;
    try { file = new File([blob], name, { type: 'application/pdf' }); } catch (e) { file = null; }
    var url = URL.createObjectURL(blob);
    var canShare = !!(file && navigator.canShare && navigator.canShare({ files: [file] }));
    ui('PDF ist fertig: <b>' + name.replace(/</g, '&lt;') + '</b>' + (canShare ? '<br><small>Im Teilen-Menü „Drucken“ oder „In Dateien sichern“ wählen.</small>' : ''), [
      [canShare ? 'Drucken / Teilen' : 'PDF öffnen', function () {
        if (canShare) {
          navigator.share({ files: [file], title: name }).catch(function () {});
        } else {
          var a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
        }
      }, true],
      ['Schließen', close]
    ]);
    return { blob: blob, file: file, canShare: canShare };
  }

  var busy = false;
  function print(o) {
    o = o || {};
    if (!needsPdf()) { window.print(); return Promise.resolve('print'); }
    if (busy) return Promise.resolve('busy');
    busy = true;
    ui('PDF wird erstellt …');
    return loadLibs().then(function () {
      return o.pages ? pagesPdf(o) : flowPdf(o);
    }).then(function (pdf) {
      busy = false;
      var r = offer(pdf, (o.name || 'Druck') + '.pdf');
      window.__vbLastPdf = r;
      return r;
    }, function (e) {
      busy = false;
      ui(e && e.message === 'load'
        ? 'Zum Drucken in der App wird einmalig eine Internetverbindung gebraucht (PDF-Baustein). Bitte mit dem Internet verbinden und noch einmal tippen.'
        : 'PDF konnte nicht erstellt werden. Alternativ die App-Adresse in Safari öffnen und dort drucken.', [['OK', close, true]]);
      throw e;
    });
  }

  window.VBDruck = { print: print, needsPdf: needsPdf };
})();
