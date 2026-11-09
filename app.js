/* Heures KA-RÉ — appli de pointage, congés et absences.
   Les données vivent dans Notion ; l'appli n'y accède que par le webhook Make
   « KA-RE - Appli heures (API) » (scénario 10133675).
   Règle de validation : rien à faire si la journée est conforme au prévu.
   Une modification par l'un passe « En attente » et l'autre valide. */
"use strict";

var VERSION = "1.0";
var API = "https://hook.eu2.make.com/6s1rm6e4ohvpsp4pujkv92ua9hfpdtd6";
var STOCK = "kare_heures_";

/* ---------- petits outils ---------- */
function $(id) { return document.getElementById(id); }
function el(tag, attrs, enfants) {
  var n = document.createElement(tag);
  if (attrs) Object.keys(attrs).forEach(function (k) {
    if (k === "text") n.textContent = attrs[k];
    else if (k === "html") n.innerHTML = attrs[k];
    else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), attrs[k]);
    else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) n.setAttribute(k, attrs[k]);
  });
  (enfants || []).forEach(function (c) { if (c) n.appendChild(typeof c === "string" ? document.createTextNode(c) : c); });
  return n;
}
function lire(k, def) { try { var v = localStorage.getItem(STOCK + k); return v === null ? def : JSON.parse(v); } catch (e) { return def; } }
function ecrire(k, v) { try { localStorage.setItem(STOCK + k, JSON.stringify(v)); } catch (e) { /* stockage plein ou bloqué */ } }
function oublier(k) { try { localStorage.removeItem(STOCK + k); } catch (e) {} }

/* ---------- dates (toujours en heure locale) ---------- */
function iso(d) { return d.getFullYear() + "-" + ("0" + (d.getMonth() + 1)).slice(-2) + "-" + ("0" + d.getDate()).slice(-2); }
function versDate(s) { var p = s.split("-"); return new Date(+p[0], +p[1] - 1, +p[2]); }
function plusJours(d, n) { var r = new Date(d.getFullYear(), d.getMonth(), d.getDate()); r.setDate(r.getDate() + n); return r; }
function lundi(d) { var j = (d.getDay() + 6) % 7; return plusJours(d, -j); }
var JOURS = ["dim", "lun", "mar", "mer", "jeu", "ven", "sam"];
var JOURS_LONGS = ["Dimanche", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi"];
var MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
function joli(d) { return d.getDate() + " " + MOIS[d.getMonth()]; }
function jolis(s) { return s ? joli(versDate(s)) : ""; }

/* Jours fériés en Moselle (droit local : + Vendredi saint et 26 décembre) */
function paques(a) {
  var b = a % 19, c = Math.floor(a / 100), d = a % 100, e = Math.floor(c / 4), f = c % 4,
    g = Math.floor((c + 8) / 25), h = Math.floor((c - g + 1) / 3), i = (19 * b + c - e - h + 15) % 30,
    k = Math.floor(d / 4), l = d % 4, m = (32 + 2 * f + 2 * k - i - l) % 7, n = Math.floor((b + 11 * i + 22 * m) / 451),
    mois = Math.floor((i + m - 7 * n + 114) / 31), jour = ((i + m - 7 * n + 114) % 31) + 1;
  return new Date(a, mois - 1, jour);
}
var _feries = {};
function feries(a) {
  if (_feries[a]) return _feries[a];
  var p = paques(a), r = {};
  [["01-01", "Jour de l'an"], ["05-01", "Fête du travail"], ["05-08", "Victoire 1945"], ["07-14", "Fête nationale"],
   ["08-15", "Assomption"], ["11-01", "Toussaint"], ["11-11", "Armistice"], ["12-25", "Noël"], ["12-26", "Saint-Étienne"]]
    .forEach(function (x) { r[a + "-" + x[0]] = x[1]; });
  r[iso(plusJours(p, -2))] = "Vendredi saint";
  r[iso(plusJours(p, 1))] = "Lundi de Pâques";
  r[iso(plusJours(p, 39))] = "Ascension";
  r[iso(plusJours(p, 50))] = "Lundi de Pentecôte";
  return (_feries[a] = r);
}
function ferie(s) { return feries(+s.slice(0, 4))[s] || null; }

/* ---------- heures ---------- */
function minutes(hhmm) { if (!hhmm) return null; var p = hhmm.split(":"); return +p[0] * 60 + +p[1]; }
function duree(arr, dep, pause) {
  var a = minutes(arr), d = minutes(dep);
  if (a === null || d === null || d <= a) return 0;
  return Math.max(0, d - a - (pause || 0)) / 60;
}
function hFmt(h) {
  var m = Math.round(h * 60), hh = Math.floor(m / 60), mm = m % 60;
  return hh + "h" + (mm ? ("0" + mm).slice(-2) : "");
}
function horaire(s) { return s ? s.replace(":", "h") : "—"; }

/* ---------- lecture des pages Notion ---------- */
function P(page, nom) { return (page && page.properties && page.properties[nom]) || {}; }
function txt(page, nom) { var p = P(page, nom), t = p.title || p.rich_text || []; return t.map(function (x) { return x.plain_text; }).join(""); }
function sel(page, nom) { var p = P(page, nom); return p.select ? p.select.name : ""; }
function num(page, nom) { var p = P(page, nom); return typeof p.number === "number" ? p.number : null; }
function coche(page, nom) { return !!P(page, nom).checkbox; }
function dateDe(page, nom) { var p = P(page, nom); return p.date ? { debut: p.date.start, fin: p.date.end || p.date.start } : null; }
function rel(page, nom) { var p = P(page, nom); return (p.relation || []).map(function (r) { return r.id; }); }
function liste(x) {
  /* Make renvoie parfois un tableau vide sous la forme {"bundle":{}} : on normalise */
  if (Array.isArray(x)) return x.filter(function (p) { return p && p.id; });
  return [];
}

/* ---------- écriture des propriétés Notion ---------- */
var N = {
  titre: function (s) { return { title: [{ text: { content: s } }] }; },
  texte: function (s) { return { rich_text: s ? [{ text: { content: String(s).slice(0, 1900) } }] : [] }; },
  choix: function (s) { return { select: s ? { name: s } : null }; },
  nombre: function (n) { return { number: n === null || n === undefined || n === "" ? null : +n }; },
  case_: function (b) { return { checkbox: !!b }; },
  date: function (d, f) { return { date: d ? { start: d, end: f && f !== d ? f : null } : null }; },
  lien: function (id) { return { relation: [{ id: id }] }; }
};

/* ---------- état ---------- */
var S = {
  code: lire("code", null),
  moiId: null,
  salaries: [],
  params: [],
  heures: lire("heures", []),
  conges: lire("conges", []),
  choisi: lire("choisi", null),
  semaine: lundi(new Date()),
  onglet: "semaine",
  charge: {}
};
var donnees = lire("donnees", null);
if (donnees) { S.moiId = donnees.moiId; S.salaries = donnees.salaries; S.params = donnees.params; }

function moi() { return S.salaries.filter(function (s) { return s.id === S.moiId; })[0] || null; }
function estPatron() { var m = moi(); return !!m && sel(m, "Profil") === "Patron"; }
function salariesPointes() { return S.salaries.filter(function (s) { return sel(s, "Profil") !== "Patron"; }); }
function salarieVu() {
  if (!estPatron()) return moi();
  var l = salariesPointes();
  return l.filter(function (s) { return s.id === S.choisi; })[0] || l[0] || null;
}
function nomCourt(s) { var n = txt(s, "Nom").split(" "); return n.length > 1 ? n.slice(1).join(" ") : n[0]; }
function role() { return estPatron() ? "Patron" : "Salarié"; }
function autre() { return estPatron() ? "le salarié" : "le patron"; }
function autreDu() { return estPatron() ? "du salarié" : "du patron"; }

/* ---------- échanges avec Make ---------- */
function appel(corps) {
  corps.code = S.code;
  var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  var minuteur = setTimeout(function () { if (ctrl) ctrl.abort(); }, 40000);
  return fetch(API, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: "payload=" + encodeURIComponent(JSON.stringify(corps)),
    signal: ctrl ? ctrl.signal : undefined
  }).then(function (r) {
    clearTimeout(minuteur);
    return r.text().then(function (t) {
      var j = null;
      try { j = JSON.parse(t); } catch (e) { /* « Accepted » = refus silencieux du scénario */ }
      if (r.status === 403 || (j && j.ok === false)) { var e1 = new Error("code"); e1.refus = true; throw e1; }
      if (!j || !j.ok) throw new Error("Réponse inattendue du serveur");
      return j;
    });
  }, function (e) { clearTimeout(minuteur); throw e; });
}

