/* Hűsvölgy Klíma – minta webshop, böngészőoldali logika (demó mód: minden adat a böngészőben) */
(function () {
  'use strict';
  var HK = window.HK || {}; var A = HK.arak || {}; var B = HK.beall || {};
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var ft = function (n) { return Math.round(n || 0).toLocaleString('hu-HU').replace(/\s/g, ' ') + ' Ft'; };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var tar = {
    get: function (k, alap) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : alap; } catch (e) { return alap; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { } }
  };
  var termek = function (id) { return (HK.termekek || []).find(function (t) { return t.id === id; }); };
  var szolg = function (id) { return (HK.szolg || []).find(function (s) { return s.id === id; }); };
  var telepulesKm = function (nev) { var t = (HK.telepulesek || []).find(function (x) { return x.nev === nev; }); return t ? t.km : 0; };
  var zonaDij = function (km) { return km <= 0 ? 0 : km <= 10 ? A.zona[1] : km <= 25 ? A.zona[2] : km <= 40 ? A.zona[3] : A.zona[4]; };
  var szerelesAlap = function (kw) { return kw <= 3.6 ? A.alap_szereles_25_35kw : A.alap_szereles_5_7kw; };
  var kisbetu = function (s) { return String(s || '').trim().toLowerCase(); };
  var levelKuld = function (sablon, adat) { try { if (window.HKApp && window.HKApp.level) window.HKApp.level(sablon, adat); } catch (e) { console.error('[level]', e); } };

  /* ---------- Fiókok (demó: localStorage; élesben Supabase Auth) ---------- */
  var Fiok = {
    lista: function () { return tar.get('hk_fiokok', []); },
    ment: function (l) { tar.set('hk_fiokok', l); },
    keres: function (email) { var e = kisbetu(email); return e ? Fiok.lista().find(function (f) { return kisbetu(f.email) === e; }) || null : null; },
    aktualis: function () { var e = tar.get('hk_belepve', null); return e ? Fiok.keres(e) : null; },
    belep: function (email) { tar.set('hk_belepve', email ? kisbetu(email) : null); },
    // MINTA: egyszerű, sózatlan hash – élesben szerveroldali (bcrypt/Supabase Auth), ide jelszó nem kerülhet
    hash: function (email, jelszo) { var s = kisbetu(email) + ':' + jelszo, h = 5381; for (var i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return 'minta$' + h.toString(16); },
    letrehoz: function (a) { // a: {email, nev, tel, jelszo, hirlevel, cim}
      if (Fiok.keres(a.email)) return null;
      var f = { email: kisbetu(a.email), nev: a.nev || '', tel: a.tel || '', jelszo: Fiok.hash(a.email, a.jelszo), reg: new Date().toISOString(), hirlevel: !!a.hirlevel, cim: a.cim || { telepules: '', irsz: '', utca: '' } };
      var l = Fiok.lista(); l.push(f); Fiok.ment(l); Fiok.belep(f.email);
      // a korábbi vendégrendeléseit is a fiókhoz kötjük
      var rl = tar.get('hk_rendelesek', []), volt = false;
      rl.forEach(function (r) { if (!r.fiok && r.vevo && kisbetu(r.vevo.email) === f.email) { r.fiok = f.email; volt = true; } });
      if (volt) tar.set('hk_rendelesek', rl);
      levelKuld('regisztracio', { fiok: f });
      fut('regisztracio', f);
      return f;
    },
    frissit: function (email, valtozas) { var l = Fiok.lista(), f = l.find(function (x) { return kisbetu(x.email) === kisbetu(email); }); if (!f) return null; Object.assign(f, valtozas); Fiok.ment(l); return f; },
    rendelesei: function (email) { var e = kisbetu(email); return e ? tar.get('hk_rendelesek', []).filter(function (r) { return kisbetu(r.fiok) === e || (r.vevo && kisbetu(r.vevo.email) === e); }) : []; }
  };

  /* ---------- Eseményhorgok (modulok ide kapcsolódnak: HKApp.horog(nev, fn)) ---------- */
  var horgok = {};
  function horog(nev, fn) { (horgok[nev] = horgok[nev] || []).push(fn); }
  function fut(nev, adat) { (horgok[nev] || []).forEach(function (fn) { try { fn(adat); } catch (e) { console.error('[horog ' + nev + ']', e); } }); return adat; }

  /* ---------- Toast ---------- */
  var toastIdo;
  function toast(html) {
    var t = $('#toast'); if (!t) return;
    t.innerHTML = html; t.classList.add('lathato');
    clearTimeout(toastIdo); toastIdo = setTimeout(function () { t.classList.remove('lathato'); }, 4200);
  }

  /* ---------- Kosár ---------- */
  // tétel: {t:'k'|'s', id, db, sz (szereléssel), m (plusz cső m), ko (konzol), sp (szivattyú), v (változat), e (beltéri egységek száma)}
  var Kosar = {
    tetelek: function () { return tar.get('hk_kosar', []); },
    ment: function (l) { tar.set('hk_kosar', l); frissitJelvenyek(); },
    kulcs: function (x) { return [x.t, x.id, x.sz ? 1 : 0, x.m || 0, x.ko ? 1 : 0, x.sp ? 1 : 0, x.v || '', x.e || 0].join('|'); },
    hozzaad: function (x) {
      var l = Kosar.tetelek(); var k = Kosar.kulcs(x);
      var meglevo = l.find(function (y) { return Kosar.kulcs(y) === k; });
      if (meglevo) meglevo.db = Math.min(20, meglevo.db + x.db); else l.push(x);
      Kosar.ment(l);
    },
    darab: function () { return Kosar.tetelek().reduce(function (s, x) { return s + x.db; }, 0); }
  };

  function tetelInfo(x) {
    var sorok = [], egyseg = 0, nev = '', url = '', rajz = '';
    if (x.t === 'k') {
      var t = termek(x.id); if (!t) return null;
      nev = t.nev; url = t.url; egyseg = t.ar; sorok.push(['Készülék', t.ar]);
      if (x.sz && t.kat !== 'multi') {
        var alap = szerelesAlap(t.kw); egyseg += alap; sorok.push(['Alapszerelés (3 m cső)', alap]);
        if (x.m) { egyseg += x.m * A.extra_cso_meter; sorok.push(['Plusz cső ' + x.m + ' m', x.m * A.extra_cso_meter]); }
        if (x.ko) { egyseg += A.falkonzol; sorok.push(['Falkonzol', A.falkonzol]); }
        if (x.sp) { egyseg += A.kondenzszivattyu; sorok.push(['Kondenzszivattyú', A.kondenzszivattyu]); }
      }
      return { nev: nev, url: url, egyseg: egyseg, sorok: sorok, osszeg: egyseg * x.db, szerelt: !!(x.sz && t.kat !== 'multi'), fizikai: !(x.sz && t.kat !== 'multi'), termek: t };
    }
    var s = szolg(x.id); if (!s) return null;
    nev = s.nev; url = '/szolgaltatasok/#' + s.id;
    if (s.valtozatok) {
      var v = s.valtozatok.find(function (w) { return w[0] === x.v; }) || s.valtozatok[0];
      egyseg = v[2]; nev += ' (' + v[1] + ')'; sorok.push(['Alapszerelés', v[2]]);
      if (x.m) { egyseg += x.m * A.extra_cso_meter; sorok.push(['Plusz cső ' + x.m + ' m', x.m * A.extra_cso_meter]); }
      if (x.ko) { egyseg += A.falkonzol; sorok.push(['Falkonzol', A.falkonzol]); }
      if (x.sp) { egyseg += A.kondenzszivattyu; sorok.push(['Kondenzszivattyú', A.kondenzszivattyu]); }
    } else if (s.tisztitas) {
      var e = x.e || 1; egyseg = A.tisztitas_1_belteri + (e - 1) * A.tisztitas_tovabbi_belteri;
      nev += ' – ' + e + ' beltéri'; sorok.push(['1. beltéri', A.tisztitas_1_belteri]); if (e > 1) sorok.push(['+' + (e - 1) + ' beltéri', (e - 1) * A.tisztitas_tovabbi_belteri]);
    } else if (s.id === 'berlet') {
      var e2 = x.e || 1; egyseg = s.ar * e2; nev += ' – ' + e2 + ' beltéri'; sorok.push(['Éves díj', egyseg]);
    } else { egyseg = s.ar; }
    return { nev: nev, url: url, egyseg: egyseg, sorok: sorok, osszeg: egyseg * x.db, szerelt: false, helyszini: !s.kiegeszito, fizikai: !!s.kiegeszito, szolg: s };
  }

  // Kedvezmények: ktx = {email} | false (nincs kedvezmény). Alapból a belépett fiók.
  function kedvezmenyek(r, ktx) {
    var l = [], szolgDij = 0;
    r.tetelek.forEach(function (e) {
      if (e.x.t === 'k') { if (e.i.szerelt) szolgDij += (e.i.egyseg - e.i.termek.ar) * e.x.db; }
      else if (e.i.helyszini) szolgDij += e.i.osszeg;
    });
    var korabbi = ktx.email ? tar.get('hk_rendelesek', []).filter(function (x) { return x.allapot !== 'Lemondva' && (kisbetu(x.vevo && x.vevo.email) === kisbetu(ktx.email) || kisbetu(x.fiok) === kisbetu(ktx.email)); }) : [];
    r.torzsvasarlo = korabbi.length > 0;
    if (r.torzsvasarlo && szolgDij) l.push(['Törzsvásárlói kedvezmény: −5% a szerelési és szolgáltatási díjakból', -Math.round(szolgDij * 0.05)]);
    // a kedvezmény nem lehet több a tételek értékénél
    var ossz = 0; l = l.filter(function (k) { var max = r.termekOsszeg + ossz; if (max <= 0) return false; if (-k[1] > max) k[1] = -max; ossz += k[1]; return true; });
    return l;
  }

  function osszesit(tetelek, telepules, szallitas, ktx) {
    var r = { tetelek: [], termekOsszeg: 0, kiszallas: 0, szallitas: 0, helyszini: false, fizikaiDb: 0, vanSzerelt: false, vanMulti: false };
    tetelek.forEach(function (x) {
      var i = tetelInfo(x); if (!i) return;
      r.tetelek.push({ x: x, i: i }); r.termekOsszeg += i.osszeg;
      if (i.szerelt || i.helyszini) r.helyszini = true;
      if (i.szerelt) r.vanSzerelt = true;
      if (i.termek && i.termek.kat === 'multi') r.vanMulti = true;
      if (x.t === 'k' && i.fizikai) r.fizikaiDb += x.db;
    });
    if (r.helyszini) r.kiszallas = zonaDij(telepulesKm(telepules));
    if (r.fizikaiDb && !r.helyszini) {
      if (szallitas === 'futar') r.szallitas = r.termekOsszeg >= B.ingyenesSzallitasFelett ? 0 : r.fizikaiDb * B.futarDij;
    } else if (r.fizikaiDb && r.helyszini) {
      r.szallitas = 0; // szereléssel egy úton visszük ki
    }
    if (ktx === undefined) { var af = Fiok.aktualis(); ktx = { email: af ? af.email : '' }; }
    r.kedvezmenyek = ktx ? kedvezmenyek(r, ktx) : [];
    r.kedvezmeny = r.kedvezmenyek.reduce(function (s, k) { return s + k[1]; }, 0);
    r.osszesen = r.termekOsszeg + r.kiszallas + r.szallitas + r.kedvezmeny;
    r.netto = Math.round(r.osszesen / (1 + B.afa / 100));
    r.afa = r.osszesen - r.netto;
    r.eloleg = Math.round(r.osszesen * B.elolegSzazalek / 100 / 100) * 100;
    return r;
  }

  function frissitJelvenyek() {
    var db = Kosar.darab();
    $$('[data-kosar-db]').forEach(function (e) { e.textContent = db; e.setAttribute('data-db', db); });
    var o = Osszehas.lista().length;
    $$('[data-osszehas-db]').forEach(function (e) { e.textContent = o; e.setAttribute('data-db', o); });
    var sav = $('#osszehas-sav'); if (sav) sav.hidden = !o || !!$('#osszehas-tartalom');
  }

  /* ---------- Összehasonlítás ---------- */
  var Osszehas = {
    lista: function () { return tar.get('hk_osszehas', []).filter(termek); },
    valt: function (id, be) {
      var l = Osszehas.lista().filter(function (x) { return x !== id; });
      if (be) { if (l.length >= 3) { toast('Legfeljebb 3 klímát hasonlíthatsz össze.'); return false; } l.push(id); }
      tar.set('hk_osszehas', l); frissitJelvenyek(); szinkronPipak(); return true;
    }
  };
  function szinkronPipak() { var l = Osszehas.lista(); $$('[data-osszehas]').forEach(function (c) { c.checked = l.indexOf(c.getAttribute('data-osszehas')) > -1; }); }
  document.addEventListener('change', function (e) {
    var c = e.target.closest && e.target.closest('[data-osszehas]'); if (!c) return;
    if (!Osszehas.valt(c.getAttribute('data-osszehas'), c.checked)) c.checked = false;
    else if (c.checked) toast('Összehasonlításhoz adva. <a href="/osszehasonlitas/">Megnézem</a>');
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-osszehas-urit]')) { tar.set('hk_osszehas', []); frissitJelvenyek(); szinkronPipak(); }
  });

  function osszehasOldal() {
    var hely = $('#osszehas-tartalom'); if (!hely) return;
    document.body.dataset.oldal = 'osszehas';
    var l = Osszehas.lista().map(termek);
    if (!l.length) return;
    var sorok = [
      ['Ár (készülék)', function (t) { return ft(t.ar); }, function (t) { return -t.ar; }],
      ['Szereléssel', function (t) { return t.kat === 'multi' ? 'felmérés után' : ft(t.ar + szerelesAlap(t.kw)); }],
      ['Hűtés / fűtés', function (t) { return (t.kw + '').replace('.', ',') + ' / ' + ((t.kwf || '–') + '').replace('.', ',') + ' kW'; }],
      ['Ajánlott alapterület', function (t) { return t.m2 || '–'; }],
      ['SEER', function (t) { return t.seer ? (t.seer + '').replace('.', ',') : '–'; }, function (t) { return t.seer || 0; }],
      ['SCOP', function (t) { return t.scop ? (t.scop + '').replace('.', ',') : '–'; }, function (t) { return t.scop || 0; }],
      ['Energiaosztály hűtés / fűtés', function (t) { return (t.oh || '–') + ' / ' + (t.of || '–'); }],
      ['Beltéri zaj (min.)', function (t) { return t.zaj != null ? (t.zaj + '').replace('.', ',') + ' dB' : '–'; }, function (t) { return t.zaj != null ? -t.zaj : null; }],
      ['Fűt külső hőmérsékletig', function (t) { return t.minfok != null ? t.minfok + ' °C' : '–'; }, function (t) { return t.minfok != null ? -t.minfok : null; }],
      ['Hűtőközeg', function (t) { return t.hk || '–'; }],
      ['Wifi', function (t) { return t.wifi || '–'; }],
      ['Garancia', function (t) { return t.gar ? t.gar + ' év' : '–'; }, function (t) { return t.gar || null; }],
      ['Készlet', function (t) { return t.keszlet === 'raktaron' ? 'Raktáron' : 'Rendelésre'; }],
    ];
    var html = '<div class="osszehas-tabla-burok"><table class="osszehas-tabla"><thead><tr><th scope="col"><span class="rejtett">Tulajdonság</span></th>' +
      l.map(function (t) { return '<th scope="col"><div class="tkartya-marka">' + esc(t.marka) + '</div><a href="' + t.url + '"><b>' + esc(t.nev) + '</b></a><div style="margin-top:8px" class="sor"><a class="gomb gomb-fo gomb-kicsi" href="' + t.url + '">Megnézem</a><button class="gomb gomb-keret gomb-kicsi" type="button" data-kivesz="' + t.id + '">Kivesz</button></div></th>'; }).join('') + '</tr></thead><tbody>' +
      sorok.map(function (s) {
        var legjobb = null;
        if (s[2] && l.length > 1) { var ert = l.map(s[2]).filter(function (v) { return v != null; }); if (ert.length > 1) legjobb = Math.max.apply(null, ert); }
        return '<tr><th scope="row">' + s[0] + '</th>' + l.map(function (t) { var j = legjobb != null && s[2](t) === legjobb; return '<td' + (j ? ' class="legjobb"' : '') + '>' + esc(s[1](t)) + '</td>'; }).join('') + '</tr>';
      }).join('') + '</tbody></table></div>';
    hely.innerHTML = html;
    hely.addEventListener('click', function (e) { var b = e.target.closest('[data-kivesz]'); if (b) { Osszehas.valt(b.getAttribute('data-kivesz'), false); location.reload(); } });
  }

  /* ---------- Léptető gombok ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-lep]'); if (!b) return;
    var inp = document.getElementById(b.getAttribute('data-cel')); if (!inp) return;
    var v = (parseInt(inp.value, 10) || 0) + parseInt(b.getAttribute('data-lep'), 10);
    var min = parseInt(inp.min, 10), max = parseInt(inp.max, 10);
    if (!isNaN(min)) v = Math.max(min, v); if (!isNaN(max)) v = Math.min(max, v);
    inp.value = v; inp.dispatchEvent(new Event('input', { bubbles: true }));
  });
  function szamErtek(inp) { var v = parseInt(inp.value, 10); var min = parseInt(inp.min, 10) || 0, max = parseInt(inp.max, 10) || 99; if (isNaN(v)) v = min; return Math.min(max, Math.max(min, v)); }

  /* ---------- Lista + szűrő ---------- */
  function listaOldal() {
    var form = $('#szuro'), racs = $('#termek-racs'); if (!form || !racs) return;
    var kartyak = $$('.tkartya', racs);
    var p = new URLSearchParams(location.search);
    if (p.get('kat')) { var r = form.querySelector('input[name=kat][value="' + p.get('kat') + '"]'); if (r) r.checked = true; }
    if (p.get('m2')) { var r2 = form.querySelector('input[name=m2][value="' + p.get('m2') + '"]'); if (r2) r2.checked = true; }
    var OSZT = { 'A+++': 7, 'A++': 6, 'A+': 5, 'A': 4, 'B': 3, 'C': 2, 'D': 1 };
    function alkalmaz() {
      var f = new FormData(form);
      var kat = f.get('kat'), m2 = parseInt(f.get('m2'), 10), markak = f.getAll('marka'), armax = parseInt(f.get('armax'), 10);
      var db = 0;
      kartyak.forEach(function (k) {
        var d = k.dataset, ok = true;
        if (kat && d.kat !== kat) ok = false;
        if (m2 && !(m2 >= +d.m2min && m2 <= +d.m2max)) ok = false;
        if (markak.length && markak.indexOf(d.marka) < 0) ok = false;
        if (f.get('aplusz') && (OSZT[d.osztaly] || 0) < 6) ok = false;
        if (f.get('wifi') && d.wifi !== 'beépített') ok = false;
        if (f.get('csendes') && +d.zaj > 21) ok = false;
        if (f.get('raktaron') && d.keszlet !== 'raktaron') ok = false;
        if (armax && +d.ar > armax) ok = false;
        k.hidden = !ok; if (ok) db++;
      });
      $('#talalat').textContent = db + ' klíma';
      $('#ures-lista').hidden = db > 0;
      var q = new URLSearchParams(); if (kat) q.set('kat', kat); if (m2) q.set('m2', m2);
      history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : ''));
    }
    function rendez() {
      var m = $('#rendezes').value;
      var fv = { 'ajanlott': function (a, b) { return a.dataset.sorrend - b.dataset.sorrend; }, 'ar-nov': function (a, b) { return a.dataset.ar - b.dataset.ar; }, 'ar-csokk': function (a, b) { return b.dataset.ar - a.dataset.ar; }, 'csendes': function (a, b) { return a.dataset.zaj - b.dataset.zaj; }, 'seer': function (a, b) { return b.dataset.seer - a.dataset.seer; } }[m];
      kartyak.slice().sort(fv).forEach(function (k) { racs.appendChild(k); });
    }
    form.addEventListener('change', alkalmaz);
    form.addEventListener('reset', function () { setTimeout(alkalmaz, 0); });
    $('#rendezes').addEventListener('change', rendez);
    document.addEventListener('click', function (e) { if (e.target.closest('[data-szuro-torol]')) { form.reset(); } });
    var nyito = $('.szuro-nyito');
    if (nyito) nyito.addEventListener('click', function () { var ny = form.classList.toggle('nyitva'); nyito.setAttribute('aria-expanded', ny); });
    alkalmaz();
  }

  /* ---------- Termékoldal ---------- */
  function termekOldal() {
    var gyoker = $('[data-termekoldal]'); if (!gyoker) return;
    var t = termek(gyoker.getAttribute('data-termekoldal')); if (!t) return;
    // galéria
    var nezetek = $('#nezetek'), fo = $('#galeria-fo');
    $$('[data-nezet]').forEach(function (b) {
      b.addEventListener('click', function () {
        var n = +b.getAttribute('data-nezet');
        fo.innerHTML = nezetek.content.children[n].innerHTML;
        $$('[data-nezet]').forEach(function (x) { x.setAttribute('aria-pressed', x === b); });
      });
    });
    // fülek
    var fulek = $$('.fulek [role=tab]');
    fulek.forEach(function (f, i) {
      f.addEventListener('click', function () { valtFul(f); });
      f.addEventListener('keydown', function (e) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + fulek.length) % fulek.length; fulek[j].focus(); valtFul(fulek[j]); }
      });
    });
    function valtFul(f) { fulek.forEach(function (x) { var be = x === f; x.setAttribute('aria-selected', be); x.tabIndex = be ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !be; }); }
    // konfigurátor
    var szBe = $('#szereles-be'), sor = $('[data-kapcsolo-sor]'), reszl = $('#szereles-reszletek');
    var extraM = $('#extra-m'), konzol = $('#opc-konzol'), sziv = $('#opc-szivattyu'), dbInp = $('#db');
    function allapot() {
      return { t: 'k', id: t.id, db: szamErtek(dbInp), sz: !!(szBe && szBe.checked), m: szBe && szBe.checked ? szamErtek(extraM) : 0, ko: !!(szBe && szBe.checked && konzol.checked), sp: !!(szBe && szBe.checked && sziv.checked) };
    }
    function frissit() {
      if (szBe) { sor.classList.toggle('be', szBe.checked); reszl.classList.toggle('lathato', szBe.checked); }
      var x = allapot(), i = tetelInfo(x);
      $('#ar-bontas').innerHTML = i.sorok.map(function (s) { return '<li><span>' + esc(s[0]) + '</span><span>' + ft(s[1]) + '</span></li>'; }).join('') + (x.db > 1 ? '<li><span>× ' + x.db + ' db</span><span></span></li>' : '');
      $('#vegosszeg').textContent = ft(i.osszeg);
    }
    if (sor) sor.addEventListener('click', function (e) { if (e.target === szBe) return; if (!e.target.closest('.kapcsolo')) { szBe.checked = !szBe.checked; frissit(); } });
    [szBe, extraM, konzol, sziv, dbInp].forEach(function (el) { if (el) { el.addEventListener('input', frissit); el.addEventListener('change', frissit); } });
    $('#kosarba').addEventListener('click', function () {
      var x = allapot(); Kosar.hozzaad(x);
      toast('<span>Kosárba tettük: <b>' + esc(t.nev) + '</b>' + (x.sz ? ' szereléssel' : '') + '</span><a href="/kosar/">Kosár →</a>');
    });
    frissit();
  }

  /* ---------- Szolgáltatások ---------- */
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-szolg-kosarba]'); if (!b) return;
    var id = b.getAttribute('data-szolg-kosarba'), s = szolg(id), k = b.closest('[data-szolg]');
    var x = { t: 's', id: id, db: 1 };
    if (s.valtozatok) { x.v = $('[data-valtozat]', k).value; x.m = szamErtek($('[data-extram]', k)); x.ko = $('[data-konzol]', k).checked; x.sp = $('[data-szivattyu]', k).checked; }
    if (s.db) x.e = szamErtek($('[data-db]', k));
    Kosar.hozzaad(x);
    toast('<span>Kosárba tettük: <b>' + esc(s.nev) + '</b></span><a href="/kosar/">Kosár →</a>');
  });

  /* ---------- Település választó ---------- */
  function telepulesValasztok() {
    var mentett = tar.get('hk_telepules', 'Pécs');
    $$('[data-telepules-valaszto]').forEach(function (sel) {
      sel.innerHTML = (HK.telepulesek || []).map(function (t) { var d = zonaDij(t.km); return '<option value="' + esc(t.nev) + '">' + esc(t.nev) + (t.km ? ' – kiszállás ' + ft(d) : ' – ingyenes kiszállás') + '</option>'; }).join('');
      sel.value = mentett;
      sel.addEventListener('change', function () { tar.set('hk_telepules', sel.value); document.dispatchEvent(new Event('hk-frissit')); });
    });
  }

  /* ---------- Kosár oldal ---------- */
  function kosarOldal() {
    var hely = $('#kosar-tetelek'); if (!hely) return;
    function rajzol() {
      var l = Kosar.tetelek(), r = osszesit(l, tar.get('hk_telepules', 'Pécs'), 'futar');
      if (!r.tetelek.length) {
        hely.innerHTML = '<div class="ures-lista">A kosarad üres. <div class="sor" style="justify-content:center;margin-top:12px"><a class="gomb gomb-fo" href="/klimak/">Klímák</a><a class="gomb gomb-keret" href="/szolgaltatasok/">Szolgáltatások</a></div></div>';
        $('#kosar-ajanlo').innerHTML = ''; $('#kosar-osszesito').innerHTML = ''; $('#kosar-netto').textContent = '';
        $('#penztar-gomb').setAttribute('aria-disabled', 'true'); $('#penztar-gomb').classList.add('rejtett'); return;
      }
      hely.innerHTML = r.tetelek.map(function (e, idx) {
        var i = e.i, x = e.x;
        return '<article class="kosar-tetel"><div class="tetel-kep">' + kisKep(i) + '</div><div><h3><a href="' + i.url + '">' + esc(i.nev) + '</a></h3>' +
          (x.t === 'k' ? '<div class="halvany" style="font-size:.88rem">' + (i.szerelt ? 'Szereléssel' : (i.termek.kat === 'multi' ? 'Szerelés felmérés után' : 'Szerelés nélkül')) + '</div>' : '') +
          '<ul class="tetel-sorok">' + i.sorok.map(function (s) { return '<li>' + esc(s[0]) + ': ' + ft(s[1]) + '</li>'; }).join('') + '</ul></div>' +
          '<div class="tetel-jobb"><span class="mennyiseg"><button type="button" data-kdb="-1" data-idx="' + idx + '" aria-label="Kevesebb">−</button><input type="number" value="' + x.db + '" min="1" max="20" data-kdb-inp="' + idx + '" aria-label="Mennyiség"><button type="button" data-kdb="1" data-idx="' + idx + '" aria-label="Több">+</button></span><b>' + ft(i.osszeg) + '</b><button class="torles" type="button" data-ktorol="' + idx + '">Törlés</button></div></article>';
      }).join('');
      $('#kosar-osszesito').innerHTML = osszesitoHtml(r, 'futar', true);
      $('#kosar-netto').innerHTML = 'Ebből nettó ' + ft(r.netto) + ' + 27% áfa ' + ft(r.afa) +
        (!Fiok.aktualis() ? '<span class="kedv-tipp">Törzsvásárló vagy? A pénztárban az e-mail-címed alapján levonjuk az 5%-ot a szerelési díjakból.</span>' : '');
      ajanlo(l, r);
    }
    document.addEventListener('click', function (e) {
      var b = e.target.closest('[data-kdb]'), t = e.target.closest('[data-ktorol]'), a = e.target.closest('[data-ajanlo]');
      var l = Kosar.tetelek();
      if (b) { var x = l[+b.getAttribute('data-idx')]; x.db = Math.min(20, Math.max(1, x.db + (+b.getAttribute('data-kdb')))); Kosar.ment(l); rajzol(); }
      if (t) { l.splice(+t.getAttribute('data-ktorol'), 1); Kosar.ment(l); rajzol(); }
      if (a) { Kosar.hozzaad(JSON.parse(a.getAttribute('data-ajanlo'))); rajzol(); toast('Hozzáadtuk a kosárhoz.'); }
    });
    document.addEventListener('change', function (e) {
      var inp = e.target.closest('[data-kdb-inp]'); if (!inp) return;
      var l = Kosar.tetelek(); l[+inp.getAttribute('data-kdb-inp')].db = szamErtek(inp); Kosar.ment(l); rajzol();
    });
    document.addEventListener('hk-frissit', rajzol);
    rajzol();
  }
  function kisKep(i) {
    var ikon = i.szolg ? (i.szolg.kiegeszito ? '📶' : '🔧') : '❄';
    return '<span aria-hidden="true" style="font-size:2rem">' + ikon + '</span>';
  }
  function osszesitoHtml(r, szallitas, kosarban) {
    var h = '<dt>Termékek, szolgáltatások</dt><dd>' + ft(r.termekOsszeg) + '</dd>';
    (r.kedvezmenyek || []).forEach(function (k) { h += '<dt class="kedv-sor">' + esc(k[0]) + '</dt><dd class="kedv-sor">−' + ft(-k[1]) + '</dd>'; });
    if (r.helyszini) h += '<dt>Kiszállás</dt><dd>' + (r.kiszallas ? ft(r.kiszallas) : 'ingyenes') + '</dd>';
    if (r.fizikaiDb && !r.helyszini) h += '<dt>Szállítás' + (kosarban ? ' (futár)' : '') + '</dt><dd>' + (szallitas === 'atvetel' ? 'átvétel – 0 Ft' : (r.szallitas ? ft(r.szallitas) : 'ingyenes')) + '</dd>';
    if (r.fizikaiDb && r.helyszini) h += '<dt>Szállítás</dt><dd>a szereléssel együtt</dd>';
    h += '<dt class="vegosszeg">Fizetendő</dt><dd class="vegosszeg">' + ft(r.osszesen) + '</dd>';
    if (r.helyszini) h += '<dt>Előleg (' + B.elolegSzazalek + '%)</dt><dd>' + ft(r.eloleg) + '</dd>';
    return h;
  }
  function ajanlo(l, r) {
    var javaslat = [];
    var vanWifiModul = l.some(function (x) { return x.id === 'wifi-modul'; });
    var opcWifi = r.tetelek.find(function (e) { return e.i.termek && e.i.termek.wifi === 'opcionális'; });
    if (opcWifi && !vanWifiModul) javaslat.push(['Wifi-modul', 'Vezéreld telefonról a(z) ' + opcWifi.i.termek.nev + ' klímát.', A.wifi_modul, { t: 's', id: 'wifi-modul', db: 1 }]);
    var szereltDb = r.tetelek.reduce(function (s, e) { return s + (e.i.szerelt ? e.x.db : 0); }, 0);
    if (szereltDb && !l.some(function (x) { return x.id === 'berlet'; })) javaslat.push(['Éves karbantartási bérlet', 'Évi tisztítás kedvezményesen, emlékeztetővel – így megmarad a garancia.', szolg('berlet').ar * szereltDb, { t: 's', id: 'berlet', db: 1, e: szereltDb }]);
    if (r.vanMulti && !l.some(function (x) { return x.id === 'felmeres'; })) javaslat.push(['Helyszíni felmérés', 'Multi-split rendszerhez felmérés után adunk fix szerelési árat.', szolg('felmeres').ar, { t: 's', id: 'felmeres', db: 1 }]);
    $('#kosar-ajanlo').innerHTML = javaslat.length ? '<section class="ajanlo" aria-labelledby="ajanlo-cim"><h2 id="ajanlo-cim" style="font-size:1.1rem">Ehhez gyakran kérik</h2>' + javaslat.map(function (j) { return '<div class="ajanlo-tetel"><div><b>' + esc(j[0]) + '</b><p>' + esc(j[1]) + '</p></div><div class="sor" style="flex-wrap:nowrap"><b style="white-space:nowrap">' + (j[2] ? ft(j[2]) : 'ingyenes') + '</b><button class="gomb gomb-keret gomb-kicsi" type="button" data-ajanlo=\'' + esc(JSON.stringify(j[3])) + '\'>Hozzáad</button></div></div>'; }).join('') + '</section>' : '';
  }

  /* ---------- Pénztár ---------- */
  function penztarOldal() {
    var form = $('#penztar-urlap'); if (!form) return;
    var l = Kosar.tetelek();
    if (!l.length) { location.replace('/kosar/'); return; }
    var allapot = { szallitas: 'futar', fizetes: '' };
    var ceges = $('#ceges');
    ceges.addEventListener('change', function () { $$('[data-ceges]').forEach(function (m) { m.hidden = !ceges.checked; }); });
    // fiók: belépve kitöltjük az adatokat, vendégként felajánljuk a fiók létrehozását
    var belepett = Fiok.aktualis(), fiokSav = $('#penztar-fiok-sav'), flPipa = $('#fiok-letrehoz'), flMezo = $('#fiok-jelszo-mezo');
    if (belepett) {
      [['nev', belepett.nev], ['tel', belepett.tel], ['email', belepett.email], ['irsz', belepett.cim && belepett.cim.irsz], ['utca', belepett.cim && belepett.cim.utca]].forEach(function (p) { var inp = $('#' + p[0]); if (inp && !inp.value && p[1]) inp.value = p[1]; });
      if (belepett.cim && belepett.cim.telepules && $('#telepules option[value="' + belepett.cim.telepules.replace(/"/g, '') + '"]')) $('#telepules').value = belepett.cim.telepules;
      if (fiokSav) fiokSav.innerHTML = '<div class="info-doboz">Bejelentkezve: <b>' + esc(belepett.nev || belepett.email) + '</b> – az adataidat kitöltöttük, a rendelés a fiókodba kerül. <a href="/fiok/">Fiókom</a></div>';
      if ($('#fiok-letrehoz-sor')) $('#fiok-letrehoz-sor').hidden = true;
    } else if (fiokSav) fiokSav.innerHTML = '<div class="info-doboz">Van már fiókod? <a href="/fiok/?vissza=/penztar/">Lépj be</a>, és kitöltjük az adataidat. Vendégként is rendelhetsz.</div>';
    if (flPipa) flPipa.addEventListener('change', function () { flMezo.hidden = !flPipa.checked; $('#fiok-jelszo').required = flPipa.checked; if (!flPipa.checked) flMezo.classList.remove('hibas'); });
    function ktx() { return { email: ($('#email').value || '').trim() }; }
    function rajzol() {
      var tel = $('#telepules').value; tar.set('hk_telepules', tel);
      var r = osszesit(l, tel, allapot.szallitas, ktx());
      // szállítás
      var szp = $('#szallitas-panel');
      szp.hidden = !(r.fizikaiDb && !r.helyszini);
      if (!szp.hidden) {
        var futarDij = r.termekOsszeg >= B.ingyenesSzallitasFelett ? 0 : r.fizikaiDb * B.futarDij;
        $('#szallitas-valaszto').innerHTML = opcio('szallitas', 'futar', 'Futárszolgálat', '2–4 munkanap, házhoz. ' + ft(B.futarDij) + '/készülék, ' + ft(B.ingyenesSzallitasFelett) + ' felett ingyenes.', futarDij ? ft(futarDij) : 'ingyenes', allapot.szallitas) +
          opcio('szallitas', 'atvetel', 'Személyes átvétel Pécsen', 'Előzetes egyeztetéssel, ' + esc(HK.ceg && HK.ceg.nev) + ' raktár.', '0 Ft', allapot.szallitas);
      }
      // fizetés
      var opciok = [];
      if (r.helyszini) {
        opciok.push(['eloleg', B.elolegSzazalek + '% előleg átutalással', 'Díjbekérőt küldünk; az előleg beérkezése után véglegesítjük az időpontot. A többit a munka után utalással vagy készpénzzel.', ft(r.eloleg) + ' most']);
        opciok.push(['teljes', 'Teljes összeg átutalással előre', 'Díjbekérő alapján, a végszámla automatikusan készül.', ft(r.osszesen)]);
      } else if (allapot.szallitas === 'futar') {
        opciok.push(['atutalas', 'Átutalás előre', 'Díjbekérő alapján; a pénz beérkezése után feladjuk.', '']);
        opciok.push(['utanvet', 'Utánvét', 'Fizetés a futárnál készpénzzel.', '']);
      } else {
        opciok.push(['atutalas', 'Átutalás előre', 'Díjbekérő alapján.', '']);
        opciok.push(['keszpenz', 'Készpénz átvételkor', 'Fizetés a raktárban, átvételkor.', '']);
      }
      if (!opciok.some(function (o) { return o[0] === allapot.fizetes; })) allapot.fizetes = opciok[0][0];
      $('#fizetes-valaszto').innerHTML = opciok.map(function (o) { return opcio('fizetes', o[0], o[1], o[2], o[3], allapot.fizetes); }).join('');
      // elállási pipa csak helyszíni szolgáltatásnál
      $('#elallas-pipa-sor').hidden = !r.helyszini; $('#elallas-pipa').required = r.helyszini;
      // összesítő
      $('#penztar-tetelek').innerHTML = r.tetelek.map(function (e) { return '<div class="sor" style="justify-content:space-between;flex-wrap:nowrap;padding:4px 0;border-bottom:1px dashed var(--vonal)"><span>' + e.x.db + ' × ' + esc(e.i.nev) + (e.i.szerelt ? ' <small class="halvany">(szereléssel)</small>' : '') + '</span><b style="white-space:nowrap">' + ft(e.i.osszeg) + '</b></div>'; }).join('');
      $('#penztar-osszesito').innerHTML = osszesitoHtml(r, allapot.szallitas, false);
      $('#penztar-netto').textContent = 'Ebből nettó ' + ft(r.netto) + ' + 27% áfa ' + ft(r.afa);
      return r;
    }
    function opcio(nev, ertek, cim, leiras, jobb, akt) {
      return '<label><input type="radio" name="' + nev + '" value="' + ertek + '"' + (akt === ertek ? ' checked' : '') + '><span><b>' + esc(cim) + '</b><small>' + leiras + '</small></span>' + (jobb ? '<span class="jobb">' + jobb + '</span>' : '') + '</label>';
    }
    form.addEventListener('change', function (e) {
      if (e.target.name === 'szallitas') { allapot.szallitas = e.target.value; rajzol(); }
      else if (e.target.name === 'fizetes') { allapot.fizetes = e.target.value; }
      else if (e.target.id === 'telepules' || e.target.id === 'email') rajzol();
    });
    document.addEventListener('hk-frissit', rajzol);
    rajzol();
    // ellenőrzés
    function ellenoriz() {
      var ok = true, elso = null;
      $$('.mezo', form).forEach(function (m) {
        var inp = m.querySelector('input,select,textarea'); if (!inp || m.hidden) { m.classList.remove('hibas'); return; }
        var kell = inp.required || (m.hasAttribute('data-ceges') && ceges.checked);
        var v = (inp.value || '').trim(), jo = true;
        if (kell && !v) jo = false;
        if (v && inp.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) jo = false;
        if (v && inp.type === 'tel' && v.replace(/\D/g, '').length < 9) jo = false;
        if (v && inp.pattern && !new RegExp('^(?:' + inp.pattern + ')$').test(v)) jo = false;
        m.classList.toggle('hibas', !jo); if (!jo) { ok = false; elso = elso || inp; inp.setAttribute('aria-invalid', 'true'); } else inp.removeAttribute('aria-invalid');
      });
      return { ok: ok, elso: elso };
    }
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var hiba = $('#penztar-hiba'); hiba.hidden = true;
      var ell = ellenoriz();
      var uzenetek = [];
      if (!ell.ok) uzenetek.push('Ellenőrizd a pirossal jelölt mezőket.');
      if (!$('#aszf').checked) uzenetek.push('Fogadd el az ÁSZF-et és az adatkezelési tájékoztatót.');
      if ($('#elallas-pipa').required && !$('#elallas-pipa').checked) uzenetek.push('A szerelés megkezdéséhez jelöld be az elállási nyilatkozatot.');
      var ujFiok = !belepett && flPipa && flPipa.checked;
      if (ujFiok && Fiok.keres($('#email').value)) uzenetek.push('Ehhez az e-mail-címhez már van fiók – <a href="/fiok/?vissza=/penztar/">lépj be</a>, vagy vedd ki a „Fiók létrehozása” pipát.');
      if (uzenetek.length) { hiba.innerHTML = uzenetek.join('<br>'); hiba.hidden = false; (ell.elso || hiba).focus(); return; }
      var r = rajzol(), f = new FormData(form);
      var azon = 'HK-' + new Date().getFullYear() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
      var rendeles = {
        azon: azon, ido: new Date().toISOString(), allapot: 'Új',
        vevo: { nev: f.get('nev'), tel: f.get('tel'), email: f.get('email'), telepules: f.get('telepules'), irsz: f.get('irsz'), utca: f.get('utca'), cegnev: ceges.checked ? f.get('cegnev') : '', adoszam: ceges.checked ? f.get('adoszam') : '' },
        szallitas: r.fizikaiDb && !r.helyszini ? allapot.szallitas : (r.helyszini ? 'szereles' : ''), fizetes: allapot.fizetes, megj: f.get('megj'),
        tetelek: r.tetelek.map(function (e) { return { nev: e.i.nev, db: e.x.db, egyseg: e.i.egyseg, osszeg: e.i.osszeg, szerelt: e.i.szerelt, sorok: e.i.sorok, x: e.x }; }),
        termekOsszeg: r.termekOsszeg, kiszallas: r.kiszallas, szallitasDij: r.szallitas, osszesen: r.osszesen, netto: r.netto, afa: r.afa, eloleg: allapot.fizetes === 'eloleg' ? r.eloleg : 0, helyszini: r.helyszini,
        kedvezmenyek: r.kedvezmenyek
      };
      if (belepett) rendeles.fiok = belepett.email;
      else if (ujFiok) rendeles.fiok = kisbetu(f.get('email'));
      rendeles.allapotNaplo = [{ ido: rendeles.ido, allapot: 'Új' }];
      fut('rendeles', rendeles); // mentés előtt: modulok kiegészíthetik (fiók, időpont, kedvezmény…)
      var rl = tar.get('hk_rendelesek', []); rl.push(rendeles); tar.set('hk_rendelesek', rl);
      tar.set('hk_utolso', azon); Kosar.ment([]);
      if (ujFiok) Fiok.letrehoz({ email: f.get('email'), nev: f.get('nev'), tel: f.get('tel'), jelszo: f.get('fiokJelszo'), hirlevel: false, cim: { telepules: f.get('telepules'), irsz: f.get('irsz'), utca: f.get('utca') }});
      fut('rendeles-mentve', rendeles); // mentés után: levelek stb.
      location.href = '/koszonjuk/';
    });
  }

  /* ---------- Köszönjük ---------- */
  function koszonjukOldal() {
    var hely = $('#koszonjuk'); if (!hely) return;
    var azon = tar.get('hk_utolso', null); var r = tar.get('hk_rendelesek', []).find(function (x) { return x.azon === azon; });
    if (!r) return;
    var fizetendoMost = r.fizetes === 'eloleg' ? r.eloleg : (r.fizetes === 'teljes' || r.fizetes === 'atutalas') ? r.osszesen : 0;
    var FIZ = { eloleg: B.elolegSzazalek + '% előleg átutalással', teljes: 'Teljes összeg átutalással', atutalas: 'Átutalás előre', utanvet: 'Utánvét', keszpenz: 'Készpénz átvételkor' };
    hely.innerHTML = '<div class="siker-doboz"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m8 12 3 3 5-6"/></svg><h1>Köszönjük a rendelést!</h1><p>Rendelésszám: <b>' + esc(r.azon) + '</b></p><p class="mb0">' + (r.helyszini ? 'Munkaidőben 24 órán belül hívunk a szerelés időpontjának egyeztetésére.' : 'Hamarosan emailben visszaigazoljuk a rendelést.') + '</p></div>' +
      (fizetendoMost ? '<section class="panel" style="margin-top:20px"><h2>Fizetés átutalással</h2><p>Emailben díjbekérőt küldünk. Ha szeretnéd, már most is utalhatsz:</p><table class="adat-tabla"><tbody><tr><th>Kedvezményezett</th><td>' + esc(HK.ceg.nev) + '</td></tr><tr><th>Bankszámla</th><td>' + esc(HK.ceg.bankszamla) + '</td></tr><tr><th>Összeg</th><td><b>' + ft(fizetendoMost) + '</b></td></tr><tr><th>Közlemény</th><td><b>' + esc(r.azon) + '</b></td></tr></tbody></table><p class="halvany" style="font-size:.85rem;margin:10px 0 0">A pénz beérkezése után a végszámlát automatikusan küldjük.</p></section>' : '') +
      '<section class="panel" style="margin-top:20px"><h2>A rendelésed</h2>' + r.tetelek.map(function (t) { return '<div class="sor" style="justify-content:space-between;flex-wrap:nowrap;padding:6px 0;border-bottom:1px dashed var(--vonal)"><span>' + t.db + ' × ' + esc(t.nev) + (t.szerelt ? ' <small class="halvany">(szereléssel)</small>' : '') + '</span><b style="white-space:nowrap">' + ft(t.osszeg) + '</b></div>'; }).join('') +
      '<dl class="osszesito" style="position:static;box-shadow:none;border:0;padding:12px 0 0;display:grid;grid-template-columns:1fr auto;gap:6px"><dt>Kiszállás / szállítás</dt><dd>' + ft(r.kiszallas + r.szallitasDij) + '</dd><dt>Fizetés módja</dt><dd>' + esc(FIZ[r.fizetes] || '') + '</dd><dt class="vegosszeg"><b>Összesen</b></dt><dd class="vegosszeg"><b>' + ft(r.osszesen) + '</b></dd></dl>' +
      '<p class="halvany" style="font-size:.85rem">Szállítási / szerelési cím: ' + esc(r.vevo.irsz + ' ' + r.vevo.telepules + ', ' + r.vevo.utca) + '</p></section>' +
      '<div class="info-doboz">Mintaoldal: a rendelés csak ebben a böngészőben tárolódik, email nem ment ki.</div>' +
      '<p style="margin-top:20px"><a class="gomb gomb-keret" href="/klimak/">Vissza a webshopba</a></p>';
    // kedvezmények az összesítőben
    if (r.kedvezmenyek && r.kedvezmenyek.length) {
      var dl = $('dl.osszesito', hely), elso = dl && dl.firstChild;
      r.kedvezmenyek.forEach(function (k) { var dt = document.createElement('dt'), dd = document.createElement('dd'); dt.className = dd.className = 'kedv-sor'; dt.textContent = k[0]; dd.textContent = '−' + ft(-k[1]); dl.insertBefore(dt, elso); dl.insertBefore(dd, elso); });
    }
    // következő lépések: díjbekérő, követés, időpont
    var q = encodeURIComponent(r.azon), lepesek = [];
    if (fizetendoMost) lepesek.push('<a class="gomb gomb-kek" href="/dijbekero/?azon=' + q + '">Díjbekérő megnyitása</a>');
    lepesek.push('<a class="gomb gomb-keret" href="/rendeles/?azon=' + q + '&amp;email=' + encodeURIComponent(r.vevo.email || '') + '">Kövesd a rendelésed</a>');
    if (r.helyszini && !r.idopont) lepesek.push('<a class="gomb gomb-fo" href="/idopont/?rendeles=' + q + '">Válassz időpontot</a>');
    var sikerDoboz = $('.siker-doboz', hely);
    sikerDoboz.insertAdjacentHTML('afterend', '<section class="panel" style="margin-top:20px" aria-labelledby="kov-cim"><h2 id="kov-cim">Következő lépések</h2>' +
      (r.helyszini && !r.idopont ? '<p>A szerelés időpontját most is kiválaszthatod – így nem kell telefonon egyeztetnünk.</p>' : '') +
      '<div class="sor">' + lepesek.join('') + '</div></section>');
    // vendégnek: fiók létrehozása egy jelszóval
    if (!r.fiok && !Fiok.keres(r.vevo.email)) {
      hely.insertAdjacentHTML('beforeend', '<section class="panel" style="margin-top:20px" id="koszi-reg" aria-labelledby="reg-cim"><h2 id="reg-cim">Mentsd el egy fiókba</h2><p>Egy jelszóval kész: követheted a rendeléseidet, emlékeztetünk az éves tisztításra.</p>' +
        '<form id="koszi-reg-urlap" novalidate><div class="mezo"><label for="koszi-jelszo">Jelszó (min. 8 karakter) – fiók: ' + esc(r.vevo.email) + '</label><input id="koszi-jelszo" type="password" autocomplete="new-password" minlength="8" required><div class="hiba-uzenet">Legalább 8 karakter.</div><div class="sugo">Minta: a jelszó egyszerű hash-sel a böngésződben tárolódik.</div></div>' +
        '<button class="gomb gomb-fo" type="submit" style="margin-top:12px">Fiók létrehozása</button></form></section>');
      $('#koszi-reg-urlap').addEventListener('submit', function (e) {
        e.preventDefault(); var inp = $('#koszi-jelszo'), m = inp.closest('.mezo');
        if (inp.value.length < 8) { m.classList.add('hibas'); inp.setAttribute('aria-invalid', 'true'); inp.focus(); return; }
        var uj = Fiok.letrehoz({ email: r.vevo.email, nev: r.vevo.nev, tel: r.vevo.tel, jelszo: inp.value, cim: { telepules: r.vevo.telepules, irsz: r.vevo.irsz, utca: r.vevo.utca }});
        $('#koszi-reg').innerHTML = uj ? '<h2>Kész a fiókod</h2><p class="mb0">Be is léptettünk. <a href="/fiok/">Fiókom megnyitása →</a></p>' : '<p class="mb0">Ehhez az e-mailhez már van fiók. <a href="/fiok/">Belépés</a></p>';
        frissitJelvenyek(); fut('fiok-valtozott', uj);
      });
    }
  }

  /* ---------- Kapcsolat űrlap ---------- */
  function kapcsolat() {
    var form = $('#kapcsolat-urlap'); if (!form) return;
    form.addEventListener('submit', function (e) {
      e.preventDefault(); var ok = true;
      $$('.mezo', form).forEach(function (m) { var i = m.querySelector('input,textarea'); if (!i || !i.required) return; var v = i.value.trim(); var jo = !!v && (i.type !== 'email' || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)); m.classList.toggle('hibas', !jo); if (!jo) ok = false; });
      if (!$('#k-adat').checked) { ok = false; toast('Jelöld be az adatkezelési hozzájárulást.'); }
      if (!ok) return;
      var l = tar.get('hk_uzenetek', []); l.push({ ido: new Date().toISOString(), adat: Object.fromEntries(new FormData(form)) }); tar.set('hk_uzenetek', l);
      form.reset(); toast('Köszönjük, megkaptuk az üzeneted! (Mintaoldal: nem ment ki email.)');
    });
  }

  /* ---------- Süti-sáv ---------- */
  function sutik() {
    var sav = $('#suti-sav'); if (!sav) return;
    var d = tar.get('hk_suti', null);
    if (!d || (Date.now() - d.ido) > 365 * 864e5) sav.hidden = false;
    function ment(stat, hird) { tar.set('hk_suti', { ido: Date.now(), stat: stat, hird: hird }); sav.hidden = true; fut('suti', { stat: stat, hird: hird }); /* élesben: gtag('consent','update',…) */ }
    sav.addEventListener('click', function (e) {
      var b = e.target.closest('[data-suti]'); if (!b) return;
      var m = b.getAttribute('data-suti');
      if (m === 'mind') ment(true, true);
      else if (m === 'szukseges') ment(false, false);
      else if (m === 'beall') {
        var bl = $('#suti-beall');
        if (bl.classList.contains('lathato')) ment($('#suti-stat').checked, $('#suti-hird').checked);
        else { bl.classList.add('lathato'); b.textContent = 'Kiválasztottak mentése'; }
      }
    });
    document.addEventListener('click', function (e) {
      if (e.target.closest('[data-suti-beall]')) { e.preventDefault(); var dd = tar.get('hk_suti', {}); $('#suti-stat').checked = !!dd.stat; $('#suti-hird').checked = !!dd.hird; $('#suti-beall').classList.add('lathato'); sav.hidden = false; }
    });
  }

  /* ---------- Általános ---------- */
  function altalanos() {
    var mg = $('.menu-gomb'), menu = $('#fomenu');
    if (mg) mg.addEventListener('click', function () { var ny = menu.classList.toggle('nyitva'); mg.setAttribute('aria-expanded', ny); });
    $$('[data-whatsapp]').forEach(function (a) {
      if (HK.ceg && HK.ceg.whatsapp) { a.href = 'https://wa.me/' + HK.ceg.whatsapp; a.target = '_blank'; a.rel = 'noopener'; }
      else a.addEventListener('click', function (e) { e.preventDefault(); toast('Mintaoldal: élesben itt nyílik a WhatsApp-csevegés.'); });
    });
  }

  // Közös API a modulok számára (src/modulok/*.js)
  window.HKApp = {
    HK: HK, A: A, B: B, $: $, $$: $$, ft: ft, esc: esc, tar: tar, toast: toast, Kosar: Kosar,
    termek: termek, szolg: szolg, telepulesKm: telepulesKm, zonaDij: zonaDij, szerelesAlap: szerelesAlap,
    tetelInfo: tetelInfo, osszesit: osszesit, frissitJelvenyek: frissitJelvenyek, horog: horog, fut: fut,
    Fiok: Fiok, kisbetu: kisbetu,
    ALLAPOTOK: ['Új', 'Díjbekérő elküldve', 'Előleg beérkezett', 'Fizetve', 'Időpont egyeztetve', 'Szerelés kész', 'Lezárva', 'Lemondva'],
    azon: function (elotag) { return elotag + '-' + new Date().getFullYear() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase(); }
  };

  document.addEventListener('DOMContentLoaded', function () {
    altalanos(); telepulesValasztok(); frissitJelvenyek(); szinkronPipak();
    listaOldal(); termekOldal(); osszehasOldal(); kosarOldal(); penztarOldal(); koszonjukOldal(); kapcsolat(); sutik();
    fut('oldal', document.body.dataset.oldal || '');
  });
})();

/* ---- modul: admin ---- */
/* Hűsvölgy Klíma – 5. ütem: admin felület (/admin/) és szerelői mobilnézet (/szerelo/). Demó: minden adat a böngészőben. */
(function () {
  'use strict';
  var H = window.HKApp; if (!H) return;
  var HK = H.HK || {}, A = H.A || {}, B = H.B || {};
  var $ = H.$, $$ = H.$$, esc = H.esc, ft = H.ft, tar = H.tar;
  var ADM = HK.adm || {};
  var SZERELOK = ADM.szerelok || [{ nev: 'Kovács Péter', kepesites: '' }, { nev: 'Szabó Dániel', kepesites: '' }];
  var SZ_NEVEK = SZERELOK.map(function (s) { return s.nev; });
  var KOD = 'minta';
  var SAVOK = ['8–12', '12–16'];
  var TIPUS = { felmeres: 'Felmérés', szereles: 'Szerelés', tisztitas: 'Tisztítás', javitas: 'Javítás' };
  var FG_ALLAPOT = ['Foglalt', 'Visszaigazolva', 'Kész', 'Lemondva'];
  var AK_ALLAPOT = ['Új', 'Ajánlat elküldve', 'Elfogadva', 'Elutasítva'];
  var AK_TIPUS = { kalkulator: 'Kalkulátor', multi: 'Multi-split', felmeres: 'Fotós felmérés', kapcsolat: 'Kapcsolat' };
  var FIZ = { eloleg: (B.elolegSzazalek || 30) + '% előleg', teljes: 'Teljes, átutalás', atutalas: 'Átutalás előre', utanvet: 'Utánvét', keszpenz: 'Készpénz' };
  var SZALL = { futar: 'Futár', atvetel: 'Személyes átvétel', szereles: 'Szereléssel' };
  var NAPOK = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  var HONAPOK = ['jan.', 'febr.', 'márc.', 'ápr.', 'máj.', 'jún.', 'júl.', 'aug.', 'szept.', 'okt.', 'nov.', 'dec.'];
  var HONAP_NEV = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  var K = { r: 'hk_rendelesek', f: 'hk_fiokok', fg: 'hk_foglalasok', ak: 'hk_ajanlatkeresek', l: 'hk_levelek', h: 'hk_hirlevel', e: 'hk_ertekelesek', hb: 'hk_hibak' };
  var SZIN = { 'Új': 'kek', 'Díjbekérő elküldve': 'sarga', 'Előleg beérkezett': 'zold', 'Fizetve': 'zold', 'Időpont egyeztetve': 'kek', 'Szerelés kész': 'zold', 'Lezárva': 'szurke', 'Lemondva': 'piros', 'Foglalt': 'sarga', 'Visszaigazolva': 'kek', 'Kész': 'zold', 'Ajánlat elküldve': 'sarga', 'Elfogadva': 'zold', 'Elutasítva': 'piros' };
  var LEVEL_INFO = {
    'Díjbekérő elküldve': 'Díjbekérő levél megy ki (DB-szám, ha még nincs).',
    'Előleg beérkezett': '„Fizetés beérkezett” levél megy ki az előleg összegével.',
    'Fizetve': '„Fizetés beérkezett” levél megy ki a teljes összeggel.',
    'Időpont egyeztetve': 'Időpont-visszaigazoló levél megy ki.',
    'Szerelés kész': '„Szerelés kész” levél megy ki, végszámlaszámmal (SZ-…).'
  };
  var ELLENORZO = [
    ['vedofolia', 'Védőfólia, takarás a munkaterületen'],
    ['furat', 'Furat és falátvezetés (tömítve, szigetelve)'],
    ['rogzites', 'Beltéri és kültéri egység rögzítése'],
    ['vakuum', 'Vákuumozás legalább 15 percig'],
    ['nyomasproba', 'Nyomáspróba (nitrogénnel)'],
    ['tomitettseg', 'Tömítettség-ellenőrzés (szivárgáskereső)'],
    ['kondenz', 'Kondenzvíz-elvezetés lejtése, kifolyás ellenőrizve'],
    ['probauzem', 'Próbaüzem hűtés és fűtés módban'],
    ['oktatas', 'Ügyfél-oktatás (kezelés, szűrőtisztítás, garancia)']
  ];
  var HUTOKOZEG = ['R32', 'R410A', 'R290', 'R454B', 'Egyéb'];
  var GWP = { R32: 675, R410A: 2088, R290: 3, R454B: 466 };
  var SZ = { rKeres: '', rAllapot: '', akAllapot: '', uKeres: '', hSzuro: '', levUzenet: '' };
  var AJ = null; // ajánlat-szerkesztő állapota

  /* ---------- Segédek ---------- */
  function lista(k) { var v = tar.get(k, []); return Array.isArray(v) ? v.filter(function (x) { return x && typeof x === 'object'; }) : []; }
  function keres(k, azon) { return lista(k).find(function (x) { return x.azon === azon; }) || null; }
  function frissit(k, azon, fn) { var l = lista(k), x = l.find(function (y) { return y.azon === azon; }); if (!x) return null; fn(x); tar.set(k, l); return x; }
  function osszeg(l, m) { return l.reduce(function (s, x) { return s + (+x[m] || 0); }, 0); }
  function most() { return new Date().toISOString(); }
  function hiba(uzenet, hely) { var l = lista(K.hb); l.push({ ido: most(), uzenet: String(uzenet), hely: hely || 'admin', oldal: location.pathname }); tar.set(K.hb, l.slice(-300)); }
  function toast(h) { H.toast(h); }
  function p2(n) { return (n < 10 ? '0' : '') + n; }
  function napStr(d) { return d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()); }
  function strDatum(s) { var p = String(s || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1, 12); }
  function ma() { return napStr(new Date()); }
  function napPlusz(n, alap) { var d = alap ? strDatum(alap) : new Date(); d.setHours(12, 0, 0, 0); d.setDate(d.getDate() + n); return napStr(d); }
  function hetEleje(s) { var d = strDatum(s); d.setDate(d.getDate() - (d.getDay() + 6) % 7); return napStr(d); }
  function datumHu(s, nap) { if (!s) return '–'; var d = strDatum(s); if (isNaN(d)) return esc(s); return d.getFullYear() + '. ' + HONAPOK[d.getMonth()] + ' ' + d.getDate() + '.' + (nap ? ' (' + NAPOK[d.getDay()] + ')' : ''); }
  function rovidNap(s) { var d = strDatum(s); return HONAPOK[d.getMonth()] + ' ' + d.getDate() + '.'; }
  function idoHu(iso) { if (!iso) return '–'; var d = new Date(iso); if (isNaN(d)) return '–'; return d.getFullYear() + '. ' + HONAPOK[d.getMonth()] + ' ' + d.getDate() + '. ' + p2(d.getHours()) + ':' + p2(d.getMinutes()); }
  function isoNap(iso) { var d = new Date(iso); return isNaN(d) ? '' : napStr(d); }
  function napokOta(iso) { var d = new Date(iso); return isNaN(d) ? 0 : Math.floor((Date.now() - d.getTime()) / 864e5); }
  function jelzo(a) { return '<span class="adm-jelzo adm-jelzo-' + (SZIN[a] || 'szurke') + '">' + esc(a || '–') + '</span>'; }
  function telHref(t) { return 'tel:' + String(t || '').replace(/[^\d+]/g, ''); }
  function cimSzoveg(cim, tel) { cim = cim || ''; tel = tel || ''; if (cim && tel && cim.indexOf(tel) > -1) return cim; return [tel, cim].filter(Boolean).join(', '); }
  function terkepUrl(cim, tel) { return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(cimSzoveg(cim, tel) + ', Magyarország'); }
  function szamP(v) { v = String(v == null ? '' : v).replace(',', '.').trim(); if (!v) return null; var n = Number(v); return isNaN(n) ? NaN : n; }
  function szamHu(n) { return n == null || n === '' || isNaN(n) ? '–' : String(n).replace('.', ','); }
  function opt(v, felirat, akt) { return '<option value="' + esc(v) + '"' + (String(v) === String(akt) ? ' selected' : '') + '>' + esc(felirat == null ? v : felirat) + '</option>'; }
  function ses(k, v) {
    try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { ses.mem = ses.mem || {}; if (v === undefined) return ses.mem[k] || null; ses.mem[k] = v; }
    return null;
  }
  function belepve() { return ses('hk_admin') === '1'; }
  function ujabbElol(a, b) { return String(b.ido || '').localeCompare(String(a.ido || '')); }
  function aktivFg(f) { return f.allapot !== 'Lemondva'; }
  function rendezFg(l) { return l.slice().sort(function (a, b) { return (a.datum + a.sav).localeCompare(b.datum + b.sav); }); }
  function helyszini(r) { return !!(r.helyszini || r.szallitas === 'szereles'); }
  function fizetElore(r) { return ['eloleg', 'teljes', 'atutalas'].indexOf(r.fizetes) > -1; }
  function szamAzon(elo, azon) { return elo + '-' + String(azon || '').replace(/^HK-/, ''); }
  function elolegSzamol(o) { return Math.round((o || 0) * (B.elolegSzazalek || 30) / 100 / 100) * 100; }
  function vevoNev(r) { return (r.vevo && (r.vevo.cegnev || r.vevo.nev)) || '–'; }
  function allapotIdo(r, a) { var n = (r.allapotNaplo || []).filter(function (x) { return x.allapot === a; }); return n.length ? n[n.length - 1].ido : ''; }
  function foglalasRendeleshez(azon) { var l = lista(K.fg).filter(function (f) { return f.rendeles === azon && aktivFg(f); }); return l.length ? l[l.length - 1] : null; }
  function burok(html) { return '<div class="adm-tabla-burok" tabindex="0" role="region" aria-label="Görgethető táblázat">' + html + '</div>'; }
  function ures(szoveg) { return '<div class="adm-ures">' + szoveg + '</div>'; }
  function fej(cim, al, jobb) { return '<div class="adm-fej"><div><h1 class="adm-cim" tabindex="-1">' + esc(cim) + '</h1>' + (al ? '<p class="halvany mb0">' + al + '</p>' : '') + '</div>' + (jobb ? '<div class="adm-fej-gombok">' + jobb + '</div>' : '') + '</div>'; }
  function vissza(href, szoveg) { return '<a class="adm-vissza" href="' + href + '">← ' + esc(szoveg) + '</a>'; }
  function csillagok(n) { n = Math.max(0, Math.min(5, Math.round(+n || 0))); return '<span class="csillagok" aria-label="' + n + ' / 5 csillag">' + '★★★★★'.slice(0, n) + '<span class="adm-csillag-ures">' + '★★★★★'.slice(0, 5 - n) + '</span></span>'; }
  function mezoHiba(mezo, uzenet) { if (!mezo) return; mezo.classList.add('hibas'); var h = mezo.querySelector('.hiba-uzenet'); if (!h) { h = document.createElement('div'); h.className = 'hiba-uzenet'; h.setAttribute('role', 'alert'); mezo.appendChild(h); } h.textContent = uzenet; var i = mezo.querySelector('input,select,textarea'); if (i) i.setAttribute('aria-invalid', 'true'); }
  function mezoOk(gy) { $$('.mezo.hibas', gy).forEach(function (m) { m.classList.remove('hibas'); var i = m.querySelector('[aria-invalid]'); if (i) i.removeAttribute('aria-invalid'); }); }

  /* ---------- Levélküldés (a levelek modulon át, ha be van töltve) ---------- */
  function levelKuld(sablon, adat, kulcs) {
    var X = window.HKApp || {}; if (typeof X.level !== 'function') return null;
    var obj = adat.rendeles || adat.ajanlatkeres || adat.foglalas, e;
    try { e = X.level(sablon, adat); } catch (err) { hiba('Levélküldés sikertelen (' + sablon + '): ' + (err && err.message), 'admin.level'); return null; }
    // ha a levelek modul új mezőt tett az objektumra (pl. token), az se vesszen el
    if (kulcs && obj && obj.azon) {
      var l = lista(kulcs), x = l.find(function (y) { return y.azon === obj.azon; });
      if (x) { Object.keys(obj).forEach(function (k) { if (!(k in x)) x[k] = obj[k]; }); tar.set(kulcs, l); }
    }
    return e || true;
  }

  /* ---------- Rendelés állapotváltás (napló + levél) ---------- */
  function rendelesAllapot(azon, uj, megj) {
    var l = lista(K.r), r = l.find(function (x) { return x.azon === azon; }); if (!r) return null;
    var fg = foglalasRendeleshez(azon), sablon = null;
    r.allapot = uj;
    if (!Array.isArray(r.allapotNaplo)) r.allapotNaplo = [];
    var bej = { ido: most(), allapot: uj }; if (megj) bej.megj = megj; r.allapotNaplo.push(bej);
    if (uj === 'Díjbekérő elküldve') { if (!r.dijbekero) r.dijbekero = szamAzon('DB', r.azon); sablon = 'dijbekero'; }
    else if (uj === 'Előleg beérkezett') { r.fizetve = Math.max(r.fizetve || 0, r.eloleg || elolegSzamol(r.osszesen)); sablon = 'fizetes-beerkezett'; }
    else if (uj === 'Fizetve') { r.fizetve = r.osszesen || 0; sablon = 'fizetes-beerkezett'; }
    else if (uj === 'Időpont egyeztetve') { if (!r.idopont && fg) r.idopont = { datum: fg.datum, sav: fg.sav }; sablon = 'idopont-visszaigazolas'; }
    else if (uj === 'Szerelés kész') { if (!r.szamla) r.szamla = szamAzon('SZ', r.azon); sablon = 'szereles-kesz'; }
    tar.set(K.r, l);
    // a kapcsolódó foglalás kövesse a rendelést
    if (fg) {
      var fa = uj === 'Időpont egyeztetve' && fg.allapot === 'Foglalt' ? 'Visszaigazolva' : uj === 'Szerelés kész' && fg.allapot !== 'Kész' ? 'Kész' : uj === 'Lemondva' ? 'Lemondva' : null;
      if (fa) fg = frissit(K.fg, fg.azon, function (f) { f.allapot = fa; }) || fg;
    }
    var adat = { rendeles: r }; if (fg) adat.foglalas = fg;
    var lev = sablon ? levelKuld(sablon, adat, K.r) : null;
    return { rendeles: r, sablon: sablon, level: !!lev };
  }

  /* ---------- Demó belépés ---------- */
  function belepes(cel, cim, kesz) {
    if (!cel) return;
    if (belepve()) { cel.innerHTML = ''; kesz(); return; }
    cel.innerHTML = '<div class="adm-belepes"><h1>' + esc(cim) + '</h1><p class="halvany">Bemutató felület kitalált adatokkal. A demó belépőkód: <b class="adm-kod">' + KOD + '</b></p>' +
      '<form id="adm-belep-urlap" novalidate><div class="mezo"><label for="adm-kod">Belépőkód</label><input type="text" id="adm-kod" autocomplete="off" autocapitalize="off" spellcheck="false" required aria-describedby="adm-kod-sugo"><div class="sugo" id="adm-kod-sugo">Írd be: minta</div><div class="hiba-uzenet" role="alert">Hibás kód. A demó kódja: minta</div></div>' +
      '<button class="gomb gomb-kek gomb-teli" type="submit">Belépés</button></form><p class="halvany adm-apro">Demó: a belépés ebben a böngészőben megmarad, amíg ki nem lépsz. A mintaadatok ügyfélfiókjaiba a „minta1234” jelszóval lehet belépni.</p></div>';
    var f = $('#adm-belep-urlap', cel);
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var i = $('#adm-kod', cel);
      if (i.value.trim().toLowerCase() !== KOD) { i.closest('.mezo').classList.add('hibas'); i.setAttribute('aria-invalid', 'true'); i.focus(); return; }
      ses('hk_admin', '1'); cel.innerHTML = ''; kesz();
    });
  }
  document.addEventListener('click', function (e) {
    if (e.target.closest('[data-adm-kilep]')) { ses('hk_admin', null); location.href = location.pathname; }
    if (e.target.closest('[data-nyomtat]')) window.print();
  });

  /* ---------- CSV ---------- */
  function csv(nev, fejlec, sorok) {
    var cella = function (v) {
      if (v == null) v = '';
      if (typeof v === 'string' && /^[=+\-@\t\r]/.test(v)) v = "'" + v; // táblázatkezelő-képlet ellen
      v = String(v);
      return /[";\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    var s = '﻿' + [fejlec].concat(sorok).map(function (r) { return r.map(cella).join(';'); }).join('\r\n');
    try {
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([s], { type: 'text/csv;charset=utf-8' }));
      a.download = nev + '-' + ma() + '.csv'; document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 800);
      toast('CSV elkészült: ' + esc(a.download));
    } catch (e) { toast('A CSV exportot ez a böngésző nem engedi.'); }
  }
  function csvRendelesek() {
    csv('rendelesek', ['Rendelésszám', 'Dátum', 'Állapot', 'Név', 'Cégnév', 'Adószám', 'E-mail', 'Telefon', 'Irsz.', 'Település', 'Cím', 'Szállítás', 'Fizetés', 'Tételek', 'Nettó', 'Áfa', 'Összesen', 'Előleg', 'Befizetve', 'Díjbekérő', 'Számla', 'Időpont'],
      lista(K.r).sort(ujabbElol).map(function (r) { var v = r.vevo || {}; return [r.azon, idoHu(r.ido), r.allapot, v.nev, v.cegnev, v.adoszam, v.email, v.tel, v.irsz, v.telepules, v.utca, SZALL[r.szallitas] || '', FIZ[r.fizetes] || r.fizetes, (r.tetelek || []).map(function (t) { return t.db + '× ' + t.nev; }).join(' | '), r.netto, r.afa, r.osszesen, r.eloleg, r.fizetve || 0, r.dijbekero || '', r.szamla || '', r.idopont ? r.idopont.datum + ' ' + r.idopont.sav : '']; }));
  }
  function csvUgyfelek() {
    csv('ugyfelek', ['E-mail', 'Név', 'Telefon', 'Település', 'Fiók', 'Hírlevél', 'Rendelések', 'Költés (Ft)', 'Utolsó rendelés', 'Törzsvásárló', 'Telepített klímák', 'Következő tisztítás'],
      ugyfelAdatok().map(function (u) { return [u.email, u.nev, u.tel, u.telepules, u.fiok ? 'igen' : 'vendég', u.hirlevel ? 'igen' : 'nem', u.db, u.koltes, u.utolso ? idoHu(u.utolso) : '', u.torzs ? 'igen' : 'nem', u.klimak.join(' | '), u.tisztitas ? u.tisztitas.datum : '']; }));
  }

  /* =====================================================================
     ADMIN
     ===================================================================== */
  var RAJZ = {};
  function admin() {
    belepes($('#adm-belepes'), 'Admin belépés', function () {
      $('#adm-keret').hidden = false;
      window.addEventListener('hashchange', function () { utvonal(true); });
      $('#adm-admin').addEventListener('click', function (e) {
        var s = e.target.closest('[data-szuro-allapot]'); if (s) { SZ.rAllapot = s.getAttribute('data-szuro-allapot'); SZ.rKeres = ''; }
        var a = e.target.closest('a[href^="#"]');
        if (a && a.getAttribute('href') === location.hash) { e.preventDefault(); utvonal(true); }
        var c = e.target.closest('[data-csv]'); if (c) { var t = c.getAttribute('data-csv'); if (t === 'rendelesek') csvRendelesek(); else if (t === 'ugyfelek') csvUgyfelek(); else if (CSV_EGYEB[t]) CSV_EGYEB[t](); }
        if (e.target.closest('[data-dialog-zar]')) dialogZar();
      });
      var d = $('#adm-dialog');
      if (d) d.addEventListener('click', function (e) { if (e.target === d) dialogZar(); });
      utvonal(false);
    });
  }
  function utvonal(navigacio) {
    var h = location.hash.replace(/^#/, ''); try { h = decodeURIComponent(h); } catch (e) { }
    var p = h.split('/'), ful = p[0], par = p.slice(1).join('/');
    if (!RAJZ[ful]) { ful = 'attekintes'; par = ''; }
    $$('#adm-menu a').forEach(function (a) { if (a.getAttribute('data-ful') === ful) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    var akt = $('#adm-menu a[aria-current]'), menu = $('#adm-menu');
    if (akt && menu && menu.scrollWidth > menu.clientWidth) { var ar = akt.getBoundingClientRect(), mr = menu.getBoundingClientRect(); menu.scrollLeft += (ar.left - mr.left) - (mr.width - ar.width) / 2; }
    szamlalok();
    var fo = $('#adm-fo'), belso = document.createElement('div'); // friss tároló: a régi nézet eseménykezelői vele együtt eltűnnek
    fo.innerHTML = ''; belso.className = 'adm-fo-belso'; fo.appendChild(belso);
    try { RAJZ[ful](belso, par); } catch (e) { console.error(e); hiba('Admin megjelenítési hiba (' + ful + '): ' + e.message, 'admin'); belso.innerHTML = '<div class="figyelmezteto">Hiba történt a megjelenítéskor: ' + esc(e.message) + '</div>'; }
    if (navigacio) { var c = $('.adm-cim', fo); window.scrollTo(0, 0); if (c) { try { c.focus({ preventScroll: true }); } catch (e) { c.focus(); } } }
  }
  function ujra() { utvonal(false); }
  function szamlalok() {
    var db = {
      rendelesek: lista(K.r).filter(function (r) { return r.allapot === 'Új'; }).length,
      ajanlatok: lista(K.ak).filter(function (a) { return !a.allapot || a.allapot === 'Új'; }).length,
      naptar: lista(K.fg).filter(function (f) { return aktivFg(f) && f.datum === ma(); }).length
    };
    $$('[data-szaml]').forEach(function (s) { var n = db[s.getAttribute('data-szaml')]; s.textContent = n ? n : ''; s.setAttribute('aria-label', n ? n + ' új' : ''); });
  }
  function dialog(html) {
    var d = $('#adm-dialog'); if (!d) return null;
    $('#adm-dialog-tartalom').innerHTML = '<button class="adm-dialog-x" type="button" data-dialog-zar aria-label="Bezárás">×</button>' + html;
    if (typeof d.showModal === 'function') { if (!d.open) d.showModal(); } else d.setAttribute('open', '');
    return d;
  }
  function dialogZar() { var d = $('#adm-dialog'); if (!d) return; if (typeof d.close === 'function' && d.open) d.close(); else d.removeAttribute('open'); }

  /* ---------- Áttekintés ---------- */
  RAJZ.attekintes = function (fo) {
    var rl = lista(K.r), fg = lista(K.fg).filter(aktivFg), ak = lista(K.ak);
    var maS = ma(), holS = napPlusz(1), hetS = napPlusz(7);
    var ujR = rl.filter(function (r) { return r.allapot === 'Új'; });
    var fizVar = rl.filter(function (r) { return r.allapot === 'Díjbekérő elküldve'; });
    var maiF = rendezFg(fg.filter(function (f) { return f.datum === maS; }));
    var holF = rendezFg(fg.filter(function (f) { return f.datum === holS; }));
    var hetF = rendezFg(fg.filter(function (f) { return f.datum > holS && f.datum <= hetS; }));
    var ujAk = ak.filter(function (a) { return !a.allapot || a.allapot === 'Új'; });
    var erv = rl.filter(function (r) { return r.allapot !== 'Lemondva'; });
    var ho = maS.slice(0, 7);
    var bevHo = osszeg(erv.filter(function (r) { return isoNap(r.ido).slice(0, 7) === ho; }), 'osszesen');
    var bevOssz = osszeg(erv, 'osszesen'), befolyt = osszeg(rl, 'fizetve');

    var teendok = [];
    ujR.forEach(function (r) { teendok.push(['narancs', fizetElore(r) ? 'Díjbekérő küldése' : 'Új rendelés feldolgozása', r.azon + ' · ' + vevoNev(r) + ' · ' + ft(r.osszesen), '#rendelesek/' + r.azon]); });
    fizVar.forEach(function (r) { var n = napokOta(allapotIdo(r, 'Díjbekérő elküldve') || r.ido); teendok.push([n >= 3 ? 'piros' : 'sarga', n >= 3 ? 'Fizetés nem érkezett meg (' + n + ' napja)' : 'Fizetésre vár', r.azon + ' · ' + vevoNev(r) + ' · ' + ft(r.osszesen), '#rendelesek/' + r.azon]); });
    rl.filter(function (r) { return (r.allapot === 'Előleg beérkezett' || r.allapot === 'Fizetve') && helyszini(r) && !foglalasRendeleshez(r.azon); }).forEach(function (r) { teendok.push(['kek', 'Időpont egyeztetése', r.azon + ' · ' + vevoNev(r) + ' · ' + esc((r.vevo || {}).tel || ''), '#rendelesek/' + r.azon]); });
    maiF.concat(holF).filter(function (f) { return !f.szerelo; }).forEach(function (f) { teendok.push(['sarga', 'Szerelő hozzárendelése', (TIPUS[f.tipus] || 'Munka') + ' · ' + rovidNap(f.datum) + ' ' + f.sav + ' · ' + f.nev, '#naptar/' + hetEleje(f.datum)]); });
    ujAk.forEach(function (a) { teendok.push(['kek', 'Ajánlat összeállítása', a.azon + ' · ' + (a.nev || '') + ' · ' + (a.telepules || ''), '#ajanlatok/' + a.azon]); });

    var csempe = function (cim, db, href, extra, ton, al) { return '<a class="adm-csempe adm-csempe-' + ton + '" href="' + href + '"' + (extra || '') + '><span>' + cim + '</span><b>' + db + '</b>' + (al ? '<small>' + al + '</small>' : '') + '</a>'; };
    var fgSor = function (f) { return '<li><a href="#naptar/' + hetEleje(f.datum) + '"><span class="adm-t-pont adm-t-' + esc(f.tipus) + '" aria-hidden="true"></span><b>' + esc(f.sav) + '</b> ' + esc(TIPUS[f.tipus] || f.tipus) + ' – ' + esc(f.nev) + '<small>' + esc(cimSzoveg(f.cim, f.telepules)) + ' · ' + (f.szerelo ? esc(f.szerelo) : '<span class="adm-piros">nincs szerelő</span>') + '</small></a></li>'; };
    var fgBlokk = function (cim, l) { return '<h3>' + cim + ' <span class="halvany">(' + l.length + ')</span></h3>' + (l.length ? '<ul class="adm-mini-lista">' + l.map(fgSor).join('') + '</ul>' : '<p class="halvany">Nincs időpont.</p>'); };
    var dObj = new Date();

    fo.innerHTML = fej('Áttekintés', datumHu(maS, true), '<a class="gomb gomb-keret gomb-kicsi" href="/szerelo/">Szerelői nézet</a><button class="gomb gomb-keret gomb-kicsi" type="button" data-adm-kilep>Kilépés</button>') +
      (!rl.length && !fg.length && !ak.length ? '<div class="info-doboz adm-mb">Még nincs adat ebben a böngészőben. A <a href="#rendszer">Rendszer</a> fülön tölthetsz be hitelesnek tűnő, kitalált mintaadatokat.</div>' : '') +
      '<div class="adm-csempek">' +
      csempe('Új rendelés', ujR.length, '#rendelesek', ' data-szuro-allapot="Új"', 'narancs', 'feldolgozásra vár') +
      csempe('Fizetésre vár', fizVar.length, '#rendelesek', ' data-szuro-allapot="Díjbekérő elküldve"', 'sarga', ft(osszeg(fizVar, 'osszesen'))) +
      csempe('Mai időpont', maiF.length, '#naptar', '', 'kek', rovidNap(maS)) +
      csempe('Holnapi időpont', holF.length, '#naptar/' + hetEleje(holS), '', 'kek', rovidNap(holS)) +
      csempe('Új ajánlatkérés', ujAk.length, '#ajanlatok', '', 'zold', 'válaszra vár') +
      '</div>' +
      '<div class="adm-racs2">' +
      '<section class="adm-kartya" aria-labelledby="t-cim"><h2 id="t-cim">Teendők <span class="halvany">(' + teendok.length + ')</span></h2>' +
      (teendok.length ? '<ul class="adm-teendok">' + teendok.slice(0, 14).map(function (t) { return '<li class="adm-teendo-' + t[0] + '"><a href="' + t[3] + '"><b>' + esc(t[1]) + '</b><span>' + esc(t[2]) + '</span></a></li>'; }).join('') + '</ul>' + (teendok.length > 14 ? '<p class="halvany">…és még ' + (teendok.length - 14) + ' tétel.</p>' : '') : '<p class="halvany">Minden rendben, nincs sürgős teendő.</p>') + '</section>' +
      '<section class="adm-kartya" aria-labelledby="i-cim"><h2 id="i-cim">Időpontok</h2>' + fgBlokk('Ma', maiF) + fgBlokk('Holnap', holF) + fgBlokk('A következő napokban (7 nap)', hetF) + '</section>' +
      '</div>' +
      '<div class="adm-csempek adm-bevetel">' +
      '<div class="adm-csempe adm-csempe-navy"><span>Bevétel – ' + HONAP_NEV[dObj.getMonth()] + '</span><b>' + ft(bevHo) + '</b><small>nem lemondott rendelések, bruttó</small></div>' +
      '<div class="adm-csempe adm-csempe-navy"><span>Bevétel – összesen</span><b>' + ft(bevOssz) + '</b><small>' + erv.length + ' rendelés</small></div>' +
      '<div class="adm-csempe adm-csempe-navy"><span>Beérkezett pénz</span><b>' + ft(befolyt) + '</b><small>előlegek és kifizetések</small></div>' +
      '<div class="adm-csempe adm-csempe-navy"><span>Átlagos kosárérték</span><b>' + ft(erv.length ? bevOssz / erv.length : 0) + '</b><small>bruttó</small></div>' +
      '</div>' +
      '<div class="adm-racs2">' + hetiDiagram(rl) + nepszeruTermekek(erv) + '</div>';
  };
  function hetiDiagram(rl) {
    var het0 = hetEleje(ma()), hetek = [];
    for (var i = 7; i >= 0; i--) hetek.push(napPlusz(-7 * i, het0));
    var adat = hetek.map(function (h) {
      var veg = napPlusz(7, h);
      var l = rl.filter(function (r) { var n = isoNap(r.ido); return r.allapot !== 'Lemondva' && n >= h && n < veg; });
      return { het: h, db: l.length, ft: osszeg(l, 'osszesen') };
    });
    var max = Math.max.apply(null, adat.map(function (a) { return a.db; }).concat([1]));
    var leiras = adat.map(function (a) { return rovidNap(a.het) + ' heti: ' + a.db + ' db'; }).join(', ');
    return '<section class="adm-kartya" aria-labelledby="d-cim"><h2 id="d-cim">Rendelések az elmúlt 8 hétben</h2><p class="halvany adm-apro">Hetek hétfőtől; lemondott rendelések nélkül.</p>' +
      '<div class="adm-diagram" role="img" aria-label="' + esc(leiras) + '">' + adat.map(function (a, i) {
        return '<div class="adm-oszlop' + (i === adat.length - 1 ? ' adm-oszlop-most' : '') + '" title="' + esc(rovidNap(a.het) + ' heti: ' + a.db + ' rendelés, ' + ft(a.ft)) + '"><span class="adm-oszlop-db">' + a.db + '</span><span class="adm-oszlop-ter"><span class="adm-oszlop-sav" style="height:' + Math.round(a.db / max * 100) + '%"></span></span><span class="adm-oszlop-cimke">' + rovidNap(a.het) + '</span></div>';
      }).join('') + '</div><p class="halvany adm-apro mb0">8 hét összesen: <b>' + adat.reduce(function (s, a) { return s + a.db; }, 0) + ' rendelés</b>, ' + ft(adat.reduce(function (s, a) { return s + a.ft; }, 0)) + '</p></section>';
  }
  function nepszeruTermekek(erv) {
    var m = {};
    erv.forEach(function (r) { (r.tetelek || []).forEach(function (t) { var k = t.nev || '–'; if (!m[k]) m[k] = { nev: k, db: 0, ft: 0, klima: !!(t.x && t.x.t === 'k') }; m[k].db += +t.db || 0; m[k].ft += +t.osszeg || 0; }); });
    var l = Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return (b.klima - a.klima) || b.db - a.db || b.ft - a.ft; }).slice(0, 6);
    var max = Math.max.apply(null, l.map(function (x) { return x.db; }).concat([1]));
    return '<section class="adm-kartya" aria-labelledby="n-cim"><h2 id="n-cim">Legnépszerűbb termékek</h2>' + (l.length ? '<ol class="adm-top">' + l.map(function (x) {
      return '<li><div class="adm-top-sor"><span>' + esc(x.nev) + '</span><b>' + x.db + ' db</b></div><div class="adm-top-sav"><span style="width:' + Math.round(x.db / max * 100) + '%"></span></div><small class="halvany">' + ft(x.ft) + '</small></li>';
    }).join('') + '</ol>' : '<p class="halvany">Még nincs rendelés.</p>') + '</section>';
  }

  /* ---------- Rendelések ---------- */
  RAJZ.rendelesek = function (fo, par) {
    if (par) return rendelesReszlet(fo, par);
    var osszes = lista(K.r);
    fo.innerHTML = fej('Rendelések', osszes.length + ' rendelés összesen', '<button class="gomb gomb-keret gomb-kicsi" type="button" data-csv="rendelesek">CSV export</button>') +
      '<div class="adm-szuro" role="search"><div class="mezo"><label for="r-keres">Keresés</label><input type="search" id="r-keres" placeholder="Rendelésszám, név, e-mail, telefon, település" value="' + esc(SZ.rKeres) + '"></div>' +
      '<div class="mezo"><label for="r-allapot">Állapot</label><select id="r-allapot">' + opt('', 'Minden állapot', SZ.rAllapot) + H.ALLAPOTOK.map(function (a) { return opt(a, a + ' (' + osszes.filter(function (r) { return r.allapot === a; }).length + ')', SZ.rAllapot); }).join('') + '</select></div></div><div id="r-tabla" aria-live="polite"></div>';
    function rajz() {
      var q = SZ.rKeres.trim().toLowerCase();
      var l = lista(K.r).filter(function (r) {
        if (SZ.rAllapot && r.allapot !== SZ.rAllapot) return false;
        if (!q) return true;
        var v = r.vevo || {};
        return [r.azon, v.nev, v.cegnev, v.email, v.tel, v.telepules, r.fiok].join(' ').toLowerCase().indexOf(q) > -1;
      }).sort(ujabbElol);
      $('#r-tabla').innerHTML = l.length ? '<p class="halvany adm-apro">' + l.length + ' találat</p>' + burok('<table class="adm-tabla"><thead><tr><th scope="col">Rendelés</th><th scope="col">Dátum</th><th scope="col">Vevő</th><th scope="col">Település</th><th scope="col" class="jobb">Összeg</th><th scope="col">Fizetés</th><th scope="col">Állapot</th><th scope="col">Időpont</th></tr></thead><tbody>' +
        l.map(function (r) {
          var v = r.vevo || {}, fg = r.idopont || foglalasRendeleshez(r.azon);
          return '<tr><td><a href="#rendelesek/' + esc(r.azon) + '"><b>' + esc(r.azon) + '</b></a>' + (r.minta ? ' <span class="adm-minta-cimke">minta</span>' : '') + '</td><td>' + idoHu(r.ido) + '</td><td>' + esc(vevoNev(r)) + '<small class="adm-al">' + esc(v.email || '') + '</small></td><td>' + esc(v.telepules || '–') + '</td><td class="jobb"><b>' + ft(r.osszesen) + '</b>' + (r.fizetve ? '<small class="adm-al">befizetve ' + ft(r.fizetve) + '</small>' : '') + '</td><td>' + esc(FIZ[r.fizetes] || r.fizetes || '–') + '</td><td>' + jelzo(r.allapot) + '</td><td>' + (fg ? rovidNap(fg.datum) + ' ' + esc(fg.sav) : (helyszini(r) ? '<span class="halvany">nincs</span>' : '<span class="halvany">–</span>')) + '</td></tr>';
        }).join('') + '</tbody></table>') : ures(osszes.length ? 'Nincs a szűrésnek megfelelő rendelés.' : 'Még nincs rendelés. A <a href="#rendszer">Rendszer</a> fülön betölthetsz mintaadatokat.');
    }
    $('#r-keres').addEventListener('input', function (e) { SZ.rKeres = e.target.value; rajz(); });
    $('#r-allapot').addEventListener('change', function (e) { SZ.rAllapot = e.target.value; rajz(); });
    rajz();
  };

  function rendelesReszlet(fo, azon) {
    var r = keres(K.r, azon);
    if (!r) { fo.innerHTML = vissza('#rendelesek', 'Rendelések') + '<div class="figyelmezteto">Nincs ilyen rendelés: ' + esc(azon) + '</div>'; return; }
    var v = r.vevo || {}, fg = foglalasRendeleshez(r.azon), email = v.email || r.fiok || '';
    var tet = (r.tetelek || []).map(function (t) {
      return '<tr><td><b>' + esc(t.nev) + '</b>' + (t.szerelt ? ' <span class="cimke cimke-kek">szereléssel</span>' : '') + (t.sorok && t.sorok.length ? '<ul class="adm-sorok">' + t.sorok.map(function (s) { return '<li>' + esc(s[0]) + ': ' + ft(s[1]) + '</li>'; }).join('') + '</ul>' : '') + '</td><td class="jobb">' + esc(t.db) + '</td><td class="jobb">' + ft(t.egyseg) + '</td><td class="jobb"><b>' + ft(t.osszeg) + '</b></td></tr>';
    }).join('');
    var ossz = [['Termékek, szolgáltatások', ft(r.termekOsszeg)]];
    if (r.kiszallas) ossz.push(['Kiszállás', ft(r.kiszallas)]);
    if (r.szallitasDij) ossz.push(['Szállítás', ft(r.szallitasDij)]);
    (r.kedvezmenyek || []).forEach(function (k) { ossz.push([k[0], ft(k[1])]); });
    ossz.push(['Fizetendő (bruttó)', '<b>' + ft(r.osszesen) + '</b>']);
    ossz.push(['Ebből nettó / áfa', ft(r.netto) + ' / ' + ft(r.afa)]);
    if (r.eloleg) ossz.push(['Előleg', ft(r.eloleg)]);
    ossz.push(['Befizetve', r.fizetve ? '<b class="adm-zold">' + ft(r.fizetve) + '</b>' : '–']);
    if (r.fizetve && r.fizetve < r.osszesen) ossz.push(['Hátralék', ft(r.osszesen - r.fizetve)]);
    var naplo = (r.allapotNaplo || []).slice().reverse().map(function (n) { return '<li><b>' + esc(n.allapot) + '</b> <small class="halvany">' + idoHu(n.ido) + '</small>' + (n.megj ? '<div class="halvany">' + esc(n.megj) + '</div>' : '') + '</li>'; }).join('');
    var rq = '?azon=' + encodeURIComponent(r.azon);
    var levelVan = typeof (window.HKApp || {}).level === 'function';
    var fgHtml;
    if (fg) {
      fgHtml = '<dl class="adm-dl"><dt>Időpont</dt><dd><b>' + datumHu(fg.datum, true) + ', ' + esc(fg.sav) + '</b></dd><dt>Típus</dt><dd>' + esc(TIPUS[fg.tipus] || fg.tipus) + '</dd><dt>Állapot</dt><dd>' + jelzo(fg.allapot) + '</dd><dt>Szerelő</dt><dd>' + (fg.szerelo ? esc(fg.szerelo) : '<span class="adm-piros">nincs hozzárendelve</span>') + '</dd></dl>' +
        '<div class="sor"><a class="gomb gomb-keret gomb-kicsi" href="#naptar/' + hetEleje(fg.datum) + '">Megnyitás a naptárban</a>' + (fg.munkalap ? '<a class="gomb gomb-keret gomb-kicsi" href="/szerelo/jegyzokonyv/?azon=' + encodeURIComponent(fg.azon) + '">Jegyzőkönyv</a>' : '') + '</div>';
    } else if (r.allapot === 'Lemondva') {
      fgHtml = '<p class="halvany mb0">Lemondott rendelés – nincs időpont.</p>';
    } else {
      var tipAlap = helyszini(r) ? 'szereles' : 'felmeres';
      fgHtml = '<p class="halvany adm-apro">Ehhez a rendeléshez még nincs foglalás. Rögzítsd a telefonon egyeztetett időpontot:</p><form id="r-fg-urlap" novalidate><div class="adm-urlap3">' +
        '<div class="mezo"><label for="r-fg-datum">Dátum</label><input type="date" id="r-fg-datum" min="' + napPlusz(-30) + '" value="' + napPlusz(r.allapot === 'Új' ? 3 : 2) + '" required></div>' +
        '<div class="mezo"><label for="r-fg-sav">Sáv</label><select id="r-fg-sav">' + SAVOK.map(function (s) { return opt(s, s + ' óra'); }).join('') + '</select></div>' +
        '<div class="mezo"><label for="r-fg-tipus">Típus</label><select id="r-fg-tipus">' + Object.keys(TIPUS).map(function (k) { return opt(k, TIPUS[k], tipAlap); }).join('') + '</select></div></div>' +
        '<div class="mezo"><label for="r-fg-szerelo">Szerelő</label><select id="r-fg-szerelo">' + opt('', 'Később döntöm el') + SZ_NEVEK.map(function (n) { return opt(n); }).join('') + '</select></div>' +
        '<p class="adm-apro halvany" id="r-fg-info" aria-live="polite"></p>' +
        '<label class="pipa-sor"><input type="checkbox" id="r-fg-allapot" checked> <span>Állapot: „Időpont egyeztetve” + visszaigazoló levél</span></label>' +
        '<button class="gomb gomb-kek gomb-kicsi" type="submit">Időpont rögzítése</button></form>';
    }
    fo.innerHTML = vissza('#rendelesek', 'Rendelések') +
      fej(r.azon, idoHu(r.ido) + ' · ' + jelzo(r.allapot) + (r.minta ? ' <span class="adm-minta-cimke">mintaadat</span>' : ''), '') +
      '<div class="adm-racs2">' +
      '<div class="adm-oszlop-bal">' +
      '<section class="adm-kartya"><h2>Tételek</h2>' + burok('<table class="adm-tabla adm-tabla-kicsi"><thead><tr><th scope="col">Tétel</th><th scope="col" class="jobb">Db</th><th scope="col" class="jobb">Egységár</th><th scope="col" class="jobb">Összeg</th></tr></thead><tbody>' + (tet || '<tr><td colspan="4">Nincs tétel.</td></tr>') + '</tbody></table>') +
      '<dl class="adm-dl adm-dl-osszeg">' + ossz.map(function (o) { return '<dt>' + esc(o[0]) + '</dt><dd>' + o[1] + '</dd>'; }).join('') + '</dl>' +
      '<p class="adm-apro halvany mb0">Fizetés: <b>' + esc(FIZ[r.fizetes] || r.fizetes || '–') + '</b> · Szállítás: <b>' + esc(SZALL[r.szallitas] || '–') + '</b></p></section>' +
      '<section class="adm-kartya"><h2>Vevő</h2><dl class="adm-dl"><dt>Név</dt><dd>' + esc(v.nev || '–') + '</dd>' + (v.cegnev ? '<dt>Cég</dt><dd>' + esc(v.cegnev) + (v.adoszam ? '<br><small>Adószám: ' + esc(v.adoszam) + '</small>' : '') + '</dd>' : '') +
      '<dt>Telefon</dt><dd>' + (v.tel ? '<a href="' + telHref(v.tel) + '">' + esc(v.tel) + '</a>' : '–') + '</dd><dt>E-mail</dt><dd>' + (email ? '<a href="mailto:' + esc(email) + '">' + esc(email) + '</a>' : '–') + '</dd>' +
      '<dt>Cím</dt><dd>' + esc([v.irsz, v.telepules].filter(Boolean).join(' ')) + (v.utca ? ', ' + esc(v.utca) : '') + (v.utca ? '<br><a href="' + terkepUrl(v.utca, v.telepules) + '" target="_blank" rel="noopener">Térkép</a>' : '') + '</dd>' +
      '<dt>Fiók</dt><dd>' + (r.fiok ? 'Regisztrált (' + esc(r.fiok) + ')' : 'Vendégrendelés') + '</dd>' + (r.megj ? '<dt>Vevő megjegyzése</dt><dd>' + esc(r.megj) + '</dd>' : '') + '</dl></section>' +
      '<section class="adm-kartya"><h2>Belső megjegyzés</h2><form id="r-belso-urlap"><div class="mezo"><label for="r-belso" class="rejtett">Belső megjegyzés</label><textarea id="r-belso" placeholder="Csak a csapat látja (pl. kapukód, parkolás, egyeztetés részletei)">' + esc(r.belsoMegj || '') + '</textarea>' + (r.belsoMegjIdo ? '<div class="sugo">Utoljára mentve: ' + idoHu(r.belsoMegjIdo) + '</div>' : '') + '</div><button class="gomb gomb-keret gomb-kicsi" type="submit">Megjegyzés mentése</button></form></section>' +
      '</div><div class="adm-oszlop-jobb">' +
      '<section class="adm-kartya"><h2>Állapot</h2><p>Jelenleg: ' + jelzo(r.allapot) + '</p><form id="r-all-urlap" novalidate>' +
      '<div class="mezo"><label for="r-uj-allapot">Új állapot</label><select id="r-uj-allapot">' + H.ALLAPOTOK.map(function (a) { return opt(a, a, kovetkezoAllapot(r)); }).join('') + '</select></div>' +
      '<div class="mezo"><label for="r-all-megj">Megjegyzés a naplóba (nem kötelező)</label><input type="text" id="r-all-megj" maxlength="200"></div>' +
      '<p class="info-doboz adm-apro" id="r-level-info" aria-live="polite"></p>' +
      '<button class="gomb gomb-fo gomb-kicsi" type="submit">Állapot mentése</button></form>' +
      '<h3 class="adm-h3">Állapotnapló</h3><ol class="adm-naplo">' + (naplo || '<li class="halvany">Nincs bejegyzés.</li>') + '</ol></section>' +
      '<section class="adm-kartya"><h2>Időpont</h2>' + fgHtml + '</section>' +
      '<section class="adm-kartya"><h2>Dokumentumok</h2><ul class="adm-linkek">' +
      '<li><a href="/dijbekero/' + rq + '">Díjbekérő</a> <small class="halvany">' + esc(r.dijbekero || 'még nincs szám') + '</small></li>' +
      '<li><a href="/szamla/' + rq + '">Végszámla (minta)</a> <small class="halvany">' + esc(r.szamla || 'még nincs szám') + '</small></li>' +
      '<li><a href="/rendeles/' + rq + (email ? '&email=' + encodeURIComponent(email) : '') + '">Ügyfél rendeléskövető oldala</a></li></ul></section>' +
      '</div></div>';

    var sel = $('#r-uj-allapot');
    function levelInfo() { var a = sel.value; $('#r-level-info').textContent = (LEVEL_INFO[a] || 'Ehhez az állapothoz nem megy automatikus levél.') + (LEVEL_INFO[a] && !levelVan ? ' (A levelek modul nincs betöltve, ezért most levél nem készül.)' : ''); }
    sel.addEventListener('change', levelInfo); levelInfo();
    $('#r-all-urlap').addEventListener('submit', function (e) {
      e.preventDefault();
      var uj = sel.value;
      if (uj === r.allapot) { toast('Ez már a jelenlegi állapot.'); return; }
      if (uj === 'Lemondva' && !confirm('Biztosan lemondottra állítod a(z) ' + r.azon + ' rendelést? A kapcsolódó időpont is lemondásra kerül.')) return;
      var res = rendelesAllapot(r.azon, uj, $('#r-all-megj').value.trim());
      toast('Állapot: <b>' + esc(uj) + '</b>' + (res && res.level ? ' · levél elküldve (<a href="/postafiok/">postafiók</a>)' : ''));
      ujra();
    });
    $('#r-belso-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); var t = $('#r-belso').value;
      frissit(K.r, r.azon, function (x) { x.belsoMegj = t; x.belsoMegjIdo = most(); }); toast('Belső megjegyzés mentve.'); ujra();
    });
    var fu = $('#r-fg-urlap');
    if (fu) {
      var info = function () {
        var d = $('#r-fg-datum').value, s = $('#r-fg-sav').value;
        if (!d) { $('#r-fg-info').textContent = ''; return; }
        var n = lista(K.fg).filter(function (f) { return aktivFg(f) && f.datum === d && f.sav === s; }).length;
        $('#r-fg-info').textContent = datumHu(d, true) + ', ' + s + ': ' + (n ? n + ' munka már van ebben a sávban (' + SZ_NEVEK.length + ' szerelő).' : 'szabad sáv.') + (strDatum(d).getDay() === 0 ? ' Figyelem: vasárnap!' : '');
      };
      $('#r-fg-datum').addEventListener('input', info); $('#r-fg-sav').addEventListener('change', info); info();
      fu.addEventListener('submit', function (e) {
        e.preventDefault(); mezoOk(fu);
        var d = $('#r-fg-datum').value, s = $('#r-fg-sav').value, t = $('#r-fg-tipus').value, sz = $('#r-fg-szerelo').value;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) { mezoHiba($('#r-fg-datum').closest('.mezo'), 'Add meg a dátumot.'); $('#r-fg-datum').focus(); return; }
        if (d < ma() && !confirm('A dátum a múltban van. Mégis rögzíted?')) return;
        var n = lista(K.fg).filter(function (f) { return aktivFg(f) && f.datum === d && f.sav === s; }).length;
        if (n >= SZ_NEVEK.length && !confirm('Ebben a sávban már ' + n + ' munka van, és ' + SZ_NEVEK.length + ' szerelőnk van. Mégis rögzíted?')) return;
        var f = { azon: H.azon('FG'), tipus: t, datum: d, sav: s, nev: v.cegnev || v.nev || '', tel: v.tel || '', email: email, telepules: v.telepules || '', cim: v.utca || '', megj: 'Rendelés: ' + r.azon, rendeles: r.azon, allapot: 'Visszaigazolva', ido: most(), forras: 'admin' };
        if (sz) f.szerelo = sz;
        var l = lista(K.fg); l.push(f); tar.set(K.fg, l);
        frissit(K.r, r.azon, function (x) { x.idopont = { datum: d, sav: s }; });
        var lev = false;
        if ($('#r-fg-allapot').checked && r.allapot !== 'Időpont egyeztetve') { var res = rendelesAllapot(r.azon, 'Időpont egyeztetve', 'Időpont: ' + datumHu(d) + ' ' + s); lev = res && res.level; }
        toast('Időpont rögzítve: <b>' + datumHu(d) + ' ' + esc(s) + '</b>' + (lev ? ' · visszaigazolás elküldve' : ''));
        ujra();
      });
    }
  }
  function kovetkezoAllapot(r) {
    var L = H.ALLAPOTOK, i = L.indexOf(r.allapot);
    if (i < 0) return L[0];
    if (r.allapot === 'Új') return fizetElore(r) ? 'Díjbekérő elküldve' : (helyszini(r) ? 'Időpont egyeztetve' : 'Fizetve');
    if (r.allapot === 'Díjbekérő elküldve') return r.fizetes === 'eloleg' ? 'Előleg beérkezett' : 'Fizetve';
    if (r.allapot === 'Előleg beérkezett' || r.allapot === 'Fizetve') return helyszini(r) ? 'Időpont egyeztetve' : 'Lezárva';
    if (r.allapot === 'Időpont egyeztetve') return 'Szerelés kész';
    if (r.allapot === 'Szerelés kész') return 'Lezárva';
    return r.allapot;
  }

  /* ---------- Naptár ---------- */
  RAJZ.naptar = function (fo, par) {
    var het = /^\d{4}-\d{2}-\d{2}$/.test(par) ? hetEleje(par) : hetEleje(ma());
    var fg = lista(K.fg), maS = ma();
    var napok = []; for (var i = 0; i < 7; i++) napok.push(napPlusz(i, het));
    var vasarnap = napok[6];
    if (!fg.some(function (f) { return f.datum === vasarnap; })) napok = napok.slice(0, 6);
    var hetFg = fg.filter(function (f) { return f.datum >= het && f.datum <= napPlusz(6, het); });
    var esemeny = function (f) {
      return '<button type="button" class="adm-esemeny adm-t-' + esc(f.tipus) + (f.allapot === 'Lemondva' ? ' adm-lemondva' : '') + '" data-fg="' + esc(f.azon) + '"><b>' + esc(TIPUS[f.tipus] || f.tipus || 'Munka') + '</b><span>' + esc(f.nev || '–') + '</span><small>' + esc(f.telepules || '') + '</small><small class="adm-esemeny-lab">' + (f.szerelo ? esc(f.szerelo) : '<span class="adm-piros">nincs szerelő</span>') + ' · ' + esc(f.allapot || '') + '</small></button>';
    };
    var nap = function (d) {
      var l = fg.filter(function (f) { return f.datum === d; });
      var egyeb = l.filter(function (f) { return SAVOK.indexOf(f.sav) < 0; });
      return '<section class="adm-nap' + (d === maS ? ' adm-nap-ma' : '') + '" aria-label="' + esc(datumHu(d, true)) + '"><h3><span>' + NAPOK[strDatum(d).getDay()] + '</span> ' + rovidNap(d) + (d === maS ? ' <span class="adm-ma-jel">ma</span>' : '') + '</h3>' +
        SAVOK.map(function (s) { var x = l.filter(function (f) { return f.sav === s; }); return '<div class="adm-sav"><span class="adm-sav-cim">' + s + '</span>' + (x.length ? x.map(esemeny).join('') : '<span class="adm-szabad">szabad</span>') + '</div>'; }).join('') +
        (egyeb.length ? '<div class="adm-sav"><span class="adm-sav-cim">egyéb</span>' + egyeb.map(esemeny).join('') + '</div>' : '') + '</section>';
    };
    var tipusDb = {}; hetFg.filter(aktivFg).forEach(function (f) { tipusDb[f.tipus] = (tipusDb[f.tipus] || 0) + 1; });
    fo.innerHTML = fej('Naptár', 'Heti nézet · ' + datumHu(het) + ' – ' + rovidNap(napPlusz(6, het)) + ' · ' + hetFg.filter(aktivFg).length + ' munka', '') +
      '<div class="adm-naptar-nav"><a class="gomb gomb-keret gomb-kicsi" href="#naptar/' + napPlusz(-7, het) + '" aria-label="Előző hét">‹ Előző</a><a class="gomb gomb-keret gomb-kicsi" href="#naptar/' + hetEleje(maS) + '">Ez a hét</a><a class="gomb gomb-keret gomb-kicsi" href="#naptar/' + napPlusz(7, het) + '" aria-label="Következő hét">Következő ›</a></div>' +
      '<ul class="adm-jelmagyarazat" aria-label="Jelmagyarázat">' + Object.keys(TIPUS).map(function (k) { return '<li><span class="adm-t-pont adm-t-' + k + '" aria-hidden="true"></span>' + TIPUS[k] + (tipusDb[k] ? ' (' + tipusDb[k] + ')' : '') + '</li>'; }).join('') + '<li><span class="adm-t-pont adm-t-lemondva" aria-hidden="true"></span>Lemondva</li></ul>' +
      '<div class="adm-het" style="--n:' + napok.length + '">' + napok.map(nap).join('') + '</div>' +
      '<p class="halvany adm-apro">Kattints egy munkára a részletekhez, a státusz és a szerelő beállításához. ' + SZ_NEVEK.length + ' szerelő → sávonként legfeljebb ' + SZ_NEVEK.length + ' munka ajánlott.</p>';
    $$('[data-fg]', fo).forEach(function (b) { b.addEventListener('click', function () { foglalasDialog(b.getAttribute('data-fg')); }); });
  };
  function foglalasDialog(azon) {
    var f = keres(K.fg, azon); if (!f) return;
    var r = f.rendeles ? keres(K.r, f.rendeles) : null;
    var ml = f.munkalap;
    var d = dialog('<h2 id="adm-dialog-cim">' + esc(TIPUS[f.tipus] || 'Munka') + ' · ' + esc(f.azon) + '</h2>' +
      '<dl class="adm-dl"><dt>Időpont</dt><dd><b>' + datumHu(f.datum, true) + ', ' + esc(f.sav) + '</b></dd><dt>Ügyfél</dt><dd>' + esc(f.nev || '–') + '</dd>' +
      '<dt>Telefon</dt><dd>' + (f.tel ? '<a href="' + telHref(f.tel) + '">' + esc(f.tel) + '</a>' : '–') + '</dd><dt>E-mail</dt><dd>' + (f.email ? '<a href="mailto:' + esc(f.email) + '">' + esc(f.email) + '</a>' : '–') + '</dd>' +
      '<dt>Cím</dt><dd>' + esc(cimSzoveg(f.cim, f.telepules) || '–') + (f.cim || f.telepules ? ' · <a href="' + terkepUrl(f.cim, f.telepules) + '" target="_blank" rel="noopener">Térkép</a>' : '') + '</dd>' +
      (f.megj ? '<dt>Megjegyzés</dt><dd>' + esc(f.megj) + '</dd>' : '') +
      (r ? '<dt>Rendelés</dt><dd><a href="#rendelesek/' + esc(r.azon) + '" data-dialog-zar>' + esc(r.azon) + '</a> · ' + jelzo(r.allapot) + '<br><small>' + (r.tetelek || []).map(function (t) { return esc(t.db + '× ' + t.nev); }).join('<br>') + '</small></dd>' : '') +
      (ml ? '<dt>Munkalap</dt><dd>' + (ml.kesz ? 'Lezárva ' + idoHu(ml.kesz) : 'Piszkozat') + ' · <a href="/szerelo/jegyzokonyv/?azon=' + encodeURIComponent(f.azon) + '">Jegyzőkönyv</a></dd>' : '') + '</dl>' +
      '<form id="fg-urlap" novalidate><div class="adm-urlap2">' +
      '<div class="mezo"><label for="fg-allapot">Státusz</label><select id="fg-allapot">' + FG_ALLAPOT.map(function (a) { return opt(a, a, f.allapot); }).join('') + '</select></div>' +
      '<div class="mezo"><label for="fg-szerelo">Szerelő</label><select id="fg-szerelo">' + opt('', 'Nincs hozzárendelve', f.szerelo || '') + SZ_NEVEK.map(function (n) { return opt(n, n, f.szerelo || ''); }).join('') + '</select></div>' +
      '<div class="mezo"><label for="fg-datum">Dátum</label><input type="date" id="fg-datum" value="' + esc(f.datum) + '" required></div>' +
      '<div class="mezo"><label for="fg-sav">Sáv</label><select id="fg-sav">' + SAVOK.map(function (s) { return opt(s, s + ' óra', f.sav); }).join('') + (SAVOK.indexOf(f.sav) < 0 && f.sav ? opt(f.sav, f.sav, f.sav) : '') + '</select></div></div>' +
      '<label class="pipa-sor" id="fg-level-sor" hidden><input type="checkbox" id="fg-level" checked> <span>Időpont-visszaigazoló levél küldése az ügyfélnek</span></label>' +
      '<div class="sor"><button class="gomb gomb-kek gomb-kicsi" type="submit">Mentés</button><button class="gomb gomb-keret gomb-kicsi" type="button" data-dialog-zar>Mégse</button></div></form>');
    if (!d) return;
    var sel = $('#fg-allapot'), dat = $('#fg-datum'), sav = $('#fg-sav');
    var levelSor = function () { $('#fg-level-sor').hidden = !(sel.value === 'Visszaigazolva' && (f.allapot !== 'Visszaigazolva' || dat.value !== f.datum || sav.value !== f.sav)); };
    [sel, dat, sav].forEach(function (x) { x.addEventListener('change', levelSor); }); levelSor();
    $('#fg-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); mezoOk(e.target);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dat.value)) { mezoHiba(dat.closest('.mezo'), 'Add meg a dátumot.'); return; }
      var kuld = !$('#fg-level-sor').hidden && $('#fg-level').checked;
      var uj = frissit(K.fg, f.azon, function (x) { x.allapot = sel.value; x.datum = dat.value; x.sav = sav.value; if ($('#fg-szerelo').value) x.szerelo = $('#fg-szerelo').value; else delete x.szerelo; });
      if (uj && uj.rendeles && (uj.datum !== f.datum || uj.sav !== f.sav)) frissit(K.r, uj.rendeles, function (x) { x.idopont = { datum: uj.datum, sav: uj.sav }; });
      var lev = false;
      if (uj && kuld) { var rr = uj.rendeles ? keres(K.r, uj.rendeles) : null; var a = { foglalas: uj }; if (rr) a.rendeles = rr; lev = !!levelKuld('idopont-visszaigazolas', a, K.fg); }
      dialogZar(); toast('Foglalás mentve' + (lev ? ' · visszaigazolás elküldve' : '') + '.'); ujra();
    });
  }

  /* ---------- Ajánlatkérések ---------- */
  RAJZ.ajanlatok = function (fo, par) {
    if (par) return ajanlatReszlet(fo, par);
    var osszes = lista(K.ak);
    fo.innerHTML = fej('Ajánlatkérések', osszes.length + ' kérés', '<button class="gomb gomb-keret gomb-kicsi" type="button" data-csv="ajanlatkeresek">CSV export</button>') +
      '<div class="adm-szuro"><div class="mezo"><label for="ak-allapot">Állapot</label><select id="ak-allapot">' + opt('', 'Minden állapot', SZ.akAllapot) + AK_ALLAPOT.map(function (a) { return opt(a, a + ' (' + osszes.filter(function (x) { return (x.allapot || 'Új') === a; }).length + ')', SZ.akAllapot); }).join('') + '</select></div></div><div id="ak-tabla"></div>';
    function rajz() {
      var l = lista(K.ak).filter(function (a) { return !SZ.akAllapot || (a.allapot || 'Új') === SZ.akAllapot; }).sort(ujabbElol);
      $('#ak-tabla').innerHTML = l.length ? burok('<table class="adm-tabla"><thead><tr><th scope="col">Azonosító</th><th scope="col">Dátum</th><th scope="col">Típus</th><th scope="col">Név</th><th scope="col">Település</th><th scope="col">Fotó</th><th scope="col">Állapot</th><th scope="col" class="jobb">Ajánlat</th></tr></thead><tbody>' +
        l.map(function (a) { return '<tr><td><a href="#ajanlatok/' + esc(a.azon) + '"><b>' + esc(a.azon) + '</b></a>' + (a.minta ? ' <span class="adm-minta-cimke">minta</span>' : '') + '</td><td>' + idoHu(a.ido) + '</td><td>' + esc(AK_TIPUS[a.tipus] || a.tipus || '–') + '</td><td>' + esc(a.nev || '–') + '<small class="adm-al">' + esc(a.tel || '') + '</small></td><td>' + esc(a.telepules || '–') + '</td><td>' + ((a.fotok || []).length || '–') + '</td><td>' + jelzo(a.allapot || 'Új') + '</td><td class="jobb">' + (a.ajanlat ? ft(a.ajanlat.osszesen) : '–') + '</td></tr>'; }).join('') + '</tbody></table>') : ures(osszes.length ? 'Nincs ilyen állapotú kérés.' : 'Még nincs ajánlatkérés (kalkulátor, multi-split, fotós felmérés vagy kapcsolat űrlapról érkeznek).');
    }
    $('#ak-allapot').addEventListener('change', function (e) { SZ.akAllapot = e.target.value; rajz(); });
    rajz();
  };
  var KULCS_NEV = { m2: 'Alapterület (m²)', kw: 'Teljesítmény (kW)', ajanlottKw: 'Ajánlott teljesítmény (kW)', helyisegek: 'Helyiségek', helyiseg: 'Helyiség', tajolas: 'Tájolás', szigeteles: 'Szigetelés', emelet: 'Emelet', megj: 'Megjegyzés', uzenet: 'Üzenet', kulteriHely: 'Kültéri egység helye', csoHossz: 'Csőhossz (m)', termek: 'Termék', nev: 'Név', tipus: 'Típus', db: 'Darab', belmagassag: 'Belmagasság (m)', cel: 'Cél' };
  function kulcsNev(k) { if (KULCS_NEV[k]) return KULCS_NEV[k]; var s = String(k).replace(/_/g, ' ').replace(/([a-záéíóöőúüű])([A-ZÁÉÍÓÖŐÚÜŰ])/g, '$1 $2').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1); }
  function ertekHtml(v) {
    if (v == null || v === '') return '–';
    if (Array.isArray(v)) return v.length && typeof v[0] === 'object' ? '<ol class="adm-ertek-lista">' + v.map(function (x) { return '<li>' + ertekHtml(x) + '</li>'; }).join('') + '</ol>' : v.map(function (x) { return ertekHtml(x); }).join(', ');
    if (typeof v === 'object') return Object.keys(v).map(function (k) { return '<span class="adm-kv"><span class="halvany">' + esc(kulcsNev(k)) + ':</span> ' + ertekHtml(v[k]) + '</span>'; }).join(' ');
    if (typeof v === 'boolean') return v ? 'igen' : 'nem';
    if (typeof v === 'number') return esc(szamHu(v));
    if (/^data:image\//.test(v)) return '<img class="adm-mini-kep" src="' + esc(v) + '" alt="">';
    return esc(v);
  }
  function adatokHtml(o) {
    if (!o || typeof o !== 'object' || !Object.keys(o).length) return '<p class="halvany">Nincs részletes adat.</p>';
    var k = Object.keys(o).filter(function (x) { return o[x] !== '' && o[x] != null && x !== 'fotok'; });
    return '<table class="adat-tabla adm-adatok"><tbody>' + k.map(function (x) { return '<tr><th scope="row">' + esc(kulcsNev(x)) + '</th><td>' + ertekHtml(o[x]) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function szolgOpciok(telepules) {
    var l = [];
    (HK.szolg || []).forEach(function (s) {
      if (s.valtozatok) s.valtozatok.forEach(function (v) { l.push({ nev: s.nev + ' (' + v[1] + ')', ar: v[2] }); });
      else if (s.tisztitas) { l.push({ nev: s.nev + ' – 1. beltéri', ar: A.tisztitas_1_belteri }); l.push({ nev: s.nev + ' – további beltéri', ar: A.tisztitas_tovabbi_belteri }); }
      else if (s.id === 'berlet') l.push({ nev: s.nev + ' – beltérinként / év', ar: s.ar });
      else l.push({ nev: s.nev, ar: s.ar || 0 });
    });
    [['Alapszerelés 2,5–3,5 kW (3 m cső)', A.alap_szereles_25_35kw], ['Alapszerelés 5–7 kW (3 m cső)', A.alap_szereles_5_7kw], ['Plusz cső (méterenként)', A.extra_cso_meter], ['Falkonzol', A.falkonzol], ['Kondenzszivattyú', A.kondenzszivattyu], ['Extra falattörés', A.falattores_extra]].forEach(function (x) { if (x[1] != null) l.push({ nev: x[0], ar: x[1], kieg: true }); });
    var km = H.telepulesKm(telepules || ''), zd = H.zonaDij(km);
    if (zd) l.push({ nev: 'Kiszállási díj – ' + telepules + ' (' + km + ' km)', ar: zd, kieg: true });
    return l;
  }
  function ajanlatReszlet(fo, azon) {
    var a = keres(K.ak, azon);
    if (!a) { fo.innerHTML = vissza('#ajanlatok', 'Ajánlatkérések') + '<div class="figyelmezteto">Nincs ilyen ajánlatkérés: ' + esc(azon) + '</div>'; return; }
    var fotok = (a.fotok || []).filter(function (x) { return typeof x === 'string' && x; });
    var aj = a.ajanlat || null;
    if (!AJ || AJ.azon !== a.azon) AJ = { azon: a.azon, tetelek: aj && aj.tetelek ? aj.tetelek.map(function (t) { return { nev: t.nev, db: t.db, egyseg: t.egyseg }; }) : [], ervenyes: (aj && aj.ervenyes) || napPlusz(15), megj: aj && aj.megj != null ? aj.megj : 'Az ajánlat helyszíni felmérés nélkül tájékoztató jellegű; a végleges árat a felmérés után rögzítjük.' };
    var SZO = szolgOpciok(a.telepules);
    var termOpc = function (kat, cim) { var l = (HK.termekek || []).filter(function (t) { return (t.kat === 'multi') === (kat === 'multi'); }); return l.length ? '<optgroup label="' + cim + '">' + l.map(function (t) { return opt(t.id, t.nev + ' – ' + ft(t.ar)); }).join('') + '</optgroup>' : ''; };
    fo.innerHTML = vissza('#ajanlatok', 'Ajánlatkérések') +
      fej(a.azon, idoHu(a.ido) + ' · ' + esc(AK_TIPUS[a.tipus] || a.tipus || '') + ' · ' + jelzo(a.allapot || 'Új') + (a.minta ? ' <span class="adm-minta-cimke">mintaadat</span>' : ''), '') +
      '<div class="adm-racs2"><div class="adm-oszlop-bal">' +
      '<section class="adm-kartya"><h2>Kérés részletei</h2>' + adatokHtml(a.adatok) + '</section>' +
      '<section class="adm-kartya"><h2>Fotók <span class="halvany">(' + fotok.length + ')</span></h2>' + (fotok.length ? '<div class="adm-fotok">' + fotok.map(function (src, i) { return '<button type="button" class="adm-foto" data-foto="' + i + '" aria-label="' + (i + 1) + '. fotó nagyítása"><img src="' + esc(src) + '" alt="' + (i + 1) + '. fotó – ' + esc(a.azon) + '"></button>'; }).join('') + '</div>' : '<p class="halvany mb0">Nem töltött fel fotót.</p>') + '</section>' +
      '</div><div class="adm-oszlop-jobb">' +
      '<section class="adm-kartya"><h2>Kapcsolat</h2><dl class="adm-dl"><dt>Név</dt><dd>' + esc(a.nev || '–') + '</dd><dt>Telefon</dt><dd>' + (a.tel ? '<a href="' + telHref(a.tel) + '">' + esc(a.tel) + '</a>' : '–') + '</dd><dt>E-mail</dt><dd>' + (a.email ? '<a href="mailto:' + esc(a.email) + '">' + esc(a.email) + '</a>' : '–') + '</dd><dt>Település</dt><dd>' + esc(a.telepules || '–') + '</dd></dl></section>' +
      '<section class="adm-kartya"><h2>Állapot</h2><form id="ak-all-urlap" class="sor"><div class="mezo adm-nyulik"><label for="ak-uj-allapot" class="rejtett">Állapot</label><select id="ak-uj-allapot">' + AK_ALLAPOT.map(function (x) { return opt(x, x, a.allapot || 'Új'); }).join('') + '</select></div><button class="gomb gomb-keret gomb-kicsi" type="submit">Mentés</button></form>' +
      (aj ? '<p class="adm-apro halvany mb0">Ajánlat: <b>' + esc(aj.szam || '') + '</b> · ' + ft(aj.osszesen) + ' · érvényes: ' + datumHu(aj.ervenyes) + (aj.elkuldve ? ' · elküldve ' + idoHu(aj.elkuldve) : ' · piszkozat') + '</p>' : '') + '</section>' +
      '</div></div>' +
      '<section class="adm-kartya" aria-labelledby="aj-cim"><div class="adm-fej adm-fej-kicsi"><h2 id="aj-cim">Ajánlat összeállítása</h2>' + (aj ? '<a class="gomb gomb-keret gomb-kicsi" href="/admin/ajanlat/?azon=' + encodeURIComponent(a.azon) + '">Nyomtatható ajánlat</a>' : '') + '</div>' +
      '<div class="adm-aj-hozzaad">' +
      '<div class="adm-aj-blokk"><div class="mezo"><label for="aj-termek">Klíma a kínálatból</label><select id="aj-termek">' + opt('', 'Válassz klímát…') + termOpc('oldalfali', 'Oldalfali') + termOpc('multi', 'Multi-split') + '</select></div><label class="pipa-sor"><input type="checkbox" id="aj-szerelessel" checked> <span>alapszereléssel együtt</span></label><button class="gomb gomb-keret gomb-kicsi" type="button" data-aj-add="termek">+ Klíma</button></div>' +
      '<div class="adm-aj-blokk"><div class="mezo"><label for="aj-szolg">Szolgáltatás, kiegészítő</label><select id="aj-szolg">' + opt('', 'Válassz…') + '<optgroup label="Szolgáltatások">' + SZO.map(function (s, i) { return s.kieg ? '' : opt(i, s.nev + ' – ' + (s.ar ? ft(s.ar) : 'ingyenes')); }).join('') + '</optgroup><optgroup label="Szerelési tételek">' + SZO.map(function (s, i) { return s.kieg ? opt(i, s.nev + ' – ' + ft(s.ar)) : ''; }).join('') + '</optgroup></select></div><button class="gomb gomb-keret gomb-kicsi" type="button" data-aj-add="szolg">+ Tétel</button></div>' +
      '<div class="adm-aj-blokk adm-aj-egyedi"><button class="gomb gomb-keret gomb-kicsi" type="button" data-aj-add="egyedi">+ Egyedi sor</button></div>' +
      '</div>' +
      burok('<table class="adm-tabla adm-aj-tabla"><thead><tr><th scope="col">Megnevezés</th><th scope="col" class="jobb">Db</th><th scope="col" class="jobb">Egységár (bruttó Ft)</th><th scope="col" class="jobb">Összeg</th><th scope="col"><span class="rejtett">Törlés</span></th></tr></thead><tbody id="aj-sorok"></tbody></table>') +
      '<div class="adm-aj-also"><div class="adm-urlap2"><div class="mezo"><label for="aj-ervenyes">Érvényes eddig</label><input type="date" id="aj-ervenyes" value="' + esc(AJ.ervenyes) + '" min="' + ma() + '" required></div>' +
      '<div class="mezo"><label for="aj-megj">Megjegyzés az ajánlaton</label><textarea id="aj-megj" rows="3">' + esc(AJ.megj) + '</textarea></div></div>' +
      '<dl class="adm-dl adm-dl-osszeg" id="aj-osszesen"></dl></div>' +
      '<div class="figyelmezteto" id="aj-hiba" role="alert" hidden></div>' +
      '<div class="sor adm-mt"><button class="gomb gomb-fo" type="button" data-aj-ment="kuld">Ajánlat mentése és elküldése</button><button class="gomb gomb-keret" type="button" data-aj-ment="piszkozat">Mentés piszkozatként</button></div>' +
      '<p class="adm-apro halvany">Küldéskor az állapot „Ajánlat elküldve” lesz, és az ügyfél levelet kap (demó: <a href="/postafiok/">postafiók</a>).</p></section>';

    function sorokRajz() {
      $('#aj-sorok').innerHTML = AJ.tetelek.length ? AJ.tetelek.map(function (t, i) {
        return '<tr><td><label class="rejtett" for="aj-n-' + i + '">' + (i + 1) + '. tétel megnevezése</label><input type="text" id="aj-n-' + i + '" data-aj-i="' + i + '" data-aj-m="nev" value="' + esc(t.nev) + '"></td>' +
          '<td class="jobb"><label class="rejtett" for="aj-d-' + i + '">Darab</label><input type="number" class="adm-szam-kicsi" id="aj-d-' + i + '" min="1" max="99" data-aj-i="' + i + '" data-aj-m="db" value="' + esc(t.db) + '"></td>' +
          '<td class="jobb"><label class="rejtett" for="aj-e-' + i + '">Egységár</label><input type="number" class="adm-szam" id="aj-e-' + i + '" min="0" step="100" data-aj-i="' + i + '" data-aj-m="egyseg" value="' + esc(t.egyseg) + '"></td>' +
          '<td class="jobb"><b data-aj-sum="' + i + '">' + ft((+t.db || 0) * (+t.egyseg || 0)) + '</b></td><td><button type="button" class="torles" data-aj-torol="' + i + '" aria-label="' + (i + 1) + '. sor törlése">Törlés</button></td></tr>';
      }).join('') : '<tr><td colspan="5" class="halvany">Még nincs tétel – adj hozzá klímát, szolgáltatást vagy egyedi sort.</td></tr>';
      osszRajz();
    }
    function osszRajz() {
      var o = AJ.tetelek.reduce(function (s, t) { return s + (+t.db || 0) * (+t.egyseg || 0); }, 0);
      var n = Math.round(o / (1 + (B.afa || 27) / 100));
      $('#aj-osszesen').innerHTML = '<dt>Nettó</dt><dd>' + ft(n) + '</dd><dt>Áfa (' + (B.afa || 27) + '%)</dt><dd>' + ft(o - n) + '</dd><dt class="adm-vegosszeg">Összesen (bruttó)</dt><dd class="adm-vegosszeg">' + ft(o) + '</dd>';
    }
    sorokRajz();
    var szek = fo;
    szek.addEventListener('input', function (e) {
      var i = e.target.getAttribute('data-aj-i'); if (i == null) return;
      var m = e.target.getAttribute('data-aj-m'), t = AJ.tetelek[+i]; if (!t) return;
      t[m] = m === 'nev' ? e.target.value : (parseFloat(e.target.value) || 0);
      var s = $('[data-aj-sum="' + i + '"]', szek); if (s) s.textContent = ft((+t.db || 0) * (+t.egyseg || 0));
      osszRajz();
    });
    $('#aj-ervenyes').addEventListener('input', function (e) { AJ.ervenyes = e.target.value; });
    $('#aj-megj').addEventListener('input', function (e) { AJ.megj = e.target.value; });
    szek.addEventListener('click', function (e) {
      var ad = e.target.closest('[data-aj-add]'), tor = e.target.closest('[data-aj-torol]'), fb = e.target.closest('[data-foto]'), mb = e.target.closest('[data-aj-ment]');
      if (ad) {
        var mit = ad.getAttribute('data-aj-add');
        if (mit === 'termek') {
          var t = H.termek($('#aj-termek').value); if (!t) { toast('Válassz klímát a listából.'); $('#aj-termek').focus(); return; }
          AJ.tetelek.push({ nev: t.nev, db: 1, egyseg: t.ar });
          if ($('#aj-szerelessel').checked) AJ.tetelek.push(t.kat === 'multi' ? { nev: 'Multi-split szerelés – ' + t.nev + ' (felmérés alapján)', db: 1, egyseg: 0 } : { nev: 'Alapszerelés (3 m cső) – ' + t.nev, db: 1, egyseg: H.szerelesAlap(t.kw) });
        } else if (mit === 'szolg') {
          var s = SZO[+$('#aj-szolg').value]; if ($('#aj-szolg').value === '' || !s) { toast('Válassz szolgáltatást a listából.'); $('#aj-szolg').focus(); return; }
          AJ.tetelek.push({ nev: s.nev, db: 1, egyseg: s.ar || 0 });
        } else AJ.tetelek.push({ nev: '', db: 1, egyseg: 0 });
        sorokRajz();
        if (mit === 'egyedi') { var u = $('#aj-n-' + (AJ.tetelek.length - 1)); if (u) u.focus(); }
      }
      if (tor) { AJ.tetelek.splice(+tor.getAttribute('data-aj-torol'), 1); sorokRajz(); }
      if (fb) { var i = +fb.getAttribute('data-foto'); dialog('<h2 id="adm-dialog-cim">' + (i + 1) + '. fotó · ' + esc(a.azon) + '</h2><img class="adm-nagy-kep" src="' + esc(fotok[i]) + '" alt="' + (i + 1) + '. fotó nagyítva"><p class="halvany adm-apro mb0">' + esc(a.nev || '') + ' · ' + esc(a.telepules || '') + '</p>'); }
      if (mb) ajanlatMent(a.azon, mb.getAttribute('data-aj-ment') === 'kuld');
    });
    $('#ak-all-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); var uj = $('#ak-uj-allapot').value;
      frissit(K.ak, a.azon, function (x) { x.allapot = uj; x.allapotIdo = most(); }); toast('Állapot: <b>' + esc(uj) + '</b>'); ujra();
    });
  }
  function ajanlatMent(azon, kuld) {
    var h = $('#aj-hiba'), hibak = [];
    var tet = AJ.tetelek.map(function (t) { return { nev: String(t.nev || '').trim(), db: Math.max(0, Math.round(+t.db || 0)), egyseg: Math.round(+t.egyseg || 0) }; });
    if (!tet.length) hibak.push('Adj hozzá legalább egy tételt.');
    tet.forEach(function (t, i) { if (!t.nev) hibak.push((i + 1) + '. sor: hiányzik a megnevezés.'); if (t.db < 1) hibak.push((i + 1) + '. sor: a darabszám legalább 1.'); if (t.egyseg < 0) hibak.push((i + 1) + '. sor: az egységár nem lehet negatív.'); });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(AJ.ervenyes || '')) hibak.push('Add meg, meddig érvényes az ajánlat.');
    else if (AJ.ervenyes < ma()) hibak.push('Az érvényesség nem lehet a mai napnál korábbi.');
    if (hibak.length) { h.innerHTML = hibak.map(esc).join('<br>'); h.hidden = false; h.focus && h.setAttribute('tabindex', '-1'); h.focus(); return; }
    h.hidden = true;
    tet.forEach(function (t) { t.osszeg = t.db * t.egyseg; });
    var ossz = tet.reduce(function (s, t) { return s + t.osszeg; }, 0), netto = Math.round(ossz / (1 + (B.afa || 27) / 100));
    var x = frissit(K.ak, azon, function (a) {
      var regi = a.ajanlat || {};
      a.ajanlat = { tetelek: tet, osszesen: ossz, ervenyes: AJ.ervenyes, netto: netto, afa: ossz - netto, megj: AJ.megj || '', szam: regi.szam || H.azon('AJ'), ido: most() };
      if (regi.elkuldve) a.ajanlat.elkuldve = regi.elkuldve;
      if (kuld) { a.allapot = 'Ajánlat elküldve'; a.ajanlat.elkuldve = most(); }
    });
    if (!x) return;
    var lev = kuld ? levelKuld('ajanlat', { ajanlatkeres: x }, K.ak) : null;
    toast(kuld ? 'Ajánlat elmentve és elküldve' + (lev ? ' (<a href="/postafiok/">postafiók</a>)' : ' – a levelek modul nincs betöltve, levél nem ment ki') + '.' : 'Piszkozat mentve.');
    ujra();
  }

  /* ---------- Ügyfelek ---------- */
  function ugyfelAdatok() {
    var m = {};
    var u = function (email) { var k = String(email || '').trim().toLowerCase(); if (!k) return null; if (!m[k]) m[k] = { email: k, nev: '', tel: '', telepules: '', fiok: false, reg: '', hirlevel: false, rendelesek: [], db: 0, koltes: 0, utolso: '', klimak: [], telepitve: '', tisztitas: null }; return m[k]; };
    lista(K.f).forEach(function (f) { var x = u(f.email); if (!x) return; x.fiok = true; x.nev = f.nev || x.nev; x.tel = f.tel || x.tel; x.reg = f.reg || ''; x.hirlevel = !!f.hirlevel; if (f.cim && f.cim.telepules) x.telepules = f.cim.telepules; });
    lista(K.r).forEach(function (r) {
      var v = r.vevo || {}, x = u(v.email || r.fiok); if (!x) return;
      if (!x.nev) x.nev = v.nev || ''; if (!x.tel) x.tel = v.tel || ''; if (!x.telepules) x.telepules = v.telepules || '';
      x.rendelesek.push(r);
      if (r.allapot !== 'Lemondva') { x.db++; x.koltes += +r.osszesen || 0; }
      if (!x.utolso || String(r.ido) > x.utolso) x.utolso = r.ido;
      if (r.allapot === 'Szerelés kész' || r.allapot === 'Lezárva') {
        var kesz = isoNap(allapotIdo(r, 'Szerelés kész') || r.ido);
        (r.tetelek || []).forEach(function (t) {
          var szerelt = t.szerelt || (t.x && t.x.id === 'szereles-sajat');
          var tiszt = t.x && t.x.t === 's' && /tisztit/i.test(t.x.id || '');
          if (szerelt) { x.klimak.push(t.db + '× ' + t.nev); if (!x.telepitve || kesz > x.telepitve) x.telepitve = kesz; }
          if (szerelt || tiszt) { if (!x.utolsoKarb || kesz > x.utolsoKarb) x.utolsoKarb = kesz; }
        });
      }
    });
    lista(K.h).forEach(function (h) { var k = String(h.email || '').toLowerCase(); if (m[k] && h.megerositve) m[k].hirlevel = true; });
    var fg = lista(K.fg);
    Object.keys(m).forEach(function (k) {
      var x = m[k];
      fg.forEach(function (f) { if (String(f.email || '').toLowerCase() !== k || f.tipus !== 'tisztitas') return; if (f.allapot === 'Kész' && (!x.utolsoKarb || f.datum > x.utolsoKarb)) x.utolsoKarb = f.datum; });
      var jovo = fg.filter(function (f) { return String(f.email || '').toLowerCase() === k && f.tipus === 'tisztitas' && aktivFg(f) && f.allapot !== 'Kész' && f.datum >= ma(); }).sort(function (a, b) { return a.datum.localeCompare(b.datum); })[0];
      if (jovo) x.tisztitas = { datum: jovo.datum, foglalva: true };
      else if (x.utolsoKarb && x.klimak.length) { var d = strDatum(x.utolsoKarb); d.setFullYear(d.getFullYear() + 1); x.tisztitas = { datum: napStr(d), foglalva: false }; }
      x.torzs = x.db >= 2;
    });
    return Object.keys(m).map(function (k) { return m[k]; }).sort(function (a, b) { return String(b.utolso || b.reg).localeCompare(String(a.utolso || a.reg)) || a.nev.localeCompare(b.nev, 'hu'); });
  }
  RAJZ.ugyfelek = function (fo) {
    var osszes = ugyfelAdatok();
    fo.innerHTML = fej('Ügyfelek', osszes.length + ' ügyfél · ' + osszes.filter(function (u) { return u.torzs; }).length + ' törzsvásárló · fiókokból és rendelésekből, e-mail szerint összevonva', '<button class="gomb gomb-keret gomb-kicsi" type="button" data-csv="ugyfelek">CSV export</button>') +
      '<div class="adm-szuro" role="search"><div class="mezo"><label for="u-keres">Keresés</label><input type="search" id="u-keres" placeholder="Név, e-mail, telefon, település" value="' + esc(SZ.uKeres) + '"></div></div><div id="u-tabla"></div>';
    function rajz() {
      var q = SZ.uKeres.trim().toLowerCase();
      var l = osszes.filter(function (u) { return !q || [u.nev, u.email, u.tel, u.telepules].join(' ').toLowerCase().indexOf(q) > -1; });
      $('#u-tabla').innerHTML = l.length ? burok('<table class="adm-tabla"><thead><tr><th scope="col">Ügyfél</th><th scope="col">Telefon</th><th scope="col">Fiók</th><th scope="col" class="jobb">Rendelés</th><th scope="col" class="jobb">Költés</th><th scope="col">Utolsó rendelés</th><th scope="col">Telepített klímák</th><th scope="col">Következő tisztítás</th></tr></thead><tbody>' +
        l.map(function (u) {
          var t = u.tisztitas, tHtml = '–';
          if (t) tHtml = t.foglalva ? '<b>' + datumHu(t.datum) + '</b><small class="adm-al">foglalva</small>' : (t.datum < ma() ? '<b class="adm-piros">' + datumHu(t.datum) + '</b><small class="adm-al">esedékes</small>' : datumHu(t.datum) + '<small class="adm-al">javasolt</small>');
          return '<tr><td><b>' + esc(u.nev || '–') + '</b>' + (u.torzs ? ' <span class="adm-jelzo adm-jelzo-zold" title="Legalább 2 nem lemondott rendelés">törzsvásárló</span>' : '') + '<small class="adm-al"><a href="mailto:' + esc(u.email) + '">' + esc(u.email) + '</a>' + (u.telepules ? ' · ' + esc(u.telepules) : '') + '</small></td>' +
            '<td>' + (u.tel ? '<a href="' + telHref(u.tel) + '">' + esc(u.tel) + '</a>' : '–') + '</td><td>' + (u.fiok ? 'Regisztrált' + (u.hirlevel ? '<small class="adm-al">hírlevél ✓</small>' : '') : '<span class="halvany">vendég</span>' + (u.hirlevel ? '<small class="adm-al">hírlevél ✓</small>' : '')) + '</td>' +
            '<td class="jobb">' + (u.rendelesek.length ? '<a href="#rendelesek" data-u-email="' + esc(u.email) + '">' + u.db + '</a>' : '0') + '</td><td class="jobb">' + ft(u.koltes) + '</td><td>' + (u.utolso ? idoHu(u.utolso) : '–') + '</td><td>' + (u.klimak.length ? u.klimak.map(esc).join('<br>') : '–') + '</td><td>' + tHtml + '</td></tr>';
        }).join('') + '</tbody></table>') : ures(osszes.length ? 'Nincs találat.' : 'Még nincs ügyfél.');
    }
    $('#u-keres').addEventListener('input', function (e) { SZ.uKeres = e.target.value; rajz(); });
    fo.addEventListener('click', function (e) { var a = e.target.closest('[data-u-email]'); if (a) { SZ.rKeres = a.getAttribute('data-u-email'); SZ.rAllapot = ''; } });
    rajz();
  };

  /* ---------- Levelek ---------- */
  RAJZ.levelek = function (fo) {
    var l = lista(K.l).sort(ujabbElol);
    var X = window.HKApp || {};
    fo.innerHTML = fej('Levelek', l.length + ' kimenő levél a demó naplóban', '<a class="gomb gomb-keret gomb-kicsi" href="/postafiok/">Postafiók megnyitása</a><button class="gomb gomb-kek gomb-kicsi" type="button" id="lev-idozitett">Időzített levelek futtatása</button>') +
      (typeof X.level !== 'function' ? '<div class="figyelmezteto adm-mb">A levelek modul ebben a buildben nincs betöltve – az állapotváltások ilyenkor nem küldenek levelet.</div>' : '') +
      (SZ.levUzenet ? '<div class="info-doboz adm-mb" role="status">' + esc(SZ.levUzenet) + '</div>' : '') +
      (l.length ? burok('<table class="adm-tabla"><thead><tr><th scope="col">Időpont</th><th scope="col">Címzett</th><th scope="col">Tárgy</th><th scope="col">Sablon</th><th scope="col">Kapcsolódó</th><th scope="col"><span class="rejtett">Megnyitás</span></th></tr></thead><tbody>' +
        l.slice(0, 300).map(function (x, i) { return '<tr><td>' + idoHu(x.ido) + '</td><td>' + esc(x.cimzett || '–') + '</td><td>' + esc(x.targy || '–') + '</td><td><code>' + esc(x.sablon || '') + '</code></td><td>' + kapcsolodoLink(x.kapcsolodo) + '</td><td><button class="gomb gomb-keret gomb-kicsi" type="button" data-lev="' + i + '">Megnéz</button></td></tr>'; }).join('') + '</tbody></table>') : ures('Még nem ment ki levél. Állapotváltáskor, ajánlatküldéskor és rendeléskor kerülnek ide.'));
    $('#lev-idozitett').addEventListener('click', function () {
      var Y = window.HKApp || {};
      if (typeof Y.idozitettLevelek !== 'function') { SZ.levUzenet = 'Az időzített küldés a levelek modulban van, ami ebben a buildben nincs betöltve.'; ujra(); return; }
      var elotte = lista(K.l).length, res;
      try { res = Y.idozitettLevelek(); } catch (e) { hiba('Időzített levelek hiba: ' + e.message, 'admin.levelek'); SZ.levUzenet = 'Hiba az időzített küldés közben: ' + e.message; ujra(); return; }
      var db = typeof res === 'number' ? res : Array.isArray(res) ? res.length : Math.max(0, lista(K.l).length - elotte);
      SZ.levUzenet = db ? db + ' időzített levél ment ki (' + idoHu(most()) + ').' : 'Nincs esedékes időzített levél (' + idoHu(most()) + ').';
      toast(esc(SZ.levUzenet)); ujra();
    });
    $$('[data-lev]', fo).forEach(function (b) {
      b.addEventListener('click', function () {
        var x = l[+b.getAttribute('data-lev')]; if (!x) return;
        dialog('<h2 id="adm-dialog-cim">' + esc(x.targy || 'Levél') + '</h2><p class="halvany adm-apro">' + idoHu(x.ido) + ' · ' + esc(x.cimzett || '') + ' · <code>' + esc(x.sablon || '') + '</code></p><iframe class="adm-level-elonezet" title="Levél előnézete" sandbox></iframe>');
        var fr = $('.adm-level-elonezet'); if (fr) fr.srcdoc = x.html || '<p>(üres levél)</p>';
      });
    });
  };
  function kapcsolodoLink(k) {
    if (!k) return '–'; k = String(k);
    if (/^HK-/.test(k)) return '<a href="#rendelesek/' + esc(k) + '">' + esc(k) + '</a>';
    if (/^AK-/.test(k)) return '<a href="#ajanlatok/' + esc(k) + '">' + esc(k) + '</a>';
    return esc(k);
  }

  /* ---------- Hírlevél ---------- */
  RAJZ.hirlevel = function (fo) {
    var l = lista(K.h).sort(ujabbElol), meg = l.filter(function (h) { return h.megerositve; }).length;
    fo.innerHTML = fej('Hírlevél', l.length + ' feliratkozó · ' + meg + ' megerősített · ' + (l.length - meg) + ' megerősítésre vár', '<button class="gomb gomb-keret gomb-kicsi" type="button" id="h-csv">CSV export</button>') +
      '<div class="adm-szuro"><div class="mezo"><label for="h-szuro">Megjelenítés</label><select id="h-szuro">' + opt('', 'Mind', SZ.hSzuro) + opt('igen', 'Megerősített', SZ.hSzuro) + opt('nem', 'Nem megerősített', SZ.hSzuro) + '</select></div></div><div id="h-tabla"></div>' +
      '<p class="halvany adm-apro">Kiküldeni csak a megerősített (dupla opt-in) címekre szabad. Az export a szűrésnek megfelelő sorokat tartalmazza.</p>';
    function szurt() { return l.filter(function (h) { return !SZ.hSzuro || (SZ.hSzuro === 'igen') === !!h.megerositve; }); }
    function rajz() {
      var s = szurt();
      $('#h-tabla').innerHTML = s.length ? burok('<table class="adm-tabla adm-tabla-kicsi"><thead><tr><th scope="col">E-mail</th><th scope="col">Feliratkozás</th><th scope="col">Állapot</th></tr></thead><tbody>' + s.map(function (h) { return '<tr><td>' + esc(h.email) + '</td><td>' + idoHu(h.ido) + '</td><td>' + (h.megerositve ? '<span class="adm-jelzo adm-jelzo-zold">megerősítve</span>' : '<span class="adm-jelzo adm-jelzo-sarga">megerősítésre vár</span>') + '</td></tr>'; }).join('') + '</tbody></table>') : ures('Nincs feliratkozó.');
    }
    $('#h-szuro').addEventListener('change', function (e) { SZ.hSzuro = e.target.value; rajz(); });
    $('#h-csv').addEventListener('click', function () { csv('hirlevel', ['E-mail', 'Feliratkozás', 'Megerősítve'], szurt().map(function (h) { return [h.email, idoHu(h.ido), h.megerositve ? 'igen' : 'nem']; })); });
    rajz();
  };

  /* ---------- Értékelések ---------- */
  RAJZ.ertekelesek = function (fo) {
    var l = lista(K.e).sort(ujabbElol), rl = lista(K.r);
    var atl = l.length ? l.reduce(function (s, e) { return s + (+e.csillag || 0); }, 0) / l.length : 0;
    var eloszlas = [5, 4, 3, 2, 1].map(function (n) { return [n, l.filter(function (e) { return Math.round(+e.csillag) === n; }).length]; });
    fo.innerHTML = fej('Értékelések', l.length + ' értékelés', '') +
      (l.length ? '<div class="adm-racs2 adm-racs-ertekeles"><section class="adm-kartya adm-ertek-atlag"><b>' + szamHu(Math.round(atl * 10) / 10) + '</b>' + csillagok(atl) + '<span class="halvany">' + l.length + ' értékelés átlaga</span></section><section class="adm-kartya"><ol class="adm-top">' + eloszlas.map(function (x) { return '<li><div class="adm-top-sor"><span>' + x[0] + ' csillag</span><b>' + x[1] + '</b></div><div class="adm-top-sav"><span style="width:' + Math.round(x[1] / l.length * 100) + '%"></span></div></li>'; }).join('') + '</ol></section></div>' +
        '<div class="adm-ertekelesek">' + l.map(function (e) { var r = rl.find(function (x) { return x.azon === e.rendeles; }); return '<article class="adm-kartya adm-ertekeles">' + csillagok(e.csillag) + '<p>' + (e.szoveg ? esc(e.szoveg) : '<span class="halvany">(szöveg nélkül)</span>') + '</p><small class="halvany">' + (r ? esc(vevoNev(r)) + ' · ' : '') + idoHu(e.ido) + (e.rendeles ? ' · <a href="#rendelesek/' + esc(e.rendeles) + '">' + esc(e.rendeles) + '</a>' : '') + '</small></article>'; }).join('') + '</div>' : ures('Még nincs értékelés. A véleménykérő levél a „Szerelés kész” után 3 nappal megy ki.'));
  };

  /* ---------- Rendszer ---------- */
  var AR_NEV = { alap_szereles_25_35kw: 'Alapszerelés 2,5–3,5 kW (3 m cső)', alap_szereles_5_7kw: 'Alapszerelés 5–7 kW (3 m cső)', extra_cso_meter: 'Plusz cső / méter', falkonzol: 'Falkonzol', kondenzszivattyu: 'Kondenzszivattyú', falattores_extra: 'Extra falattörés', tisztitas_1_belteri: 'Tisztítás – 1. beltéri', tisztitas_tovabbi_belteri: 'Tisztítás – további beltéri', javitas_kiszallas_hibafeltaras: 'Javítás: kiszállás + hibafeltárás', leszereles: 'Leszerelés', athelyezes: 'Áthelyezés', felmeres: 'Helyszíni felmérés', wifi_modul: 'Wifi-modul', berlet_ev: 'Karbantartási bérlet / beltéri / év' };
  var CSV_EGYEB = {
    ajanlatkeresek: function () { csv('ajanlatkeresek', ['Azonosító', 'Dátum', 'Típus', 'Név', 'E-mail', 'Telefon', 'Település', 'Állapot', 'Fotók', 'Ajánlat (Ft)', 'Érvényes'], lista(K.ak).sort(ujabbElol).map(function (a) { return [a.azon, idoHu(a.ido), AK_TIPUS[a.tipus] || a.tipus, a.nev, a.email, a.tel, a.telepules, a.allapot || 'Új', (a.fotok || []).length, a.ajanlat ? a.ajanlat.osszesen : '', a.ajanlat ? a.ajanlat.ervenyes : '']; })); },
    foglalasok: function () { csv('foglalasok', ['Azonosító', 'Típus', 'Dátum', 'Sáv', 'Név', 'Telefon', 'E-mail', 'Település', 'Cím', 'Állapot', 'Szerelő', 'Rendelés', 'Hűtőközeg', 'Utántöltés (kg)', 'Munkalap lezárva'], rendezFg(lista(K.fg)).map(function (f) { var m = f.munkalap || {}; return [f.azon, TIPUS[f.tipus] || f.tipus, f.datum, f.sav, f.nev, f.tel, f.email, f.telepules, f.cim, f.allapot, f.szerelo || '', f.rendeles || '', m.hutokozeg || '', m.utantoltes != null ? szamHu(m.utantoltes) : '', m.kesz ? idoHu(m.kesz) : '']; })); }
  };
  RAJZ.rendszer = function (fo) {
    var hb = lista(K.hb).sort(ujabbElol);
    var arSor = Object.keys(AR_NEV).filter(function (k) { return A[k] != null; }).map(function (k) { return '<tr><th scope="row">' + esc(AR_NEV[k]) + '</th><td class="jobb">' + ft(A[k]) + '</td></tr>'; }).join('') +
      (A.zona ? Object.keys(A.zona).map(function (z) { return '<tr><th scope="row">Kiszállás ' + z + '. zóna (' + ({ 1: '≤ 10 km', 2: '≤ 25 km', 3: '≤ 40 km', 4: '40 km felett' }[z] || '') + ')</th><td class="jobb">' + ft(A.zona[z]) + '</td></tr>'; }).join('') : '') +
      '<tr><th scope="row">Előleg</th><td class="jobb">' + (B.elolegSzazalek || 30) + '%</td></tr><tr><th scope="row">Futárdíj / készülék</th><td class="jobb">' + ft(B.futarDij) + '</td></tr><tr><th scope="row">Ingyenes szállítás felett</th><td class="jobb">' + ft(B.ingyenesSzallitasFelett) + '</td></tr><tr><th scope="row">Áfa</th><td class="jobb">' + (B.afa || 27) + '%</td></tr>';
    var term = (HK.termekek || []).map(function (t) { return '<tr><td><a href="' + esc(t.url) + '">' + esc(t.nev) + '</a></td><td>' + (t.kat === 'multi' ? 'Multi' : 'Oldalfali') + '</td><td class="jobb">' + szamHu(t.kw) + '</td><td class="jobb">' + szamHu(t.seer) + '</td><td>' + esc(t.oh || '–') + '</td><td>' + esc(t.hk || '–') + '</td><td>' + (t.keszlet === 'raktaron' ? 'Raktáron' : 'Rendelésre') + '</td><td class="jobb"><b>' + ft(t.ar) + '</b></td></tr>'; }).join('');
    fo.innerHTML = fej('Rendszer', 'Demóadatok, exportok, hibanapló, árak', '<button class="gomb gomb-keret gomb-kicsi" type="button" data-adm-kilep>Kilépés</button>') +
      '<div class="adm-racs2">' +
      '<section class="adm-kartya"><h2>Mintaadatok</h2><p class="halvany">Hitelesnek tűnő, <b>kitalált</b> adatok a bemutatóhoz: 9 rendelés különböző állapotokban, foglalások a következő 2 hétre, 2 ajánlatkérés fotóval, 2 fiók, értékelések, hírlevél-feliratkozók. A dátumok a mai naphoz igazodnak, a meglévő adatok megmaradnak.</p><button class="gomb gomb-kek" type="button" id="sys-minta">Mintaadatok betöltése</button></section>' +
      '<section class="adm-kartya"><h2>CSV exportok</h2><p class="halvany">Pontosvesszővel tagolt, UTF-8 – Excelben közvetlenül megnyitható.</p><div class="sor"><button class="gomb gomb-keret gomb-kicsi" type="button" data-csv="rendelesek">Rendelések</button><button class="gomb gomb-keret gomb-kicsi" type="button" data-csv="ugyfelek">Ügyfelek</button><button class="gomb gomb-keret gomb-kicsi" type="button" data-csv="ajanlatkeresek">Ajánlatkérések</button><button class="gomb gomb-keret gomb-kicsi" type="button" data-csv="foglalasok">Foglalások (F-gáz adatokkal)</button></div></section>' +
      '</div>' +
      '<section class="adm-kartya"><div class="adm-fej adm-fej-kicsi"><h2>Hibanapló <span class="halvany">(' + hb.length + ')</span></h2>' + (hb.length ? '<button class="gomb gomb-keret gomb-kicsi" type="button" id="sys-hiba-torol">Napló ürítése</button>' : '') + '</div>' +
      (hb.length ? burok('<table class="adm-tabla adm-tabla-kicsi"><thead><tr><th scope="col">Időpont</th><th scope="col">Üzenet</th><th scope="col">Hely</th><th scope="col">Oldal</th></tr></thead><tbody>' + hb.slice(0, 200).map(function (h) { return '<tr><td>' + idoHu(h.ido) + '</td><td>' + esc(h.uzenet) + '</td><td><code>' + esc(h.hely || '') + '</code></td><td>' + esc(h.oldal || '') + '</td></tr>'; }).join('') + '</tbody></table>') : '<p class="halvany mb0">Nincs rögzített hiba.</p>') + '</section>' +
      '<section class="adm-kartya"><h2>Árak és beállítások <span class="halvany">(csak olvasható)</span></h2><p class="halvany adm-apro">Módosítás: <code>src/config.mjs</code> és <code>data/kutatas.json</code>, majd újraépítés. Bruttó árak.</p>' + burok('<table class="adm-tabla adm-tabla-kicsi adm-tabla-keskeny"><tbody>' + arSor + '</tbody></table>') + '</section>' +
      '<section class="adm-kartya"><h2>Termékek <span class="halvany">(' + (HK.termekek || []).length + ', csak olvasható)</span></h2>' + burok('<table class="adm-tabla adm-tabla-kicsi"><thead><tr><th scope="col">Termék</th><th scope="col">Kategória</th><th scope="col" class="jobb">kW</th><th scope="col" class="jobb">SEER</th><th scope="col">Osztály</th><th scope="col">Hűtőközeg</th><th scope="col">Készlet</th><th scope="col" class="jobb">Ár</th></tr></thead><tbody>' + term + '</tbody></table>') + '</section>' +
      '<section class="adm-kartya adm-veszely"><h2>Minden demóadat törlése</h2><p class="halvany">Törli ebben a böngészőben a rendeléseket, fiókokat, foglalásokat, ajánlatkéréseket, leveleket, hírlevél-feliratkozókat, értékeléseket, a hibanaplót, a kosarat és az összehasonlítást. A süti-döntés megmarad. Nem vonható vissza.</p><button class="gomb adm-gomb-piros" type="button" id="sys-torol">Minden demóadat törlése</button></section>';
    $('#sys-minta').addEventListener('click', function () {
      try { var n = mintaadatok(); toast('Mintaadatok betöltve: ' + n.r + ' rendelés, ' + n.fg + ' foglalás, ' + n.ak + ' ajánlatkérés.'); location.hash = '#attekintes'; }
      catch (e) { console.error(e); hiba('Mintaadat-betöltés hiba: ' + e.message, 'admin.minta'); toast('Hiba a mintaadatok betöltésekor: ' + esc(e.message)); }
    });
    var ht = $('#sys-hiba-torol'); if (ht) ht.addEventListener('click', function () { if (confirm('Üríted a hibanaplót?')) { tar.set(K.hb, []); ujra(); } });
    $('#sys-torol').addEventListener('click', function () {
      if (!confirm('Biztosan törlöd az összes demóadatot ebben a böngészőben? Ez nem vonható vissza.')) return;
      ['hk_rendelesek', 'hk_fiokok', 'hk_foglalasok', 'hk_ajanlatkeresek', 'hk_levelek', 'hk_hirlevel', 'hk_ertekelesek', 'hk_hibak', 'hk_mero', 'hk_uzenetek', 'hk_kosar', 'hk_osszehas'].forEach(function (k) { tar.set(k, []); });
      tar.set('hk_belepve', null); tar.set('hk_utolso', null);
      AJ = null; SZ.levUzenet = '';
      if (H.frissitJelvenyek) H.frissitJelvenyek();
      toast('Minden demóadat törölve.'); location.hash = '#attekintes'; ujra();
    });
  };

  /* ---------- Mintaadatok ---------- */
  function mintaKep(cim, szin) {
    try {
      var c = document.createElement('canvas'); c.width = 640; c.height = 480; var x = c.getContext('2d');
      var g = x.createLinearGradient(0, 0, 0, 380); g.addColorStop(0, szin); g.addColorStop(1, '#eef2f6'); x.fillStyle = g; x.fillRect(0, 0, 640, 380);
      x.fillStyle = '#c9b391'; x.fillRect(0, 380, 640, 100);
      x.fillStyle = '#cfe8fa'; x.fillRect(400, 110, 170, 190); x.strokeStyle = '#fff'; x.lineWidth = 10; x.strokeRect(400, 110, 170, 190); x.beginPath(); x.moveTo(485, 110); x.lineTo(485, 300); x.stroke();
      x.setLineDash([14, 9]); x.strokeStyle = '#1479d4'; x.lineWidth = 4; x.strokeRect(70, 80, 250, 72); x.setLineDash([]);
      x.fillStyle = '#1479d4'; x.font = 'bold 20px system-ui, sans-serif'; x.fillText('tervezett beltéri egység', 78, 180);
      x.fillStyle = 'rgba(12,35,64,.78)'; x.fillRect(0, 410, 640, 70); x.fillStyle = '#fff'; x.font = 'bold 26px system-ui, sans-serif'; x.fillText('MINTA FOTÓ – ' + cim, 24, 455);
      return c.toDataURL('image/jpeg', 0.7);
    } catch (e) { return null; }
  }
  function mintaAlairas(nev) {
    try {
      var c = document.createElement('canvas'); c.width = 600; c.height = 180; var x = c.getContext('2d');
      x.strokeStyle = '#0c2340'; x.lineWidth = 3; x.lineCap = 'round'; x.lineJoin = 'round';
      x.beginPath(); x.moveTo(40, 120);
      for (var i = 0; i < 14; i++) { var bx = 40 + i * 32; x.bezierCurveTo(bx + 8, 40 + (i % 3) * 12, bx + 22, 150 - (i % 2) * 30, bx + 32, 105 + Math.sin(i) * 18); }
      x.stroke(); x.beginPath(); x.moveTo(60, 150); x.quadraticCurveTo(300, 130, 520, 148); x.stroke();
      x.fillStyle = 'rgba(86,102,125,.85)'; x.font = '14px system-ui, sans-serif'; x.fillText('minta aláírás – ' + nev, 380, 172);
      return c.toDataURL('image/png');
    } catch (e) { return null; }
  }
  function mintaadatok() {
    var oldalfali = (HK.termekek || []).filter(function (t) { return t.kat !== 'multi'; });
    if (!oldalfali.length) throw new Error('nincs termékadat');
    var k = function (i) { return oldalfali[i % oldalfali.length]; };
    var munkanap = function (n) { var s = napPlusz(n); return strDatum(s).getDay() === 0 ? napPlusz(n + 1) : s; };
    var napVissza = function (n, ora, perc) { var d = new Date(); d.setDate(d.getDate() - n); d.setHours(ora, perc || 0, 0, 0); if (d > new Date()) d = new Date(Date.now() - 60 * 60 * 1000); return d.toISOString(); };
    var token = function () { return Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 8); };
    var ujRend = [], ujFg = [];
    function rendeles(o) {
      var szall = o.szereles ? '' : o.szallitas;
      var r = H.osszesit(o.kosar, o.telepules, szall);
      var azon = H.azon('HK');
      var rend = {
        azon: azon, ido: napVissza(o.nap, o.ora || 10, o.perc || 12), allapot: 'Új', minta: true,
        vevo: { nev: o.nev, tel: o.tel, email: o.email, telepules: o.telepules, irsz: o.irsz, utca: o.utca, cegnev: o.cegnev || '', adoszam: o.adoszam || '' },
        szallitas: r.fizikaiDb && !r.helyszini ? o.szallitas : (r.helyszini ? 'szereles' : ''), fizetes: o.fizetes, megj: o.megj || '',
        tetelek: r.tetelek.map(function (e) { return { nev: e.i.nev, db: e.x.db, egyseg: e.i.egyseg, osszeg: e.i.osszeg, szerelt: e.i.szerelt, sorok: e.i.sorok, x: e.x }; }),
        termekOsszeg: r.termekOsszeg, kiszallas: r.kiszallas, szallitasDij: r.szallitas, osszesen: r.osszesen, netto: r.netto, afa: r.afa, eloleg: o.fizetes === 'eloleg' ? r.eloleg : 0, helyszini: r.helyszini
      };
      if (o.fiok) rend.fiok = o.email;
      rend.allapotNaplo = [{ ido: rend.ido, allapot: 'Új' }];
      (o.lepesek || []).forEach(function (l) {
        var megj = typeof l[3] === 'string' ? l[3] : l[4], ido = napVissza(l[1], l[2] || 14, typeof l[3] === 'number' ? l[3] : 5);
        rend.allapot = l[0]; var b = { ido: ido, allapot: l[0] }; if (megj) b.megj = megj; rend.allapotNaplo.push(b);
        if (l[0] === 'Díjbekérő elküldve') rend.dijbekero = szamAzon('DB', azon);
        if (l[0] === 'Előleg beérkezett') rend.fizetve = rend.eloleg || elolegSzamol(rend.osszesen);
        if (l[0] === 'Fizetve') rend.fizetve = rend.osszesen;
        if (l[0] === 'Szerelés kész') { rend.szamla = szamAzon('SZ', azon); rend.token = token(); }
      });
      if (o.vegFizetve) rend.fizetve = rend.osszesen;
      if (o.fg) {
        var f = { azon: H.azon('FG'), tipus: o.fg.tipus || 'szereles', datum: o.fg.datum, sav: o.fg.sav, nev: o.nev, tel: o.tel, email: o.email, telepules: o.telepules, cim: o.utca, megj: o.fg.megj || ('Rendelés: ' + azon), rendeles: azon, allapot: o.fg.allapot, ido: rend.ido, minta: true };
        if (o.fg.szerelo) f.szerelo = o.fg.szerelo;
        if (o.fg.munkalap) f.munkalap = o.fg.munkalap;
        rend.idopont = { datum: f.datum, sav: f.sav };
        ujFg.push(f);
      }
      ujRend.push(rend);
      return rend;
    }
    var ESZTER = { nev: 'Takács Eszter', tel: '+36 30 555 0147', email: 'takacs.eszter@minta.example', telepules: 'Pécs', irsz: '7632', utca: 'Akácfa utca 21.', fiok: true };
    var GERGO = { nev: 'Horváth Gergely', tel: '+36 20 555 0183', email: 'horvath.gergely@minta.example', telepules: 'Orfű', irsz: '7677', utca: 'Tóparti sor 6.', fiok: true };
    var o = function (alap, extra) { return Object.assign({}, alap, extra); };
    rendeles({ nev: 'Kiss Bence', tel: '+36 30 555 0112', email: 'kiss.bence@minta.example', telepules: 'Pécs', irsz: '7624', utca: 'Fenyves sor 8.', nap: 0, ora: Math.max(8, new Date().getHours() - 2), perc: 14, szereles: true, fizetes: 'eloleg', kosar: [{ t: 'k', id: k(0).id, db: 1, sz: true, m: 2, ko: false, sp: false }], megj: 'Délután vagyok otthon, előtte hívjatok.' });
    rendeles({ nev: 'Varga Zsófia', tel: '+36 70 555 0129', email: 'varga.zsofia@minta.example', telepules: 'Kozármisleny', irsz: '7761', utca: 'Diófa utca 5.', nap: 3, ora: 9, szallitas: 'futar', fizetes: 'atutalas', kosar: [{ t: 'k', id: k(3).id, db: 1 }, { t: 's', id: 'wifi-modul', db: 1 }], lepesek: [['Díjbekérő elküldve', 3, 11, 20]] });
    rendeles({ nev: 'Németh Ádám', tel: '+36 30 555 0165', email: 'nemeth.adam@minta.example', telepules: 'Pellérd', irsz: '7831', utca: 'Szőlőhegy utca 3.', nap: 8, ora: 19, szereles: true, fizetes: 'eloleg', kosar: [{ t: 'k', id: k(1).id, db: 2, sz: true, m: 0, ko: true }], lepesek: [['Díjbekérő elküldve', 7, 9], ['Előleg beérkezett', 5, 10]], fg: { datum: munkanap(1), sav: '8–12', allapot: 'Visszaigazolva', szerelo: SZ_NEVEK[0], megj: 'Két beltéri: nappali + hálószoba, falkonzolos kültéri.' } });
    rendeles(o(ESZTER, { nap: 12, ora: 20, szereles: true, fizetes: 'teljes', kosar: [{ t: 'k', id: k(2).id, db: 1, sz: true, m: 3 }], lepesek: [['Díjbekérő elküldve', 11, 8], ['Fizetve', 10, 13], ['Időpont egyeztetve', 9, 10, 'Telefonon egyeztetve']], fg: { datum: ma(), sav: '12–16', allapot: 'Visszaigazolva', szerelo: SZ_NEVEK[1] } }));
    var mlKesz = napVissza(19, 15, 40);
    var r5 = rendeles(o(GERGO, { nap: 26, ora: 11, szereles: true, fizetes: 'eloleg', vegFizetve: true, kosar: [{ t: 'k', id: k(4).id, db: 1, sz: true, m: 1, sp: true }, { t: 's', id: 'berlet', db: 1, e: 1 }], lepesek: [['Díjbekérő elküldve', 26, 13], ['Előleg beérkezett', 24, 9], ['Időpont egyeztetve', 23, 16], ['Szerelés kész', 19, 15, 'A hátralékot a helyszínen készpénzzel fizette']], fg: { datum: napPlusz(-19), sav: '12–16', allapot: 'Kész', szerelo: SZ_NEVEK[0], munkalap: { lista: ELLENORZO.reduce(function (m, e) { m[e[0]] = true; return m; }, {}), vakuum: 0.6, vakuumPerc: 25, kifujt: 8.5, kulso: 9, hutokozeg: 'R32', toltet: 0.65, utantoltes: 0, gyariBel: 'MINTA-B23110457', gyariKul: 'MINTA-K23110458', fotok: [mintaKep('kültéri egység, konzolon', '#b9c9d8')].filter(Boolean), megj: 'Kondenzszivattyú a szekrény mögé szerelve, a kezelést megmutattam.', alairoNev: 'Horváth Gergely', alairas: mintaAlairas('Horváth Gergely'), szerelo: SZ_NEVEK[0], mentve: mlKesz, kesz: mlKesz } } }));
    var r6 = rendeles(o(ESZTER, { nap: 47, ora: 10, szereles: true, fizetes: 'teljes', kosar: [{ t: 'k', id: k(5).id, db: 1, sz: true, m: 0 }], lepesek: [['Díjbekérő elküldve', 47, 12], ['Fizetve', 46, 9], ['Időpont egyeztetve', 45, 11], ['Szerelés kész', 40, 15], ['Lezárva', 35, 9]] }));
    rendeles({ nev: 'Farkas Levente', tel: '+36 20 555 0131', email: 'farkas.levente@minta.example', telepules: 'Komló', irsz: '7300', utca: 'Kossuth Lajos utca 40.', nap: 17, ora: 21, szallitas: 'futar', fizetes: 'utanvet', kosar: [{ t: 'k', id: k(6).id, db: 1 }], lepesek: [['Lemondva', 16, 9, 'Az ügyfél telefonon lemondta (máshol vett klímát)']] });
    rendeles({ nev: 'Balogh Kitti', tel: '+36 30 555 0176', email: 'balogh.kitti@minta.example', telepules: 'Pécsvárad', irsz: '7720', utca: 'Rákóczi utca 12.', nap: 5, ora: 8, szereles: true, fizetes: 'teljes', kosar: [{ t: 's', id: 'szereles-sajat', db: 1, v: 'kicsi', m: 2, ko: false, sp: false }, { t: 's', id: 'berlet', db: 1, e: 1 }], lepesek: [['Díjbekérő elküldve', 5, 10], ['Fizetve', 3, 15]], megj: 'A klíma megvan, dobozban.', fg: { datum: munkanap(5), sav: '8–12', allapot: 'Foglalt', megj: 'Saját készülék felszerelése (2,5 kW), +2 m cső.' } });
    var r9 = rendeles({ nev: 'Papp Norbert', tel: '+36 70 555 0158', email: 'papp.norbert@minta.example', telepules: 'Pécs', irsz: '7630', utca: 'Hársfa utca 17.', nap: 33, ora: 12, szereles: true, fizetes: 'teljes', kosar: [{ t: 's', id: 'tisztitas', db: 1, e: 2 }], lepesek: [['Díjbekérő elküldve', 33, 14], ['Fizetve', 32, 10], ['Időpont egyeztetve', 32, 11], ['Szerelés kész', 28, 12], ['Lezárva', 27, 9]] });
    // önálló foglalások a következő két hétre
    [
      { tipus: 'felmeres', datum: munkanap(2), sav: '12–16', allapot: 'Visszaigazolva', nev: 'Molnár Réka', tel: '+36 30 555 0194', email: 'molnar.reka@minta.example', telepules: 'Pécs', cim: 'Szigeti út 44., 3. em.', megj: 'Multi-split felmérés (3 helyiség) – AK kapcsolódik' },
      { tipus: 'tisztitas', datum: munkanap(3), sav: '8–12', allapot: 'Foglalt', nev: 'Simon Tamás', tel: '+36 20 555 0105', email: 'simon.tamas@minta.example', telepules: 'Kozármisleny', cim: 'Liliom utca 9.', megj: '2 beltéri egység, utolsó tisztítás 2025 tavaszán' },
      { tipus: 'javitas', datum: munkanap(6), sav: '12–16', allapot: 'Visszaigazolva', szerelo: SZ_NEVEK[0], nev: 'Lakatos Judit', tel: '+36 30 555 0122', email: 'lakatos.judit@minta.example', telepules: 'Siklós', cim: 'Batthyány utca 2.', megj: 'Csöpög a beltéri egység, E1 hibakód' },
      { tipus: 'tisztitas', datum: munkanap(9), sav: '8–12', allapot: 'Foglalt', nev: 'Kovács Márta', tel: '+36 70 555 0119', email: 'kovacs.marta@minta.example', telepules: 'Pécs', cim: 'Megyeri út 61.', megj: '1 beltéri, kisállat van a lakásban' },
      { tipus: 'felmeres', datum: munkanap(12), sav: '12–16', allapot: 'Foglalt', nev: 'Szűcs András', tel: '+36 20 555 0166', email: 'szucs.andras@minta.example', telepules: 'Bóly', cim: 'Ady Endre utca 30.', megj: 'Családi ház, tetőtéri hálószoba' }
    ].forEach(function (f) { f.azon = H.azon('FG'); f.ido = napVissza(2, 10); f.minta = true; ujFg.push(f); });
    // ajánlatkérések
    var ak1 = { azon: H.azon('AK'), ido: napVissza(1, 18, 40), tipus: 'multi', minta: true, nev: 'Molnár Réka', tel: '+36 30 555 0194', email: 'molnar.reka@minta.example', telepules: 'Pécs', allapot: 'Új',
      adatok: { helyisegek: [{ nev: 'Nappali', m2: 32 }, { nev: 'Hálószoba', m2: 14 }, { nev: 'Gyerekszoba', m2: 12 }], kulteriHely: 'Erkély, 3. emelet', emelet: 3, megj: 'A csendes működés fontos, a gyerekszobában alszik a kicsi.' },
      fotok: [mintaKep('nappali, ablak melletti fal', '#d7e3ee'), mintaKep('erkély, kültéri helye', '#c4d3e0')].filter(Boolean) };
    var kt = k(1), ervenyes = napPlusz(9);
    var tet2 = [{ nev: kt.nev, db: 1, egyseg: kt.ar }, { nev: 'Alapszerelés (3 m cső) – ' + kt.nev, db: 1, egyseg: H.szerelesAlap(kt.kw) }, { nev: 'Plusz cső (méterenként)', db: 2, egyseg: A.extra_cso_meter || 0 }];
    var zd = H.zonaDij(H.telepulesKm('Bóly')); if (zd) tet2.push({ nev: 'Kiszállási díj – Bóly', db: 1, egyseg: zd });
    tet2.forEach(function (t) { t.osszeg = t.db * t.egyseg; });
    var o2 = tet2.reduce(function (s, t) { return s + t.osszeg; }, 0), n2 = Math.round(o2 / (1 + (B.afa || 27) / 100));
    var ak2 = { azon: H.azon('AK'), ido: napVissza(6, 20, 5), tipus: 'kalkulator', minta: true, nev: 'Szűcs András', tel: '+36 20 555 0166', email: 'szucs.andras@minta.example', telepules: 'Bóly', allapot: 'Ajánlat elküldve',
      adatok: { m2: 28, belmagassag: 2.6, tajolas: 'Dél', szigeteles: 'Közepes', ajanlottKw: 3.5, megj: 'Tetőtéri hálószoba, nyáron nagyon meleg.' }, fotok: [],
      ajanlat: { tetelek: tet2, osszesen: o2, netto: n2, afa: o2 - n2, ervenyes: ervenyes, megj: 'Az ajánlat a helyszíni felmérés után véglegesíthető. A felmérés díját megrendelés esetén jóváírjuk.', szam: H.azon('AJ'), ido: napVissza(5, 9), elkuldve: napVissza(5, 9, 10) } };
    // fiókok
    var fiokok = lista(K.f), vanFiok = function (e) { return fiokok.some(function (f) { return String(f.email).toLowerCase() === e; }); };
    [[ESZTER, 61, true], [GERGO, 28, false]].forEach(function (x) {
      if (vanFiok(x[0].email)) return;
      fiokok.push({ email: x[0].email, nev: x[0].nev, tel: x[0].tel, jelszo: (H.Fiok ? H.Fiok.hash(x[0].email, 'minta1234') : 'minta-fiok-nem-hasznalhato'), reg: napVissza(x[1], 19), hirlevel: x[2], cim: { telepules: x[0].telepules, irsz: x[0].irsz, utca: x[0].utca }, minta: true });
    });
    // értékelések
    var ert = lista(K.e);
    [[r5, 5, 'Pontosan érkeztek, letakartak mindent, és utána ki is takarítottak. A klíma halk, a kezelést is elmagyarázták.', 15], [r6, 5, 'Másodszor rendeltem tőlük, most is gyors és korrekt volt. Az ár pontosan annyi lett, amennyit a webshop mutatott.', 36], [r9, 4, 'Alapos tisztítás, kellemes illat utána. Egy csillag le, mert kicsit késtek, de előre szóltak.', 25]].forEach(function (x) {
      if (!x[0].token) x[0].token = token();
      ert.push({ token: x[0].token, rendeles: x[0].azon, csillag: x[1], szoveg: x[2], ido: napVissza(x[3], 20), minta: true });
    });
    // hírlevél
    var hl = lista(K.h);
    [[ESZTER.email, 60, true], [GERGO.email, 27, false], ['kovacs.marta@minta.example', 14, true], ['kiss.bence@minta.example', 0, false]].forEach(function (x) {
      if (hl.some(function (h) { return String(h.email).toLowerCase() === x[0]; })) return;
      hl.push({ email: x[0], ido: napVissza(x[1], 12), megerositve: x[2], token: token(), minta: true });
    });
    tar.set(K.r, lista(K.r).concat(ujRend));
    tar.set(K.fg, lista(K.fg).concat(ujFg));
    tar.set(K.ak, lista(K.ak).concat([ak1, ak2]));
    tar.set(K.f, fiokok); tar.set(K.e, ert); tar.set(K.h, hl);
    return { r: ujRend.length, fg: ujFg.length, ak: 2 };
  }

  /* =====================================================================
     SZERELŐI NÉZET
     ===================================================================== */
  function szerelo() {
    belepes($('#adm-belepes'), 'Szerelői nézet – belépés', function () {
      $('#sz-keret').hidden = false;
      window.addEventListener('hashchange', function () { szUt(); window.scrollTo(0, 0); });
      szUt();
    });
  }
  function szUt() {
    var h = location.hash.replace(/^#/, ''); try { h = decodeURIComponent(h); } catch (e) { }
    var k = $('#sz-keret');
    if (h.indexOf('munkalap/') === 0) munkalap(k, h.slice(9)); else szLista(k);
  }
  function szLista(k) {
    var nev = ses('hk_szerelo') || '';
    if (nev && SZ_NEVEK.indexOf(nev) < 0) nev = '';
    var fg = lista(K.fg).filter(function (f) { return aktivFg(f) && (!nev || !f.szerelo || f.szerelo === nev); });
    var rl = lista(K.r);
    var kartya = function (f) {
      var r = f.rendeles ? rl.find(function (x) { return x.azon === f.rendeles; }) : null;
      var tet = r ? (r.tetelek || []).map(function (t) { return '<li>' + esc(t.db + '× ' + t.nev) + '</li>'; }).join('') : '';
      var cim = cimSzoveg(f.cim, f.telepules);
      return '<article class="sz-munka adm-t-' + esc(f.tipus) + '">' +
        '<div class="sz-munka-fej"><span class="sz-sav">' + esc(f.sav) + '</span><span class="adm-tipus-cimke">' + esc(TIPUS[f.tipus] || 'Munka') + '</span>' + jelzo(f.allapot) + '</div>' +
        '<h3>' + esc(f.nev || '–') + '</h3>' +
        (cim ? '<p class="sz-cim"><a href="' + terkepUrl(f.cim, f.telepules) + '" target="_blank" rel="noopener">' + esc(cim) + '</a></p>' : '') +
        (tet ? '<ul class="sz-tetelek">' + tet + '</ul>' : '') +
        (f.megj ? '<p class="sz-megj">' + esc(f.megj) + '</p>' : '') +
        (r && r.megj ? '<p class="sz-megj"><b>Ügyfél:</b> ' + esc(r.megj) + '</p>' : '') +
        (r && r.belsoMegj ? '<p class="sz-megj"><b>Iroda:</b> ' + esc(r.belsoMegj) + '</p>' : '') +
        (r ? '<p class="adm-apro halvany">' + esc(r.azon) + ' · ' + esc(FIZ[r.fizetes] || '') + (r.fizetve ? ' · befizetve ' + ft(r.fizetve) : '') + (r.osszesen - (r.fizetve || 0) > 0 ? ' · <b>helyszínen fizetendő: ' + ft(r.osszesen - (r.fizetve || 0)) + '</b>' : '') + '</p>' : '') +
        '<p class="adm-apro">' + (f.szerelo ? 'Szerelő: <b>' + esc(f.szerelo) + '</b>' : '<span class="adm-piros">Nincs hozzárendelve</span>' + (nev ? ' <button class="gomb gomb-keret gomb-kicsi" type="button" data-elvallal="' + esc(f.azon) + '">Elvállalom</button>' : '')) + (f.munkalap && f.munkalap.kesz ? ' · <a href="/szerelo/jegyzokonyv/?azon=' + encodeURIComponent(f.azon) + '">Jegyzőkönyv</a>' : '') + '</p>' +
        '<div class="sz-gombok">' + (f.tel ? '<a class="gomb gomb-kek" href="' + telHref(f.tel) + '">Hívás</a>' : '') + (cim ? '<a class="gomb gomb-keret" href="' + terkepUrl(f.cim, f.telepules) + '" target="_blank" rel="noopener">Útvonal</a>' : '') + '<a class="gomb gomb-fo" href="#munkalap/' + encodeURIComponent(f.azon) + '">' + (f.allapot === 'Kész' ? 'Munkalap (kész)' : 'Munkalap') + '</a></div></article>';
    };
    var blokk = function (cim, d) { var l = rendezFg(fg.filter(function (f) { return f.datum === d; })); return '<section class="sz-nap" aria-labelledby="sz-' + d + '"><h2 id="sz-' + d + '">' + cim + ' <small class="halvany">' + datumHu(d, true) + ' · ' + l.length + ' munka</small></h2>' + (l.length ? l.map(kartya).join('') : '<p class="adm-ures">Nincs munka erre a napra.</p>') + '</section>'; };
    var kesobb = rendezFg(fg.filter(function (f) { return f.datum > napPlusz(1) && f.datum <= napPlusz(8); }));
    k.innerHTML = '<div class="sz-fej"><div><h1 class="adm-cim" tabindex="-1">Szerelői nézet</h1><p class="halvany mb0">Minta szerelők, kitalált munkák</p></div><button class="gomb gomb-keret gomb-kicsi" type="button" data-adm-kilep>Kilépés</button></div>' +
      '<div class="mezo sz-valaszto"><label for="sz-valaszt">Ki dolgozik ma?</label><select id="sz-valaszt">' + opt('', 'Mindenki munkái', nev) + SZ_NEVEK.map(function (n) { return opt(n, n, nev); }).join('') + '</select><div class="sugo">Szerelő kiválasztásakor a saját és a még hozzá nem rendelt munkák látszanak.</div></div>' +
      blokk('Mai munkák', ma()) + blokk('Holnap', napPlusz(1)) +
      (kesobb.length ? '<details class="sz-kesobb"><summary>Később (7 nap) – ' + kesobb.length + ' munka</summary><ul class="adm-mini-lista">' + kesobb.map(function (f) { return '<li><a href="#munkalap/' + encodeURIComponent(f.azon) + '"><span class="adm-t-pont adm-t-' + esc(f.tipus) + '" aria-hidden="true"></span><b>' + rovidNap(f.datum) + ' ' + esc(f.sav) + '</b> ' + esc(TIPUS[f.tipus] || '') + ' – ' + esc(f.nev) + '<small>' + esc(cimSzoveg(f.cim, f.telepules)) + (f.szerelo ? ' · ' + esc(f.szerelo) : '') + '</small></a></li>'; }).join('') + '</ul></details>' : '') +
      '<p class="adm-apro halvany">Irodai nézet: <a href="/admin/#naptar">admin naptár</a></p>';
    $('#sz-valaszt').addEventListener('change', function (e) { ses('hk_szerelo', e.target.value || null); szLista(k); });
    $$('[data-elvallal]', k).forEach(function (b) { b.addEventListener('click', function () { frissit(K.fg, b.getAttribute('data-elvallal'), function (f) { f.szerelo = nev; }); toast('Elvállaltad a munkát.'); szLista(k); }); });
  }

  /* ---------- Munkalap ---------- */
  function kicsinyit(file, max, cb) {
    if (!file || !/^image\//.test(file.type)) { cb(null); return; }
    var url = URL.createObjectURL(file), img = new Image();
    img.onload = function () {
      try {
        var s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
        cb(c.toDataURL('image/jpeg', 0.72));
      } catch (e) { cb(null); }
      URL.revokeObjectURL(url);
    };
    img.onerror = function () { URL.revokeObjectURL(url); cb(null); };
    img.src = url;
  }
  function alairasPad(c, kezdo) {
    var x = c.getContext('2d'), rajzol = false, uresE = true, utolso = null, kep = kezdo || null;
    function beallit() {
      var r = c.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      if (!r.width) return;
      var mentett = !uresE ? c.toDataURL('image/png') : kep;
      c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr);
      x.setTransform(dpr, 0, 0, dpr, 0, 0); x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#0c2340'; x.fillStyle = '#0c2340';
      if (mentett) { var i = new Image(); i.onload = function () { x.setTransform(1, 0, 0, 1, 0, 0); x.drawImage(i, 0, 0, c.width, c.height); x.setTransform(dpr, 0, 0, dpr, 0, 0); }; i.src = mentett; uresE = false; }
    }
    function pont(e) { var r = c.getBoundingClientRect(), t = e.touches && e.touches[0] ? e.touches[0] : e; return { x: t.clientX - r.left, y: t.clientY - r.top }; }
    function kezd(e) { if (e.button != null && e.button > 0) return; e.preventDefault(); rajzol = true; utolso = pont(e); x.beginPath(); x.arc(utolso.x, utolso.y, 1.2, 0, 2 * Math.PI); x.fill(); uresE = false; }
    function mozog(e) { if (!rajzol) return; e.preventDefault(); var p = pont(e); x.beginPath(); x.moveTo(utolso.x, utolso.y); x.lineTo(p.x, p.y); x.stroke(); utolso = p; }
    function vege() { rajzol = false; }
    if (window.PointerEvent) {
      c.addEventListener('pointerdown', function (e) { try { c.setPointerCapture(e.pointerId); } catch (er) { } kezd(e); });
      c.addEventListener('pointermove', mozog); c.addEventListener('pointerup', vege); c.addEventListener('pointercancel', vege);
    } else {
      c.addEventListener('mousedown', kezd); window.addEventListener('mousemove', mozog); window.addEventListener('mouseup', vege);
      c.addEventListener('touchstart', kezd, { passive: false }); c.addEventListener('touchmove', mozog, { passive: false }); c.addEventListener('touchend', vege);
    }
    beallit();
    var idozito; window.addEventListener('resize', function () { clearTimeout(idozito); idozito = setTimeout(beallit, 150); });
    return {
      ures: function () { return uresE; },
      torol: function () { x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height); beallitTr(); uresE = true; kep = null; },
      adat: function () {
        if (uresE) return null;
        var o = document.createElement('canvas'); o.width = 600; o.height = Math.round(600 * c.height / Math.max(1, c.width));
        var ox = o.getContext('2d'); ox.drawImage(c, 0, 0, o.width, o.height); return o.toDataURL('image/png');
      }
    };
    function beallitTr() { var dpr = window.devicePixelRatio || 1; x.setTransform(dpr, 0, 0, dpr, 0, 0); }
  }
  function munkalap(k, azon) {
    var f = keres(K.fg, azon);
    if (!f) { k.innerHTML = '<a class="adm-vissza" href="#">← Munkák</a><div class="figyelmezteto">Nincs ilyen munka: ' + esc(azon) + '</div>'; return; }
    var r = f.rendeles ? keres(K.r, f.rendeles) : null;
    var ml = JSON.parse(JSON.stringify(f.munkalap || {}));
    ml.lista = ml.lista || {}; ml.fotok = Array.isArray(ml.fotok) ? ml.fotok : [];
    var kesz = f.allapot === 'Kész' && ml.kesz;
    var szereles = f.tipus === 'szereles' || !f.tipus;
    var szNev = ses('hk_szerelo') || f.szerelo || '';
    var mezo = function (id, cimke, ertek, sugo, extra) { return '<div class="mezo"><label for="' + id + '">' + cimke + '</label><input type="text" id="' + id + '" inputmode="decimal" autocomplete="off" value="' + esc(ertek == null ? '' : szamHu(ertek)) + '"' + (extra || '') + '>' + (sugo ? '<div class="sugo">' + sugo + '</div>' : '') + '<div class="hiba-uzenet" role="alert"></div></div>'; };
    var cim = cimSzoveg(f.cim, f.telepules);
    k.innerHTML = '<a class="adm-vissza" href="#">← Munkák</a>' +
      '<div class="sz-fej"><div><h1 class="adm-cim" tabindex="-1">Munkalap</h1><p class="halvany mb0">' + esc(TIPUS[f.tipus] || 'Munka') + ' · ' + esc(f.azon) + ' · ' + datumHu(f.datum) + ' ' + esc(f.sav) + '</p></div>' + jelzo(f.allapot) + '</div>' +
      (kesz ? '<div class="siker-doboz sz-kesz"><b>A munka lezárva: ' + idoHu(ml.kesz) + '</b><p class="mb0"><a class="gomb gomb-kek gomb-kicsi" href="/szerelo/jegyzokonyv/?azon=' + encodeURIComponent(f.azon) + '">Jegyzőkönyv megnyitása / nyomtatás</a></p></div>' : '') +
      '<section class="adm-kartya sz-ugyfel"><h2>' + esc(f.nev || '–') + '</h2>' + (cim ? '<p class="mb0"><a href="' + terkepUrl(f.cim, f.telepules) + '" target="_blank" rel="noopener">' + esc(cim) + '</a></p>' : '') +
      (r ? '<ul class="sz-tetelek">' + (r.tetelek || []).map(function (t) { return '<li>' + esc(t.db + '× ' + t.nev) + '</li>'; }).join('') + '</ul>' : '') +
      '<div class="sz-gombok">' + (f.tel ? '<a class="gomb gomb-kek gomb-kicsi" href="' + telHref(f.tel) + '">Hívás</a>' : '') + (cim ? '<a class="gomb gomb-keret gomb-kicsi" href="' + terkepUrl(f.cim, f.telepules) + '" target="_blank" rel="noopener">Útvonal</a>' : '') + '</div></section>' +
      '<form id="ml-urlap" novalidate>' +
      '<fieldset class="adm-kartya sz-blokk" id="ml-lista"><legend>Ellenőrzőlista</legend>' + (szereles ? '' : '<p class="halvany adm-apro">Nem szerelés: csak a releváns pontokat jelöld.</p>') +
      ELLENORZO.map(function (e) { return '<label class="sz-pipa"><input type="checkbox" name="lista" value="' + e[0] + '"' + (ml.lista[e[0]] ? ' checked' : '') + '> <span>' + esc(e[1]) + '</span></label>'; }).join('') + '<div class="hiba-uzenet" id="ml-lista-hiba" role="alert"></div></fieldset>' +
      '<fieldset class="adm-kartya sz-blokk"><legend>Mért értékek</legend><div class="adm-urlap2">' +
      mezo('ml-vakuum', 'Vákuum (mbar)', ml.vakuum, 'Cél: ≤ 0,67 mbar (500 mikron)') + mezo('ml-vakuumperc', 'Vákuumozás ideje (perc)', ml.vakuumPerc, 'Legalább 15 perc') +
      mezo('ml-kifujt', 'Kifújt levegő (°C)', ml.kifujt, 'Hűtés módban, beltérinél') + mezo('ml-kulso', 'Külső hőmérséklet (°C)', ml.kulso, '') + '</div></fieldset>' +
      '<fieldset class="adm-kartya sz-blokk"><legend>Hűtőközeg (F-gáz nyilvántartás)</legend><div class="adm-urlap2">' +
      '<div class="mezo"><label for="ml-hk">Hűtőközeg típusa</label><select id="ml-hk">' + opt('', 'Válassz…', ml.hutokozeg || '') + HUTOKOZEG.map(function (h) { return opt(h, h, ml.hutokozeg || ''); }).join('') + '</select><div class="hiba-uzenet" role="alert"></div></div>' +
      mezo('ml-toltet', 'Gyári töltet (kg)', ml.toltet, 'Az adattábláról') + mezo('ml-utantoltes', 'Utántöltés (kg)', ml.utantoltes, '0, ha nem kellett') + '</div></fieldset>' +
      '<fieldset class="adm-kartya sz-blokk"><legend>Gyári számok</legend><div class="adm-urlap2">' +
      '<div class="mezo"><label for="ml-gybel">Beltéri egység</label><input type="text" id="ml-gybel" autocomplete="off" autocapitalize="characters" value="' + esc(ml.gyariBel || '') + '"><div class="hiba-uzenet" role="alert"></div></div>' +
      '<div class="mezo"><label for="ml-gykul">Kültéri egység</label><input type="text" id="ml-gykul" autocomplete="off" autocapitalize="characters" value="' + esc(ml.gyariKul || '') + '"><div class="hiba-uzenet" role="alert"></div></div></div></fieldset>' +
      '<fieldset class="adm-kartya sz-blokk"><legend>Fotók (max. 4)</legend><div class="sz-fotok" id="ml-fotok"></div><label class="gomb gomb-keret gomb-kicsi sz-foto-gomb" id="ml-foto-gomb"><input type="file" id="ml-foto" accept="image/*" capture="environment" multiple class="rejtett"> Fotó hozzáadása</label><p class="sugo">A képeket a telefon automatikusan kicsinyíti (max. 1000 px).</p></fieldset>' +
      '<fieldset class="adm-kartya sz-blokk"><legend>Megjegyzés</legend><div class="mezo"><label for="ml-megj" class="rejtett">Megjegyzés</label><textarea id="ml-megj" placeholder="Pl. eltérés az ajánlattól, extra anyag, ügyfél kérése">' + esc(ml.megj || '') + '</textarea></div></fieldset>' +
      '<fieldset class="adm-kartya sz-blokk"><legend>Ügyfél aláírása</legend><p class="halvany adm-apro">„A berendezést működőképes állapotban átvettem, a kezelését bemutatták.”</p>' +
      '<div class="mezo"><label for="ml-alairo">Aláíró neve</label><input type="text" id="ml-alairo" autocomplete="off" value="' + esc(ml.alairoNev || f.nev || '') + '"><div class="hiba-uzenet" role="alert"></div></div>' +
      '<div class="mezo" id="ml-alairas-mezo"><canvas class="sz-alairas" id="ml-alairas" role="img" aria-label="Aláírás mező: rajzolj ujjal vagy egérrel"></canvas><div class="hiba-uzenet" role="alert"></div></div>' +
      '<button class="gomb gomb-keret gomb-kicsi" type="button" id="ml-alairas-torol">Aláírás törlése</button></fieldset>' +
      '<div class="figyelmezteto" id="ml-hiba" role="alert" tabindex="-1" hidden></div>' +
      '<div class="sz-vegso"><button class="gomb gomb-keret" type="button" id="ml-ment">Mentés (piszkozat)</button><button class="gomb gomb-fo" type="submit">' + (kesz ? 'Módosítás mentése (kész)' : 'Munka kész') + '</button></div>' +
      '<p class="adm-apro halvany">A „Munka kész” lezárja a foglalást' + (r ? ', a(z) ' + esc(r.azon) + ' rendelést „Szerelés kész” állapotba teszi, és elküldi az ügyfélnek a levelet' : '') + '.</p></form>';

    var pad = alairasPad($('#ml-alairas'), ml.alairas || null);
    function fotokRajz() {
      $('#ml-fotok').innerHTML = ml.fotok.length ? ml.fotok.map(function (s, i) { return '<figure class="sz-foto"><img src="' + esc(s) + '" alt="' + (i + 1) + '. fotó"><button type="button" class="sz-foto-x" data-foto-torol="' + i + '" aria-label="' + (i + 1) + '. fotó törlése">×</button></figure>'; }).join('') : '<p class="halvany adm-apro mb0">Még nincs fotó.</p>';
      $('#ml-foto-gomb').hidden = ml.fotok.length >= 4;
    }
    fotokRajz();
    $('#ml-foto').addEventListener('change', function (e) {
      var fajlok = Array.prototype.slice.call(e.target.files || []), hely = 4 - ml.fotok.length;
      if (fajlok.length > hely) toast('Legfeljebb 4 fotó: ' + (hely > 0 ? 'az első ' + hely + ' kerül fel.' : 'nincs több hely.'));
      fajlok = fajlok.slice(0, Math.max(0, hely));
      var maradt = fajlok.length;
      fajlok.forEach(function (fj) { kicsinyit(fj, 1000, function (d) { if (d && ml.fotok.length < 4) ml.fotok.push(d); else if (!d) toast('Ezt a fájlt nem sikerült képként beolvasni.'); if (--maradt === 0) fotokRajz(); }); });
      e.target.value = '';
    });
    $('#ml-fotok').addEventListener('click', function (e) { var b = e.target.closest('[data-foto-torol]'); if (b) { ml.fotok.splice(+b.getAttribute('data-foto-torol'), 1); fotokRajz(); } });
    $('#ml-alairas-torol').addEventListener('click', function () { pad.torol(); ml.alairas = null; });

    function gyujt() {
      var u = $('#ml-urlap'), lst = {};
      $$('input[name=lista]', u).forEach(function (c) { lst[c.value] = c.checked; });
      ml.lista = lst;
      ml.vakuum = szamP($('#ml-vakuum').value); ml.vakuumPerc = szamP($('#ml-vakuumperc').value);
      ml.kifujt = szamP($('#ml-kifujt').value); ml.kulso = szamP($('#ml-kulso').value);
      ml.hutokozeg = $('#ml-hk').value; ml.toltet = szamP($('#ml-toltet').value); ml.utantoltes = szamP($('#ml-utantoltes').value);
      ml.gyariBel = $('#ml-gybel').value.trim(); ml.gyariKul = $('#ml-gykul').value.trim();
      ml.megj = $('#ml-megj').value.trim(); ml.alairoNev = $('#ml-alairo').value.trim();
      var a = pad.adat(); if (a) ml.alairas = a;
    }
    function ellenoriz(vegleges) {
      var u = $('#ml-urlap'), hibak = [];
      mezoOk(u); $('#ml-lista-hiba').textContent = ''; $('#ml-lista').classList.remove('hibas');
      var szamMezo = function (id, nev, min, max) { var v = szamP($(id).value); if (v != null && (isNaN(v) || (min != null && v < min) || (max != null && v > max))) { mezoHiba($(id).closest('.mezo'), 'Érvénytelen érték' + (min != null ? ' (' + szamHu(min) + '–' + szamHu(max) + ')' : '') + '.'); hibak.push(nev); } return v; };
      var vak = szamMezo('#ml-vakuum', 'vákuum', 0, 1000), perc = szamMezo('#ml-vakuumperc', 'vákuumozás ideje', 0, 600);
      szamMezo('#ml-kifujt', 'kifújt levegő', -10, 70); szamMezo('#ml-kulso', 'külső hőmérséklet', -30, 50);
      szamMezo('#ml-toltet', 'gyári töltet', 0, 50); szamMezo('#ml-utantoltes', 'utántöltés', 0, 20);
      if (vegleges) {
        if (szereles) {
          if (vak == null) { mezoHiba($('#ml-vakuum').closest('.mezo'), 'Add meg a mért vákuumot.'); hibak.push('vákuum'); }
          if (perc == null) { mezoHiba($('#ml-vakuumperc').closest('.mezo'), 'Add meg a vákuumozás idejét.'); hibak.push('vákuumozás ideje'); }
          else if (!isNaN(perc) && perc < 15) { mezoHiba($('#ml-vakuumperc').closest('.mezo'), 'Legalább 15 perc vákuumozás szükséges.'); hibak.push('vákuumozás ideje'); }
          if (!$('#ml-hk').value) { mezoHiba($('#ml-hk').closest('.mezo'), 'Válaszd ki a hűtőközeget.'); hibak.push('hűtőközeg'); }
          if (!$('#ml-gybel').value.trim()) { mezoHiba($('#ml-gybel').closest('.mezo'), 'Add meg a beltéri gyári számát.'); hibak.push('beltéri gyári szám'); }
          if (!$('#ml-gykul').value.trim()) { mezoHiba($('#ml-gykul').closest('.mezo'), 'Add meg a kültéri gyári számát.'); hibak.push('kültéri gyári szám'); }
          var hiany = ELLENORZO.filter(function (e) { var c = $('input[name=lista][value="' + e[0] + '"]', u); return !c || !c.checked; });
          if (hiany.length) { $('#ml-lista-hiba').textContent = 'Még nincs kipipálva: ' + hiany.map(function (e) { return e[1]; }).join('; ') + '.'; $('#ml-lista').classList.add('hibas'); hibak.push('ellenőrzőlista'); }
        }
        if (!$('#ml-alairo').value.trim()) { mezoHiba($('#ml-alairo').closest('.mezo'), 'Add meg az aláíró nevét.'); hibak.push('aláíró neve'); }
        if (pad.ures() && !ml.alairas) { mezoHiba($('#ml-alairas-mezo'), 'Az ügyfél aláírása szükséges.'); hibak.push('aláírás'); }
      }
      var h = $('#ml-hiba');
      if (hibak.length) { h.innerHTML = 'Javítsd a jelölt mezőket: ' + esc(hibak.join(', ')) + '.'; h.hidden = false; h.focus(); return false; }
      h.hidden = true; return true;
    }
    function mentes(vegleges) {
      gyujt();
      ml.mentve = most(); ml.szerelo = szNev || ml.szerelo || '';
      if (vegleges) ml.kesz = ml.kesz || most();
      var friss = frissit(K.fg, f.azon, function (x) { x.munkalap = ml; if (vegleges) { x.allapot = 'Kész'; if (!x.szerelo && ml.szerelo) x.szerelo = ml.szerelo; } });
      var ell = keres(K.fg, f.azon);
      if (!friss || !ell || !ell.munkalap || ell.munkalap.mentve !== ml.mentve) {
        hiba('Munkalap mentése sikertelen (tárhely megtelt?) – ' + f.azon, 'szerelo.munkalap');
        toast('Nem sikerült menteni – valószínűleg megtelt a böngésző tárhelye. Törölj egy fotót, és próbáld újra.');
        return false;
      }
      return true;
    }
    $('#ml-ment').addEventListener('click', function () { if (!ellenoriz(false)) return; if (mentes(false)) toast('Munkalap mentve (piszkozat).'); });
    $('#ml-urlap').addEventListener('submit', function (e) {
      e.preventDefault();
      if (!ellenoriz(true)) return;
      var elsoLezaras = !ml.kesz;
      if (!mentes(true)) return;
      var lev = false;
      if (elsoLezaras && f.rendeles && f.tipus !== 'felmeres') {
        var rr = keres(K.r, f.rendeles);
        if (rr && ['Szerelés kész', 'Lezárva', 'Lemondva'].indexOf(rr.allapot) < 0) { var res = rendelesAllapot(rr.azon, 'Szerelés kész', 'Munkalap: ' + f.azon + (ml.szerelo ? ' · ' + ml.szerelo : '')); lev = res && res.level; }
      }
      toast(elsoLezaras ? 'Munka kész!' + (lev ? ' Az ügyfél megkapta a „Szerelés kész” levelet.' : '') : 'Módosítás mentve.');
      munkalap(k, f.azon); window.scrollTo(0, 0);
    });
  }

  /* =====================================================================
     NYOMTATHATÓ LAPOK
     ===================================================================== */
  function lapInit(kesz) {
    belepes($('#adm-belepes'), 'Belépés a dokumentumhoz', function () { $('#lap-gombok').hidden = false; kesz(new URLSearchParams(location.search).get('azon') || ''); });
  }
  function jegyzokonyv() {
    lapInit(function (azon) {
      var f = keres(K.fg, azon), hely = $('#jk-tartalom'), lap = $('#jk-lap');
      if (!f) { lap.hidden = false; hely.innerHTML = '<div class="figyelmezteto">Nincs ilyen munka: ' + esc(azon || '(hiányzó azonosító)') + '. Nyisd meg a szerelői nézetből.</div>'; return; }
      var ml = f.munkalap || {}, r = f.rendeles ? keres(K.r, f.rendeles) : null, li = ml.lista || {};
      var szerelo = ml.szerelo || f.szerelo || '', szObj = SZERELOK.find(function (s) { return s.nev === szerelo; });
      var gwp = GWP[ml.hutokozeg], ossz = (ml.toltet || 0) + (ml.utantoltes || 0);
      var co2 = gwp && ossz ? Math.round(ossz * gwp / 10) / 100 : null;
      var klimak = r ? (r.tetelek || []).filter(function (t) { return (t.x && t.x.t === 'k') || t.szerelt || (t.x && t.x.id === 'szereles-sajat'); }) : [];
      var szereles = f.tipus === 'szereles' || !f.tipus;
      $('#lap-cim').textContent = szereles ? 'Üzembe helyezési jegyzőkönyv' : 'Munkalap – ' + (TIPUS[f.tipus] || 'munka');
      document.title = $('#lap-cim').textContent + ' ' + f.azon + ' (minta)';
      $('#lap-azon').innerHTML = 'Sorszám: <b>' + esc(f.azon) + '</b><br>Kelt: ' + (ml.kesz ? idoHu(ml.kesz) : datumHu(f.datum));
      lap.hidden = false;
      var kv = function (sorok) { return '<table class="adm-lap-kv"><tbody>' + sorok.map(function (s) { return '<tr><th scope="row">' + esc(s[0]) + '</th><td>' + s[1] + '</td></tr>'; }).join('') + '</tbody></table>'; };
      hely.innerHTML = (ml.kesz ? '' : '<div class="figyelmezteto adm-mb">A munkalap még nincs lezárva – ez piszkozat.</div>') +
        '<div class="adm-lap-racs"><section><h2>Megrendelő / üzemeltető</h2>' + kv([['Név', esc(f.nev || '–')], ['Cím', esc(cimSzoveg(f.cim, f.telepules) || '–')], ['Telefon', esc(f.tel || '–')], ['E-mail', esc(f.email || '–')], ['Rendelés', esc(r ? r.azon : '–')]]) + '</section>' +
        '<section><h2>Elvégzett munka</h2>' + kv([['Típus', esc(TIPUS[f.tipus] || '–')], ['Időpont', datumHu(f.datum) + ' ' + esc(f.sav || '')], ['Szerelő', esc(szerelo || '–')], ['Képesítés', esc(szObj && szObj.kepesites || '–')]]) + '</section></div>' +
        '<section><h2>Berendezés</h2>' + kv([['Típus', klimak.length ? klimak.map(function (t) { return esc(t.db + '× ' + t.nev); }).join('<br>') : 'a helyszínen rögzítve'], ['Gyári szám – beltéri', esc(ml.gyariBel || '–')], ['Gyári szám – kültéri', esc(ml.gyariKul || '–')]]) + '</section>' +
        '<div class="adm-lap-racs"><section><h2>Mért értékek</h2>' + kv([['Vákuum', ml.vakuum != null ? szamHu(ml.vakuum) + ' mbar' : '–'], ['Vákuumozás ideje', ml.vakuumPerc != null ? szamHu(ml.vakuumPerc) + ' perc' : '–'], ['Kifújt levegő', ml.kifujt != null ? szamHu(ml.kifujt) + ' °C' : '–'], ['Külső hőmérséklet', ml.kulso != null ? szamHu(ml.kulso) + ' °C' : '–']]) + '</section>' +
        '<section><h2>Hűtőközeg (F-gáz)</h2>' + kv([['Típus', esc(ml.hutokozeg || '–') + (gwp ? ' <small>(GWP ' + gwp + ')</small>' : '')], ['Gyári töltet', ml.toltet != null ? szamHu(ml.toltet) + ' kg' : '–'], ['Utántöltés', ml.utantoltes != null ? szamHu(ml.utantoltes) + ' kg' : '–'], ['CO₂-egyenérték', co2 != null ? szamHu(co2) + ' t' : '–']]) + '</section></div>' +
        '<section><h2>Ellenőrzőlista</h2><ul class="adm-lap-lista">' + ELLENORZO.map(function (e) { return '<li class="' + (li[e[0]] ? 'ok' : 'nem') + '"><span aria-hidden="true">' + (li[e[0]] ? '✓' : '–') + '</span> ' + esc(e[1]) + (li[e[0]] ? '' : ' <span class="rejtett">(nincs jelölve)</span>') + '</li>'; }).join('') + '</ul></section>' +
        ((ml.fotok || []).length ? '<section><h2>Fotók</h2><div class="adm-lap-fotok">' + ml.fotok.map(function (s, i) { return '<img src="' + esc(s) + '" alt="' + (i + 1) + '. munkafotó">'; }).join('') + '</div></section>' : '') +
        (ml.megj ? '<section><h2>Megjegyzés</h2><p>' + esc(ml.megj) + '</p></section>' : '') +
        '<section class="adm-lap-alairas"><div><div class="adm-alairas-hely">' + (ml.alairas ? '<img src="' + esc(ml.alairas) + '" alt="Az ügyfél aláírása">' : '') + '</div><span>' + esc(ml.alairoNev || f.nev || '') + '<br><small>ügyfél – a berendezést működőképes állapotban átvettem</small></span></div>' +
        '<div><div class="adm-alairas-hely"></div><span>' + esc(szerelo || '') + '<br><small>szerelő · ' + esc((ADM.ceg || {}).fgaz || '') + '</small></span></div></section>' +
        '<p class="adm-lap-lab">MINTA – kitalált cég és adatok, nem valós jegyzőkönyv. Élesben a hűtőközeggel végzett munkát a hatósági F-gáz nyilvántartásban is rögzíteni kell (' + esc((ADM.ceg || {}).fgazSzerv || '') + '). A jegyzőkönyvet és a garanciajegyet őrizd meg.</p>';
    });
  }
  function ajanlatNyomtat() {
    lapInit(function (azon) {
      var a = keres(K.ak, azon), hely = $('#aj-tartalom'), lap = $('#aj-lap');
      lap.hidden = false;
      if (!a || !a.ajanlat) { hely.innerHTML = '<div class="figyelmezteto">' + (a ? 'Ehhez a kéréshez még nincs mentett ajánlat.' : 'Nincs ilyen ajánlatkérés: ' + esc(azon || '(hiányzó azonosító)')) + '</div>'; return; }
      var aj = a.ajanlat;
      document.title = 'Árajánlat ' + (aj.szam || a.azon) + ' (minta)';
      $('#lap-azon').innerHTML = 'Ajánlat száma: <b>' + esc(aj.szam || a.azon) + '</b><br>Kelt: ' + idoHu(aj.ido) + '<br>Érvényes: <b>' + datumHu(aj.ervenyes) + '</b>';
      hely.innerHTML = '<div class="adm-lap-racs"><section><h2>Címzett</h2><p>' + esc(a.nev || '') + '<br>' + esc(a.telepules || '') + '<br>' + esc(a.tel || '') + '<br>' + esc(a.email || '') + '</p></section><section><h2>Hivatkozás</h2><p>Ajánlatkérés: ' + esc(a.azon) + ' (' + esc(AK_TIPUS[a.tipus] || a.tipus || '') + ')<br>Beérkezett: ' + idoHu(a.ido) + '</p></section></div>' +
        '<section><h2>Tételek</h2>' + burok('<table class="adm-lap-tabla"><thead><tr><th scope="col">Megnevezés</th><th scope="col" class="jobb">Db</th><th scope="col" class="jobb">Egységár</th><th scope="col" class="jobb">Összeg</th></tr></thead><tbody>' + (aj.tetelek || []).map(function (t) { return '<tr><td>' + esc(t.nev) + '</td><td class="jobb">' + esc(t.db) + '</td><td class="jobb">' + ft(t.egyseg) + '</td><td class="jobb">' + ft(t.osszeg != null ? t.osszeg : t.db * t.egyseg) + '</td></tr>'; }).join('') + '</tbody><tfoot><tr><th scope="row" colspan="3">Nettó</th><td class="jobb">' + ft(aj.netto != null ? aj.netto : Math.round(aj.osszesen / 1.27)) + '</td></tr><tr><th scope="row" colspan="3">Áfa (' + (B.afa || 27) + '%)</th><td class="jobb">' + ft(aj.afa != null ? aj.afa : aj.osszesen - Math.round(aj.osszesen / 1.27)) + '</td></tr><tr class="adm-lap-vegosszeg"><th scope="row" colspan="3">Fizetendő (bruttó)</th><td class="jobb">' + ft(aj.osszesen) + '</td></tr></tfoot></table>') + '</section>' +
        (aj.megj ? '<section><h2>Megjegyzés</h2><p>' + esc(aj.megj) + '</p></section>' : '') +
        '<section><h2>Feltételek</h2><ul class="adm-lap-felt"><li>Fizetés: ' + (B.elolegSzazalek || 30) + '% előleg díjbekérő alapján átutalással, a fennmaradó összeg a munka elvégzése után átutalással vagy készpénzzel. Bankkártyás és online fizetés nincs.</li><li>Az árak forintban értendők és tartalmazzák a ' + (B.afa || 27) + '% áfát.</li><li>Az ajánlat ' + datumHu(aj.ervenyes) + '-ig érvényes; a szerelést F-gáz képesített szakember végzi.</li></ul></section>' +
        '<p class="adm-lap-lab">MINTA – kitalált cég és árak, nem valós ajánlat.</p>';
    });
  }

  /* ---------- Indítás ---------- */
  H.horog('oldal', function () {
    if ($('#adm-admin')) admin();
    else if ($('#adm-szerelo')) szerelo();
    else if ($('#jk-lap')) jegyzokonyv();
    else if ($('#aj-lap')) ajanlatNyomtat();
  });
})();

/* ---- modul: fiok ---- */
/* 2. ütem – fiók, rendeléskövetés, díjbekérő, minta végszámla (demó: minden adat a böngészőben) */
(function () {
  'use strict';
  var H = window.HKApp; if (!H) return;
  var $ = H.$, $$ = H.$$, ft = H.ft, esc = H.esc, tar = H.tar, F = H.Fiok, kb = H.kisbetu, HK = H.HK, AL = H.ALLAPOTOK;
  var CEG = HK.fiokCeg || HK.ceg || {};
  var enc = encodeURIComponent;

  /* ---------- Segédek ---------- */
  function emailJo(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
  function napDatum(s) { if (!s) return ''; var d = new Date(s.length === 10 ? s + 'T12:00:00' : s); return isNaN(d) ? '' : d.toLocaleDateString('hu-HU', { year: 'numeric', month: '2-digit', day: '2-digit' }); }
  function honapHozza(s, n) { var d = new Date((s.length === 10 ? s + 'T12:00:00' : s)); d.setMonth(d.getMonth() + n); return d.toISOString().slice(0, 10); }
  function napHozza(s, n) { var d = new Date(s); d.setDate(d.getDate() + n); return d.toISOString(); }
  function rendelesek() { return tar.get('hk_rendelesek', []); }
  function foglalasok(azon) { return tar.get('hk_foglalasok', []).filter(function (f) { return f.rendeles === azon && f.allapot !== 'Lemondva'; }); }
  function mentRendeles(r) { var l = rendelesek(); for (var i = 0; i < l.length; i++) if (l[i].azon === r.azon) l[i] = r; tar.set('hk_rendelesek', l); }
  function tokenGen() { var s = ''; for (var i = 0; i < 4; i++) s += Math.random().toString(36).slice(2, 8); return s; }
  function keresztnev(nev) { var t = String(nev || '').trim().split(/\s+/); return t.length > 1 ? t[t.length - 1] : t[0]; }
  function vanNaplo(r, a) { return (r.allapotNaplo || []).some(function (n) { return n.allapot === a; }); }
  function naploIdo(r, a) { var t = null; (r.allapotNaplo || []).forEach(function (n) { if (n.allapot === a) t = n.ido; }); return t; }
  var UTALAS = { eloleg: 1, teljes: 1, atutalas: 1 };
  var FIZ = { eloleg: (HK.beall.elolegSzazalek || 30) + '% előleg átutalással', teljes: 'Teljes összeg átutalással', atutalas: 'Átutalás előre', utanvet: 'Utánvét', keszpenz: 'Készpénz átvételkor' };
  function cimke(a) { var o = a === 'Lemondva' ? 'piros' : (a === 'Szerelés kész' || a === 'Lezárva' || a === 'Fizetve') ? 'zold' : a === 'Új' ? 'kek' : 'sarga'; return '<span class="allapot-cimke allapot-' + o + '">' + esc(a) + '</span>'; }

  // fizetési helyzet: mennyi folyt be, mennyi van hátra, mi esedékes most
  function fizetes(r) {
    var teljes = vanNaplo(r, 'Fizetve') || r.allapot === 'Fizetve' || r.allapot === 'Lezárva' || (r.fizetve || 0) >= r.osszesen;
    var elolegKesz = r.fizetes === 'eloleg' && (vanNaplo(r, 'Előleg beérkezett') || (r.fizetve || 0) >= r.eloleg);
    var fizetve = r.fizetve != null ? r.fizetve : teljes ? r.osszesen : elolegKesz ? r.eloleg : 0;
    var hatra = Math.max(0, r.osszesen - fizetve), most = 0;
    if (UTALAS[r.fizetes] && r.allapot !== 'Lemondva') most = r.fizetes === 'eloleg' && !elolegKesz ? Math.max(0, r.eloleg - fizetve) : (r.fizetes === 'eloleg' ? 0 : hatra);
    return { teljes: teljes, elolegKesz: elolegKesz, fizetve: fizetve, hatra: hatra, most: most };
  }

  // egyszerű űrlap-ellenőrzés (a pénztáréval azonos szabályok)
  function ellenoriz(form) {
    var ok = true, elso = null;
    $$('.mezo', form).forEach(function (m) {
      var inp = m.querySelector('input,select,textarea');
      if (!inp || m.hidden || inp.readOnly || inp.type === 'checkbox') { m.classList.remove('hibas'); return; }
      var v = (inp.value || '').trim(), jo = true;
      if (inp.required && !v) jo = false;
      if (v && inp.type === 'email' && !emailJo(v)) jo = false;
      if (v && inp.type === 'tel' && v.replace(/\D/g, '').length < 9) jo = false;
      if (v && inp.pattern && !new RegExp('^(?:' + inp.pattern + ')$').test(v)) jo = false;
      if (inp.minLength > 0 && inp.value && inp.value.length < inp.minLength) jo = false;
      var egy = inp.getAttribute('data-egyezik'); if (egy && inp.value !== document.getElementById(egy).value) jo = false;
      if (inp.hasAttribute('data-hibas')) jo = false;
      m.classList.toggle('hibas', !jo);
      if (!jo) { ok = false; elso = elso || inp; inp.setAttribute('aria-invalid', 'true'); } else inp.removeAttribute('aria-invalid');
    });
    return { ok: ok, elso: elso };
  }

  /* ---------- Fejléc: fiók ikon jelölése ---------- */
  function jelolFejlec() {
    var f = F.aktualis();
    $$('[data-fiok-gomb]').forEach(function (a) { a.classList.toggle('belepve', !!f); a.setAttribute('aria-label', f ? 'Fiókom – bejelentkezve: ' + (f.nev || f.email) : 'Fiókom – belépés'); });
  }

  /* ---------- Hírlevél (a levelek modul kettős megerősítésével) ---------- */
  function hirlevelBe(f) {
    var l = tar.get('hk_hirlevel', []), mar = l.filter(function (x) { return kb(x.email) === f.email; })[0];
    if (!mar) { mar = { email: f.email, ido: new Date().toISOString(), megerositve: false, token: tokenGen() }; l.push(mar); tar.set('hk_hirlevel', l); }
    if (!mar.megerositve && H.level) H.level('hirlevel-megerosites', { hirlevel: mar, fiok: f, cimzett: f.email });
    return mar;
  }
  function hirlevelKi(email) { tar.set('hk_hirlevel', tar.get('hk_hirlevel', []).filter(function (x) { return kb(x.email) !== kb(email); })); }

  /* ---------- /fiok/ ---------- */
  function fiokOldal() {
    if (!$('#fiok-oldal')) return;
    var p = new URLSearchParams(location.search);
    var vissza = p.get('vissza'); if (!(vissza && /^\/(?!\/)/.test(vissza))) vissza = '';
    var fulek = $$('#fiok-ki [role=tab]');
    function valtFul(f) { fulek.forEach(function (x) { var be = x === f; x.setAttribute('aria-selected', be); x.tabIndex = be ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !be; }); }
    fulek.forEach(function (f, i) {
      f.addEventListener('click', function () { valtFul(f); });
      f.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { var j = (i + (e.key === 'ArrowRight' ? 1 : -1) + fulek.length) % fulek.length; fulek[j].focus(); valtFul(fulek[j]); } });
    });
    if (p.get('ful') === 'reg') valtFul($('#tab-reg'));
    function kesz() { if (vissza) location.href = vissza; else { rajzol(); window.scrollTo(0, 0); } }

    $('#belepes-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); var hiba = $('#belepes-hiba'); hiba.hidden = true;
      var ell = ellenoriz(this); if (!ell.ok) { ell.elso.focus(); return; }
      var em = $('#b-email').value.trim(), f = F.keres(em);
      if (!f || f.jelszo !== F.hash(em, $('#b-jelszo').value)) { hiba.textContent = 'Hibás e-mail-cím vagy jelszó.'; hiba.hidden = false; $('#b-jelszo').focus(); return; }
      F.belep(f.email); H.toast('Sikeres belépés. Szia, ' + esc(keresztnev(f.nev)) + '!'); kesz();
    });

    $('#reg-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); var hiba = $('#reg-hiba'); hiba.hidden = true;
      var ell = ellenoriz(this), uz = [];
      if (!ell.ok) uz.push('Ellenőrizd a pirossal jelölt mezőket.');
      if (!$('#r-aszf').checked) uz.push('Fogadd el az ÁSZF-et és az adatkezelési tájékoztatót.');
      var em = $('#r-email').value.trim();
      if (ell.ok && F.keres(em)) uz.push('Ezzel az e-mail-címmel már van fiók. Lépj be, vagy kérj új jelszót.');
      if (uz.length) { hiba.innerHTML = uz.join('<br>'); hiba.hidden = false; (ell.elso || hiba).focus(); return; }
      var f = F.letrehoz({ email: em, nev: $('#r-nev').value.trim(), tel: $('#r-tel').value.trim(), jelszo: $('#r-jelszo').value, hirlevel: $('#r-hirlevel').checked });
      if (f.hirlevel) hirlevelBe(f);
      H.toast('Kész a fiókod! ' + (f.hirlevel ? 'A hírlevélhez küldtünk egy megerősítő emailt.' : ''));
      kesz();
    });

    $('#elfelejtett-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); var ell = ellenoriz(this); if (!ell.ok) { ell.elso.focus(); return; }
      var u = $('#elfelejtett-uzenet');
      u.innerHTML = 'Ha a(z) <b>' + esc($('#e-email').value.trim()) + '</b> címhez tartozik fiók, küldtünk egy linket az új jelszó beállításához (1 óráig érvényes).<br><small>Mintaoldal: valójában nem megy ki email; élesben ezt a Supabase Auth intézi.</small>';
      u.hidden = false;
    });

    // Fiókom – az eseménykezelők egyszer, a tartalom a rajzol()-ban
    $('#adat-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); var f = F.aktualis(); if (!f) return;
      var ell = ellenoriz(this); if (!ell.ok) { ell.elso.focus(); return; }
      F.frissit(f.email, { nev: $('#a-nev').value.trim(), tel: $('#a-tel').value.trim(), cim: { telepules: $('#a-telepules').value, irsz: $('#a-irsz').value.trim(), utca: $('#a-utca').value.trim() } });
      H.toast('Mentettük az adataidat.'); rajzol();
    });
    var hk = $('#hirlevel-kapcsolo');
    function hirlevelValt() {
      var f = F.aktualis(); if (!f) return;
      $('#hirlevel-sor').classList.toggle('be', hk.checked);
      F.frissit(f.email, { hirlevel: hk.checked });
      if (hk.checked) { var h = hirlevelBe(f); H.toast(h.megerositve ? 'Feliratkoztál a hírlevélre.' : 'Küldtünk egy megerősítő emailt – a linkre kattintva lesz érvényes.'); }
      else { hirlevelKi(f.email); H.toast('Leiratkoztál a hírlevélről.'); }
    }
    hk.addEventListener('change', hirlevelValt);
    $('#hirlevel-sor').addEventListener('click', function (e) { if (e.target === hk) return; hk.checked = !hk.checked; hirlevelValt(); });
    $('#kilepes').addEventListener('click', function () { F.belep(null); H.toast('Kiléptél.'); rajzol(); window.scrollTo(0, 0); });
    $('#fiok-torles').addEventListener('click', function () { $('#torles-doboz').hidden = false; $('#torles-igen').focus(); });
    $('#torles-megse').addEventListener('click', function () { $('#torles-doboz').hidden = true; $('#fiok-torles').focus(); });
    $('#torles-igen').addEventListener('click', function () {
      var f = F.aktualis(); if (!f) return;
      F.ment(F.lista().filter(function (x) { return kb(x.email) !== f.email; }));
      hirlevelKi(f.email);
      var rl = rendelesek(); rl.forEach(function (r) { if (kb(r.fiok) === f.email) delete r.fiok; }); tar.set('hk_rendelesek', rl);
      F.belep(null); H.fut('fiok-torolve', { email: f.email });
      $('#torles-doboz').hidden = true; H.toast('A fiókodat töröltük.'); rajzol(); window.scrollTo(0, 0);
    });
    rajzol();
  }

  function rajzol() {
    var f = F.aktualis();
    $('#fiok-ki').hidden = !!f; $('#fiok-be').hidden = !f;
    $('#fiok-cim').textContent = f ? 'Szia, ' + keresztnev(f.nev || 'ügyfelünk') + '!' : 'Fiókom';
    $('#fiok-bevezeto').textContent = f ? 'Itt látod a rendeléseidet, a klímáidat és a következő tisztítás idejét.' : 'Lépj be, vagy hozz létre fiókot: követheted a rendeléseidet, emlékeztetünk az éves tisztításra.';
    jelolFejlec();
    if (!f) return;
    // Adataim
    var c = f.cim || {};
    $('#a-nev').value = f.nev || ''; $('#a-tel').value = f.tel || ''; $('#a-email').value = f.email;
    $('#a-telepules').innerHTML = '<option value="">– válassz –</option>' + (HK.telepulesek || []).map(function (t) { return '<option' + (t.nev === c.telepules ? ' selected' : '') + '>' + esc(t.nev) + '</option>'; }).join('');
    $('#a-irsz').value = c.irsz || ''; $('#a-utca').value = c.utca || '';
    // Rendeléseim
    var rl = F.rendelesei(f.email).sort(function (a, b) { return a.ido < b.ido ? 1 : -1; });
    $('#rendeles-lista').innerHTML = rl.length ? rl.map(function (r) {
      var db = r.tetelek.reduce(function (s, t) { return s + t.db; }, 0);
      return '<article class="fiok-rendeles"><div><b>' + esc(r.azon) + '</b><small>' + napDatum(r.ido) + ' · ' + db + ' tétel · ' + ft(r.osszesen) + '</small></div>' + cimke(r.allapot) +
        '<a class="gomb gomb-keret gomb-kicsi" href="/rendeles/?azon=' + enc(r.azon) + '&amp;email=' + enc(r.vevo.email) + '">Részletek<span class="rejtett"> – ' + esc(r.azon) + '</span></a></article>';
    }).join('') : '<div class="ures-lista">Még nincs rendelésed. <a href="/klimak/">Klímák böngészése →</a></div>';
    // Saját klímáim
    $('#klima-lista').innerHTML = klimaim(rl);
    // Beállítások
    $('#hirlevel-kapcsolo').checked = !!f.hirlevel; $('#hirlevel-sor').classList.toggle('be', !!f.hirlevel);
  }

  // a rendelésekből a szerelt készülékek, szerelési dátummal, következő tisztítással, garanciával
  function szerelesInfo(r) {
    var fogl = foglalasok(r.azon);
    var kesz = fogl.filter(function (x) { return x.allapot === 'Kész' && (x.tipus === 'szereles' || !x.tipus); })[0] || fogl.filter(function (x) { return x.allapot === 'Kész'; })[0];
    if (kesz) return { datum: kesz.datum, kesz: true, fogl: kesz };
    var ni = naploIdo(r, 'Szerelés kész');
    var kesznek = ni || AL.indexOf(r.allapot) >= AL.indexOf('Szerelés kész') && r.allapot !== 'Lemondva';
    var terv = fogl[0] || null, tervDatum = (terv && terv.datum) || (r.idopont && r.idopont.datum) || '';
    if (kesznek) return { datum: (ni && ni.slice(0, 10)) || tervDatum, kesz: true, fogl: terv };
    return tervDatum ? { datum: tervDatum, kesz: false, fogl: terv, sav: (terv && terv.sav) || (r.idopont && r.idopont.sav) } : null;
  }
  function cimkeSzoveg(k) { return String(k).replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); }); }
  function klimaim(rl) {
    var ma = new Date().toISOString().slice(0, 10), kartyak = [];
    rl.filter(function (r) { return r.allapot !== 'Lemondva'; }).forEach(function (r) {
      var sz = null;
      r.tetelek.forEach(function (t) {
        var x = t.x || {}, sajat = x.t === 's' && x.id === 'szereles-sajat';
        if (!t.szerelt && !sajat) return;
        sz = sz || szerelesInfo(r) || { datum: '', kesz: false };
        var term = x.t === 'k' ? H.termek(x.id) : null;
        var h = '<article class="klima-kartya"><div class="klima-fej"><div><b>' + esc(t.nev) + '</b>' + (t.db > 1 ? ' <span class="halvany">× ' + t.db + '</span>' : '') + '<small>Rendelés: <a href="/rendeles/?azon=' + enc(r.azon) + '&amp;email=' + enc(r.vevo.email) + '">' + esc(r.azon) + '</a>' + (sajat ? ' · saját készülék' : '') + '</small></div></div><dl class="fiok-adatok">';
        if (sz.kesz && sz.datum) {
          var kov = honapHozza(sz.datum, 12), esedekes = kov <= ma;
          h += '<dt>Szerelés</dt><dd>' + napDatum(sz.datum) + '</dd><dt>Következő tisztítás</dt><dd' + (esedekes ? ' class="esedekes"' : '') + '>' + napDatum(kov) + (esedekes ? ' – esedékes!' : '') + '</dd>';
        } else if (sz.datum) h += '<dt>Szerelés</dt><dd>tervezett: ' + napDatum(sz.datum) + (sz.sav ? ', ' + esc(sz.sav) + ' óra' : '') + '</dd><dt>Következő tisztítás</dt><dd>a szerelés után 12 hónappal</dd>';
        else h += '<dt>Szerelés</dt><dd>még nincs időpont – <a href="/idopont/?rendeles=' + enc(r.azon) + '">Időpontot választok</a></dd>';
        if (sz.datum && (sz.fogl || r.idopont)) { // garanciális adatok, ha van időpont / munkalap
          var ev = term && term.gar;
          if (ev) h += '<dt>Gyártói garancia</dt><dd>' + ev + ' év' + (sz.kesz ? ', ' + napDatum(honapHozza(sz.datum, ev * 12)) + '-ig' : ', a beüzemeléstől') + '<br><small class="halvany">Feltétele az évenkénti szakszervizes tisztítás.</small></dd>';
          if (sz.fogl && sz.fogl.szerelo) h += '<dt>Szerelő</dt><dd>' + esc(sz.fogl.szerelo) + '</dd>';
          var ml = sz.fogl && sz.fogl.munkalap;
          if (ml && typeof ml === 'object') {
            h += '<dt>Munkalap</dt><dd>' + esc(sz.fogl.azon || '') + '</dd>';
            Object.keys(ml).forEach(function (k) { var v = ml[k]; if (v == null || v === '' || typeof v === 'object' || /alairas|kep|foto/i.test(k)) return; h += '<dt>' + esc(cimkeSzoveg(k)) + '</dt><dd>' + esc(typeof v === 'boolean' ? (v ? 'igen' : 'nem') : v) + '</dd>'; });
          }
        }
        h += '</dl><a class="gomb gomb-kek gomb-kicsi" href="/idopont/?tipus=tisztitas">Tisztítást kérek</a></article>';
        kartyak.push(h);
      });
    });
    return kartyak.length ? '<div class="klima-racs">' + kartyak.join('') + '</div>' : '<div class="ures-lista">Még nincs általunk szerelt klímád. <a href="/klimak/">Klímák szereléssel →</a></div>';
  }

  /* ---------- /rendeles/ – rendeléskövetés ---------- */
  function keresRendeles(azon, email) {
    var a = String(azon || '').trim().toUpperCase(), e = kb(email);
    if (!a || !e) return null;
    return rendelesek().filter(function (r) { return String(r.azon).toUpperCase() === a && (kb(r.vevo && r.vevo.email) === e || kb(r.fiok) === e); })[0] || null;
  }
  function kovetesOldal() {
    var form = $('#kovetes-urlap'); if (!form) return;
    var p = new URLSearchParams(location.search), bel = F.aktualis();
    if (p.get('azon')) $('#k-azon').value = p.get('azon');
    $('#k-email').value = p.get('email') || (bel ? bel.email : '');
    function keres(kezi) {
      var hiba = $('#kovetes-hiba'); hiba.hidden = true;
      var r = keresRendeles($('#k-azon').value, $('#k-email').value);
      if (!r) { if (kezi || p.get('azon')) { hiba.textContent = 'Nem találunk ilyen rendelést ezzel az e-mail-címmel. Ellenőrizd a rendelésszámot (pl. HK-2026-ABC123).'; hiba.hidden = false; } $('#kovetes-eredmeny').innerHTML = ''; return; }
      history.replaceState(null, '', '/rendeles/?azon=' + enc(r.azon) + '&email=' + enc($('#k-email').value.trim()));
      mutat(r);
    }
    form.addEventListener('submit', function (e) { e.preventDefault(); var ell = ellenoriz(form); if (!ell.ok) { ell.elso.focus(); return; } keres(true); });
    $('#kovetes-eredmeny').addEventListener('click', function (e) {
      var r = keresRendeles($('#k-azon').value, $('#k-email').value); if (!r) return;
      if (e.target.closest('#lemond-gomb')) { $('#lemond-doboz').hidden = false; $('#lemond-igen').focus(); }
      if (e.target.closest('#lemond-megse')) $('#lemond-doboz').hidden = true;
      if (e.target.closest('#lemond-igen')) lemond(r);
    });
    if ($('#k-azon').value && $('#k-email').value) keres(false);
  }
  function lemond(r) {
    if (r.allapot !== 'Új') return;
    var ido = new Date().toISOString();
    r.allapot = 'Lemondva'; (r.allapotNaplo = r.allapotNaplo || []).push({ ido: ido, allapot: 'Lemondva', megj: 'Az ügyfél mondta le a rendeléskövetőn.' });
    mentRendeles(r);
    H.fut('rendeles-lemondva', r);
    H.toast('A rendelést lemondtuk.'); mutat(r);
  }
  function tetelTabla(r) {
    var h = '<div class="tabla-burok"><table class="kovetes-tabla"><thead><tr><th scope="col">Tétel</th><th scope="col" class="szam">Db</th><th scope="col" class="szam">Összeg</th></tr></thead><tbody>';
    r.tetelek.forEach(function (t) { h += '<tr><td>' + esc(t.nev) + (t.szerelt ? ' <small class="halvany">(szereléssel)</small>' : '') + (t.sorok && t.sorok.length > 1 ? '<ul class="tetel-sorok">' + t.sorok.map(function (s) { return '<li>' + esc(s[0]) + ': ' + ft(s[1]) + '</li>'; }).join('') + '</ul>' : '') + '</td><td class="szam">' + t.db + '</td><td class="szam">' + ft(t.osszeg) + '</td></tr>'; });
    (r.kedvezmenyek || []).forEach(function (k) { h += '<tr class="kedv-sor"><td colspan="2">' + esc(k[0]) + '</td><td class="szam">−' + ft(-k[1]) + '</td></tr>'; });
    if (r.kiszallas) h += '<tr><td colspan="2">Kiszállás</td><td class="szam">' + ft(r.kiszallas) + '</td></tr>';
    if (r.szallitasDij) h += '<tr><td colspan="2">Szállítás (futár)</td><td class="szam">' + ft(r.szallitasDij) + '</td></tr>';
    h += '</tbody><tfoot><tr><th scope="row" colspan="2">Összesen</th><td class="szam"><b>' + ft(r.osszesen) + '</b></td></tr><tr><td colspan="3" class="halvany szam" style="font-size:.85rem">Ebből nettó ' + ft(r.netto) + ' + 27% áfa ' + ft(r.afa) + '</td></tr></tfoot></table></div>';
    return h;
  }
  function idovonal(r) {
    var lepesek = AL.filter(function (a) {
      if (a === 'Lemondva') return false;
      if (!UTALAS[r.fizetes] && (a === 'Díjbekérő elküldve' || a === 'Előleg beérkezett')) return vanNaplo(r, a);
      if (r.fizetes !== 'eloleg' && a === 'Előleg beérkezett') return vanNaplo(r, a);
      if (!r.helyszini && (a === 'Időpont egyeztetve' || a === 'Szerelés kész')) return vanNaplo(r, a);
      return true;
    });
    var lemondva = r.allapot === 'Lemondva', akt = AL.indexOf(r.allapot);
    var h = '<ol class="idovonal">';
    lepesek.forEach(function (a) {
      var ido = naploIdo(r, a), kesz = !!ido || (!lemondva && AL.indexOf(a) <= akt);
      if (lemondva && !ido) return;
      var megj = ''; (r.allapotNaplo || []).forEach(function (n) { if (n.allapot === a && n.megj) megj = n.megj; });
      h += '<li class="' + (a === r.allapot ? 'aktualis' : kesz ? 'kesz' : 'hatra') + '"' + (a === r.allapot ? ' aria-current="step"' : '') + '><b>' + esc(a) + '</b>' + (ido ? '<small>' + napDatum(ido) + '</small>' : '') + (megj ? '<small>' + esc(megj) + '</small>' : '') + '</li>';
    });
    if (lemondva) h += '<li class="aktualis lemondva" aria-current="step"><b>Lemondva</b><small>' + napDatum(naploIdo(r, 'Lemondva')) + '</small></li>';
    return h + '</ol>';
  }
  function mutat(r) {
    var fz = fizetes(r), q = enc(r.azon), lemondva = r.allapot === 'Lemondva';
    var fogl = foglalasok(r.azon)[0], idop = r.idopont || (fogl ? { datum: fogl.datum, sav: fogl.sav } : null);
    var h = '<section class="panel kovetes-fej"><div><span class="halvany">Rendelés</span><h2>' + esc(r.azon) + '</h2><small class="halvany">Leadva: ' + napDatum(r.ido) + ' · ' + esc(FIZ[r.fizetes] || '') + '</small></div>' + cimke(r.allapot) + '</section>';
    h += '<section class="panel" aria-labelledby="iv-cim"><h2 id="iv-cim">Állapot</h2>' + idovonal(r) + '</section>';
    // fizetés
    if (!lemondva && !fz.teljes) {
      h += '<section class="panel" aria-labelledby="fiz-cim"><h2 id="fiz-cim">Fizetés</h2>';
      if (fz.most) h += '<p>Kérjük, utald át az alábbi összeget a díjbekérő alapján:</p><table class="adat-tabla"><tbody><tr><th>Kedvezményezett</th><td>' + esc(CEG.jogiNev || CEG.nev) + '</td></tr><tr><th>Bankszámla</th><td>' + esc(CEG.bankszamla) + '</td></tr><tr><th>Összeg</th><td><b>' + ft(fz.most) + '</b>' + (r.fizetes === 'eloleg' ? ' (előleg)' : '') + '</td></tr><tr><th>Közlemény</th><td><b>' + esc(r.azon) + '</b></td></tr></tbody></table>';
      else if (r.fizetes === 'eloleg') h += '<p class="mb0">Az előleget (' + ft(r.eloleg) + ') megkaptuk, köszönjük! A fennmaradó <b>' + ft(fz.hatra) + '</b>-ot a szerelés után utalással vagy készpénzzel fizeted.</p>';
      else if (r.fizetes === 'utanvet') h += '<p class="mb0">Fizetés a futárnál: <b>' + ft(r.osszesen) + '</b> (készpénzzel).</p>';
      else if (r.fizetes === 'keszpenz') h += '<p class="mb0">Fizetés átvételkor a raktárban: <b>' + ft(r.osszesen) + '</b>.</p>';
      if (fz.fizetve && fz.most) h += '<p class="halvany" style="margin:10px 0 0">Eddig beérkezett: ' + ft(fz.fizetve) + '.</p>';
      h += '</section>';
    }
    // bizonylatok + időpont
    var bz = [];
    if (UTALAS[r.fizetes] && !lemondva) bz.push('<a class="gomb gomb-keret gomb-kicsi" href="/dijbekero/?azon=' + q + '">' + (r.fizetes === 'eloleg' ? 'Előleg-díjbekérő' : 'Díjbekérő') + '</a>');
    if (!lemondva) bz.push('<a class="gomb gomb-keret gomb-kicsi" href="/szamla/?azon=' + q + '">' + (fz.teljes || r.szamla ? 'Végszámla (minta)' : 'Végszámla előnézet (minta)') + '</a>');
    if (bz.length) h += '<section class="panel" aria-labelledby="bz-cim"><h2 id="bz-cim">Bizonylatok</h2><div class="sor">' + bz.join('') + '</div>' + (fz.teljes || r.szamla ? '' : '<p class="halvany" style="font-size:.85rem;margin:10px 0 0">A végszámla a teljesítés és a teljes kifizetés után készül.</p>') + '</section>';
    if (r.helyszini && !lemondva) {
      h += '<section class="panel" aria-labelledby="id-cim"><h2 id="id-cim">Időpont</h2>';
      h += idop && idop.datum ? '<p class="mb0">' + (vanNaplo(r, 'Időpont egyeztetve') || (fogl && fogl.allapot === 'Visszaigazolva') ? 'Visszaigazolt' : 'Választott') + ' időpont: <b>' + napDatum(idop.datum) + (idop.sav ? ', ' + esc(idop.sav) + ' óra' : '') + '</b>' + (fogl && fogl.allapot ? ' <span class="halvany">(' + esc(fogl.allapot) + ')</span>' : '') + '</p>'
        : '<p>Még nincs időpont. Válaszd ki a neked megfelelő napot – a naptárban a szabad helyeket látod.</p><a class="gomb gomb-fo" href="/idopont/?rendeles=' + q + '">Időpontot választok</a>';
      h += '</section>';
    }
    h += '<section class="panel" aria-labelledby="tt-cim"><h2 id="tt-cim">Tételek</h2>' + tetelTabla(r) + '<p class="halvany" style="font-size:.85rem;margin:10px 0 0">Cím: ' + esc([r.vevo.irsz, r.vevo.telepules].join(' ') + ', ' + r.vevo.utca) + '</p></section>';
    if (r.allapot === 'Új') h += '<section class="panel" aria-labelledby="lm-cim"><h2 id="lm-cim">Lemondás</h2><p>Amíg nem küldtük ki a díjbekérőt, a rendelést itt díjmentesen lemondhatod.</p><button class="gomb gomb-keret" type="button" id="lemond-gomb">Rendelés lemondása</button><div class="figyelmezteto" id="lemond-doboz" hidden style="margin-top:12px"><p><b>Biztosan lemondod a(z) ' + esc(r.azon) + ' rendelést?</b> Ezt nem lehet visszavonni.</p><div class="sor"><button class="gomb gomb-fo" type="button" id="lemond-igen" style="background:var(--piros)">Igen, lemondom</button><button class="gomb gomb-keret" type="button" id="lemond-megse">Mégse</button></div></div></section>';
    h += '<div class="info-doboz">Mintaoldal: a rendelés csak ebben a böngészőben létezik. Kérdésed van? Hívj: ' + esc(CEG.telefon || '') + '</div>';
    $('#kovetes-eredmeny').innerHTML = h;
  }

  /* ---------- /dijbekero/ és /szamla/ – nyomtatható A4 bizonylat ---------- */
  // ÉLESBEN: Billingo API (díjbekérő, előlegszámla, végszámla + NAV Online Számla); ez csak minta-előnézet.
  function bizonylatOldal() {
    var el = $('#bizonylat'); if (!el) return;
    document.body.classList.add('bizonylat-oldal');
    $$('[data-nyomtat]').forEach(function (b) { b.addEventListener('click', function () { window.print(); }); });
    var tipus = el.getAttribute('data-bizonylat'), azon = new URLSearchParams(location.search).get('azon') || '';
    var r = rendelesek().filter(function (x) { return String(x.azon).toUpperCase() === azon.trim().toUpperCase(); })[0];
    if (!r) return;
    $('#bizonylat-vissza').href = '/rendeles/?azon=' + enc(r.azon) + '&email=' + enc(r.vevo.email);
    var afa = (HK.beall.afa || 27) / 100, fz = fizetes(r), dij = tipus === 'dijbekero', eloleg = dij && r.fizetes === 'eloleg';
    var sorszamAlap = String(r.azon).replace(/^HK-/, '');
    var sorszam = dij ? (r.dijbekero || 'DB-' + sorszamAlap) : (r.szamla || 'SZ-' + sorszamAlap);
    var kelte = dij ? r.ido : (naploIdo(r, 'Fizetve') || naploIdo(r, 'Szerelés kész') || new Date().toISOString());
    var telj = naploIdo(r, 'Szerelés kész') || kelte;
    var sorok = [];
    if (eloleg) sorok.push({ nev: 'Előleg a(z) ' + r.azon + ' rendeléshez (' + (HK.beall.elolegSzazalek || 30) + '%)', db: 1, brutto: r.eloleg });
    else {
      r.tetelek.forEach(function (t) { sorok.push({ nev: t.nev + (t.szerelt ? ' – szereléssel' : ''), reszlet: t.sorok && t.sorok.length > 1 ? t.sorok.map(function (s) { return s[0] + ' ' + ft(s[1]); }).join(' · ') : '', db: t.db, brutto: t.osszeg }); });
      (r.kedvezmenyek || []).forEach(function (k) { sorok.push({ nev: k[0], db: 1, brutto: k[1] }); });
      if (r.kiszallas) sorok.push({ nev: 'Kiszállási díj (' + r.vevo.telepules + ')', db: 1, brutto: r.kiszallas });
      if (r.szallitasDij) sorok.push({ nev: 'Szállítás futárral', db: 1, brutto: r.szallitasDij });
    }
    var ossz = { netto: 0, afa: 0, brutto: 0 };
    sorok.forEach(function (s) { s.netto = Math.round(s.brutto / (1 + afa)); s.afa = s.brutto - s.netto; ossz.netto += s.netto; ossz.afa += s.afa; ossz.brutto += s.brutto; });
    var v = r.vevo, cim = (CEG.jogiNev || CEG.nev);
    var h = '<div class="minta-pecset" aria-hidden="true">MINTA</div>' +
      '<p class="minta-sav"><b>MINTA – nem valós bizonylat.</b> Kitalált cég, demó adatok; élesben a Billingo állítja ki.</p>' +
      '<header class="bz-fej"><div><div class="bz-cegnev">' + esc(CEG.nev) + '</div><div class="halvany">' + esc(cim) + '</div></div><div class="bz-cim"><h1>' + (eloleg ? 'Előleg-díjbekérő' : dij ? 'Díjbekérő' : 'Számla') + '</h1><div>Sorszám: <b>' + esc(sorszam) + '</b></div>' + (dij ? '<div class="halvany" style="font-size:.8rem">Nem számla, számviteli bizonylatként nem használható.</div>' : '') + '</div></header>' +
      '<div class="bz-felek"><section><h2>Eladó</h2><p><b>' + esc(cim) + '</b><br>' + esc(CEG.cim || '') + '<br>Adószám: ' + esc(CEG.adoszam || '') + '<br>' + esc(CEG.cegjegyzek || '') + '<br>Bankszámla: ' + esc(CEG.bankszamla || '') + '<br>' + esc(CEG.email || '') + ' · ' + esc(CEG.telefon || '') + '</p></section>' +
      '<section><h2>Vevő</h2><p><b>' + esc(v.cegnev || v.nev) + '</b>' + (v.cegnev ? '<br>' + esc(v.nev) : '') + '<br>' + esc(v.irsz + ' ' + v.telepules + ', ' + v.utca) + (v.adoszam ? '<br>Adószám: ' + esc(v.adoszam) : '') + '<br>' + esc(v.email) + '</p></section></div>' +
      '<dl class="bz-datumok"><div><dt>Kelte</dt><dd>' + napDatum(kelte) + '</dd></div>' + (dij ? '<div><dt>Fizetési határidő</dt><dd>' + napDatum(napHozza(kelte, 8)) + '</dd></div>' : '<div><dt>Teljesítés</dt><dd>' + napDatum(telj) + '</dd></div><div><dt>Fizetési határidő</dt><dd>' + napDatum(kelte) + '</dd></div>') + '<div><dt>Fizetés módja</dt><dd>' + esc(UTALAS[r.fizetes] ? 'Átutalás' : r.fizetes === 'utanvet' ? 'Utánvét' : 'Készpénz') + '</dd></div><div><dt>Rendelésszám</dt><dd>' + esc(r.azon) + '</dd></div></dl>' +
      '<div class="tabla-burok"><table class="bz-tabla"><thead><tr><th scope="col">Megnevezés</th><th scope="col" class="szam">Menny.</th><th scope="col" class="szam">Nettó</th><th scope="col" class="szam">Áfa ' + Math.round(afa * 100) + '%</th><th scope="col" class="szam">Bruttó</th></tr></thead><tbody>' +
      sorok.map(function (s) { return '<tr><td>' + esc(s.nev) + (s.reszlet ? '<small>' + esc(s.reszlet) + '</small>' : '') + '</td><td class="szam">' + s.db + ' db</td><td class="szam">' + ft(s.netto) + '</td><td class="szam">' + ft(s.afa) + '</td><td class="szam">' + ft(s.brutto) + '</td></tr>'; }).join('') +
      '</tbody><tfoot><tr><th scope="row" colspan="2">Összesen</th><td class="szam">' + ft(ossz.netto) + '</td><td class="szam">' + ft(ossz.afa) + '</td><td class="szam"><b>' + ft(ossz.brutto) + '</b></td></tr></tfoot></table></div>';
    var fizetendo = ossz.brutto;
    if (!dij && r.fizetes === 'eloleg' && fz.elolegKesz) { fizetendo = ossz.brutto - r.eloleg; h += '<dl class="bz-osszeg"><div><dt>Előlegszámlán már kiszámlázva</dt><dd>−' + ft(r.eloleg) + '</dd></div></dl>'; }
    h += '<div class="bz-fizetendo"><span>' + (dij ? 'Fizetendő' : fz.teljes ? 'Fizetve' : 'Fizetendő') + '</span><b>' + ft(fizetendo) + '</b></div>';
    if (eloleg) h += '<p class="halvany" style="font-size:.85rem">A rendelés teljes összege ' + ft(r.osszesen) + '; a fennmaradó ' + ft(r.osszesen - r.eloleg) + '-ot a szerelés után fizeted. Az előleg beérkezése után előlegszámlát küldünk.</p>';
    if (dij || !fz.teljes) h += '<section class="bz-utalas"><h2>Átutalási adatok</h2><dl><div><dt>Kedvezményezett</dt><dd>' + esc(cim) + '</dd></div><div><dt>Bankszámlaszám</dt><dd>' + esc(CEG.bankszamla || '') + '</dd></div><div><dt>Összeg</dt><dd><b>' + ft(fizetendo) + '</b></dd></div><div><dt>Közlemény</dt><dd><b>' + esc(r.azon) + '</b></dd></div></dl></section>';
    h += '<footer class="bz-lab">Élesben ezt a bizonylatot a Billingo számlázó állítja ki és küldi emailben' + (dij ? '' : ', a NAV Online Számla rendszerbe bejelentve') + '. MINTA – nem valós bizonylat, nem fizetendő.</footer>';
    el.innerHTML = h;
    document.title = (eloleg ? 'Előleg-díjbekérő' : dij ? 'Díjbekérő' : 'Számla') + ' ' + sorszam + ' (MINTA)';
  }

  H.horog('oldal', function () {
    [jelolFejlec, fiokOldal, kovetesOldal, bizonylatOldal].forEach(function (f) { try { f(); } catch (e) { console.error('[fiok]', e); } });
  });
  H.horog('fiok-valtozott', jelolFejlec);
})();

/* ---- modul: igenyfelmeres ---- */
/* 3. ütem: igényfelmérés és foglalás (kalkulátor, multi-split, fotós felmérés, időpontfoglalás) */
(function () {
  'use strict';
  var H = window.HKApp; if (!H) return;
  var $ = H.$, $$ = H.$$, esc = H.esc, ft = H.ft, tar = H.tar;
  var HK = H.HK || {}; var A = H.A || {};

  /* ======================= Közös segédek ======================= */
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function datumStr(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); } // helyi idő szerint
  function datumBol(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  var NAPOK = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  var HONAPOK = ['január', 'február', 'március', 'április', 'május', 'június', 'július', 'augusztus', 'szeptember', 'október', 'november', 'december'];
  function datumSzoveg(s) { var d = datumBol(s); return d.getFullYear() + '. ' + HONAPOK[d.getMonth()] + ' ' + d.getDate() + '., ' + NAPOK[d.getDay()]; }
  function kwSzoveg(n) { return (Math.round(n * 10) / 10).toFixed(1).replace('.', ','); }
  function szam(v) { return parseFloat(String(v == null ? '' : v).replace(',', '.')); }

  function lekerdezes(nev) {
    try { var m = new RegExp('[?&]' + nev + '=([^&#]*)').exec(window.location.search); return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : ''; } catch (e) { return ''; }
  }

  // Elérhetőségi blokk olvasása és ellenőrzése: [data-kapcsolat] gyökér, [data-k] mezők. Hiba esetén null.
  function olvasKapcsolat(gyoker) {
    if (!gyoker) return null;
    var ok = true; var adat = {}; var elso = null;
    $$('[data-k]', gyoker).forEach(function (i) {
      var k = i.getAttribute('data-k'); var m = i.closest('.mezo'); var jo = true;
      if (i.type === 'checkbox') { jo = i.checked; adat[k] = i.checked; }
      else {
        var v = String(i.value || '').trim(); adat[k] = v;
        if (i.required && !v) jo = false;
        else if (k === 'email' && v) jo = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
        else if (k === 'tel' && v) jo = /^[+0-9\s\-()\/]{7,}$/.test(v) && v.replace(/\D/g, '').length >= 7;
      }
      if (m) m.classList.toggle('hibas', !jo);
      if (!jo) { ok = false; if (!elso) elso = i; }
    });
    if (!ok) { if (elso) { try { elso.focus(); } catch (e) { } } return null; }
    return adat;
  }

  // Ajánlatkérés mentése a hk_ajanlatkeresek-be (ha a fotók miatt nem fér el, fotó nélkül próbálja újra)
  function ajanlatMent(tipus, adatok, fotok, k) {
    var ak = { azon: H.azon('AK'), ido: new Date().toISOString(), tipus: tipus, adatok: adatok, fotok: fotok || [], nev: k.nev, tel: k.tel, email: k.email, telepules: k.telepules, allapot: 'Új' };
    var kulcs = 'hk_ajanlatkeresek';
    function proba() { var l = tar.get(kulcs, []); l.push(ak); tar.set(kulcs, l); return tar.get(kulcs, []).some(function (x) { return x.azon === ak.azon; }); }
    if (!proba()) {
      if (ak.fotok.length) { ak.fotok = []; ak.adatok.fotoMegjegyzes = 'A fotók nem fértek el a böngésző tárhelyén.'; if (!proba()) return null; ak.kevesFotoHelyi = true; }
      else return null;
    }
    H.fut('ajanlatkeres-mentve', ak);
    if (H.level) { try { H.level('ajanlatkeres-visszaigazolas', { ajanlatkeres: ak }); } catch (e) { console.error(e); } }
    return ak;
  }

  // Sikeres ajánlatkérés nézete: azonosító + felmérés-időpont felajánlása
  function ajanlatSiker(ak, cim, szoveg) {
    return '<div class="siker-doboz ig-siker" role="status"><div class="ig-pipa" aria-hidden="true">✓</div><h2>' + esc(cim) + '</h2>' +
      '<p>' + szoveg + '</p><p><b>Azonosító: ' + esc(ak.azon) + '</b></p>' +
      '<p class="halvany">Mintaoldal: az ajánlatkérés csak a böngésződben tárolódik; a visszaigazoló levelet a Postafiók oldalon nézheted meg.</p>' +
      '<div class="sor" style="justify-content:center"><a class="gomb gomb-fo" href="/idopont/?tipus=felmeres&amp;ak=' + encodeURIComponent(ak.azon) + '">Helyszíni felmérés időpontja</a><a class="gomb gomb-keret" href="/klimak/">Vissza a klímákhoz</a></div></div>';
  }

  /* ======================= Kalkulátor ======================= */
  var TIPUS_F = { nappali: 1.0, halo: 0.9, gyerek: 0.95, iroda: 1.15, konyha: 1.2, tetoter: 1.05 };
  var TIPUS_N = { nappali: 'Nappali', halo: 'Hálószoba', gyerek: 'Gyerekszoba', iroda: 'Iroda', konyha: 'Konyha-étkező', tetoter: 'Tetőtéri helyiség' };
  var TAJ_F = { eszak: 0.9, kelet: 1.0, nyugat: 1.1, del: 1.15 };
  var UVEG_F = { 'kevés': 0.95, 'közepes': 1.0, 'sok': 1.15 };
  var SZIG_F = { 'jó': 0.9, 'közepes': 1.0, 'gyenge': 1.15 };
  var SZIG_FUTES = { 'jó': 0.8, 'közepes': 1.0, 'gyenge': 1.3 };
  var ALAP_W = 100; // W/m² (2,7 m belmagasság mellett) – becslés

  // b: {tipus, m2, mag, taj, uveg, szig, teto, futes} → {hut (kW), fut (kW)}
  function kwSzamit(b) {
    var m2 = Math.max(5, Math.min(150, b.m2)); var mag = Math.max(2.2, Math.min(4.5, b.mag || 2.7));
    var terf = mag / 2.7;
    var hut = m2 * ALAP_W / 1000 * terf * (TIPUS_F[b.tipus] || 1) * (TAJ_F[b.taj] || 1) * (UVEG_F[b.uveg] || 1) * (SZIG_F[b.szig] || 1) * (b.teto ? 1.15 : 1);
    var fut = m2 * 0.07 * terf * (SZIG_FUTES[b.szig] || 1) * (b.teto ? 1.1 : 1);
    return { hut: Math.round(hut * 10) / 10, fut: Math.round(fut * 10) / 10 };
  }

  // A legkisebb elég erős oldalfali klímák (3–6 db). igeny: kW hűtés; futes: kW fűtés (vagy 0)
  function ajanl(termekek, igeny, futes) {
    var oldalfali = termekek.filter(function (t) { return t.kat !== 'multi'; });
    var jo = oldalfali.filter(function (t) { return t.kw >= igeny * 0.95 && (!futes || !t.kwf || t.kwf >= futes * 0.95); });
    var rend = function (a, b) { return a.kw - b.kw || a.ar - b.ar; };
    jo.sort(rend);
    if (!jo.length) return { lista: oldalfali.slice().sort(function (a, b) { return b.kw - a.kw || a.ar - b.ar; }).slice(0, 3), tulNagy: true };
    var min = jo[0].kw;
    var kozel = jo.filter(function (t) { return t.kw <= min + 1.2; });
    if (kozel.length < 3) kozel = jo.slice(0, 3);
    return { lista: kozel.slice(0, 6), tulNagy: false };
  }

  function kalkulator() {
    var urlap = $('#kalk-urlap'); if (!urlap) return;
    var eredm = $('#kalk-eredmeny'), ajSzekcio = $('#kalk-ajanlat'), kartyak = $('#kalk-kartyak');
    var utolso = null;
    var mezok = { tipus: $('#k-tipus'), m2: $('#k-m2'), mag: $('#k-mag'), taj: $('#k-taj'), uveg: $('#k-uveg'), szig: $('#k-szig'), teto: $('#k-teto'), futes: $('#k-futes') };

    function olvas() {
      return { tipus: mezok.tipus.value, m2: szam(mezok.m2.value), mag: szam(mezok.mag.value), taj: mezok.taj.value, uveg: mezok.uveg.value, szig: mezok.szig.value, teto: mezok.teto.checked, futes: mezok.futes.checked };
    }
    function jelzes(mezo, hibas) { var m = mezo.closest('.mezo'); if (m) m.classList.toggle('hibas', hibas); return !hibas; }

    function frissit() {
      var b = olvas();
      var jo1 = jelzes(mezok.m2, !(b.m2 >= 5 && b.m2 <= 150));
      var jo2 = jelzes(mezok.mag, !(b.mag >= 2.2 && b.mag <= 4.5));
      if (!jo1 || !jo2) {
        utolso = null; ajSzekcio.hidden = true;
        eredm.innerHTML = '<h2 id="kalk-eredmeny-cim">Becsült igény</h2><p class="halvany">Adj meg érvényes alapterületet és belmagasságot.</p>';
        return;
      }
      var k = kwSzamit(b);
      var a = ajanl(HK.termekek || [], k.hut, b.futes ? k.fut : 0);
      utolso = { b: b, hut: k.hut, fut: b.futes ? k.fut : 0, ajanlott: a.lista.map(function (t) { return t.id; }) };
      var tippek = [];
      if (b.taj === 'del' || b.taj === 'nyugat') tippek.push('A ' + (b.taj === 'del' ? 'déli' : 'nyugati') + ' tájolás miatt több a napsugárzás – külső árnyékolóval (redőny, reluxa) csökkenthető az igény.');
      if (b.teto) tippek.push('Tetőtérben vagy legfelső emeleten a tető felől is hőt kap a helyiség, ezért számoltunk rá felárat.');
      if (b.szig === 'gyenge') tippek.push('Gyenge szigetelésnél a klíma sokat dolgozik; a nyílászárók cseréje vagy a homlokzati szigetelés megtérül.');
      eredm.innerHTML = '<h2 id="kalk-eredmeny-cim">Becsült igény</h2>' +
        '<div class="ig-nagy" role="status">' + kwSzoveg(k.hut) + ' <small>kW hűtés</small></div>' +
        '<dl><dt>Alapterület</dt><dd>' + esc(String(Math.round(b.m2 * 10) / 10).replace('.', ',')) + ' m²</dd>' +
        '<dt>Belmagasság</dt><dd>' + esc(String(b.mag).replace('.', ',')) + ' m</dd>' +
        (b.futes ? '<dt>Fűtési igény</dt><dd>~' + kwSzoveg(k.fut) + ' kW</dd>' : '') +
        '<dt>Ajánlott méret</dt><dd>min. ' + kwSzoveg(k.hut) + ' kW</dd></dl>' +
        (tippek.length ? '<ul class="elony-lista" style="margin:0 0 14px">' + tippek.map(function (t) { return '<li><span>' + esc(t) + '</span></li>'; }).join('') + '</ul>' : '') +
        '<p class="halvany" style="font-size:.85rem">Becslés, a pontos méretezés felméréssel. A számítás ~' + ALAP_W + ' W/m²-ből indul, szorzókkal.</p>' +
        '<a class="gomb gomb-fo gomb-teli" href="#kalk-ajanlat">Ajánlott klímák</a>' +
        '<p style="margin:12px 0 0" class="kozep"><a href="/multi-split/">Több szobám van →</a></p>';
      // kártyák
      $('#kalk-ajanlat-leiras').textContent = a.tulNagy
        ? 'Ekkora igényhez egyetlen oldalfali klíma kevés lehet: ezek a legerősebb készülékeink. Nagy térnél multi-split vagy felmérés javasolt.'
        : 'A legkisebb, még elég erős oldalfali készülékek' + (b.futes ? ' (fűtésre is megfelelők)' : '') + ' – szereléssel együtt kérhetők.';
      kartyak.innerHTML = a.lista.map(function (t) {
        var szer = H.szerelesAlap(t.kw);
        return '<article class="kartya ig-termek"><div class="tkartya-marka">' + esc(t.marka) + '</div><h3><a href="' + esc(t.url) + '">' + esc(t.nev) + '</a></h3>' +
          '<ul class="tkartya-adatok"><li><b>' + kwSzoveg(t.kw) + ' kW</b> hűtés</li>' + (t.kwf ? '<li>' + kwSzoveg(t.kwf) + ' kW fűtés</li>' : '') + (t.m2 ? '<li>' + esc(t.m2) + '</li>' : '') + (t.seer ? '<li>SEER <b>' + String(t.seer).replace('.', ',') + '</b></li>' : '') + '</ul>' +
          '<div class="ar">' + ft(t.ar) + '<small>szereléssel: ' + ft(t.ar + szer) + '</small></div>' +
          '<div class="sor"><button class="gomb gomb-fo gomb-kicsi" type="button" data-ig-kosar="' + esc(t.id) + '">Kosárba szereléssel</button><a class="gomb gomb-keret gomb-kicsi" href="' + esc(t.url) + '">Részletek</a></div></article>';
      }).join('');
      ajSzekcio.hidden = false;
    }

    mezok.tipus.addEventListener('change', function () { if (mezok.tipus.value === 'tetoter') mezok.teto.checked = true; });
    urlap.addEventListener('input', frissit); urlap.addEventListener('change', frissit);
    urlap.addEventListener('submit', function (e) { e.preventDefault(); });

    kartyak.addEventListener('click', function (e) {
      var g = e.target.closest('[data-ig-kosar]'); if (!g) return;
      H.Kosar.hozzaad({ t: 'k', id: g.getAttribute('data-ig-kosar'), db: 1, sz: true, m: 0, ko: false, sp: false });
      H.frissitJelvenyek();
      H.toast('A klíma szereléssel a kosárba került. <a href="/kosar/">Kosár megnyitása</a>');
    });

    $('#kalk-ajanlat-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); if (!utolso) return;
      var k = olvasKapcsolat($('[data-kapcsolat="ka"]')); if (!k) return;
      var ak = ajanlatMent('kalkulator', { bemenet: utolso.b, hutesiIgenyKw: utolso.hut, futesiIgenyKw: utolso.fut, ajanlottTermekek: utolso.ajanlott }, [], k);
      var doboz = $('#kalk-ajanlatkeres');
      if (!ak) { H.toast('Nem sikerült menteni (a böngésző tárhelye tele van?).'); return; }
      doboz.innerHTML = ajanlatSiker(ak, 'Megkaptuk az ajánlatkérésed!', 'A számításod alapján 1 munkanapon belül fix árral jelentkezünk. Ha szeretnéd, a helyszíni felmérésre most le is foglalhatsz egy időpontot.');
    });
    frissit();
  }

  /* ======================= Multi-split ======================= */
  var BELTERI_MERET = [2.0, 2.5, 3.5, 5.0, 7.0];
  var BELTERI_AR = { '2': 94900, '2.5': 102900, '3.5': 118900, '5': 146900, '7': 189900 }; // MINTA árak
  function beltMeret(igeny) {
    for (var i = 0; i < BELTERI_MERET.length; i++) if (BELTERI_MERET[i] >= igeny * 0.95) return BELTERI_MERET[i];
    return BELTERI_MERET[BELTERI_MERET.length - 1];
  }
  function arKerekit(n, fel) { return (fel ? Math.ceil(n / 10000) : Math.floor(n / 10000)) * 10000; }

  // szobak: [{tipus, m2}]. Visszaadja a beltéri méreteket, a kültéri egységet és az ársávot.
  function multiSzamit(szobak, szig, teto, termekek, multiMax, arak) {
    var r = { szobak: [], ossz: 0, kulteri: null, ar: null, ok: false, ok_szoveg: '' };
    szobak.forEach(function (s) {
      var igeny = kwSzamit({ tipus: s.tipus, m2: s.m2, mag: 2.7, taj: 'kelet', uveg: 'közepes', szig: szig, teto: teto, futes: false }).hut;
      var bm = beltMeret(igeny);
      r.szobak.push({ tipus: s.tipus, m2: s.m2, igenyKw: igeny, belteriKw: bm }); r.ossz += bm;
    });
    r.ossz = Math.round(r.ossz * 10) / 10;
    var db = szobak.length;
    var multik = termekek.filter(function (t) { return t.kat === 'multi'; });
    var jok = multik.filter(function (t) { return (multiMax[t.id] || 3) >= db && t.kw >= r.ossz * 0.75; }).sort(function (a, b) { return a.ar - b.ar || a.kw - b.kw; });
    if (jok.length) {
      r.kulteri = jok[0]; r.ok = true;
      var beltAr = r.szobak.reduce(function (s, x) { return s + (BELTERI_AR[String(x.belteriKw)] || 120000); }, 0);
      var szer = (arak.alap_szereles_5_7kw || 99900) + (db - 1) * Math.round((arak.alap_szereles_25_35kw || 79900) * 0.85 / 100) * 100;
      var kozep = r.kulteri.ar + beltAr + szer;
      r.ar = { lo: arKerekit(kozep * 0.95, false), hi: arKerekit(kozep * 1.2, true), beltAr: beltAr, szereles: szer };
    } else {
      var legnagyobb = multik.reduce(function (m, t) { return Math.max(m, multiMax[t.id] || 3); }, 0);
      r.ok_szoveg = db > legnagyobb
        ? 'A mintakínálat kültéri egységei legfeljebb ' + legnagyobb + ' beltérit bírnak. ' + db + ' helyiséghez két rendszer vagy nagyobb multi kell – felméréssel tervezzük meg.'
        : 'A beltéri egységek együttes teljesítménye (' + kwSzoveg(r.ossz) + ' kW) meghaladja a mintakínálat kültéri egységeit. Két rendszerre bontással vagy nagyobb multival oldjuk meg – felméréssel.';
    }
    return r;
  }

  function multi() {
    var gyoker = $('#ig-multi'); if (!gyoker) return;
    var szobaDiv = $('#mu-szobak'), eredm = $('#mu-eredmeny');
    var alapTipus = ['nappali', 'halo', 'gyerek', 'iroda', 'konyha']; var alapM2 = [26, 14, 12, 15, 12];
    var szobak = [{ tipus: alapTipus[0], m2: alapM2[0] }, { tipus: alapTipus[1], m2: alapM2[1] }];
    var utolso = null;

    function tipusOpc(ert) { return Object.keys(TIPUS_N).map(function (k) { return '<option value="' + k + '"' + (k === ert ? ' selected' : '') + '>' + TIPUS_N[k] + '</option>'; }).join(''); }
    function szobakRajz() {
      szobaDiv.innerHTML = szobak.map(function (s, i) {
        return '<fieldset class="ig-szoba" data-i="' + i + '"><legend>' + (i + 1) + '. helyiség</legend>' +
          '<div class="mezo"><label for="mu-t' + i + '">Típus</label><select id="mu-t' + i + '" data-mu-tipus style="width:100%">' + tipusOpc(s.tipus) + '</select></div>' +
          '<div class="mezo"><label for="mu-m' + i + '">Alapterület (m²)</label><input id="mu-m' + i + '" data-mu-m2 type="number" min="5" max="150" step="1" value="' + s.m2 + '" inputmode="decimal"><div class="hiba-uzenet">5 és 150 m² között.</div></div></fieldset>';
      }).join('');
    }
    function frissit() {
      var jo = szobak.every(function (s) { return s.m2 >= 5 && s.m2 <= 150; });
      if (!jo) { utolso = null; eredm.innerHTML = '<h2 id="mu-eredmeny-cim">Javaslat</h2><p class="halvany">Minden helyiséghez adj meg 5 és 150 m² közötti alapterületet.</p>'; return; }
      var r = multiSzamit(szobak, $('#mu-szig').value, $('#mu-teto').checked, HK.termekek || [], HK.multiMax || {}, A);
      utolso = r;
      var h = '<h2 id="mu-eredmeny-cim">Javaslat</h2><table class="adat-tabla ig-tabla"><thead><tr><th scope="col">Helyiség</th><th scope="col">Igény</th><th scope="col">Beltéri</th></tr></thead><tbody>' +
        r.szobak.map(function (s, i) { return '<tr><td>' + (i + 1) + '. ' + esc(TIPUS_N[s.tipus]) + ' (' + s.m2 + ' m²)</td><td>' + kwSzoveg(s.igenyKw) + ' kW</td><td><b>' + kwSzoveg(s.belteriKw) + ' kW</b></td></tr>'; }).join('') +
        '</tbody></table>';
      h += '<dl style="margin-top:12px"><dt>Beltéri egységek összesen</dt><dd>' + kwSzoveg(r.ossz) + ' kW</dd></dl>';
      if (r.ok) {
        h += '<div class="ig-kulteri"><div class="tkartya-marka">Javasolt kültéri egység</div><b><a href="' + esc(r.kulteri.url) + '">' + esc(r.kulteri.nev) + '</a></b>' +
          '<div class="halvany" style="font-size:.88rem">' + kwSzoveg(r.kulteri.kw) + ' kW, legfeljebb ' + ((HK.multiMax || {})[r.kulteri.id] || 3) + ' beltérihez · ' + ft(r.kulteri.ar) + '</div></div>' +
          '<div class="ig-arsav"><span class="halvany">Tájékoztató ársáv (szereléssel)</span><div class="ar">' + ft(r.ar.lo) + ' – ' + ft(r.ar.hi) + '</div></div>' +
          '<p class="halvany" style="font-size:.82rem;margin:8px 0 12px">Minta számítás: kültéri egység + ' + r.szobak.length + ' beltéri (mintaár) + szerelés. A fix árat a felmérés után adjuk.</p>';
      } else {
        h += '<div class="figyelmezteto" role="note" style="margin:12px 0">' + esc(r.ok_szoveg) + '</div>';
      }
      h += '<a class="gomb gomb-fo gomb-teli" href="#mu-ajanlat">Ajánlatot és felmérést kérek</a>' +
        '<p class="halvany" style="font-size:.82rem;margin:10px 0 0">Becslés, a pontos méretezés felméréssel. Multi-splitnél a felmérés kötelező.</p>';
      eredm.innerHTML = h;
    }
    szobaDiv.addEventListener('input', function (e) {
      var f = e.target.closest('.ig-szoba'); if (!f) return; var i = +f.getAttribute('data-i');
      if (e.target.hasAttribute('data-mu-m2')) { szobak[i].m2 = szam(e.target.value); var m = e.target.closest('.mezo'); m.classList.toggle('hibas', !(szobak[i].m2 >= 5 && szobak[i].m2 <= 150)); }
      if (e.target.hasAttribute('data-mu-tipus')) szobak[i].tipus = e.target.value;
      frissit();
    });
    $('#mu-db').addEventListener('change', function () {
      var n = +this.value;
      while (szobak.length < n) { var i = szobak.length; szobak.push({ tipus: alapTipus[i] || 'nappali', m2: alapM2[i] || 15 }); }
      while (szobak.length > n) szobak.pop();
      szobakRajz(); frissit();
    });
    $('#mu-szig').addEventListener('change', frissit); $('#mu-teto').addEventListener('change', frissit);
    $('#multi-urlap').addEventListener('submit', function (e) { e.preventDefault(); });
    $('#mu-ajanlat-urlap').addEventListener('submit', function (e) {
      e.preventDefault(); if (!utolso) { H.toast('Előbb add meg a helyiségeket.'); return; }
      var k = olvasKapcsolat($('[data-kapcsolat="mu"]')); if (!k) return;
      var ak = ajanlatMent('multi', { helyisegek: utolso.szobak, szigeteles: $('#mu-szig').value, legfelsoEmelet: $('#mu-teto').checked, beltereiOsszKw: utolso.ossz, kulteri: utolso.kulteri ? utolso.kulteri.id : null, arsav: utolso.ar ? [utolso.ar.lo, utolso.ar.hi] : null, felmeresKotelezo: true }, [], k);
      if (!ak) { H.toast('Nem sikerült menteni (a böngésző tárhelye tele van?).'); return; }
      $('#mu-ajanlat .panel').innerHTML = ajanlatSiker(ak, 'Megkaptuk a multi-split ajánlatkérésed!', 'Multi-splitnél helyszíni felmérés kell a fix árhoz – foglalj egy időpontot, mi pedig 1 munkanapon belül jelentkezünk.');
    });
    szobakRajz(); frissit();
  }

  /* ======================= Fotós felmérés ======================= */
  function kicsinit(file, cb) {
    var url; try { url = (window.URL || window.webkitURL).createObjectURL(file); } catch (e) { cb(null); return; }
    var img = new Image();
    img.onload = function () {
      var max = 800, w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
      var s = Math.min(1, max / Math.max(w, h)); var c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(w * s)); c.height = Math.max(1, Math.round(h * s));
      var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
      try { (window.URL || window.webkitURL).revokeObjectURL(url); } catch (e) { }
      var d = null; try { d = c.toDataURL('image/jpeg', 0.7); } catch (e) { }
      cb(d);
    };
    img.onerror = function () { try { (window.URL || window.webkitURL).revokeObjectURL(url); } catch (e) { } cb(null); };
    img.src = url;
  }

  function felmeres() {
    var urlap = $('#felmeres-urlap'); if (!urlap) return;
    var fotok = {}; // kulcs → {dataUrl, cimke}
    var hibaDoboz = $('#fm-foto-hiba');
    $$('.ig-foto', urlap).forEach(function (kartya) {
      var kulcs = kartya.getAttribute('data-foto'); var inp = $('[data-foto-input]', kartya);
      var kepDiv = $('[data-foto-kep]', kartya), torol = $('[data-foto-torol]', kartya), szoveg = $('[data-foto-szoveg]', kartya);
      var cimke = $('.ig-foto-fej b', kartya).textContent.replace(/^\d+\.\s*/, '');
      function mutat(d) {
        if (d) { kepDiv.innerHTML = '<img alt="Előnézet: ' + esc(cimke) + '" src="' + d + '">'; kepDiv.hidden = false; torol.hidden = false; szoveg.textContent = 'Másik kép'; }
        else { kepDiv.innerHTML = ''; kepDiv.hidden = true; torol.hidden = true; szoveg.textContent = 'Kép kiválasztása'; inp.value = ''; }
      }
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0]; hibaDoboz.hidden = true; if (!f) return;
        if (!/^image\//.test(f.type)) { hibaDoboz.textContent = 'Csak képfájlt (JPG, PNG) tölthetsz fel.'; hibaDoboz.hidden = false; inp.value = ''; return; }
        szoveg.textContent = 'Feldolgozás…';
        kicsinit(f, function (d) {
          if (!d) { hibaDoboz.textContent = 'A képet nem sikerült feldolgozni. Próbálj másikat.'; hibaDoboz.hidden = false; mutat(fotok[kulcs] ? fotok[kulcs].d : null); return; }
          fotok[kulcs] = { d: d, cimke: cimke }; mutat(d);
        });
      });
      torol.addEventListener('click', function () { delete fotok[kulcs]; mutat(null); });
    });

    urlap.addEventListener('submit', function (e) {
      e.preventDefault(); var hiba = $('#fm-hiba'); hiba.hidden = true;
      var k = olvasKapcsolat($('[data-kapcsolat="fm"]')); if (!k) { hiba.textContent = 'Kérjük, javítsd a pirossal jelölt mezőket.'; hiba.hidden = false; return; }
      var kulcsok = Object.keys(fotok).slice(0, 4);
      var ak = ajanlatMent('felmeres', { cim: k.cim, mit: $('#fm-mit').value, megj: $('#fm-megj').value.trim(), fotoCimkek: kulcsok.map(function (x) { return fotok[x].cimke; }) }, kulcsok.map(function (x) { return fotok[x].d; }), k);
      if (!ak) { hiba.textContent = 'Nem sikerült menteni: a fotók túl sok helyet foglalnak. Próbáld kevesebb fotóval.'; hiba.hidden = false; return; }
      urlap.hidden = true;
      var s = $('#fm-siker'); s.hidden = false;
      s.innerHTML = ajanlatSiker(ak, 'Megkaptuk a felmérési kérésed!', (ak.fotok.length ? ak.fotok.length + ' fotót mentettünk. ' : '') + 'A fotók alapján 1 munkanapon belül jelentkezünk. A pontos árhoz helyszíni felmérést is foglalhatsz.');
      if (ak.kevesFotoHelyi) s.insertAdjacentHTML('afterbegin', '<div class="figyelmezteto" role="alert" style="margin-bottom:14px">A fotók nem fértek el a böngésző tárhelyén, ezért nélkülük mentettük a kérést.</div>');
      try { s.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e2) { }
    });
  }

  /* ======================= Időpontfoglalás ======================= */
  var SAV1 = '8\u201312', SAV2 = '12\u201316', KAP = 2;
  // Magyar munkaszüneti napok 2026–2027 (MINTA: élesítés előtt a hivatalos rendelettel egyeztetni; áthelyezett munkanapokat nem kezelünk)
  var UNNEPEK = {
    '2026-01-01': 'Újév', '2026-01-02': 'Pihenőnap', '2026-04-03': 'Nagypéntek', '2026-04-06': 'Húsvéthétfő', '2026-05-01': 'A munka ünnepe', '2026-05-25': 'Pünkösdhétfő',
    '2026-08-20': 'Államalapítás ünnepe', '2026-08-21': 'Pihenőnap', '2026-10-23': '1956-os forradalom ünnepe', '2026-11-01': 'Mindenszentek', '2026-12-24': 'Szenteste', '2026-12-25': 'Karácsony', '2026-12-26': 'Karácsony másnapja',
    '2027-01-01': 'Újév', '2027-03-15': 'Nemzeti ünnep', '2027-03-26': 'Nagypéntek', '2027-03-29': 'Húsvéthétfő', '2027-05-01': 'A munka ünnepe', '2027-05-17': 'Pünkösdhétfő',
    '2027-08-20': 'Államalapítás ünnepe', '2027-10-23': '1956-os forradalom ünnepe', '2027-11-01': 'Mindenszentek', '2027-12-24': 'Szenteste', '2027-12-25': 'Karácsony', '2027-12-26': 'Karácsony másnapja'
  };
  function unnepe(s) { return UNNEPEK[s] || ''; }
  window.HKApp.unnepnap = unnepe; // 'YYYY-MM-DD' → ünnep neve vagy '' (a levelek modul munkanap-számításához)
  function munkanap(d) { var n = d.getDay(); return n >= 1 && n <= 5 && !unnepe(datumStr(d)); }

  // A következő 4 hét (holnaptól 28 napig) napjai: [{datum, d, munkanap, unnep}] – hétvégék nélkül
  function naptarNapok(ma) {
    var ki = []; var e = ma.getFullYear(), h = ma.getMonth(), n = ma.getDate();
    for (var i = 1; i <= 28; i++) {
      var d = new Date(e, h, n + i); var w = d.getDay(); if (w === 0 || w === 6) continue;
      var s = datumStr(d); ki.push({ datum: s, d: d, munkanap: !unnepe(s), unnep: unnepe(s) });
    }
    return ki;
  }
  function savNorm(s) { return String(s || '').replace(/\s/g, '').replace(/[\u2010-\u2015\-]/g, '\u2013'); }
  // Kitalált alap-foglaltság (demóhoz, determinisztikus): 0, 1 vagy 2 foglalt hely
  function alapFoglalt(datum, sav) {
    var s = datum + sav, h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 4294967296;
    var m = h % 9; return m === 0 ? 2 : (m <= 2 ? 1 : 0);
  }
  // Foglalt helyek száma egy sávban (a szerelés mindkét sávot foglalja)
  function foglalt(foglalasok, datum, sav) {
    var db = alapFoglalt(datum, sav);
    foglalasok.forEach(function (f) {
      if (f.allapot === 'Lemondva' || f.datum !== datum) return;
      if (f.tipus === 'szereles' || savNorm(f.sav) === sav) db++;
    });
    return db;
  }
  function szabad(foglalasok, datum, sav) { return Math.max(0, KAP - foglalt(foglalasok, datum, sav)); }
  function szabadNap(foglalasok, datum, tipus) { // tipus szerelés: a teljes nap 1 helyet kér mindkét sávban
    if (tipus === 'szereles') return szabad(foglalasok, datum, SAV1) > 0 && szabad(foglalasok, datum, SAV2) > 0;
    return szabad(foglalasok, datum, SAV1) > 0 || szabad(foglalasok, datum, SAV2) > 0;
  }

  var TIPUS_NEV = { felmeres: 'Helyszíni felmérés', szereles: 'Klímaszerelés', tisztitas: 'Klímatisztítás', javitas: 'Hibafeltárás, javítás' };

  function icsSzoveg(s) { return String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n'); }
  function icsKeszit(f) {
    var nap = f.datum.replace(/-/g, ''); var kezd, veg;
    if (f.tipus === 'szereles') { kezd = '080000'; veg = '160000'; } else if (savNorm(f.sav) === SAV2) { kezd = '120000'; veg = '160000'; } else { kezd = '080000'; veg = '120000'; }
    var most = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
    var ceg = (HK.ceg && HK.ceg.nev) || 'Klímaszerelés';
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//' + icsSzoveg(ceg) + '//Idopont minta//HU', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
      'UID:' + f.azon + '@klima-minta', 'DTSTAMP:' + most, 'DTSTART:' + nap + 'T' + kezd, 'DTEND:' + nap + 'T' + veg,
      'SUMMARY:' + icsSzoveg(ceg + ' – ' + (TIPUS_NEV[f.tipus] || 'időpont')), 'LOCATION:' + icsSzoveg((f.cim ? f.cim + ', ' : '') + f.telepules),
      'DESCRIPTION:' + icsSzoveg('Azonosító: ' + f.azon + (f.rendeles ? '\nRendelés: ' + f.rendeles : '') + '\nMintafoglalás – kitalált cég.'),
      'BEGIN:VALARM', 'TRIGGER:-PT12H', 'ACTION:DISPLAY', 'DESCRIPTION:Holnapi klímás időpont', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n') + '\r\n';
  }
  function icsLetolt(f) {
    var blob = new Blob([icsKeszit(f)], { type: 'text/calendar;charset=utf-8' });
    var url = (window.URL || window.webkitURL).createObjectURL(blob);
    var a = document.createElement('a'); a.href = url; a.download = 'idopont-' + f.azon + '.ics'; document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); (window.URL || window.webkitURL).revokeObjectURL(url); }, 500);
  }

  function idopont() {
    var urlap = $('#idopont-urlap'); if (!urlap) return;
    var naptar = $('#id-naptar'), kiv = $('#id-kivalasztott'), surgos = $('#id-surgos');
    var foglalasok = tar.get('hk_foglalasok', []);
    var napok = naptarNapok(new Date());
    var valasztott = null; // {datum, sav}
    var rendelesAzon = lekerdezes('rendeles'), akAzon = lekerdezes('ak');
    var rendeles = null, ak = null;

    if (rendelesAzon) { rendeles = tar.get('hk_rendelesek', []).filter(function (r) { return r.azon === rendelesAzon; })[0] || null; }
    if (akAzon) { ak = tar.get('hk_ajanlatkeresek', []).filter(function (r) { return r.azon === akAzon; })[0] || null; }

    function tipus() { var c = $('input[name="tipus"]:checked', urlap); return c ? c.value : 'szereles'; }
    function setTipus(t) { var c = $('input[name="tipus"][value="' + t + '"]', urlap); if (c) c.checked = true; }

    function rajz() {
      var t = tipus(); var egesz = t === 'szereles'; var hetek = []; var akt = null;
      napok.forEach(function (n) {
        var hetfo = new Date(n.d.getFullYear(), n.d.getMonth(), n.d.getDate() - ((n.d.getDay() + 6) % 7)); var kulcs = datumStr(hetfo);
        if (!akt || akt.kulcs !== kulcs) { akt = { kulcs: kulcs, hetfo: hetfo, napok: [] }; hetek.push(akt); }
        akt.napok.push(n);
      });
      naptar.innerHTML = hetek.map(function (het) {
        var utolso = het.napok[het.napok.length - 1].d; var elso = het.napok[0].d;
        var cim = HONAPOK[elso.getMonth()] + ' ' + elso.getDate() + '. – ' + (utolso.getMonth() !== elso.getMonth() ? HONAPOK[utolso.getMonth()] + ' ' : '') + utolso.getDate() + '.';
        return '<div class="ig-het-cim">' + esc(cim) + '</div><div class="ig-het" role="group" aria-label="' + esc(cim) + '">' + het.napok.map(function (n) {
          var oszlop = ((n.d.getDay() + 6) % 7) + 1;
          var fej = '<div class="ig-nap-fej"><b>' + NAPOK[n.d.getDay()].replace(/^./, function (c) { return c.toUpperCase(); }) + '</b><span>' + n.d.getDate() + '.</span></div>';
          if (!n.munkanap) return '<div class="ig-nap ig-nap-unnep" style="--oszlop:' + oszlop + '">' + fej + '<div class="ig-unnep">' + esc(n.unnep) + '<br><small>munkaszüneti nap</small></div></div>';
          var gombok;
          if (egesz) {
            var ok = szabadNap(foglalasok, n.datum, 'szereles'); var kij = valasztott && valasztott.datum === n.datum;
            gombok = '<button type="button" class="ig-sav ig-sav-nagy" data-datum="' + n.datum + '" data-sav="' + SAV1 + '" aria-pressed="' + (kij ? 'true' : 'false') + '"' + (ok ? '' : ' disabled') + ' aria-label="' + esc(datumSzoveg(n.datum)) + ', egész nap (8–16)' + (ok ? '' : ', foglalt') + '">Egész nap<small>' + (ok ? '8–16' : 'foglalt') + '</small></button>';
          } else {
            gombok = [SAV1, SAV2].map(function (sv) {
              var sz = szabad(foglalasok, n.datum, sv); var kij = valasztott && valasztott.datum === n.datum && valasztott.sav === sv;
              return '<button type="button" class="ig-sav" data-datum="' + n.datum + '" data-sav="' + sv + '" aria-pressed="' + (kij ? 'true' : 'false') + '"' + (sz ? '' : ' disabled') + ' aria-label="' + esc(datumSzoveg(n.datum)) + ', ' + sv + ' óra' + (sz ? '' : ', foglalt') + '">' + sv + '<small>' + (sz ? (sz === 1 ? '1 hely' : 'szabad') : 'foglalt') + '</small></button>';
            }).join('');
          }
          return '<div class="ig-nap" style="--oszlop:' + oszlop + '">' + fej + '<div class="ig-savok">' + gombok + '</div></div>';
        }).join('') + '</div>';
      }).join('');
      kivJelez();
    }
    function kivJelez() {
      if (!valasztott) { kiv.innerHTML = 'Még nem választottál időpontot.'; return; }
      var egesz = tipus() === 'szereles';
      kiv.innerHTML = 'Választott időpont: <b>' + esc(datumSzoveg(valasztott.datum)) + ', ' + (egesz ? 'egész nap (8–16 óra)' : esc(valasztott.sav) + ' óra') + '</b>';
    }
    function tipusValt() {
      var t = tipus(); surgos.hidden = t !== 'javitas';
      $('#id-sugo').textContent = t === 'szereles' ? 'Szerelésnél az egész nap a tiéd (8–16): olyan napot választhatsz, amikor mindkét sáv szabad. A szürke napok foglaltak.' : 'Munkanapokon két sáv van: 8–12 és 12–16. A szürke sávok már foglaltak.';
      if (valasztott) { var ok = t === 'szereles' ? szabadNap(foglalasok, valasztott.datum, t) : szabad(foglalasok, valasztott.datum, valasztott.sav) > 0; if (!ok) valasztott = null; }
      rajz();
    }

    naptar.addEventListener('click', function (e) {
      var g = e.target.closest('.ig-sav'); if (!g || g.disabled) return;
      valasztott = { datum: g.getAttribute('data-datum'), sav: g.getAttribute('data-sav') };
      $('#id-nap-hiba').hidden = true; rajz();
      var uj = $('.ig-sav[aria-pressed="true"]', naptar); if (uj) { try { uj.focus(); } catch (e2) { } }
    });
    $$('input[name="tipus"]', urlap).forEach(function (r) { r.addEventListener('change', tipusValt); });

    // Előtöltés: rendelésből vagy ajánlatkérésből
    function tolt(k, v) { var i = $('[data-kapcsolat="id"] [data-k="' + k + '"]'); if (i && v) i.value = v; }
    var forras = null;
    if (rendeles) {
      forras = rendeles.vevo || {};
      var szerelt = (rendeles.tetelek || []).some(function (x) { return x.szerelt; }) || /szereles/.test(rendeles.szallitas || '');
      setTipus(szerelt || lekerdezes('tipus') === '' ? 'szereles' : (lekerdezes('tipus') || 'szereles'));
      var sav = $('#id-rendeles-sav'); sav.hidden = false;
      sav.innerHTML = '<b>Rendelés: ' + esc(rendeles.azon) + '</b> – a megadott adataidat a rendelésből töltöttük ki.' + (rendeles.idopont ? ' Jelenlegi időpont: ' + esc(datumSzoveg(rendeles.idopont.datum)) + ', ' + (rendeles.idopont.egesznap ? 'egész nap' : esc(rendeles.idopont.sav)) + ' – az új foglalás ezt felülírja.' : '');
      tolt('cim', [forras.utca].filter(Boolean).join(''));
    } else if (rendelesAzon) {
      var s2 = $('#id-rendeles-sav'); s2.hidden = false; s2.innerHTML = 'A(z) <b>' + esc(rendelesAzon) + '</b> rendelést nem találjuk ebben a böngészőben, ezért add meg kézzel az adataidat.';
      setTipus('szereles');
    } else {
      var t0 = lekerdezes('tipus'); if (TIPUS_NEV[t0]) setTipus(t0); else setTipus('szereles');
      if (ak) { forras = ak; }
    }
    if (forras) { tolt('nev', forras.nev); tolt('tel', forras.tel); tolt('email', forras.email); if (forras.telepules) tolt('telepules', forras.telepules); if (ak && ak.adatok && ak.adatok.cim) tolt('cim', ak.adatok.cim); }
    if (ak && !rendeles) { var s3 = $('#id-rendeles-sav'); s3.hidden = false; s3.innerHTML = '<b>Ajánlatkérés: ' + esc(ak.azon) + '</b> – a megadott adataidat onnan töltöttük ki.'; }
    var tpl = $('[data-kapcsolat="id"] [data-k="telepules"]'); if (forras && forras.telepules && tpl) tpl.value = forras.telepules;

    urlap.addEventListener('submit', function (e) {
      e.preventDefault(); var hiba = $('#id-hiba'); hiba.hidden = true;
      var k = olvasKapcsolat($('[data-kapcsolat="id"]')); var t = tipus();
      var nincsNap = !valasztott; $('#id-nap-hiba').hidden = !nincsNap;
      if (nincsNap) { var el = $('#id-nap-hiba'); try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch (e1) { } }
      if (!k || nincsNap) { if (!k) { hiba.textContent = 'Kérjük, javítsd a pirossal jelölt mezőket.'; hiba.hidden = false; } return; }
      // Újraellenőrzés mentés előtt (másik lapon közben foglalhattak)
      foglalasok = tar.get('hk_foglalasok', []);
      var ok = t === 'szereles' ? szabadNap(foglalasok, valasztott.datum, t) : szabad(foglalasok, valasztott.datum, valasztott.sav) > 0;
      if (!ok) { valasztott = null; rajz(); hiba.textContent = 'Ez a sáv közben betelt. Válassz másikat.'; hiba.hidden = false; return; }
      var f = { azon: H.azon('FG'), tipus: t, datum: valasztott.datum, sav: t === 'szereles' ? SAV1 : valasztott.sav, nev: k.nev, tel: k.tel, email: k.email, telepules: k.telepules, cim: k.cim, megj: $('#id-megj').value.trim(), allapot: 'Foglalt' };
      if (t === 'szereles') f.egesznap = true;
      if (rendeles) f.rendeles = rendeles.azon;
      if (ak) f.ajanlatkeres = ak.azon;
      var lista = foglalasok.slice();
      if (rendeles) lista.forEach(function (x) { if (x.rendeles === rendeles.azon && x.tipus === 'szereles' && x.allapot !== 'Lemondva') x.allapot = 'Lemondva'; });
      lista.push(f); tar.set('hk_foglalasok', lista);
      if (!tar.get('hk_foglalasok', []).some(function (x) { return x.azon === f.azon; })) { hiba.textContent = 'Nem sikerült menteni (a böngésző tárhelye tele van?).'; hiba.hidden = false; return; }
      if (rendeles) {
        var rl = tar.get('hk_rendelesek', []);
        rl.forEach(function (r) {
          if (r.azon !== rendeles.azon) return;
          r.idopont = { datum: f.datum, sav: f.sav }; if (f.egesznap) r.idopont.egesznap = true;
          r.allapotNaplo = r.allapotNaplo || [];
          r.allapotNaplo.push({ ido: new Date().toISOString(), allapot: 'Időpont egyeztetve', megj: 'Időpont: ' + datumSzoveg(f.datum) + ', ' + (f.egesznap ? 'egész nap (8–16)' : f.sav) + ' (' + f.azon + ')' });
        });
        tar.set('hk_rendelesek', rl);
      }
      H.fut('foglalas-mentve', f);
      if (H.level) { try { H.level('idopont-visszaigazolas', { foglalas: f }); } catch (e3) { console.error(e3); } }
      visszaigazolas(f);
    });

    function visszaigazolas(f) {
      urlap.hidden = true; $('#id-rendeles-sav').hidden = true;
      var s = $('#id-siker'); s.hidden = false;
      s.innerHTML = '<div class="siker-doboz ig-siker" role="status"><div class="ig-pipa" aria-hidden="true">✓</div><h2>Az időpontod lefoglalva</h2>' +
        '<table class="adat-tabla ig-vissza"><tbody>' +
        '<tr><th scope="row">Típus</th><td>' + esc(TIPUS_NEV[f.tipus]) + '</td></tr>' +
        '<tr><th scope="row">Időpont</th><td><b>' + esc(datumSzoveg(f.datum)) + ', ' + (f.egesznap ? 'egész nap (8–16 óra)' : esc(f.sav) + ' óra') + '</b></td></tr>' +
        '<tr><th scope="row">Helyszín</th><td>' + esc(f.cim) + ', ' + esc(f.telepules) + '</td></tr>' +
        '<tr><th scope="row">Név, telefon</th><td>' + esc(f.nev) + ', ' + esc(f.tel) + '</td></tr>' +
        '<tr><th scope="row">Azonosító</th><td>' + esc(f.azon) + (f.rendeles ? ' (rendelés: ' + esc(f.rendeles) + ')' : '') + '</td></tr></tbody></table>' +
        '<p class="halvany">A szerelő a megjelölt sávon belül érkezik, és előtte telefonon jelentkezik. Mintaoldal: email nem megy ki, a visszaigazolást a Postafiók oldalon nézheted meg.</p>' +
        '<div class="sor" style="justify-content:center"><button class="gomb gomb-fo" type="button" id="id-ics">Naptárba (.ics)</button><a class="gomb gomb-keret" href="/">Főoldal</a></div></div>';
      $('#id-ics').addEventListener('click', function () { icsLetolt(f); });
      try { s.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (e) { }
    }

    tipusValt();
  }

  // Nyilvános segédek (próbákhoz és más modulokhoz)
  H.igeny = { kwSzamit: kwSzamit, ajanl: ajanl, multiSzamit: multiSzamit, beltMeret: beltMeret, unnepe: unnepe, munkanap: munkanap, naptarNapok: naptarNapok, datumStr: datumStr, foglalt: foglalt, szabad: szabad, szabadNap: szabadNap, icsKeszit: icsKeszit };

  H.horog('oldal', function () { kalkulator(); multi(); felmeres(); idopont(); });
})();

/* ---- modul: levelek ---- */
/* Levelek modul: HKApp.level, időzített levelek, demó postafiók, értékelés, hírlevél */
(function () {
  'use strict';
  var App = window.HKApp; if (!App) return;
  var tar = App.tar, esc = App.esc, ft = App.ft, $ = App.$, $$ = App.$$;
  var HK = App.HK || {}, CEG = HK.ceg || {}, LC = HK.levelCeg || {}, B = App.B || {};
  var GOOGLE = LC.google || 'https://search.google.com/local/writereview?placeid=MINTA';
  var DB_FIZ = ['eloleg', 'teljes', 'atutalas'];
  var FIZ = { eloleg: (B.elolegSzazalek || 30) + '% előleg átutalással', teljes: 'Teljes összeg átutalással', atutalas: 'Átutalás előre', utanvet: 'Utánvét', keszpenz: 'Készpénz átvételkor' };
  var TIPUS = { felmeres: 'Helyszíni felmérés', szereles: 'Klímaszerelés', tisztitas: 'Klímatisztítás', javitas: 'Klímajavítás' };
  var AK_TIPUS = { kalkulator: 'Klíma-kalkulátor', multi: 'Multi-split ajánlatkérés', felmeres: 'Fotós felmérés', kapcsolat: 'Üzenet' };
  var NAPOK = ['vasárnap', 'hétfő', 'kedd', 'szerda', 'csütörtök', 'péntek', 'szombat'];
  var CIMKE = {
    'rendeles-visszaigazolas': 'Rendelés-visszaigazolás', 'dijbekero': 'Díjbekérő', 'fizetesi-emlekezteto': 'Fizetési emlékeztető',
    'fizetes-beerkezett': 'Fizetés beérkezett', 'idopont-visszaigazolas': 'Időpont-visszaigazolás', 'szereles-elotti-emlekezteto': 'Szerelés előtti emlékeztető',
    'szereles-kesz': 'Szerelés kész', 'velemenykeres': 'Véleménykérés', 'tisztitas-emlekezteto': 'Tisztítás-emlékeztető',
    'hirlevel-megerosites': 'Hírlevél-megerősítés', 'ajanlatkeres-visszaigazolas': 'Ajánlatkérés-visszaigazolás', 'ajanlat': 'Ajánlat',
    'regisztracio': 'Regisztráció'
  };
  var FG_SABLONOK = ['szereles-elotti-emlekezteto', 'idopont-visszaigazolas'];

  /* ---------- Segédek ---------- */
  function alapUrl() { var o = location.origin; return (o && o !== 'null' && o.indexOf('http') === 0) ? o : (LC.domain || ''); }
  function url(ut) { return alapUrl() + ut; }
  function enc(s) { return encodeURIComponent(s == null ? '' : s); }
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoNap(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function parseNap(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || ''); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; }
  function parseIdo(s) { if (!s) return null; var d = new Date(s); return isNaN(d.getTime()) ? null : d; }
  function datumHu(s) { var d = typeof s === 'string' ? parseNap(s) : s; if (!d) return s || ''; return d.getFullYear() + '. ' + pad2(d.getMonth() + 1) + '. ' + pad2(d.getDate()) + '. (' + NAPOK[d.getDay()] + ')'; }
  function idoHu(iso) { var d = parseIdo(iso); if (!d) return ''; return d.getFullYear() + '. ' + pad2(d.getMonth() + 1) + '. ' + pad2(d.getDate()) + '. ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()); }
  function napKesobb(n, d) { var x = new Date((d || new Date()).getTime()); x.setDate(x.getDate() + n); return x; }
  function honapKesobb(d, n) { var x = new Date(d.getTime()); var nap = x.getDate(); x.setDate(1); x.setMonth(x.getMonth() + n); var max = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate(); x.setDate(Math.min(nap, max)); return x; }
  function hetvege(d) { // hétvége vagy munkaszüneti nap (az ünneplistát az igenyfelmeres modul adja)
    if (d.getDay() === 0 || d.getDay() === 6) return true;
    var u = window.HKApp && window.HKApp.unnepnap; return !!(u && u(d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2)));
  }
  function munkanapHozzaad(d, n) { var x = new Date(d.getTime()); while (n > 0) { x.setDate(x.getDate() + 1); if (!hetvege(x)) n--; } return x; }
  function elozoMunkanap(d) { var x = new Date(d.getTime()); do { x.setDate(x.getDate() - 1); } while (hetvege(x)); return x; }
  function tokenGen() {
    var s = '';
    try { var a = new Uint8Array(12); (window.crypto || window.msCrypto).getRandomValues(a); for (var i = 0; i < a.length; i++) s += (a[i] % 36).toString(36); } catch (e) { s = ''; }
    while (s.length < 16) s += Math.random().toString(36).slice(2);
    return s.slice(0, 20);
  }
  function emailJo(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v || ''); }
  function masol(cel, forras, kulcsok) { kulcsok.forEach(function (k) { if (forras[k] !== undefined) cel[k] = forras[k]; }); }

  /* ---------- Tárolók (olvasás-módosítás-írás: mások mezőit nem írjuk felül) ---------- */
  function patch(kulcs, azon, fn) {
    var l = tar.get(kulcs, []), tal = null;
    for (var i = 0; i < l.length; i++) { if (l[i] && l[i].azon === azon) { fn(l[i]); tal = l[i]; } }
    if (tal) tar.set(kulcs, l);
    return tal;
  }
  function keresRendeles(azon) { var l = tar.get('hk_rendelesek', []); for (var i = 0; i < l.length; i++) if (l[i].azon === azon) return l[i]; return null; }
  function ujDijbekeroSzam(azon) { return 'DB-' + String(azon || '').replace(/^HK-/, ''); }

  function biztosToken(r) {
    if (!r || !r.azon) return;
    var tok = r.token;
    var t = patch('hk_rendelesek', r.azon, function (x) { if (!x.token) x.token = tok || tokenGen(); tok = x.token; });
    if (!t && !tok) tok = tokenGen();
    r.token = tok;
  }

  /* ---------- Levélkeret és építőelemek (táblázatos, inline stílus, max. 600 px) ---------- */
  var BETU = 'Arial,Helvetica,sans-serif';
  function p(t, st) { return '<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#14213d;font-family:' + BETU + ';' + (st || '') + '">' + t + '</p>'; }
  function h1(t) { return '<h1 style="margin:0 0 14px;font-size:24px;line-height:1.25;color:#0c2340;font-family:' + BETU + ';">' + t + '</h1>'; }
  function h2(t) { return '<h2 style="margin:18px 0 8px;font-size:17px;line-height:1.3;color:#0c2340;font-family:' + BETU + ';">' + t + '</h2>'; }
  function gomb(href, szoveg, kek) {
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 18px"><tr><td style="background:' + (kek ? '#1479d4' : '#ff7a1a') + ';border-radius:8px">' +
      '<a href="' + esc(href) + '" style="display:inline-block;padding:14px 26px;font-family:' + BETU + ';font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:8px">' + esc(szoveg) + '</a></td></tr></table>';
  }
  function ertek(v) { return v && v.h != null ? v.h : esc(v); }
  function adatTabla(sorok) {
    var h = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border:1px solid #dbe4ee;border-radius:8px;border-collapse:separate">';
    sorok.forEach(function (s, i) {
      if (s[1] === '' || s[1] == null) return;
      h += '<tr><td style="padding:10px 14px;width:38%;background:#f5f8fc;font-size:13px;color:#56667d;font-family:' + BETU + ';vertical-align:top;border-top:' + (i ? '1px solid #dbe4ee' : '0') + '">' + esc(s[0]) + '</td>' +
        '<td style="padding:10px 14px;font-size:14px;color:#14213d;font-family:' + BETU + ';vertical-align:top;border-top:' + (i ? '1px solid #dbe4ee' : '0') + '">' + ertek(s[1]) + '</td></tr>';
    });
    return h + '</table>';
  }
  function dobozInfo(t) { return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px"><tr><td style="background:#e8f4fd;border-left:4px solid #1479d4;padding:12px 16px;font-size:14px;line-height:1.55;color:#123461;font-family:' + BETU + '">' + t + '</td></tr></table>'; }
  function lista(elemek) { return '<ul style="margin:0 0 16px;padding-left:20px;font-size:15px;line-height:1.7;color:#14213d;font-family:' + BETU + '">' + elemek.map(function (e) { return '<li>' + e + '</li>'; }).join('') + '</ul>'; }

  function keret(targy, elofejlec, tartalom, leiratkozas) {
    var nev = CEG.nev || 'Hűsvölgy Klíma';
    var lab = '<b>' + esc(nev) + '</b><br>' + esc(LC.jogiNev || nev) + ' · ' + esc(LC.cim || '') + '<br>Adószám: ' + esc(LC.adoszam || '') + ' · ' + esc(LC.cegjegyzek || '') +
      '<br>Tel.: ' + esc(CEG.telefon || '') + ' · <a href="mailto:' + esc(CEG.email || '') + '" style="color:#1479d4">' + esc(CEG.email || '') + '</a>' +
      '<br><i>Bemutató levél: kitalált cég, minta adatok.</i>';
    if (leiratkozas) lab += '<br><br>Azért kaptad ezt a levelet, mert hírlevélre iratkoztál fel. <a href="' + esc(leiratkozas) + '" style="color:#1479d4">Leiratkozás</a>';
    return '<!doctype html><html lang="hu"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(targy) + '</title></head>' +
      '<body style="margin:0;padding:0;background:#eef2f7">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;font-size:1px;color:#eef2f7">' + esc(elofejlec || '') + '</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#eef2f7"><tr><td align="center" style="padding:24px 12px">' +
      '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;border-collapse:separate">' +
      '<tr><td style="background:#0c2340;padding:22px 28px;border-radius:12px 12px 0 0;font-family:' + BETU + '"><span style="font-size:22px;font-weight:bold;color:#ffffff;letter-spacing:-.01em">' + esc(nev) + '</span>' +
      '<br><span style="font-size:12px;color:#9fc4ec">' + esc(LC.alcim || '') + '</span></td></tr>' +
      '<tr><td style="padding:28px 28px 10px">' + tartalom + '</td></tr>' +
      '<tr><td style="background:#f5f8fc;padding:20px 28px;border-radius:0 0 12px 12px;font-size:12px;line-height:1.6;color:#56667d;font-family:' + BETU + '">' + lab + '</td></tr>' +
      '</table></td></tr></table></body></html>';
  }

  /* ---------- Rendelés-blokkok ---------- */
  function koszon(c) { return p('Kedves ' + esc(c.nev || 'Ügyfelünk') + '!'); }
  function kovetoUrl(r) { return url('/rendeles/?azon=' + enc(r.azon) + '&email=' + enc((r.vevo && r.vevo.email) || '')); }
  function dbOsszeg(r) { return (r.fizetes === 'eloleg' && r.eloleg) ? r.eloleg : r.osszesen; }
  function sorTd(bal, jobb, nagy) {
    var st = 'padding:10px 0;border-bottom:1px solid #dbe4ee;font-size:' + (nagy ? '17px;font-weight:bold;color:#0c2340' : '14px;color:#14213d') + ';font-family:' + BETU + ';';
    return '<tr><td style="' + st + '">' + bal + '</td><td align="right" style="' + st + 'white-space:nowrap">' + jobb + '</td></tr>';
  }
  function rendelesBlokk(r) {
    var h = '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 18px;border-collapse:collapse">';
    (r.tetelek || []).forEach(function (t) {
      h += sorTd(esc(t.db) + ' × ' + esc(t.nev) + (t.szerelt ? ' <span style="color:#56667d">(szereléssel)</span>' : ''), '<b>' + esc(ft(t.osszeg)) + '</b>');
    });
    var szall = (r.kiszallas || 0) + (r.szallitasDij || 0);
    h += sorTd('Kiszállás / szállítás', szall ? esc(ft(szall)) : 'ingyenes');
    (r.kedvezmenyek || []).forEach(function (k) { h += sorTd(esc(k[0]), esc(ft(k[1]))); });
    h += sorTd('Összesen', esc(ft(r.osszesen)), true);
    if (r.eloleg) h += sorTd('Ebből előleg (' + (B.elolegSzazalek || 30) + '%)', esc(ft(r.eloleg)));
    return h + '</table>';
  }
  function bankTabla(r, hatarido) {
    return adatTabla([
      ['Díjbekérő száma', r.dijbekero],
      ['Kedvezményezett', CEG.nev],
      ['Bankszámlaszám', CEG.bankszamla],
      ['Fizetendő összeg', { h: '<b style="font-size:17px;color:#0c2340">' + esc(ft(dbOsszeg(r))) + '</b>' }],
      ['Közlemény', { h: '<b>' + esc(r.azon) + '</b>' }],
      ['Fizetési határidő', hatarido]
    ]);
  }
  function idopontAdat(c) {
    if (c.fg) return { tipus: c.fg.tipus, datum: c.fg.datum, sav: c.fg.sav, hely: [c.fg.cim, c.fg.telepules].filter(Boolean).join(', '), rendeles: c.fg.rendeles, azon: c.fg.azon };
    if (c.r && c.r.idopont) { var v = c.r.vevo || {}; return { tipus: 'szereles', datum: c.r.idopont.datum, sav: c.r.idopont.sav, hely: [v.irsz, v.telepules].filter(Boolean).join(' ') + (v.utca ? ', ' + v.utca : ''), rendeles: c.r.azon }; }
    return null;
  }

  /* ---------- Sablonok ---------- */
  var SABLON = {};
  SABLON['rendeles-visszaigazolas'] = function (c) {
    var r = c.r, kovetkezo = [];
    if (r.helyszini) kovetkezo.push('Munkaidőben <b>24 órán belül hívunk</b> a szerelés időpontjának egyeztetésére.');
    if (DB_FIZ.indexOf(r.fizetes) > -1) kovetkezo.push('A <b>díjbekérőt</b> külön levélben küldjük; a pénz beérkezése után véglegesítjük a rendelést.');
    if (r.fizetes === 'utanvet') kovetkezo.push('A csomagot <b>utánvéttel</b> kézbesíti a futár, a fizetés készpénzzel történik.');
    if (r.fizetes === 'keszpenz') kovetkezo.push('A fizetés <b>készpénzzel</b>, átvételkor történik.');
    if (!r.helyszini && r.szallitas === 'futar') kovetkezo.push('A feladásról külön értesítünk.');
    if (!r.helyszini && r.szallitas === 'atvetel') kovetkezo.push('A személyes átvételről egyeztetni fogunk.');
    return {
      targy: 'Megkaptuk a rendelésed – ' + r.azon,
      elofejlec: 'Rendelésszám: ' + r.azon + ' · összesen ' + ft(r.osszesen),
      tartalom: h1('Köszönjük a rendelésed!') + koszon(c) +
        p('Megkaptuk a rendelésed, a rendelésszámod: <b>' + esc(r.azon) + '</b>. Az alábbiakat rendelted:') +
        rendelesBlokk(r) +
        adatTabla([['Fizetés módja', FIZ[r.fizetes] || ''], ['Cím', [((r.vevo || {}).irsz), ((r.vevo || {}).telepules)].filter(Boolean).join(' ') + (((r.vevo || {}).utca) ? ', ' + r.vevo.utca : '')]]) +
        (kovetkezo.length ? h2('Hogyan tovább?') + lista(kovetkezo) : '') +
        gomb(kovetoUrl(r), 'Rendelés követése')
    };
  };
  SABLON['dijbekero'] = function (c) {
    var r = c.r;
    return {
      targy: 'Díjbekérő – ' + (r.dijbekero || r.azon),
      elofejlec: 'Fizetendő: ' + ft(dbOsszeg(r)) + ' · közlemény: ' + r.azon,
      tartalom: h1('Díjbekérő a rendelésedhez') + koszon(c) +
        p('Az alábbi adatokkal tudod átutalni ' + (r.fizetes === 'eloleg' ? 'az előleget' : 'a rendelés összegét') + '. <b>A közleménybe kérjük, a rendelésszámot írd.</b>') +
        bankTabla(r, datumHu(napKesobb(8))) +
        (r.fizetes === 'eloleg' ? dobozInfo('Az előleg beérkezése után véglegesítjük a szerelés időpontját. A fennmaradó <b>' + esc(ft(r.osszesen - (r.eloleg || 0))) + '</b> a munka elvégzése után fizetendő (utalással vagy készpénzzel).') : dobozInfo('A pénz beérkezése után a végszámlát automatikusan küldjük, a csomagot pedig feladjuk / a szerelést beütemezzük.')) +
        p('A díjbekérő <b>nem számla</b>, nyomtatható változata az alábbi gombbal nyitható meg.') +
        gomb(url('/dijbekero/?azon=' + enc(r.azon)), 'Díjbekérő megnyitása')
    };
  };
  SABLON['fizetesi-emlekezteto'] = function (c) {
    var r = c.r;
    return {
      targy: 'Fizetési emlékeztető – ' + r.azon,
      elofejlec: 'Még nem láttuk az átutalást a ' + r.azon + ' rendelésedhez.',
      tartalom: h1('Kedves emlékeztető a fizetésről') + koszon(c) +
        p('A <b>' + esc(r.azon) + '</b> rendelésedhez küldött díjbekérő összege még nem érkezett meg hozzánk. Előfordulhat, hogy az átutalás már úton van – ebben az esetben kérjük, tekintsd tárgytalannak ezt a levelet.') +
        bankTabla(r, 'mielőbb') +
        p('Ha bármi kérdésed van, vagy módosítanál a rendelésen, hívj minket: <b>' + esc(CEG.telefon || '') + '</b>.') +
        gomb(url('/dijbekero/?azon=' + enc(r.azon)), 'Díjbekérő megnyitása')
    };
  };
  SABLON['fizetes-beerkezett'] = function (c) {
    var r = c.r, osszeg = r.fizetve || (r.allapot === 'Előleg beérkezett' ? r.eloleg : r.osszesen);
    var elol = r.allapot === 'Előleg beérkezett' || (r.fizetes === 'eloleg' && r.fizetve && r.fizetve < r.osszesen);
    return {
      targy: 'Megkaptuk a befizetésed – ' + r.azon,
      elofejlec: 'Beérkezett összeg: ' + ft(osszeg),
      tartalom: h1('Köszönjük, megérkezett a fizetés!') + koszon(c) +
        p('A <b>' + esc(r.azon) + '</b> rendelésedhez <b>' + esc(ft(osszeg)) + '</b> beérkezett.') +
        (elol ? dobozInfo('Az előleg megérkezett, így <b>véglegesítjük a szerelés időpontját</b>. A fennmaradó összeget a munka után kell rendezned.') : dobozInfo('A végszámlát a munka lezárása után automatikusan küldjük.')) +
        gomb(kovetoUrl(r), 'Rendelés követése')
    };
  };
  SABLON['idopont-visszaigazolas'] = function (c) {
    var i = idopontAdat(c) || {}, tn = TIPUS[i.tipus] || 'Időpont';
    var modosit = i.rendeles ? url('/idopont/?rendeles=' + enc(i.rendeles)) : url('/idopont/?tipus=' + enc(i.tipus || 'felmeres'));
    return {
      targy: 'Időpont-visszaigazolás – ' + tn + (i.datum ? ', ' + datumHu(i.datum).replace(/ \(.*\)/, '') : ''),
      elofejlec: tn + ': ' + (i.datum ? datumHu(i.datum) : '') + ' ' + (i.sav || ''),
      tartalom: h1('Visszaigazoltuk az időpontot') + koszon(c) +
        p('Az alábbi időpontban várhatod a szerelőnket:') +
        adatTabla([['Szolgáltatás', tn], ['Időpont', i.datum ? { h: '<b>' + esc(datumHu(i.datum)) + '</b>' } : 'egyeztetés alatt'], ['Idősáv', i.sav ? i.sav + ' óra között' : ''], ['Helyszín', i.hely], ['Azonosító', i.azon]]) +
        dobozInfo('Indulás előtt <b>telefonon jelzünk</b>, hogy pontosan mikorra érkezünk a megadott sávon belül.') +
        p('Ha változott a terv, itt tudod módosítani az időpontot:') +
        gomb(modosit, 'Időpont módosítása', true)
    };
  };
  SABLON['szereles-elotti-emlekezteto'] = function (c) {
    var i = idopontAdat(c) || {}, tn = TIPUS[i.tipus] || 'Időpont';
    var tippek = i.tipus === 'tisztitas' ? ['Kérjük, hogy a beltéri egység környéke legyen szabad.', 'Legyen a közelben hálózati csatlakozó és (lehetőleg) víz.'] :
      i.tipus === 'szereles' ? ['A beltéri egység helyénél legyen szabad hozzáférés (mozgatható bútorok, képek).', 'A kültéri egység helyét előre egyeztettük – kérjük, a hozzáférést (erkély, létra, kapu) biztosítsd.', 'Legyen a közelben 230 V-os csatlakozó.', 'Ha lehet, jelezd, hol parkolhatunk.'] :
        ['A munkaterület legyen szabadon hozzáférhető.', 'Ha a hiba jellege változott, jelezd telefonon.'];
    return {
      targy: 'Emlékeztető: ' + (i.datum ? datumHu(i.datum).replace(/ \(.*\)/, '') : 'közelgő időpont') + ' ' + (i.sav || '') + ' – ' + tn,
      elofejlec: tn + ': ' + (i.datum ? datumHu(i.datum) : '') + ' ' + (i.sav || ''),
      tartalom: h1('Hamarosan jövünk!') + koszon(c) +
        p('Emlékeztető: ' + (i.datum ? '<b>' + esc(datumHu(i.datum)) + '</b>' : 'a közeli időpontodon') + (i.sav ? ' <b>' + esc(i.sav) + ' óra között</b>' : '') + ' érkezik hozzád a szerelőnk (' + esc(tn.toLowerCase()) + ').') +
        (i.hely ? adatTabla([['Helyszín', i.hely]]) : '') +
        h2('Kérjük, készülj így') + lista(tippek) +
        p('Ha nem megfelelő az időpont, hívj minket: <b>' + esc(CEG.telefon || '') + '</b>.') +
        gomb(i.rendeles ? url('/idopont/?rendeles=' + enc(i.rendeles)) : url('/idopont/?tipus=' + enc(i.tipus || 'szereles')), 'Időpont módosítása', true)
    };
  };
  SABLON['szereles-kesz'] = function (c) {
    var r = c.r;
    return {
      targy: 'Elkészült a klímaszerelés – köszönjük! (' + r.azon + ')',
      elofejlec: 'Köszönjük, hogy minket választottál. Tippek a klíma használatához.',
      tartalom: h1('Kész a szerelés – köszönjük!') + koszon(c) +
        p('A <b>' + esc(r.azon) + '</b> rendeléshez tartozó munkát elvégeztük. Reméljük, hamarosan élvezed a hűs levegőt!') +
        (r.szamla ? adatTabla([['Végszámla', r.szamla]]) : '') +
        h2('Pár tipp a kezdéshez') +
        lista(['Az első bekapcsoláskor ne állítsd túl alacsonyra: a 24–26 °C a leggazdaságosabb.', 'A szűrőt 2–3 havonta mosd át, a beltéri egységet évente tisztíttasd – így marad meg a garancia és a tiszta levegő.', 'Jegyezd fel: a jegyzőkönyvet és a garanciajegyet megtalálod a rendelésed oldalán.']) +
        gomb(url('/szamla/?azon=' + enc(r.azon)), 'Végszámla megnyitása') +
        p('Pár nap múlva megkérünk, hogy értékeld a munkánkat – a véleményed sokat jelent nekünk.', 'color:#56667d;font-size:14px')
    };
  };
  SABLON['velemenykeres'] = function (c) {
    var r = c.r || {}, tok = r.token || '';
    var cs = '';
    for (var n = 1; n <= 5; n++) {
      cs += '<td align="center" style="padding:0 3px"><a href="' + esc(url('/ertekeles/?t=' + enc(tok) + '&cs=' + n)) + '" style="display:block;background:#fff7e6;border:1px solid #f6dc9c;border-radius:8px;padding:10px 0;text-decoration:none;font-family:' + BETU + ';text-align:center"><span style="font-size:24px;line-height:28px;color:#f5a623">&#9733;</span><br><span style="font-size:13px;font-weight:bold;color:#0c2340">' + n + '</span></a></td>';
    }
    return {
      targy: 'Hogyan tetszett a munkánk? Értékelj egy kattintással',
      elofejlec: 'Egy kattintás: 1–5 csillag. A véleményed sokat segít.',
      tartalom: h1('Hogyan sikerült a munkánk?') + koszon(c) +
        p('Köszönjük, hogy ránk bíztad a klímád. Nagyon örülnénk, ha megosztanád a tapasztalatodat – kattints a csillagokra (5 = nagyon elégedett vagyok):') +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 20px;table-layout:fixed"><tr>' + cs + '</tr></table>' +
        p('Ha elégedett voltál, sokat segítesz másoknak azzal is, ha a Google-ön is értékelsz:') +
        gomb(GOOGLE, 'Értékelj a Google-ön') +
        p('Ha valami nem volt rendben, azt is írd meg nekünk – szeretnénk jóvátenni.', 'color:#56667d;font-size:14px')
    };
  };
  SABLON['tisztitas-emlekezteto'] = function (c) {
    var ar = (App.A || {}).tisztitas_1_belteri;
    return {
      targy: 'Ideje klímatisztításnak – 11 hónapja szereltük a klímád',
      elofejlec: 'Évi egy tisztítás: tisztább levegő, kisebb fogyasztás, megmarad a garancia.',
      tartalom: h1('Ideje a karbantartásnak') + koszon(c) +
        p('Közel egy éve szereltük a klímádat. Évente egyszer érdemes tisztíttatni: tisztább a levegő, alacsonyabb a fogyasztás, és a garancia is érvényes marad.') +
        lista(['Beltéri egység alapos tisztítása, fertőtlenítése', 'Szűrők, lamellák, kondenzvíz-elvezetés ellenőrzése', 'Hűtőközeg-nyomás és működés ellenőrzése']) +
        (ar ? p('Tisztítás már <b>' + esc(ft(ar)) + '</b>-tól (1 beltéri egység).') : '') +
        gomb(url('/idopont/?tipus=tisztitas'), 'Időpontot foglalok')
    };
  };
  SABLON['hirlevel-megerosites'] = function (c) {
    var hl = c.hl || {};
    return {
      targy: 'Erősítsd meg a hírlevél-feliratkozásodat',
      elofejlec: 'Egy kattintás, és kész a feliratkozás.',
      tartalom: h1('Erősítsd meg a feliratkozást') + p('Kedves Feliratkozó!') +
        p('Ezzel az e-mail címmel (<b>' + esc(hl.email || c.email) + '</b>) hírlevélre iratkoztak fel a ' + esc(CEG.nev || '') + ' oldalán. A feliratkozás akkor lesz érvényes, ha megerősíted:') +
        gomb(url('/hirlevel/megerosites/?t=' + enc(hl.token || '')), 'Feliratkozás megerősítése') +
        p('Ha nem te iratkoztál fel, egyszerűen hagyd figyelmen kívül ezt a levelet – megerősítés nélkül nem küldünk hírlevelet.', 'color:#56667d;font-size:14px'),
      leiratkozas: url('/hirlevel/?leiratkozas=' + enc(hl.email || c.email) + '&t=' + enc(hl.token || ''))
    };
  };
  SABLON['ajanlatkeres-visszaigazolas'] = function (c) {
    var ak = c.ak || {}, db = (ak.fotok || []).length;
    return {
      targy: 'Megkaptuk az ajánlatkérésed – ' + (ak.azon || ''),
      elofejlec: 'Munkanapon belül jelentkezünk az ajánlattal.',
      tartalom: h1('Köszönjük az ajánlatkérést!') + koszon(c) +
        p('Megkaptuk az ajánlatkérésed. Szakemberünk átnézi az adatokat, és <b>1 munkanapon belül</b> jelentkezik – ha kell, kérdésekkel vagy helyszíni felméréssel.') +
        adatTabla([['Azonosító', ak.azon], ['Típus', AK_TIPUS[ak.tipus] || ''], ['Település', ak.telepules], ['Feltöltött fotó', db ? db + ' db' : ''], ['Telefon', ak.tel]]) +
        p('Addig is, ha sürgős a dolog, hívj: <b>' + esc(CEG.telefon || '') + '</b>.') +
        gomb(url('/idopont/?tipus=felmeres'), 'Helyszíni felmérés foglalása', true)
    };
  };
  SABLON['ajanlat'] = function (c) {
    var ak = c.ak || {}, aj = c.adat.ajanlat || ak.ajanlat || null;
    return {
      targy: 'Elkészült az ajánlatunk – ' + (ak.azon || ''),
      elofejlec: aj && aj.osszeg ? 'Ajánlati ár: ' + ft(aj.osszeg) : 'Elkészült a személyre szabott ajánlatod.',
      tartalom: h1('Elkészült az ajánlatod') + koszon(c) +
        p('Az ajánlatkérésed (<b>' + esc(ak.azon || '') + '</b>) alapján összeállítottuk az ajánlatunkat.') +
        adatTabla([['Ajánlati ár', aj && aj.osszeg ? { h: '<b style="font-size:17px;color:#0c2340">' + esc(ft(aj.osszeg)) + '</b>' } : ''], ['Tartalom', aj && aj.megj], ['Érvényes', datumHu(napKesobb(14))]]) +
        p('Ha megfelel, foglalj időpontot, és mi mindent elintézünk. Kérdés esetén hívj: <b>' + esc(CEG.telefon || '') + '</b>.') +
        gomb(url('/idopont/?tipus=szereles'), 'Időpontot foglalok')
    };
  };
  SABLON['regisztracio'] = function (c) {
    var fi = c.fi || {};
    return {
      targy: 'Sikeres regisztráció – üdvözlünk!',
      elofejlec: 'A fiókodban követheted a rendeléseidet és időpontjaidat.',
      tartalom: h1('Üdvözlünk nálunk!') + koszon(c) +
        p('Elkészült a fiókod (<b>' + esc(fi.email || c.email) + '</b>). Mostantól:') +
        lista(['követheted a rendeléseid állapotát', 'látod az időpontjaidat és a dokumentumokat (díjbekérő, számla)', 'a címed elmentve, így gyorsabban rendelsz']) +
        gomb(url('/fiok/'), 'Belépés a fiókomba')
    };
  };
  /* ---------- HKApp.level(sablon, adat) ---------- */
  function ctxEpit(adat) {
    var r = adat.rendeles || null, fg = adat.foglalas || null, ak = adat.ajanlatkeres || null, fi = adat.fiok || null, hl = adat.hirlevel || null;
    if (!r && fg && fg.rendeles) r = keresRendeles(fg.rendeles);
    var v = (r && r.vevo) || {};
    return {
      adat: adat, r: r, fg: fg, ak: ak, fi: fi, hl: hl,
      nev: v.nev || (fg && fg.nev) || (ak && ak.nev) || (fi && fi.nev) || '',
      email: adat.cimzett || v.email || (fg && fg.email) || (ak && ak.email) || (fi && fi.email) || (hl && hl.email) || ''
    };
  }
  function level(sablon, adat) {
    adat = adat || {};
    var gyar = SABLON[sablon];
    if (!gyar) { try { console.error('[level] ismeretlen sablon: ' + sablon); } catch (e) { } return null; }
    var c = ctxEpit(adat);
    var rendelesKell = ['rendeles-visszaigazolas', 'dijbekero', 'fizetesi-emlekezteto', 'fizetes-beerkezett', 'szereles-kesz', 'velemenykeres'].indexOf(sablon) > -1;
    if (rendelesKell && !c.r) { try { console.error('[level] ' + sablon + ': hiányzik a rendelés'); } catch (e) { } return null; }
    if (c.r) {
      biztosToken(c.r);
      if (sablon === 'dijbekero' && !c.r.dijbekero) {
        var szam = ujDijbekeroSzam(c.r.azon);
        patch('hk_rendelesek', c.r.azon, function (x) { if (!x.dijbekero) x.dijbekero = szam; });
        c.r.dijbekero = szam;
      }
    }
    var m = gyar(c);
    var bej = {
      azon: App.azon('LV'), ido: new Date().toISOString(), cimzett: c.email || '(nincs e-mail cím)', targy: m.targy, sablon: sablon,
      html: keret(m.targy, m.elofejlec, m.tartalom, m.leiratkozas),
      kapcsolodo: (c.fg && c.fg.azon && FG_SABLONOK.indexOf(sablon) > -1 && c.fg.azon) || (c.r && c.r.azon) || (c.fg && c.fg.azon) || (c.ak && c.ak.azon) || (c.hl && c.hl.email) || (c.fi && c.fi.email) || ''
    };
    var l = tar.get('hk_levelek', []); l.push(bej);
    if (l.length > 150) l = l.slice(l.length - 150);
    tar.set('hk_levelek', l);
    // kiküldés-jelölő (hogy az időzített levelek duplán ne menjenek)
    var most = bej.ido;
    if (c.fg && c.fg.azon && FG_SABLONOK.indexOf(sablon) > -1) patch('hk_foglalasok', c.fg.azon, function (x) { x.kuldve = x.kuldve || {}; x.kuldve[sablon] = most; });
    else if (c.r && c.r.azon) { patch('hk_rendelesek', c.r.azon, function (x) { x.kuldve = x.kuldve || {}; x.kuldve[sablon] = most; }); c.r.kuldve = c.r.kuldve || {}; c.r.kuldve[sablon] = most; }
    return bej;
  }

  /* ---------- rendeles-mentve: visszaigazolás + díjbekérő ---------- */
  App.horog('rendeles-mentve', function (r) {
    if (!r || !r.azon || !r.vevo || !r.vevo.email) return;
    level('rendeles-visszaigazolas', { rendeles: r });
    if (DB_FIZ.indexOf(r.fizetes) < 0) return;
    var szam = ujDijbekeroSzam(r.azon), most = new Date().toISOString();
    var t = patch('hk_rendelesek', r.azon, function (x) {
      x.dijbekero = szam;
      if (x.allapot === 'Új') { x.allapot = 'Díjbekérő elküldve'; x.allapotNaplo = x.allapotNaplo || []; x.allapotNaplo.push({ ido: most, allapot: 'Díjbekérő elküldve', megj: 'Díjbekérő automatikusan kiküldve: ' + szam }); }
    });
    if (t) masol(r, t, ['dijbekero', 'allapot', 'allapotNaplo', 'token', 'kuldve']); else r.dijbekero = szam;
    level('dijbekero', { rendeles: r });
  });

  /* ---------- HKApp.idozitettLevelek() ---------- */
  function naploIdo(r, allapot) {
    var n = (r.allapotNaplo || []).filter(function (e) { return e.allapot === allapot; });
    return n.length ? parseIdo(n[n.length - 1].ido) : null;
  }
  function idozitettLevelek() {
    var most = new Date(), db = 0;
    var rl = tar.get('hk_rendelesek', []), fl = tar.get('hk_foglalasok', []);
    var foglKulcs = {};
    function kuldve(o, s) { return !!(o.kuldve && o.kuldve[s]); }
    function kuld(s, adat) { try { if (App.level(s, adat)) db++; } catch (e) { console.error('[idozitett ' + s + ']', e); } }
    fl.forEach(function (f) { if (f && f.rendeles && f.datum) foglKulcs[f.rendeles + '|' + f.datum] = 1; });
    fl.forEach(function (f) {
      if (!f || !f.email || !f.datum || kuldve(f, 'szereles-elotti-emlekezteto')) return;
      if (f.allapot === 'Lemondva' || f.allapot === 'Kész') return;
      var d = parseNap(f.datum); if (!d) return;
      if (most >= elozoMunkanap(d) && most < napKesobb(1, d)) kuld('szereles-elotti-emlekezteto', { foglalas: f });
    });
    rl.forEach(function (r) {
      if (!r || !r.azon || !r.vevo || !r.vevo.email || r.allapot === 'Lemondva') return;
      if (r.dijbekero && !r.fizetve && (r.allapot === 'Új' || r.allapot === 'Díjbekérő elküldve') && DB_FIZ.indexOf(r.fizetes) > -1 && !kuldve(r, 'fizetesi-emlekezteto')) {
        var t0 = parseIdo(r.kuldve && r.kuldve.dijbekero) || naploIdo(r, 'Díjbekérő elküldve') || parseIdo(r.ido);
        if (t0 && most >= munkanapHozzaad(t0, 3)) kuld('fizetesi-emlekezteto', { rendeles: r });
      }
      var id = r.idopont && r.idopont.datum ? parseNap(r.idopont.datum) : null;
      if (id && !foglKulcs[r.azon + '|' + r.idopont.datum] && !kuldve(r, 'szereles-elotti-emlekezteto') && r.allapot !== 'Szerelés kész' && r.allapot !== 'Lezárva') {
        if (most >= elozoMunkanap(id) && most < napKesobb(1, id)) kuld('szereles-elotti-emlekezteto', { rendeles: r });
      }
      var kesz = naploIdo(r, 'Szerelés kész');
      if (kesz) {
        if (!kuldve(r, 'velemenykeres') && most >= napKesobb(3, kesz)) kuld('velemenykeres', { rendeles: r });
        if (r.helyszini && !kuldve(r, 'tisztitas-emlekezteto') && most >= honapKesobb(kesz, 11)) kuld('tisztitas-emlekezteto', { rendeles: r });
      }
    });
    return db;
  }

  App.level = level;
  App.idozitettLevelek = idozitettLevelek;

  /* ---------- /postafiok/ ---------- */
  function postafiokOldal() {
    var lista = $('#pf-lista'); if (!lista) return;
    var szuro = $('#pf-szuro'), keretEl = $('#pf-keret'), fej = $('#pf-fej'), db = $('#pf-db'), urit = $('#pf-urit'), uritIdo = null;
    var kivalasztott = null;
    szuro.innerHTML = '<option value="">Minden levél</option>' + Object.keys(CIMKE).map(function (k) { return '<option value="' + k + '">' + esc(CIMKE[k]) + '</option>'; }).join('');
    function rajzol() {
      var mind = tar.get('hk_levelek', []).map(function (l, i) { return { l: l, i: i }; });
      mind.sort(function (a, b) { var x = String(b.l.ido).localeCompare(String(a.l.ido)); return x || (b.i - a.i); });
      var f = szuro.value, lat = mind.filter(function (e) { return !f || e.l.sablon === f; });
      db.textContent = mind.length ? (lat.length + ' levél' + (f ? ' (összesen ' + mind.length + ' közül)' : '')) : '';
      if (!lat.length) {
        lista.innerHTML = '<li class="pf-ures">' + (mind.length ? 'Nincs ilyen sablonú levél.' : 'A postafiók üres. Adj le egy rendelést, vagy iratkozz fel a hírlevélre – a levelek itt jelennek meg.') + '</li>';
        fej.innerHTML = ''; keretEl.srcdoc = ''; kivalasztott = null; return;
      }
      if (!lat.some(function (e) { return e.l.azon === kivalasztott; })) kivalasztott = lat[0].l.azon;
      lista.innerHTML = lat.map(function (e) {
        var l = e.l, akt = l.azon === kivalasztott;
        return '<li><button type="button" class="pf-elem" data-azon="' + esc(l.azon) + '" aria-current="' + akt + '"><span class="pf-targy">' + esc(l.targy) + '</span><span class="pf-meta">Címzett: ' + esc(l.cimzett) + '</span><span class="pf-sor"><span class="pf-cimke">' + esc(CIMKE[l.sablon] || l.sablon) + '</span><time>' + esc(idoHu(l.ido)) + '</time></span></button></li>';
      }).join('');
      mutat(kivalasztott);
    }
    function mutat(azon) {
      var l = tar.get('hk_levelek', []).filter(function (x) { return x.azon === azon; })[0]; if (!l) return;
      fej.innerHTML = '<h2>' + esc(l.targy) + '</h2><dl><dt>Címzett</dt><dd>' + esc(l.cimzett) + '</dd><dt>Elküldve</dt><dd>' + esc(idoHu(l.ido)) + '</dd><dt>Sablon</dt><dd>' + esc(CIMKE[l.sablon] || l.sablon) + (l.kapcsolodo ? ' · ' + esc(l.kapcsolodo) : '') + '</dd></dl>';
      keretEl.srcdoc = String(l.html || '').replace('<head>', '<head><base target="_blank">');
    }
    lista.addEventListener('click', function (e) {
      var b = e.target.closest('[data-azon]'); if (!b) return;
      kivalasztott = b.getAttribute('data-azon');
      $$('.pf-elem', lista).forEach(function (x) { x.setAttribute('aria-current', x === b ? 'true' : 'false'); });
      mutat(kivalasztott);
      if (window.innerWidth <= 860) fej.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    szuro.addEventListener('change', rajzol);
    $('#pf-futtat').addEventListener('click', function () {
      var n = idozitettLevelek();
      App.toast(n ? 'Kiment ' + n + ' esedékes időzített levél.' : 'Most nincs esedékes időzített levél.');
      rajzol();
    });
    urit.addEventListener('click', function () {
      if (!uritIdo) {
        urit.textContent = 'Biztosan? Kattints még egyszer'; uritIdo = setTimeout(function () { urit.textContent = 'Postafiók ürítése'; uritIdo = null; }, 4000); return;
      }
      clearTimeout(uritIdo); uritIdo = null; urit.textContent = 'Postafiók ürítése';
      tar.set('hk_levelek', []); kivalasztott = null; rajzol(); App.toast('A postafiókot kiürítettük.');
    });
    rajzol();
  }

  /* ---------- /ertekeles/ ---------- */
  function stars(n) { var s = ''; for (var i = 1; i <= 5; i++) s += i <= n ? '★' : '☆'; return s; }
  function ertekelesOldal() {
    var gy = $('#ert-gyoker'); if (!gy) return;
    var p = new URLSearchParams(location.search), token = (p.get('t') || '').trim(), cs0 = parseInt(p.get('cs'), 10);
    var r = null;
    if (token) tar.get('hk_rendelesek', []).forEach(function (x) { if (x.token === token) r = x; });
    if (!r) {
      gy.innerHTML = '<div class="panel ert-hiba"><h1>Ez az értékelő link nem érvényes</h1><p>Lehet, hogy lejárt, vagy hiányos a hivatkozás. Nyisd meg újra a levelünkben lévő linket, vagy írj nekünk, és segítünk.</p>' +
        '<div class="sor"><a class="gomb gomb-fo" href="/kapcsolat/">Kapcsolat</a><a class="gomb gomb-keret" href="/">Főoldal</a></div><p class="halvany" style="margin:14px 0 0;font-size:.88rem">Mintaoldal: a demóban az értékelő link a <a href="/postafiok/">Demó postafiókban</a> lévő „Véleménykérés” levélből nyitható.</p></div>';
      return;
    }
    var mar = null; tar.get('hk_ertekelesek', []).forEach(function (e) { if (e.token === token) mar = e; });
    function eredmeny(e, mostani) {
      var jo = e.csillag >= 4;
      gy.innerHTML = '<div class="' + (jo ? 'siker-doboz' : 'panel ert-bocsanat') + '">' +
        '<div class="ert-csill-kicsi" aria-label="' + e.csillag + ' csillag az 5-ből">' + stars(e.csillag) + '</div>' +
        (jo ? '<h1>' + (mostani ? 'Köszönjük az értékelést!' : 'Már értékeltél – köszönjük!') + '</h1><p>Nagyon örülünk, hogy elégedett vagy. Ha van egy perced, a Google-ön is megírhatod – ezzel másoknak is sokat segítesz.</p>' +
          '<p><a class="gomb gomb-fo ert-google" href="' + esc(GOOGLE) + '" target="_blank" rel="noopener">Írd meg a Google-ön is</a></p><p class="halvany" style="font-size:.85rem;margin:0">Mintaoldal: a link egy minta Google-értékelő oldalra mutat.</p>'
          : '<h1>Sajnáljuk – felhívunk</h1><p>Köszönjük az őszinte véleményt. Ez nem az a szint, amit szeretnénk nyújtani. Munkaidőben <b>1 munkanapon belül felhívunk</b>, hogy rendbe tegyük a dolgot.</p><p class="mb0">Sürgős esetben hívj minket: <a href="' + esc(CEG.telefon ? 'tel:' + CEG.telefon.replace(/[^\d+]/g, '') : '#') + '">' + esc(CEG.telefon || '') + '</a></p>') + '</div>';
    }
    if (mar) { eredmeny(mar, false); return; }
    var nev = (r.vevo && r.vevo.nev) || '';
    var rad = '';
    for (var n = 1; n <= 5; n++) rad += '<input class="rejtett" type="radio" name="cs" id="cs-' + n + '" value="' + n + '"' + (n === cs0 ? ' checked' : '') + '><label for="cs-' + n + '" title="' + n + ' csillag"><span class="rejtett">' + n + ' csillag</span><span aria-hidden="true">★</span></label>';
    gy.innerHTML = '<div class="panel"><h1>Hogyan tetszett a munkánk?</h1><p class="halvany">' + (nev ? 'Kedves ' + esc(nev) + '! ' : '') + 'A <b>' + esc(r.azon) + '</b> rendelésedet értékeled. Kb. 1 perc.</p>' +
      '<form id="ert-urlap" novalidate><fieldset class="ert-fs"><legend>Hány csillagot adsz?</legend><div class="ert-csillagok" id="ert-csill">' + rad + '</div><div class="ert-hiba-uzenet" id="ert-cs-hiba" role="alert" hidden>Válassz 1 és 5 csillag között.</div></fieldset>' +
      '<div class="mezo"><label for="ert-szoveg">Írd le, mi tetszett, min javíthatnánk <span class="halvany">(nem kötelező)</span></label><textarea id="ert-szoveg" name="szoveg" maxlength="1000"></textarea></div>' +
      '<button class="gomb gomb-fo" type="submit">Értékelés beküldése</button></form></div>';
    var csill = $('#ert-csill'), form = $('#ert-urlap');
    function frissit() { var v = parseInt((form.querySelector('input[name=cs]:checked') || {}).value, 10) || 0; $$('label', csill).forEach(function (l, i) { l.classList.toggle('be', i < v); }); }
    form.addEventListener('change', function () { frissit(); $('#ert-cs-hiba').hidden = true; });
    frissit();
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var ch = form.querySelector('input[name=cs]:checked');
      if (!ch) { var h = $('#ert-cs-hiba'); h.hidden = false; $('#cs-1').focus(); return; }
      var bej = { token: token, rendeles: r.azon, csillag: parseInt(ch.value, 10), szoveg: ($('#ert-szoveg').value || '').trim(), ido: new Date().toISOString() };
      if (bej.csillag <= 3) bej.visszahivas = true;
      var l = tar.get('hk_ertekelesek', []).filter(function (x) { return x.token !== token; }); l.push(bej); tar.set('hk_ertekelesek', l);
      eredmeny(bej, true); window.scrollTo(0, 0);
    });
  }

  /* ---------- Hírlevél ---------- */
  function hirlevelOldal() {
    var urlap = $('#hl-urlap'); if (!urlap) return;
    var p = new URLSearchParams(location.search), eredm = $('#hl-eredmeny');
    function mutatEredmeny(html) { urlap.hidden = true; eredm.hidden = false; eredm.innerHTML = html; }
    if (p.get('leiratkozas') !== null) {
      var em = (p.get('leiratkozas') || '').trim(), tk = (p.get('t') || '').trim();
      var tal = tar.get('hk_hirlevel', []).filter(function (x) { return x.token === tk && x.email.toLowerCase() === em.toLowerCase(); })[0];
      if (!tal) { mutatEredmeny('<h2>Ez a leiratkozó link nem érvényes</h2><p>Lehet, hogy már leiratkoztál. Ha mégis kapsz tőlünk levelet, írj az <a href="mailto:' + esc(CEG.email || '') + '">' + esc(CEG.email || '') + '</a> címre, és azonnal töröljük a címed.</p>'); return; }
      mutatEredmeny('<h2>Leiratkozás a hírlevélről</h2><p>Biztosan leiratkozol erről a címről: <b>' + esc(tal.email) + '</b>?</p><button class="gomb gomb-kek" type="button" id="hl-leir">Leiratkozom</button> <a class="gomb gomb-keret" href="/">Mégsem</a>');
      $('#hl-leir').addEventListener('click', function () {
        tar.set('hk_hirlevel', tar.get('hk_hirlevel', []).filter(function (x) { return x.token !== tk; }));
        var fk = tar.get('hk_fiokok', []), valt = false; fk.forEach(function (f) { if (f.email && f.email.toLowerCase() === em.toLowerCase() && f.hirlevel) { f.hirlevel = false; valt = true; } }); if (valt) tar.set('hk_fiokok', fk);
        mutatEredmeny('<div class="siker-doboz"><h2>Leiratkoztál</h2><p class="mb0">A(z) ' + esc(em) + ' címet töröltük a hírlevél-listáról. Sajnáljuk, hogy mész!</p></div>');
      });
      return;
    }
    urlap.addEventListener('submit', function (e) {
      e.preventDefault();
      var email = $('#hl-email').value.trim(), pipa = $('#hl-pipa').checked;
      var ok1 = emailJo(email), ok2 = pipa;
      $('#hl-email-mezo').classList.toggle('hibas', !ok1); $('#hl-pipa-mezo').classList.toggle('hibas', !ok2);
      if (!ok1) { $('#hl-email').setAttribute('aria-invalid', 'true'); $('#hl-email').focus(); return; } else $('#hl-email').removeAttribute('aria-invalid');
      if (!ok2) { $('#hl-pipa').focus(); return; }
      var l = tar.get('hk_hirlevel', []), mar = l.filter(function (x) { return x.email.toLowerCase() === email.toLowerCase(); })[0];
      if (mar && mar.megerositve === true) {
        mutatEredmeny('<h2>Erre a címre már feliratkoztál</h2><p class="mb0">A(z) <b>' + esc(email) + '</b> már szerepel a hírlevél-listán. Köszönjük!</p>'); return;
      }
      if (!mar) { mar = { email: email, ido: new Date().toISOString(), megerositve: false, token: tokenGen() }; l.push(mar); tar.set('hk_hirlevel', l); }
      level('hirlevel-megerosites', { hirlevel: mar });
      mutatEredmeny('<div class="siker-doboz"><h2>Már csak egy lépés!</h2><p>Küldtünk egy levelet a(z) <b>' + esc(email) + '</b> címre. A feliratkozás akkor lesz érvényes, ha a benne lévő linkre kattintasz.</p><p class="mb0"><a class="gomb gomb-keret" href="/postafiok/">Mintaoldal: levél megnézése a demó postafiókban</a></p></div>');
    });
  }
  function megerositesOldal() {
    var gy = $('#hl-megerosites'); if (!gy) return;
    var tk = (new URLSearchParams(location.search).get('t') || '').trim();
    var l = tar.get('hk_hirlevel', []), mar = null;
    if (tk) l.forEach(function (x) { if (x.token === tk) mar = x; });
    if (!mar) {
      gy.innerHTML = '<div class="panel ert-hiba"><h1>Ez a megerősítő link nem érvényes</h1><p>Lehet, hogy lejárt, vagy hiányos a hivatkozás. Iratkozz fel újra, és küldünk új levelet.</p><p class="mb0"><a class="gomb gomb-fo" href="/hirlevel/">Feliratkozás</a></p></div>'; return;
    }
    if (!mar.megerositve) { mar.megerositve = true; mar.megerositesIdo = new Date().toISOString(); tar.set('hk_hirlevel', l); }
    gy.innerHTML = '<div class="siker-doboz"><h1>Feliratkozás megerősítve</h1><p>Köszönjük! A(z) <b>' + esc(mar.email) + '</b> címre mostantól küldjük a hírlevelet. Minden levélben találsz leiratkozás linket.</p><p class="mb0"><a class="gomb gomb-keret" href="/klimak/">Irány a webshop</a></p></div>';
  }

  /* ---------- Oldalbetöltés ---------- */
  App.horog('oldal', function () {
    try { idozitettLevelek(); } catch (e) { console.error('[idozitett]', e); }
    [postafiokOldal, ertekelesOldal, hirlevelOldal, megerositesOldal].forEach(function (f) { try { f(); } catch (e) { console.error('[levelek]', e); } });
  });
})();

/* ---- modul: seo ---- */
(function () {
  'use strict';
  var App = window.HKApp; if (!App) return;
  var tar = App.tar;
  var MAX_MERO = 300, MAX_HIBA = 50, GCLID_NAP = 90;

  /* ---------- Consent Mode v2 (gtag-stub; a CSP miatt nem lehet inline szkript) ---------- */
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied', wait_for_update: 500 });

  var dontes = tar.get('hk_suti', null); // {ido, stat, hird}
  function engedelyez(d) {
    dontes = d || {};
    var h = dontes.hird ? 'granted' : 'denied';
    gtag('consent', 'update', { ad_storage: h, ad_user_data: h, ad_personalization: h, analytics_storage: dontes.stat ? 'granted' : 'denied' });
  }
  if (dontes && (dontes.stat || dontes.hird)) engedelyez(dontes);

  var mehet = function () { return !!(dontes && (dontes.stat || dontes.hird)); };

  /* ---------- Mérés: csak hozzájárulással, csak a hk_mero-ba (a Google-szkript NEM töltődik be) ---------- */
  function mero(esemeny, adat) {
    if (!mehet()) return;
    var l = tar.get('hk_mero', []);
    var rek = { ido: new Date().toISOString(), esemeny: esemeny, oldal: location.pathname };
    for (var k in (adat || {})) if (Object.prototype.hasOwnProperty.call(adat, k)) rek[k] = adat[k];
    l.push(rek); if (l.length > MAX_MERO) l = l.slice(l.length - MAX_MERO);
    tar.set('hk_mero', l);
    window.dataLayer.push({ event: esemeny, value: rek.ertek, currency: 'HUF' });
  }

  var pvKesz = false;
  function pageView() { if (pvKesz || !mehet()) return; pvKesz = true; mero('page_view', { cim: document.title }); }

  /* ---------- GCLID / UTM: csak hirdetési hozzájárulás után kerül a hk_gclid-be ---------- */
  var fuggo = null;
  (function () {
    try {
      var p = new URLSearchParams(location.search), o = {}, van = false;
      ['gclid', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach(function (k) {
        var v = p.get(k); if (v) { o[k] = String(v).slice(0, 120); van = true; }
      });
      if (van) { o.ido = Date.now(); o.lejar = Date.now() + GCLID_NAP * 864e5; fuggo = o; }
    } catch (e) { }
  })();
  function gclidMent() {
    if (!fuggo || !dontes || !dontes.hird) return;
    tar.set('hk_gclid', fuggo); fuggo = null;
  }
  function forras() {
    var g = tar.get('hk_gclid', null);
    if (!g || !g.lejar || g.lejar < Date.now() || !dontes || !dontes.hird) return null;
    var f = {}; for (var k in g) if (k !== 'lejar' && Object.prototype.hasOwnProperty.call(g, k)) f[k] = g[k];
    return f;
  }
  gclidMent();

  /* ---------- Horgok ---------- */
  App.horog('suti', function (d) { engedelyez(d); gclidMent(); pageView(); });
  App.horog('oldal', function () {
    pageView();
    if (location.pathname === '/penztar/') mero('begin_checkout', { ertek: App.Kosar.tetelek().reduce(function (s, x) { var i = App.tetelInfo(x); return s + (i ? i.osszeg : 0); }, 0) });
  });
  App.horog('rendeles', function (r) { var f = forras(); if (f) r.forras = f; });
  App.horog('rendeles-mentve', function (r) { mero('purchase', { ertek: r.osszesen, azon: r.azon, tetelek: (r.tetelek || []).length }); });

  // add_to_cart: a Kosar.hozzaad köré csomagolva (az app.js-hez nem nyúlunk)
  var K = App.Kosar, eredeti = K.hozzaad;
  K.hozzaad = function (x) {
    var vissza = eredeti.apply(K, arguments);
    try { var i = App.tetelInfo(x); mero('add_to_cart', { ertek: i ? i.osszeg : 0, nev: i ? i.nev : x.id, db: x.db }); } catch (e) { }
    return vissza;
  };

  /* ---------- Hibanapló ---------- */
  var hibaBent = false;
  function hiba(uzenet, hely) {
    if (hibaBent) return; hibaBent = true;
    try {
      var l = tar.get('hk_hibak', []);
      l.unshift({ ido: new Date().toISOString(), uzenet: String(uzenet || '').slice(0, 300), hely: String(hely || '').slice(0, 200), oldal: location.pathname });
      tar.set('hk_hibak', l.slice(0, MAX_HIBA));
    } catch (e) { }
    hibaBent = false;
  }
  window.addEventListener('error', function (e) {
    hiba(e.message || 'Ismeretlen hiba', (e.filename || '') + ':' + (e.lineno || 0) + ':' + (e.colno || 0));
  });
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason; hiba('Kezeletlen Promise-hiba: ' + (r && r.message ? r.message : r), r && r.stack ? String(r.stack).split('\n')[1] || '' : '');
  });
})();