function plageChargement(d) {
  return { debut: iso(plusJours(lundi(d), -14)), fin: iso(plusJours(lundi(d), 13)) };
}

function chargerTout(dateRef) {
  var p = plageChargement(dateRef || S.semaine);
  return appel({ action: "init", debut: p.debut, fin: p.fin }).then(function (j) {
    S.moiId = j.moi_id;
    S.salaries = liste(j.salaries);
    S.params = liste(j.params);
    fusionHeures(liste(j.heures), p);
    S.conges = liste(j.conges);
    ecrire("donnees", { moiId: S.moiId, salaries: S.salaries, params: S.params });
    ecrire("conges", S.conges);
    S.charge = {};
    marquerCharge(p);
  });
}
function chargerHeures(dateRef) {
  var p = plageChargement(dateRef);
  var v = salarieVu();
  return appel({ action: "heures", debut: p.debut, fin: p.fin, salarie_id: estPatron() && v ? v.id : "" }).then(function (j) {
    fusionHeures(liste(j.heures), p);
    S.conges = liste(j.conges);
    ecrire("conges", S.conges);
    marquerCharge(p);
  });
}
function marquerCharge(p) {
  for (var d = versDate(p.debut); iso(d) <= p.fin; d = plusJours(d, 7)) S.charge[iso(lundi(d))] = true;
}
function fusionHeures(nouvelles, p) {
  var vu = salarieVu();
  S.heures = S.heures.filter(function (h) {
    var d = (dateDe(h, "Date") || {}).debut;
    if (!d || d < p.debut || d > p.fin) return true;
    /* en profil patron on ne recharge qu'un salarié : on garde les autres */
    if (estPatron() && vu && rel(h, "Salarié").indexOf(vu.id) < 0) return true;
    return false;
  }).concat(nouvelles);
  ecrire("heures", S.heures.slice(-400));
}

/* ---------- semaine type et journée prévue ---------- */
function semaineType(s) {
  try { var j = JSON.parse(txt(s, "Semaine type") || "{}"); return j; } catch (e) { return {}; }
}
function absenceLe(salId, date) {
  return S.conges.filter(function (c) {
    var st = sel(c, "Statut"), p = dateDe(c, "Période");
    return p && rel(c, "Salarié").indexOf(salId) >= 0 && date >= p.debut && date <= p.fin &&
      (st === "Accordé" || (st === "Demandé" && /Arrêt|Malade/.test(sel(c, "Type"))));
  })[0] || null;
}
function statutAbsence(c) {
  var t = sel(c, "Type");
  if (/sans solde/.test(t)) return "Sans solde";
  if (/Arrêt/.test(t)) return "Arrêt";
  if (/Malade/.test(t)) return "Malade";
  if (/Examen/.test(t)) return "Examen";
  return "Congé";
}
function enregistrementDu(salId, date) {
  return S.heures.filter(function (h) {
    return rel(h, "Salarié").indexOf(salId) >= 0 && (dateDe(h, "Date") || {}).debut === date;
  })[0] || null;
}
/* La journée telle qu'elle s'affiche : l'enregistrement s'il existe, sinon le prévu. */
function journee(sal, date) {
  var d = versDate(date), cle = JOURS[d.getDay()], st = semaineType(sal)[cle];
  var rec = enregistrementDu(sal.id, date);
  var fer = ferie(date), abs = absenceLe(sal.id, date);
  var j = {
    date: date, rec: rec, ferie: fer, absence: abs,
    prevu: st ? { arrivee: st[0], depart: st[1], pause: st[2] || 0 } : null
  };
  /* Avant le premier jour ou après la fin du contrat : rien à saisir, rien à modifier. */
  if (horsContrat(sal, date)) {
    j.horsContrat = true; j.statut = "Hors contrat"; j.validation = "Prévu"; j.arrivee = ""; j.depart = "";
    j.pause = 0; j.heures = 0; j.panier = false; j.rec = null; j.confS = true; j.confP = true;
    return j;
  }
  if (rec) {
    j.statut = sel(rec, "Statut jour") || "Travaillé";
    j.arrivee = txt(rec, "Arrivée"); j.depart = txt(rec, "Départ");
    j.pause = num(rec, "Pause (min)") || 0;
    j.validation = sel(rec, "Validation") || "Prévu";
    j.modifiePar = sel(rec, "Modifié par");
    j.chantiers = txt(rec, "Chantiers"); j.commentaire = txt(rec, "Commentaire");
    j.panier = coche(rec, "Panier"); j.zone = num(rec, "Zone trajet");
    j.confS = coche(rec, "Semaine confirmée salarié"); j.confP = coche(rec, "Semaine confirmée patron");
  } else {
    j.validation = "Prévu"; j.modifiePar = ""; j.chantiers = ""; j.commentaire = ""; j.zone = null;
    j.confS = false; j.confP = false;
    var ecole = st && enCFA(sal, date);
    if (fer) j.statut = "Férié";
    else if (ecole) j.statut = "CFA";
    else if (abs) j.statut = statutAbsence(abs);
    else if (st) j.statut = "Travaillé";
    else j.statut = "Repos";
    if (j.statut === "Travaillé") {
      j.arrivee = st[0]; j.depart = st[1]; j.pause = st[2] || 0;
      j.panier = panierParDefaut(j);
    } else if (j.statut === "CFA") {
      j.arrivee = HORAIRE_CFA[0]; j.depart = HORAIRE_CFA[1]; j.pause = HORAIRE_CFA[2]; j.panier = false;
    } else { j.arrivee = ""; j.depart = ""; j.pause = 0; j.panier = false; }
  }
  j.heures = (j.statut === "Travaillé" || j.statut === "CFA") ? duree(j.arrivee, j.depart, j.pause) : 0;
  return j;
}
function horsContrat(sal, date) {
  var deb = (dateDe(sal, "Début contrat") || {}).debut, fin = (dateDe(sal, "Fin contrat") || {}).debut;
  return (deb && date < deb) || (fin && date > fin);
}
/* Planning CFA : champ « Planning école » de la fiche salarié, au format
   [["2026-11-16","2026-11-20"], ...]. Les jours d'école se posent tout seuls.
   Horaires du CFA d'après la convocation : 8h30-16h30 (pause repas 1 h). */
var HORAIRE_CFA = ["08:30", "16:30", 60];
function planningCFA(sal) {
  try { var p = JSON.parse(txt(sal, "Planning école") || "[]"); return Array.isArray(p) ? p : []; } catch (e) { return []; }
}
function enCFA(sal, date) {
  return planningCFA(sal).some(function (x) { return date >= x[0] && date <= (x[1] || x[0]); });
}
/* Panier : seulement une journée complète sur chantier (pas une demi-journée
   où il mange chez lui). Réponse CAPEB du 04/11/2026. Modifiable à la main. */
function panierParDefaut(j) {
  return j.statut === "Travaillé" && minutes(j.depart) !== null && minutes(j.depart) > 13 * 60 + 30 &&
    minutes(j.arrivee) !== null && minutes(j.arrivee) < 12 * 60;
}
function joursDeLaSemaine(sal, l) {
  var r = [];
  for (var i = 0; i < 7; i++) {
    var date = iso(plusJours(l, i)), j = journee(sal, date);
    if (i < 5 || j.rec) r.push(j);
  }
  return r;
}

/* ---------- règles d'âge (apprenti mineur) ---------- */
function ageLe(sal, date) {
  var n = (dateDe(sal, "Date de naissance") || {}).debut;
  if (!n) return 99;
  var a = versDate(n), d = versDate(date), age = d.getFullYear() - a.getFullYear();
  if (d.getMonth() < a.getMonth() || (d.getMonth() === a.getMonth() && d.getDate() < a.getDate())) age--;
  return age;
}
function avertissementsJour(sal, j) {
  var w = [], age = ageLe(sal, j.date);
  if (j.statut !== "Travaillé") return w;
  if (age < 18) {
    if (j.heures > 8) w.push("Plus de 8 h dans la journée : interdit pour un mineur.");
    var limite = age < 16 ? 20 * 60 : 22 * 60;
    if (minutes(j.depart) > limite) w.push("Travail après " + (age < 16 ? "20 h" : "22 h") + " : interdit à son âge.");
    if (minutes(j.arrivee) !== null && minutes(j.arrivee) < 6 * 60) w.push("Travail avant 6 h : interdit pour un mineur.");
    var amplitude = (minutes(j.depart) || 0) - (minutes(j.arrivee) || 0);
    if (amplitude - j.pause > 270 && j.pause < 30) w.push("Plus de 4 h 30 de travail : pause de 30 min obligatoire.");
  }
  if (j.ferie && age < 18) w.push("Jour férié : un apprenti mineur ne travaille pas.");
  return w;
}

/* ---------- affichage ---------- */
var ETATS = {
  "Prévu": ["e-prevu", "Prévu"], "En attente": ["e-attente", "À valider"],
  "Validé": ["e-valide", "Validé"], "Refusé": ["e-refuse", "Refusé"]
};
function badge(j) {
  if (j.rec) {
    var e = ETATS[j.validation] || ETATS["Prévu"];
    var txtE = e[1];
    if (j.validation === "En attente") txtE = j.modifiePar === role() ? "Attente " + (estPatron() ? "salarié" : "patron") : "À valider";
    return el("span", { class: "etat " + e[0], text: txtE });
  }
  if (j.statut !== "Travaillé" && j.statut !== "Repos") return el("span", { class: "etat e-absence", text: j.statut });
  return el("span", { class: "etat e-prevu", text: "Prévu" });
}
function ligneJour(sal, j) {
  var d = versDate(j.date), auj = j.date === iso(new Date());
  var detail;
  if (j.horsContrat) return el("div", { class: "jour off" }, [el("div", { class: "j" }, [JOURS_LONGS[d.getDay()].slice(0, 3) + ".", el("small", { text: joli(d) })]),
    el("div", { class: "h" }, ["Hors contrat", el("small", { text: "Pas encore embauché ou contrat terminé" })]), el("span")]);
  if (j.statut === "CFA") detail = el("div", { class: "h" }, ["École (CFA)", el("small", { text: horaire(j.arrivee) + " – " + horaire(j.depart) + " · " + hFmt(j.heures) })]);
  else if (j.statut === "Travaillé") detail = el("div", { class: "h" }, [horaire(j.arrivee) + " – " + horaire(j.depart),
    el("small", { text: hFmt(j.heures) + (j.pause ? " · pause " + j.pause + " min" : "") + (j.chantiers ? " · " + j.chantiers : "") })]);
  else detail = el("div", { class: "h" }, [j.statut, el("small", { text: j.ferie || (j.absence ? sel(j.absence, "Type") : "") || "" })]);
  return el("button", {
    type: "button", class: "jour" + (auj ? " aujourdhui" : "") + (j.statut !== "Travaillé" ? " off" : ""),
    onclick: function () { ouvrirJour(sal, j.date); }
  }, [el("div", { class: "j" }, [JOURS_LONGS[d.getDay()].slice(0, 3) + ".", el("small", { text: joli(d) })]), detail, badge(j)]);
}

function afficher() {
  $("ecranChargement").hidden = true;
  if (!S.code) { $("ecranCode").hidden = false; $("ecranAppli").hidden = true; $("btnMaj").hidden = true; $("qui").textContent = ""; return; }
  $("ecranCode").hidden = true; $("ecranAppli").hidden = false; $("btnMaj").hidden = false;
  var m = moi();
  $("qui").textContent = m ? txt(m, "Nom") : "";
  afficherSalaries();
  afficherAlertes();
  $("vueSemaine").hidden = S.onglet !== "semaine";
  $("vueConges").hidden = S.onglet !== "conges";
  document.querySelectorAll(".onglets button").forEach(function (b) { b.setAttribute("aria-selected", b.dataset.onglet === S.onglet ? "true" : "false"); });
  if (S.onglet === "semaine") afficherSemaine(); else afficherConges();
}

function aValider(sal) {
  var n = 0;
  S.heures.forEach(function (h) {
    if (rel(h, "Salarié").indexOf(sal.id) >= 0 && sel(h, "Validation") === "En attente" && sel(h, "Modifié par") !== role()) n++;
  });
  if (estPatron()) S.conges.forEach(function (c) {
    if (rel(c, "Salarié").indexOf(sal.id) >= 0 && sel(c, "Statut") === "Demandé") n++;
  });
  return n;
}

function afficherSalaries() {
  var nav = $("salaries");
  if (!estPatron()) { nav.hidden = true; return; }
  nav.hidden = false; nav.innerHTML = "";
  var vu = salarieVu();
  salariesPointes().forEach(function (s) {
    var n = aValider(s);
    nav.appendChild(el("button", {
      type: "button", "aria-pressed": vu && vu.id === s.id ? "true" : "false",
      onclick: function () { S.choisi = s.id; ecrire("choisi", s.id); S.charge = {}; afficher(); rafraichir(); }
    }, [txt(s, "Nom"), n ? el("span", { class: "pastille", text: String(n) }) : null]));
  });
}

function afficherAlertes() {
  var z = $("alertes"); z.innerHTML = "";
  var vu = salarieVu(); if (!vu) return;
  var n = aValider(vu);
  if (n) z.appendChild(el("button", { type: "button", class: "alerte jaune lien", onclick: function () { listeAValider(vu); } },
    [n === 1 ? "1 élément attend ta validation" : n + " éléments attendent ta validation", el("span", { text: "Voir ›" })]));
  var att = lire("attente", []);
  if (att.length) z.appendChild(el("div", { class: "alerte bleu", text: att.length + " envoi(s) en attente de réseau. Ils partiront tout seuls." }));
  avisReponses(vu).forEach(function (a) {
    var ok = el("button", { type: "button", class: "btn second", text: "OK, vu" });
    ok.addEventListener("click", function () { var v = lire("vus", {}); v[a.cle] = 1; ecrire("vus", v); afficherAlertes(); });
    z.appendChild(el("div", { class: "alerte " + (a.ok ? "vert" : "rouge") }, [
      el("div", { text: a.texte }), a.motif ? el("div", { class: "motif", text: "Motif : " + a.motif }) : null, ok]));
  });
}
/* Réponses à MES modifications et demandes : acceptée ou refusée, avec le motif.
   Chaque avis s'affiche jusqu'à ce qu'on appuie sur « OK, vu » (mémorisé dans le téléphone). */
function avisReponses(sal) {
  var vus = lire("vus", {}), r = [], qui = estPatron() ? "Le salarié" : "Le patron";
  S.heures.forEach(function (h) {
    if (rel(h, "Salarié").indexOf(sal.id) < 0 || sel(h, "Modifié par") !== role()) return;
    var v = sel(h, "Validation"); if (v !== "Validé" && v !== "Refusé") return;
    var cle = h.id + "|" + v + "|" + (h.last_edited_time || ""); if (vus[cle]) return;
    var d = (dateDe(h, "Date") || {}).debut, jr = versDate(d);
    r.push({ cle: cle, ok: v === "Validé", motif: v === "Refusé" ? txt(h, "Motif") : "",
      texte: (v === "Validé" ? "✅ " : "❌ ") + qui + " a " + (v === "Validé" ? "accepté" : "refusé") + (" ta modification du " + JOURS_LONGS[jr.getDay()].toLowerCase() + " " + joli(jr) + ".").replace("..", ".") });
  });
  S.conges.forEach(function (c) {
    if (rel(c, "Salarié").indexOf(sal.id) < 0 || sel(c, "Demandé par") !== role()) return;
    var st = sel(c, "Statut"); if (st !== "Accordé" && st !== "Refusé") return;
    if (estPatron()) return; /* le patron accorde lui-même ce qu'il pose */
    var cle = c.id + "|" + st + "|" + (c.last_edited_time || ""); if (vus[cle]) return;
    var p = dateDe(c, "Période") || {};
    r.push({ cle: cle, ok: st === "Accordé", motif: st === "Refusé" ? txt(c, "Motif") : "",
      texte: (st === "Accordé" ? "✅ " : "❌ ") + "Ta demande (" + sel(c, "Type").toLowerCase() + " du " + jolis(p.debut) + (p.fin !== p.debut ? " au " + jolis(p.fin) : "") + ") a été " + (st === "Accordé" ? "acceptée." : "refusée.") });
  });
  return r;
}

/* Liste de ce qui attend ma validation : un appui ouvre l'élément. */
function listeAValider(sal) {
  var feuille = $("feuille"); feuille.innerHTML = "";
  feuille.appendChild(el("div", { class: "tete" }, [el("h2", { text: "À valider" }),
    el("button", { type: "button", class: "fermer", "aria-label": "Fermer", onclick: fermer }, ["✕"])]));
  var l = el("div", { class: "liste" });
  S.heures.filter(function (h) {
    return rel(h, "Salarié").indexOf(sal.id) >= 0 && sel(h, "Validation") === "En attente" && sel(h, "Modifié par") !== role();
  }).sort(function (a, b) { return (dateDe(a, "Date") || {}).debut < (dateDe(b, "Date") || {}).debut ? -1 : 1; })
    .forEach(function (h) {
      var d = (dateDe(h, "Date") || {}).debut, jr = versDate(d);
      var qui = sel(h, "Modifié par") === "Patron" ? "le patron" : sel(h, "Modifié par") === "Claude" ? "Claude" : "le salarié";
      l.appendChild(el("button", { type: "button", class: "jour", onclick: function () {
        fermer(); S.onglet = "semaine"; S.semaine = lundi(jr); afficher(); ouvrirJour(sal, d);
      } }, [el("div", { class: "j" }, [JOURS_LONGS[jr.getDay()].slice(0, 3) + ".", el("small", { text: joli(jr) })]),
        el("div", { class: "h" }, ["Journée modifiée", el("small", { text: "par " + qui })]), el("span", { class: "etat e-attente", text: "Voir" })]));
    });
  if (estPatron()) S.conges.filter(function (c) { return rel(c, "Salarié").indexOf(sal.id) >= 0 && sel(c, "Statut") === "Demandé"; })
    .forEach(function (c) {
      var p = dateDe(c, "Période") || {};
      l.appendChild(el("button", { type: "button", class: "jour", onclick: function () { fermer(); S.onglet = "conges"; afficher(); } },
        [el("div", { class: "j" }, ["🌴"]), el("div", { class: "h" }, [sel(c, "Type"), el("small", { text: "du " + jolis(p.debut) + " au " + jolis(p.fin) })]),
          el("span", { class: "etat e-attente", text: "Voir" })]));
    });
  feuille.appendChild(l);
  ouvrir();
}

function afficherSemaine() {
  var v = $("vueSemaine"); v.innerHTML = "";
  var sal = salarieVu();
  if (!sal) { v.appendChild(el("p", { class: "doux", text: "Aucun salarié à afficher." })); return; }
  var l = S.semaine, fin = plusJours(l, 6);
  v.appendChild(el("div", { class: "semnav" }, [
    el("button", { type: "button", "aria-label": "Semaine précédente", onclick: function () { changerSemaine(-7); } }, ["‹"]),
    el("h2", { text: "Semaine du " + joli(l) + " au " + joli(fin) }),
    el("button", { type: "button", "aria-label": "Semaine suivante", onclick: function () { changerSemaine(7); } }, ["›"])
  ]));
  if (!S.charge[iso(l)]) v.appendChild(el("p", { class: "note", text: "Mise à jour en cours…" }));
  var js = joursDeLaSemaine(sal, l), total = 0;
  var box = el("div", { class: "jours" });
  js.forEach(function (j) { total += j.heures; box.appendChild(ligneJour(sal, j)); });
  v.appendChild(box);
  var trop = ageLe(sal, iso(l)) < 18 && total > 35;
  v.appendChild(el("div", { class: "total" + (trop ? " trop" : "") }, [el("span", { text: "Heures travaillées" }), el("span", { text: hFmt(total) + (trop ? " (max 35 h)" : "") })]));

  /* confirmation de la semaine */
  var travailles = js.filter(function (j) { return iso(plusJours(l, 4)) >= j.date && !j.horsContrat; });
  var confS = travailles.length && travailles.every(function (j) { return j.confS; });
  var confP = travailles.length && travailles.every(function (j) { return j.confP; });
  var enAttente = js.filter(function (j) { return j.rec && j.validation === "En attente"; }).length;
  var maConf = estPatron() ? confP : confS;
  var c = el("div", { class: "confirm" });
  c.appendChild(el("p", { class: "signes", text: "Salarié : " + (confS ? "semaine confirmée ✓" : "pas encore confirmée") + " · Patron : " + (confP ? "semaine confirmée ✓" : "pas encore confirmée") }));
  var vendredi = plusJours(l, 4);
  if (!maConf && travailles.length && new Date() >= new Date(vendredi.getFullYear(), vendredi.getMonth(), vendredi.getDate(), 12)) {
    var b = el("button", { type: "button", class: "btn", text: enAttente ? "Il reste " + enAttente + " journée(s) à valider" : "Je confirme la semaine", disabled: enAttente ? "disabled" : null });
    b.addEventListener("click", function () { confirmerSemaine(sal, js, b); });
    c.appendChild(b);
  }
  v.appendChild(c);
}

function changerSemaine(n) {
  S.semaine = plusJours(S.semaine, n);
  afficher();
  if (!S.charge[iso(S.semaine)]) chargerHeures(S.semaine).then(afficher).catch(function () { toast("Pas de réseau : affichage de ce qui est en mémoire.", "ko"); afficher(); });
}

/* ---------- édition d'une journée ---------- */
var STATUTS = ["Travaillé", "CFA", "Congé", "Sans solde", "Malade", "Arrêt", "Intempérie", "Férié", "Repos"];
function ouvrirJour(sal, date) {
  var j = journee(sal, date), d = versDate(date);
  var f = { statut: j.statut, arrivee: j.arrivee || (j.prevu ? j.prevu.arrivee : "08:30"), depart: j.depart || (j.prevu ? j.prevu.depart : "17:30"),
    pause: j.pause, chantiers: j.chantiers || "", commentaire: j.commentaire || "", panier: j.panier, zone: j.zone };
  var feuille = $("feuille"); feuille.innerHTML = "";
  feuille.appendChild(el("div", { class: "tete" }, [el("h2", { text: JOURS_LONGS[d.getDay()] + " " + joli(d) }),
    el("button", { type: "button", class: "fermer", "aria-label": "Fermer", onclick: fermer }, ["✕"])]));
  if (j.ferie) feuille.appendChild(el("div", { class: "alerte bleu", text: "Jour férié : " + j.ferie }));
  if (j.absence && !j.rec) feuille.appendChild(el("div", { class: "alerte bleu", text: sel(j.absence, "Type") + " (" + sel(j.absence, "Statut") + ")" }));

  /* Validation demandée à moi */
  if (j.rec && j.validation === "En attente" && j.modifiePar !== role()) {
    feuille.appendChild(el("div", { class: "alerte jaune", text: (j.modifiePar === "Patron" ? "Le patron" : j.modifiePar === "Claude" ? "Claude" : "Le salarié") + " a modifié cette journée. Tu valides ?" }));
    var bv = el("button", { type: "button", class: "btn vert", text: "Je valide" });
    var br = el("button", { type: "button", class: "btn rouge", text: "Je refuse" });
    bv.addEventListener("click", function () { decider(j, "Validé", bv); });
    br.addEventListener("click", function () { decider(j, "Refusé", br); });
    feuille.appendChild(el("div", { class: "duo" }, [bv, br]));
    feuille.appendChild(el("p", { class: "note", text: "Ou corrige ci-dessous : ta correction repart en validation chez " + autre() + "." }));
  } else if (j.rec && j.validation === "En attente") {
    feuille.appendChild(el("div", { class: "alerte jaune", text: "Modification envoyée, en attente de validation par " + autre() + "." }));
  } else if (j.rec && j.validation === "Refusé") {
    feuille.appendChild(el("div", { class: "alerte rouge", text: "Modification refusée" + (txt(j.rec, "Motif") ? " : " + txt(j.rec, "Motif") : ".") + " Corrige ou parlez-en ensemble." }));
  }

  var zone = el("div", { class: "champ" }, [el("span", { text: "Ce jour-là" })]);
  var choix = el("div", { class: "choix" });
  STATUTS.forEach(function (s) {
    var b = el("button", { type: "button", "aria-pressed": f.statut === s ? "true" : "false", text: s });
    b.addEventListener("click", function () { f.statut = s; choix.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); maj(); });
    choix.appendChild(b);
  });
  zone.appendChild(choix); feuille.appendChild(zone);

  var blocHeures = el("div", { class: "champ" });
  var iA = el("input", { type: "time", value: f.arrivee, step: 300 }), iD = el("input", { type: "time", value: f.depart, step: 300 });
  iA.addEventListener("input", function () { f.arrivee = iA.value; f.panier = panierParDefaut({ statut: "Travaillé", arrivee: f.arrivee, depart: f.depart }); cPanier.checked = f.panier; maj(); });
  iD.addEventListener("input", function () { f.depart = iD.value; f.panier = panierParDefaut({ statut: "Travaillé", arrivee: f.arrivee, depart: f.depart }); cPanier.checked = f.panier; maj(); });
  blocHeures.appendChild(el("div", { class: "deux" }, [
    el("label", { class: "champ" }, [el("span", { text: "Arrivée" }), iA]),
    el("label", { class: "champ" }, [el("span", { text: "Départ" }), iD])]));
  var pauses = el("div", { class: "choix" });
  [0, 30, 45, 60].forEach(function (p) {
    var b = el("button", { type: "button", "aria-pressed": f.pause === p ? "true" : "false", text: p ? p + " min" : "Pas de pause" });
    b.addEventListener("click", function () { f.pause = p; pauses.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); maj(); });
    pauses.appendChild(b);
  });
  blocHeures.appendChild(el("div", { class: "champ" }, [el("span", { text: "Pause repas" }), pauses]));
  var calc = el("div", { class: "calcul" }), avert = el("div");
  blocHeures.appendChild(calc); blocHeures.appendChild(avert);
  var iC = el("input", { type: "text", value: f.chantiers, placeholder: "Ex. : Marly, Metz" });
  iC.addEventListener("input", function () { f.chantiers = iC.value; });
  blocHeures.appendChild(el("label", { class: "champ" }, [el("span", { text: "Chantier(s)" }), iC]));
  var cPanier = el("input", { type: "checkbox" }); cPanier.checked = !!f.panier;
  cPanier.addEventListener("change", function () { f.panier = cPanier.checked; });
  blocHeures.appendChild(el("label", { class: "case" }, [cPanier, "Panier repas (journée complète sur chantier)"]));
  if (estPatron()) {
    var sZone = el("select", {}, [el("option", { value: "", text: "Zone de trajet : à voir" })].concat([1, 2, 3, 4, 5].map(function (z) { return el("option", { value: String(z), text: "Zone " + z, selected: f.zone === z ? "selected" : null }); })));
    sZone.addEventListener("change", function () { f.zone = sZone.value ? +sZone.value : null; });
    blocHeures.appendChild(el("label", { class: "champ" }, [el("span", { text: "Zone de trajet (chantier le plus loin)" }), sZone]));
  }
  feuille.appendChild(blocHeures);

  var iCom = el("textarea", { placeholder: "Un mot si besoin" }, []); iCom.value = f.commentaire;
  iCom.addEventListener("input", function () { f.commentaire = iCom.value; });
  feuille.appendChild(el("label", { class: "champ" }, [el("span", { text: "Commentaire" }), iCom]));

  var bE = el("button", { type: "button", class: "btn", text: "Enregistrer" });
  bE.addEventListener("click", function () { enregistrerJour(sal, j, f, bE); });
  feuille.appendChild(bE);

  function maj() {
    blocHeures.hidden = f.statut !== "Travaillé";
    var h = duree(f.arrivee, f.depart, f.pause);
    calc.textContent = "Temps de travail : " + hFmt(h);
    avert.innerHTML = "";
    avertissementsJour(sal, { date: date, statut: f.statut, arrivee: f.arrivee, depart: f.depart, pause: f.pause, heures: h, ferie: j.ferie })
      .forEach(function (w) { avert.appendChild(el("p", { class: "avert", text: "⚠ " + w })); });
  }
  maj();
  ouvrir();
}

function identique(j, f) {
  if (j.statut !== f.statut) return false;
  if (f.statut !== "Travaillé") return !f.commentaire;
  return j.arrivee === f.arrivee && j.depart === f.depart && (+j.pause || 0) === (+f.pause || 0) &&
    !!j.panier === !!f.panier && !f.chantiers && !f.commentaire && f.zone == null;
}

function propsJour(sal, date, f, extra) {
  var h = f.statut === "Travaillé" ? duree(f.arrivee, f.depart, f.pause) : 0;
  var p = {
    "Jour": N.titre(date + " - " + txt(sal, "Nom")),
    "Salarié": N.lien(sal.id),
    "Date": N.date(date),
    "Statut jour": N.choix(f.statut),
    "Arrivée": N.texte(f.statut === "Travaillé" ? f.arrivee : ""),
    "Départ": N.texte(f.statut === "Travaillé" ? f.depart : ""),
    "Pause (min)": N.nombre(f.statut === "Travaillé" ? f.pause : 0),
    "Heures": N.nombre(Math.round(h * 100) / 100),
    "Chantiers": N.texte(f.chantiers),
    "Commentaire": N.texte(f.commentaire),
    "Panier": N.case_(f.statut === "Travaillé" && f.panier)
  };
  if (f.zone !== undefined) p["Zone trajet"] = N.nombre(f.zone);
  Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
  return p;
}

function enregistrerJour(sal, j, f, bouton) {
  if (!j.rec && identique(j, f)) { fermer(); toast("Rien n'a changé : la journée reste au prévu."); return; }
  var props = propsJour(sal, j.date, f, {
    "Modifié par": N.choix(role()),
    "Validation": N.choix("En attente"),
    "Motif": N.texte(""),
    "Semaine confirmée salarié": N.case_(false),
    "Semaine confirmée patron": N.case_(false)
  });
  envoyer({ base: "heures", page_id: j.rec ? j.rec.id : "", props: props, cle: sal.id + "|" + j.date }, bouton,
    "Modification de la journée prise en compte : validation en attente " + autreDu() + ".");
}

function decider(j, decision, bouton) {
  if (decision === "Validé") {
    envoyer({ base: "heures", page_id: j.rec.id, props: { "Validation": N.choix("Validé"), "Motif": N.texte("") } }, bouton,
      "Journée validée. " + (estPatron() ? "Le salarié" : "Le patron") + " est prévenu.");
    return;
  }
  demanderMotif("Pourquoi tu refuses ?", function (motif) {
    envoyer({ base: "heures", page_id: j.rec.id, props: { "Validation": N.choix("Refusé"), "Motif": N.texte(motif) } }, null,
      "Modification refusée. " + (estPatron() ? "Le salarié" : "Le patron") + " verra ton motif.");
  });
}
/* Petite fenêtre qui demande le motif d'un refus (obligatoire). */
function demanderMotif(titre, suite) {
  var feuille = $("feuille"); feuille.innerHTML = "";
  feuille.appendChild(el("div", { class: "tete" }, [el("h2", { text: titre }),
    el("button", { type: "button", class: "fermer", "aria-label": "Fermer", onclick: fermer }, ["✕"])]));
  var t = el("textarea", { placeholder: "Ex. : on a fini à 17h, pas à 18h" });
  feuille.appendChild(el("label", { class: "champ" }, [el("span", { text: "Motif (il sera affiché à l'autre)" }), t]));
  var b = el("button", { type: "button", class: "btn rouge", text: "Envoyer le refus" });
  b.addEventListener("click", function () {
    if (!t.value.trim()) { toast("Écris un motif, même court.", "ko"); t.focus(); return; }
    etatBouton(b, "envoi", "Envoi en cours…");
    suite(t.value.trim());
  });
  feuille.appendChild(b);
  ouvrir(); setTimeout(function () { t.focus(); }, 50);
}

function confirmerSemaine(sal, js, bouton) {
  var champ = estPatron() ? "Semaine confirmée patron" : "Semaine confirmée salarié";
  var envois = js.filter(function (j) { return !j.horsContrat; }).map(function (j) {
    var props = {}; props[champ] = N.case_(true);
    if (!j.rec) {
      props = propsJour(sal, j.date, { statut: j.statut, arrivee: j.arrivee, depart: j.depart, pause: j.pause, chantiers: "", commentaire: "", panier: j.panier }, props);
      props["Modifié par"] = N.choix("Personne");
      props["Validation"] = N.choix("Validé");
    }
    return { base: "heures", page_id: j.rec ? j.rec.id : "", props: props, cle: sal.id + "|" + j.date };
  });
  etatBouton(bouton, "envoi", "Envoi en cours…");
  var ok = 0;
  envois.reduce(function (pr, e) { return pr.then(function () { return appel({ action: "ecrire", base: e.base, page_id: e.page_id, props: JSON.stringify(e.props) }).then(function () { ok++; }); }); }, Promise.resolve())
    .then(function () {
      etatBouton(bouton, "fait", "Semaine confirmée ✓");
      toast("Semaine confirmée. Elle vaut feuille d'heures signée.", "ok");
      return chargerHeures(S.semaine);
    })
    .then(afficher)
    .catch(function (e) {
      etatBouton(bouton, "raté", ok + "/" + envois.length + " envoyés. Réessaie.");
      toast(e && e.refus ? "Code refusé. Reconnecte-toi." : "Pas de réseau : rien n'est perdu, réessaie dans un moment.", "ko");
    });
}

/* ---------- envoi avec retour visuel et file d'attente hors réseau ---------- */
function etatBouton(b, etat, texte) {
  if (!b) return;
  b.classList.remove("envoi", "fait", "raté");
  if (etat) b.classList.add(etat);
  b.disabled = etat === "envoi";
  if (texte) b.textContent = texte;
}
function envoyer(e, bouton, message) {
  etatBouton(bouton, "envoi", "Envoi en cours…");
  return appel({ action: "ecrire", base: e.base, page_id: e.page_id, props: JSON.stringify(e.props) }).then(function (r) {
    etatBouton(bouton, "fait", "Enregistré ✓");
    toast(message, "ok");
    setTimeout(fermer, 700);
    return chargerHeures(S.semaine).then(afficher, afficher);
  }).catch(function (err) {
    if (err && err.refus) { etatBouton(bouton, "raté", "Code refusé"); toast("Code refusé. Reconnecte-toi.", "ko"); return; }
    var att = lire("attente", []); att.push(e); ecrire("attente", att);
    etatBouton(bouton, "fait", "Gardé, part dès que le réseau revient");
    toast("Pas de réseau : c'est gardé dans le téléphone et ça partira tout seul.", "ok");
    setTimeout(function () { fermer(); afficher(); }, 900);
  });
}
/* Rejoue les envois gardés hors réseau. Une création se transforme en
   modification si la journée existe déjà (cas d'un envoi parti mais sans réponse). */
function viderAttente() {
  var att = lire("attente", []);
  if (!att.length) return Promise.resolve();
  var reste = att.slice();
  return att.reduce(function (pr, e) {
    return pr.then(function () {
      if (!e.page_id && e.cle) {
        var p = e.cle.split("|"), r = enregistrementDu(p[0], p[1]);
        if (r) e.page_id = r.id;
      }
      return appel({ action: "ecrire", base: e.base, page_id: e.page_id || "", props: JSON.stringify(e.props) })
        .then(function () { reste.shift(); ecrire("attente", reste); });
    });
  }, Promise.resolve()).then(function () { return true; });
}

/* ---------- congés ---------- */
function joursOuvrables(d1, d2) {
  var n = 0;
  for (var d = versDate(d1); iso(d) <= d2; d = plusJours(d, 1)) if (d.getDay() !== 0 && !ferie(iso(d))) n++;
  return n;
}
function compteurConges(sal) {
  var debut = (dateDe(sal, "Début contrat") || {}).debut;
  var acquis = 0;
  if (debut) {
    var a = versDate(debut), now = new Date();
    var mois = (now.getFullYear() - a.getFullYear()) * 12 + now.getMonth() - a.getMonth() - (now.getDate() < a.getDate() ? 1 : 0);
    acquis = Math.max(0, mois) * 2.5;
  }
  var pris = 0, demandes = 0, sansSolde = 0;
  S.conges.forEach(function (c) {
    if (rel(c, "Salarié").indexOf(sal.id) < 0) return;
    var t = sel(c, "Type"), st = sel(c, "Statut"), n = num(c, "Jours ouvrables") || 0;
    if (t === "Congé sans solde") { if (st === "Accordé") sansSolde += n; return; }
    if (t !== "Congé demandé" && t !== "Congé imposé") return;
    if (st === "Accordé") pris += n;
    if (st === "Demandé") demandes += n;
  });
  return { acquis: acquis, pris: pris, demandes: demandes, reste: acquis - pris, sansSolde: sansSolde };
}

function afficherConges() {
  var v = $("vueConges"); v.innerHTML = "";
  var sal = salarieVu();
  if (!sal) return;
  var c = compteurConges(sal);
  v.appendChild(el("div", { class: "compteur" }, [
    el("div", {}, [el("b", { text: String(c.acquis).replace(".", ",") }), el("span", { text: "jours acquis" })]),
    el("div", {}, [el("b", { text: String(c.pris).replace(".", ",") }), el("span", { text: "posés et accordés" })]),
    el("div", {}, [el("b", { text: String(c.reste).replace(".", ",") }), el("span", { text: "reste" })])
  ]));
  v.appendChild(el("p", { class: "note", text: "Congés payés en jours ouvrables (lundi au samedi). 2,5 jours par mois travaillé depuis l'embauche. Calcul indicatif : c'est la CIBTP qui paie et qui fait foi." + (c.sansSolde ? " Congés sans solde accordés : " + c.sansSolde + " j (non payés, ne touchent pas aux congés payés)." : "") }));

  var b1 = el("button", { type: "button", class: "btn", text: estPatron() ? "Poser un congé" : "Demander un congé" });
  b1.addEventListener("click", function () { formulaireConge(sal, estPatron() ? "Congé imposé" : "Congé demandé"); });
  var b2 = el("button", { type: "button", class: "btn second", text: estPatron() ? "Noter une absence (maladie, arrêt)" : "Je suis malade / en arrêt" });
  b2.addEventListener("click", function () { formulaireAbsence(sal); });
  v.appendChild(el("div", { class: "duo" }, [b1, b2]));

  var l = el("div", { class: "liste" });
  var siens = S.conges.filter(function (x) { return rel(x, "Salarié").indexOf(sal.id) >= 0 && sel(x, "Statut") !== "Annulé"; });
  if (!siens.length) l.appendChild(el("p", { class: "doux", text: "Rien pour l'instant." }));
  siens.forEach(function (x) {
    var p = dateDe(x, "Période") || {}, st = sel(x, "Statut");
    var cls = { "Demandé": "e-attente", "Accordé": "e-valide", "Refusé": "e-refuse" }[st] || "e-prevu";
    var ligne = el("div", { class: "ligne" }, [
      el("div", { class: "haut" }, [el("div", {}, [el("div", { class: "quoi", text: sel(x, "Type") }),
        el("div", { class: "quand", text: (p.debut === p.fin ? "le " + jolis(p.debut) : "du " + jolis(p.debut) + " au " + jolis(p.fin)) + (num(x, "Jours ouvrables") ? " · " + num(x, "Jours ouvrables") + " j ouvrables" : "") })]),
        el("span", { class: "etat " + cls, text: st || "—" })]),
      txt(x, "Commentaire") ? el("div", { class: "quand", text: txt(x, "Commentaire") }) : null,
      st === "Refusé" && txt(x, "Motif") ? el("div", { class: "quand", text: "Motif du refus : " + txt(x, "Motif") }) : null
    ]);
    if (st === "Demandé" && estPatron()) {
      var ba = el("button", { type: "button", class: "btn vert", text: /Malade|Arrêt/.test(sel(x, "Type")) ? "Bien noté" : "J'accepte" });
      var br = el("button", { type: "button", class: "btn rouge", text: "Je refuse" });
      ba.addEventListener("click", function () { envoyer({ base: "conges", page_id: x.id, props: { "Statut": N.choix("Accordé"), "Motif": N.texte("") } }, ba, /Malade|Arrêt/.test(sel(x, "Type")) ? "Absence notée." : "Congé accordé. " + nomCourt(sal) + " le verra en ouvrant l'appli."); });
      br.addEventListener("click", function () { demanderMotif("Pourquoi tu refuses ce congé ?", function (motif) {
        envoyer({ base: "conges", page_id: x.id, props: { "Statut": N.choix("Refusé"), "Motif": N.texte(motif) } }, null, "Demande refusée. " + nomCourt(sal) + " verra ton motif.");
      }); });
      ligne.appendChild(el("div", { class: "duo" }, [ba, br]));
    }
    if (st === "Demandé" && !estPatron() && sel(x, "Demandé par") === "Salarié") {
      var bx = el("button", { type: "button", class: "btn second", text: "Annuler ma demande" });
      bx.addEventListener("click", function () { envoyer({ base: "conges", page_id: x.id, props: { "Statut": N.choix("Annulé") } }, bx, "Demande annulée."); });
      ligne.appendChild(bx);
    }
    l.appendChild(ligne);
  });
  v.appendChild(el("h2", { text: "Historique" }));
  v.appendChild(l);
}

/* Congé payé ou sans solde. Côté patron : congé imposé (payé) ou sans solde,
   tous deux accordés d'office. Côté salarié : une demande, dans les deux cas. */
function formulaireConge(sal, typeDepart) {
  var demain = iso(plusJours(new Date(), 1));
  var f = { debut: demain, fin: demain, commentaire: "", type: typeDepart };
  var patron = estPatron();
  var feuille = $("feuille"); feuille.innerHTML = "";
  var titre = el("h2");
  feuille.appendChild(el("div", { class: "tete" }, [titre,
    el("button", { type: "button", class: "fermer", "aria-label": "Fermer", onclick: fermer }, ["✕"])]));
  var ch = el("div", { class: "choix" });
  [[patron ? "Congé imposé" : "Congé demandé", "Congé payé"], ["Congé sans solde", "Sans solde"]].forEach(function (t) {
    var bt = el("button", { type: "button", "aria-pressed": f.type === t[0] ? "true" : "false", text: t[1] });
    bt.addEventListener("click", function () { f.type = t[0]; ch.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === bt ? "true" : "false"); }); maj(); });
    ch.appendChild(bt);
  });
  feuille.appendChild(ch);
  var i1 = el("input", { type: "date", value: f.debut }), i2 = el("input", { type: "date", value: f.fin });
  var calc = el("div", { class: "calcul" }), avert = el("div");
  var b = el("button", { type: "button", class: "btn" });
  function maj() {
    var ss = f.type === "Congé sans solde";
    titre.textContent = patron ? (ss ? "Congé sans solde" : "Congé imposé") : (ss ? "Demande de congé sans solde" : "Demande de congé");
    b.textContent = patron ? "Poser le congé" : "Envoyer ma demande";
    f.debut = i1.value; f.fin = i2.value < i1.value ? i1.value : i2.value;
    var n = f.debut && f.fin ? joursOuvrables(f.debut, f.fin) : 0;
    calc.textContent = ss ? n + " jour(s) non payé(s), sans toucher aux congés payés" : n + " jour(s) ouvrable(s) décompté(s) des congés payés";
    avert.innerHTML = "";
    if (f.type === "Congé imposé" && f.debut) {
      var delai = (versDate(f.debut) - new Date()) / 86400000;
      if (delai < 30) avert.appendChild(el("p", { class: "avert", text: "⚠ Moins d'un mois avant le départ : pour un congé imposé, le délai de prévenance est d'un mois." }));
    }
  }
  i1.addEventListener("input", maj); i2.addEventListener("input", maj);
  feuille.appendChild(el("div", { class: "deux" }, [el("label", { class: "champ" }, [el("span", { text: "Du" }), i1]), el("label", { class: "champ" }, [el("span", { text: "Au (inclus)" }), i2])]));
  feuille.appendChild(calc); feuille.appendChild(avert);
  var iC = el("textarea", { placeholder: "Un mot si besoin" });
  iC.addEventListener("input", function () { f.commentaire = iC.value; });
  feuille.appendChild(el("label", { class: "champ" }, [el("span", { text: "Commentaire" }), iC]));
  b.addEventListener("click", function () {
    if (!f.debut || !f.fin) { toast("Choisis les dates.", "ko"); return; }
    var n = joursOuvrables(f.debut, f.fin), ss = f.type === "Congé sans solde";
    envoyer({ base: "conges", page_id: "", props: {
      "Objet": N.titre(f.type + " " + txt(sal, "Nom") + " du " + f.debut + " au " + f.fin),
      "Salarié": N.lien(sal.id), "Type": N.choix(f.type), "Période": N.date(f.debut, f.fin),
      "Jours ouvrables": N.nombre(n), "Statut": N.choix(patron ? "Accordé" : "Demandé"),
      "Demandé par": N.choix(role()), "Commentaire": N.texte(f.commentaire)
    } }, b, patron ? (ss ? "Congé sans solde noté. " : "Congé posé. ") + nomCourt(sal) + " le voit tout de suite dans son appli."
      : "Demande bien reçue. En attente de la réponse du patron.");
  });
  feuille.appendChild(b);
  maj(); ouvrir();
}

function formulaireAbsence(sal) {
  var auj = iso(new Date());
  var f = { type: "Malade sans arrêt", debut: auj, jours: 1, commentaire: "" };
  var feuille = $("feuille"); feuille.innerHTML = "";
  feuille.appendChild(el("div", { class: "tete" }, [el("h2", { text: "Absence" }),
    el("button", { type: "button", class: "fermer", "aria-label": "Fermer", onclick: fermer }, ["✕"])]));
  var ch = el("div", { class: "choix" });
  [["Malade sans arrêt", "Malade, sans arrêt"], ["Arrêt maladie", "Arrêt de travail du médecin"]].forEach(function (t) {
    var b = el("button", { type: "button", "aria-pressed": f.type === t[0] ? "true" : "false", text: t[1] });
    b.addEventListener("click", function () { f.type = t[0]; ch.querySelectorAll("button").forEach(function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); maj(); });
    ch.appendChild(b);
  });
  feuille.appendChild(ch);
  var i1 = el("input", { type: "date", value: f.debut }), iN = el("input", { type: "number", min: 1, max: 365, value: 1, inputmode: "numeric" });
  var lblN = el("label", { class: "champ" }, [el("span", { text: "Nombre de jours d'arrêt (écrit sur l'arrêt)" }), iN]);
  var info = el("div", { class: "alerte bleu" });
  function maj() {
    f.debut = i1.value; f.jours = Math.max(1, +iN.value || 1);
    lblN.hidden = f.type !== "Arrêt maladie";
    info.textContent = f.type === "Arrêt maladie"
      ? "Envoie aussi la photo de l'arrêt au patron, et le volet employeur sous 48 h."
      : "Préviens le patron par téléphone le matin même si tu ne l'as pas déjà fait.";
  }
  i1.addEventListener("input", maj); iN.addEventListener("input", maj);
  feuille.appendChild(el("label", { class: "champ" }, [el("span", { text: "À partir du" }), i1]));
  feuille.appendChild(lblN); feuille.appendChild(info);
  var iC = el("textarea", { placeholder: "Un mot si besoin" });
  iC.addEventListener("input", function () { f.commentaire = iC.value; });
  feuille.appendChild(el("label", { class: "champ" }, [el("span", { text: "Commentaire" }), iC]));
  var b = el("button", { type: "button", class: "btn", text: "Envoyer" });
  b.addEventListener("click", function () {
    var fin = f.type === "Arrêt maladie" ? iso(plusJours(versDate(f.debut), f.jours - 1)) : f.debut;
    envoyer({ base: "conges", page_id: "", props: {
      "Objet": N.titre(f.type + " " + txt(sal, "Nom") + " du " + f.debut + (fin !== f.debut ? " au " + fin : "")),
      "Salarié": N.lien(sal.id), "Type": N.choix(f.type), "Période": N.date(f.debut, fin),
      "Jours ouvrables": N.nombre(joursOuvrables(f.debut, fin)),
      "Statut": N.choix(estPatron() ? "Accordé" : "Demandé"), "Demandé par": N.choix(role()),
      "Commentaire": N.texte(f.commentaire)
    } }, b, estPatron() ? "Absence notée." : "Absence bien reçue. Le patron est prévenu en ouvrant l'appli.");
  });
  feuille.appendChild(b);
  maj(); ouvrir();
}

/* ---------- feuille, toast ---------- */
function ouvrir() { $("fond").hidden = false; $("feuille").hidden = false; $("feuille").scrollTop = 0; }
function fermer() { $("fond").hidden = true; $("feuille").hidden = true; }
var _toast;
function toast(m, genre) {
  var t = $("toast"); t.textContent = m; t.className = "toast" + (genre ? " " + genre : ""); t.hidden = false;
  clearTimeout(_toast); _toast = setTimeout(function () { t.hidden = true; }, 3800);
}

/* ---------- connexion ---------- */
var saisie = "";
function clavier() {
  var c = $("clavier"); c.innerHTML = "";
  ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"].forEach(function (k) {
    if (!k) { c.appendChild(el("span")); return; }
    c.appendChild(el("button", { type: "button", text: k, "aria-label": k === "⌫" ? "Effacer" : k, onclick: function () { touche(k); } }));
  });
}
function touche(k) {
  $("erreurCode").textContent = "";
  if (k === "⌫") saisie = saisie.slice(0, -1); else if (saisie.length < 4) saisie += k;
  document.querySelectorAll("#points span").forEach(function (s, i) { s.classList.toggle("plein", i < saisie.length); });
  if (saisie.length === 4) {
    S.code = saisie; saisie = "";
    $("ecranCode").hidden = true; $("ecranChargement").hidden = false;
    chargerTout().then(function () { ecrire("code", S.code); afficher(); })
      .catch(function (e) {
        S.code = null;
        $("ecranChargement").hidden = true; $("ecranCode").hidden = false;
        document.querySelectorAll("#points span").forEach(function (s) { s.classList.remove("plein"); });
        $("erreurCode").textContent = e && e.refus ? "Code inconnu. Réessaie." : "Pas de réseau. Réessaie quand tu captes.";
      });
  }
}

/* ---------- actualisation ---------- */
var _enCours = false, _dernier = 0;
function rafraichir(siVieux) {
  if (_enCours || !S.code) return Promise.resolve();
  if (siVieux && Date.now() - _dernier < 120000) return Promise.resolve();
  _enCours = true; _dernier = Date.now();
  return viderAttente().catch(function () {}).then(function () { return chargerTout(S.semaine); })
    .then(function () { _enCours = false; afficher(); })
    .catch(function (e) {
      _enCours = false;
      if (e && e.refus) { oublier("code"); S.code = null; afficher(); toast("Ton code n'est plus valable. Demande-le au patron.", "ko"); return; }
      afficher();
    });
}

document.querySelectorAll(".onglets button").forEach(function (b) {
  b.addEventListener("click", function () { S.onglet = b.dataset.onglet; afficher(); });
});
$("btnMaj").addEventListener("click", function () { toast("Mise à jour…"); rafraichir().then(function () { toast("À jour.", "ok"); }); });
$("fond").addEventListener("click", fermer);
document.addEventListener("visibilitychange", function () { if (!document.hidden) rafraichir(true); });
window.addEventListener("online", function () { rafraichir(); });

clavier();
if (S.code && S.moiId) afficher();
if (S.code) rafraichir(); else afficher();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
}
