// Boudoir & Vanille — serveur Cloudflare : sert le site (fichiers statiques) et la boutique /api/…
//
// Comptes clients sans mot de passe (même principe que TRIGONE) : à l'inscription, l'appareil reçoit un jeton secret
// qu'il garde pour lui ; le serveur n'en garde que l'empreinte. Pour un autre appareil, le client affiche un code de
// liaison (8 caractères, 15 min) et le saisit sur le nouvel appareil. Téléphone perdu : l'atelier donne un code de
// réactivation (48 h).
//
// Messagerie (comme la boîte aux lettres de TRIGONE) : chaque client reçoit une adresse prenom.nom@boudoir-vanille qui ne
// sert que sur le site. Il écrit à melanie@boudoir-vanille, l'atelier répond ; les étapes de ses commandes lui arrivent aussi
// en message automatique.
//
// Parrainage : à l'inscription, le filleul coche « Je me fais parrainer » et scanne le QR code de la carte de son parrain
// (ou ouvre le lien partagé par son parrain) : numéro + clé secrète, vérifiés ici. Le parrain gagne alors 5 % de réduction
// sur sa prochaine commande, puis 1 € de cagnotte à chaque commande du filleul. Annulation : tout est repris ou rendu.
//
// Notifications (Web Push, comme TRIGONE) : chaque appareil qui les accepte s'abonne ; le client choisit ce qu'il reçoit
// (messages, suivi de commande, nouveautés de l'atelier, mises à jour de l'appli). Mélanie est prévenue des nouveaux
// messages et des nouvelles commandes. Les mises à jour sont annoncées par la tâche planifiée (voir version.json).
//
// Carte de fidélité : numéro client 0001, 0002… dans l'ordre des inscriptions. Un tampon par commande (retiré si la
// commande est annulée) ; au 10e tampon, un bon de 10 € à utiliser sur l'achat de son choix.
//
// Stockage : base D1 (liaison DB, SQLite de Cloudflare), tables créées au premier appel.
//
// Réglage à faire une fois (Cloudflare › Workers › la-madeleine › Paramètres › Variables et secrets) :
//   CODE_ATELIER (secret)   code qui ouvre l'atelier de Mélanie sur un appareil. Jamais dans le dépôt.

const CODE_CAR = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// Règles de la boutique : valeurs de départ, modifiables par Mélanie (Atelier › Ma boutique), relues à chaque appel
let TAMPONS_PAR_BON = 10, VALEUR_BON = 10, PORT = 6.9, PORT_OFFERT = 60;
// Parrainage : le parrain gagne cette somme dans sa cagnotte à chaque commande de son filleul…
let GAIN_PARRAIN = 1;
// …et, à chaque filleul inscrit, une réduction (5 %) appliquée toute seule sur sa prochaine commande
let TAUX_REDUCTION = 0.05;
const REGLAGES_DEFAUT = {
  bandeau: 'Photos d’inspiration à remplacer par les créations de Mélanie · paiement en ligne pas encore branché',
  accrocheTitre: 'Des bougies qui sentent *le goûter* de grand-mère.',
  accrocheTexte: 'Gâteaux de cire, verrines gourmandes, beignets et fondants parfumés : chaque pièce est coulée et décorée à la main par Mélanie, en cire végétale, dans l’esprit des salons d’antan.',
  port: 6.9, portOffert: 60, tamponsParBon: 10, valeurBon: 10, gainParrain: 1, tauxReduction: 5,
  categories: [['gateau', 'Gâteaux'], ['verrine', 'Verrines'], ['douceur', 'Petites douceurs'], ['pot', 'Pots'], ['bouteille', 'Bouteilles'], ['tasse', 'Tasses']],
  images: { accueil: ['img/p6.jpg', 'img/p1.jpg', 'img/p3.jpg'], histoire: ['img/p8.jpg', 'img/p9.jpg', 'img/p5.jpg'], souvenirs: ['img/p7.jpg', 'img/p8.jpg', 'img/p2.jpg', 'img/p1.jpg'] },
};
// Verrine sur mesure : options et prix, modifiables dans l'atelier
const VERRINE_DEFAUT = {
  actif: true, delai: 'Coulée et décorée à la main pour vous, prête sous 7 jours',
  verres: [{ id: 'petit', nom: 'Petite verrine', poids: 180, duree: 30, prix: 22 }, { id: 'moyen', nom: 'Verrine moyenne', poids: 250, duree: 40, prix: 28 }, { id: 'grand', nom: 'Grande verrine', poids: 320, duree: 50, prix: 34 }],
  prixTroisEtages: 3,
  etages: [{ id: 'choco', nom: 'Génoise chocolat', couleur: '#5b3424' }, { id: 'vanille', nom: 'Crème vanille', couleur: '#f3e3c3' }, { id: 'fraise', nom: 'Mousse fraise', couleur: '#e79aa8' },
    { id: 'caramel', nom: 'Caramel', couleur: '#c98a4b' }, { id: 'pistache', nom: 'Pistache', couleur: '#b5c98a' }, { id: 'cafe', nom: 'Crème café', couleur: '#9a6a4a' },
    { id: 'framboise', nom: 'Coulis framboise', couleur: '#c2405a' }, { id: 'chantilly', nom: 'Chantilly', couleur: '#fbf6ee' }],
  parfums: [{ id: 'vanille', nom: 'Vanille bourbon' }, { id: 'fraise', nom: 'Fraise des bois' }, { id: 'caramel', nom: 'Caramel au beurre salé' }, { id: 'choco', nom: 'Chocolat noisette' },
    { id: 'cafe', nom: 'Café crème' }, { id: 'peche', nom: 'Pêche de vigne' }, { id: 'oranger', nom: 'Fleur d’oranger' }, { id: 'barbe', nom: 'Barbe à papa' }],
  decors: [{ id: 'chantilly', nom: 'Rosace de chantilly', prix: 0 }, { id: 'fraises', nom: 'Fraises', prix: 2 }, { id: 'framboises', nom: 'Framboises', prix: 2 },
    { id: 'vermicelles', nom: 'Vermicelles', prix: 1 }, { id: 'grains', nom: 'Grains de café', prix: 1 }, { id: 'chocolat', nom: 'Carré de chocolat', prix: 1.5 },
    { id: 'paillettes', nom: 'Paillettes dorées', prix: 1 }, { id: 'biscuit', nom: 'Petit biscuit', prix: 1.5 }],
  maxDecors: 3, prixMot: 1.5, maxMot: 28,
};
let R = REGLAGES_DEFAUT, V = VERRINE_DEFAUT;
async function chargerReglages(env) {
  const { results } = await env.DB.prepare("SELECT k, v FROM reglages WHERE k IN ('boutique', 'verrine')").all();
  const lu = Object.fromEntries(results.map(r => { try { return [r.k, JSON.parse(r.v)]; } catch { return [r.k, {}]; } }));
  R = { ...REGLAGES_DEFAUT, ...(lu.boutique || {}) };
  R.images = { ...REGLAGES_DEFAUT.images, ...((lu.boutique || {}).images || {}) };
  V = { ...VERRINE_DEFAUT, ...(lu.verrine || {}) };
  TAMPONS_PAR_BON = R.tamponsParBon; VALEUR_BON = R.valeurBon; PORT = R.port; PORT_OFFERT = R.portOffert;
  GAIN_PARRAIN = R.gainParrain; TAUX_REDUCTION = R.tauxReduction / 100;
}
const nombre = (v, min, max, defaut) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, arrondi(n))) : defaut; };
const urlImage = v => typeof v === 'string' && /^(img\/p\d{1,2}\.jpg|api\/image\/[0-9a-f]{24})$/.test(v) ? v : null;
const ident = v => /^[a-z0-9-]{1,24}$/.test(String(v || '')) ? String(v) : null;
const couleur = v => /^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v) : '#e7dacd';
function nettoyerReglages(r) {
  const d = REGLAGES_DEFAUT, im = r.images || {};
  const liste = (k, n) => Array.from({ length: n }, (_, i) => urlImage((im[k] || [])[i]) || d.images[k][i]);
  const cats = (Array.isArray(r.categories) ? r.categories : []).map(c => [ident(c && c[0]), txt(c && c[1], 30)]).filter(c => c[0] && c[1]).slice(0, 20);
  return {
    bandeau: txt(r.bandeau, 200), accrocheTitre: txt(r.accrocheTitre, 120) || d.accrocheTitre, accrocheTexte: txt(r.accrocheTexte, 600) || d.accrocheTexte,
    port: nombre(r.port, 0, 100, d.port), portOffert: nombre(r.portOffert, 0, 10000, d.portOffert),
    tamponsParBon: Math.round(nombre(r.tamponsParBon, 2, 50, d.tamponsParBon)), valeurBon: nombre(r.valeurBon, 0, 500, d.valeurBon),
    gainParrain: nombre(r.gainParrain, 0, 100, d.gainParrain), tauxReduction: nombre(r.tauxReduction, 0, 90, d.tauxReduction),
    categories: cats.length ? cats : d.categories,
    images: { accueil: liste('accueil', 3), histoire: liste('histoire', 3), souvenirs: liste('souvenirs', 4) },
  };
}
function nettoyerVerrine(v) {
  const d = VERRINE_DEFAUT;
  const options = (l, f) => (Array.isArray(l) ? l : []).map(f).filter(x => x && x.id && x.nom).slice(0, 30);
  const out = {
    actif: !!v.actif, delai: txt(v.delai, 160),
    verres: options(v.verres, x => x && { id: ident(x.id), nom: txt(x.nom, 40), poids: Math.round(nombre(x.poids, 0, 5000, 0)), duree: Math.round(nombre(x.duree, 0, 500, 0)), prix: nombre(x.prix, 0, 1000, 0) }),
    prixTroisEtages: nombre(v.prixTroisEtages, 0, 100, d.prixTroisEtages),
    etages: options(v.etages, x => x && { id: ident(x.id), nom: txt(x.nom, 40), couleur: couleur(x.couleur) }),
    parfums: options(v.parfums, x => x && { id: ident(x.id), nom: txt(x.nom, 40) }),
    decors: options(v.decors, x => x && { id: ident(x.id), nom: txt(x.nom, 40), prix: nombre(x.prix, 0, 100, 0) }),
    maxDecors: Math.round(nombre(v.maxDecors, 0, 8, d.maxDecors)), prixMot: nombre(v.prixMot, 0, 50, d.prixMot), maxMot: Math.round(nombre(v.maxMot, 0, 40, d.maxMot)),
  };
  if (!out.verres.length || out.etages.length < 2 || !out.parfums.length) throw new Refus(400, 'Gardez au moins un verre, deux étages et un parfum.');
  return out;
}
// Verrine composée par le client : vérifiée et chiffrée ici, avec les options en vigueur
function verrineCommandee(p, q) {
  if (!V.actif) throw new Refus(409, 'Les verrines sur mesure sont en pause pour le moment.');
  const verre = V.verres.find(x => x.id === p?.verre);
  const etages = (Array.isArray(p?.etages) ? p.etages : []).map(id => V.etages.find(x => x.id === id));
  const parfum = V.parfums.find(x => x.id === p?.parfum);
  const decors = [...new Set(Array.isArray(p?.decors) ? p.decors : [])].map(id => V.decors.find(x => x.id === id));
  const mot = txt(p?.mot, V.maxMot);
  if (!verre || !parfum || etages.length < 2 || etages.length > 3 || etages.includes(undefined) || decors.includes(undefined) || decors.length > V.maxDecors)
    throw new Refus(409, 'Une option de votre verrine n\'est plus proposée : recomposez-la, s\'il vous plaît.');
  const prix = arrondi(verre.prix + (etages.length === 3 ? V.prixTroisEtages : 0) + decors.reduce((a, x) => a + x.prix, 0) + (mot ? V.prixMot : 0));
  const detail = [verre.nom, etages.map(x => x.nom).join(' / '), 'parfum ' + parfum.nom, decors.length ? 'décor : ' + decors.map(x => x.nom.toLowerCase()).join(', ') : '', mot ? `mot « ${mot} »` : ''].filter(Boolean).join(' · ');
  return { id: 'verrine', nom: 'Verrine sur mesure', q, prix, detail, perso: { verre: verre.id, etages: etages.map(x => x.id), parfum: parfum.id, decors: decors.map(x => x.id), mot } };
}
const arrondi = n => Math.round(n * 100) / 100;
const MODES = ['Colissimo', 'Retrait atelier'];
const DOMAINE = 'boudoir-vanille', ADRESSE_ATELIER = 'melanie@' + DOMAINE;
const STATUTS = ['nouvelle', 'preparation', 'prete', 'livree', 'annulee'];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS clients (numero INTEGER PRIMARY KEY AUTOINCREMENT, prenom TEXT, nom TEXT, email TEXT,
     tel TEXT, adresse TEXT, photo TEXT, tampons INTEGER NOT NULL DEFAULT 0, bons INTEGER NOT NULL DEFAULT 0, cree TEXT)`,
  // jeton : empreinte du jeton de l'appareil ; numero NULL pour un appareil de l'atelier
  `CREATE TABLE IF NOT EXISTS appareils (jeton TEXT PRIMARY KEY, numero INTEGER, role TEXT NOT NULL, cree TEXT)`,
  `CREATE TABLE IF NOT EXISTS codes (code TEXT PRIMARY KEY, numero INTEGER NOT NULL, expire INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS produits (id TEXT PRIMARY KEY, data TEXT NOT NULL, stock INTEGER NOT NULL DEFAULT 0, ordre INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS commandes (id INTEGER PRIMARY KEY AUTOINCREMENT, numero INTEGER, date TEXT, items TEXT,
     mode TEXT, adresse TEXT, port REAL, remise REAL, statut TEXT, tampon INTEGER NOT NULL DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS reglages (k TEXT PRIMARY KEY, v TEXT)`,
  // de : 'client' (vers l'atelier) ou 'atelier' (vers le client) ; lu : lu par le destinataire
  `CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, numero INTEGER NOT NULL, de TEXT NOT NULL,
     objet TEXT, texte TEXT NOT NULL, commande INTEGER, date TEXT NOT NULL, lu INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS messages_numero ON messages (numero, id)`,
  `CREATE TABLE IF NOT EXISTS limites (cle TEXT PRIMARY KEY, n INTEGER NOT NULL, fin INTEGER NOT NULL)`,
  // Appareils abonnés aux notifications : role 'client' (numero), 'atelier' ou 'visiteur' ; choix = ce qu'il veut recevoir
  `CREATE TABLE IF NOT EXISTS abonnements (endpoint TEXT PRIMARY KEY, numero INTEGER, role TEXT NOT NULL, cles TEXT NOT NULL, choix TEXT NOT NULL, cree TEXT)`,
  // Photos du site et des bougies envoyées depuis l'atelier (servies par /api/image/<id>)
  `CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, type TEXT NOT NULL, data TEXT NOT NULL, cree TEXT)`,
  // Codes de réduction : type 'pourcent' ou 'euros'
  `CREATE TABLE IF NOT EXISTS promos (code TEXT PRIMARY KEY, libelle TEXT, type TEXT NOT NULL, valeur REAL NOT NULL, minimum REAL NOT NULL DEFAULT 0,
     debut TEXT, fin TEXT, max INTEGER, utilisations INTEGER NOT NULL DEFAULT 0, actif INTEGER NOT NULL DEFAULT 1)`,
];

// ---------- Outils ----------
class Refus extends Error { constructor(statut, message) { super(message); this.statut = statut; } }
const json = (data, statut = 200) => new Response(JSON.stringify(data), {
  status: statut, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const txt = (v, max) => String(v ?? '').trim().slice(0, max);
const maintenant = () => Math.floor(Date.now() / 1000);
async function empreinte(s) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('madeleine:' + s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const hasard = n => [...crypto.getRandomValues(new Uint8Array(n))].map(x => x.toString(16).padStart(2, '0')).join('');
function nouveauCode() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map(x => CODE_CAR[x % CODE_CAR.length]).join('');
}
const normaliserCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
function photoValide(p, max) {
  if (p == null || p === '') return null;
  if (typeof p !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(p)) throw new Refus(400, 'Photo illisible.');
  if (p.length > max) throw new Refus(413, 'Photo trop lourde.');
  return p;
}

// Adresse interne prenom.nom@boudoir-vanille (sans accents) ; prenom.nom2… si elle est déjà prise
const simplifier = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
async function adresseLibre(env, prenom, nom) {
  const base = [simplifier(prenom), simplifier(nom)].filter(Boolean).join('.') || 'client';
  for (let n = 1; ; n++) {
    const a = `${base}${n > 1 ? n : ''}@${DOMAINE}`;
    if (base + '@' + DOMAINE === ADRESSE_ATELIER && n === 1) continue;
    if (!await env.DB.prepare('SELECT 1 FROM clients WHERE courriel = ?').bind(a).first()) return a;
  }
}
const messageAuto = (env, numero, objet, texte, commande) => env.DB.prepare(
  "INSERT INTO messages (numero, de, objet, texte, commande, date) VALUES (?, 'atelier', ?, ?, ?, ?)").bind(numero, objet, texte, commande ?? null, new Date().toISOString());
const refCmd = id => 'CMD-' + String(id).padStart(4, '0');
function texteStatut(statut, o) {
  switch (statut) {
  case 'preparation': return 'Mélanie a commencé à préparer votre commande.';
  case 'prete': return o.mode === 'Retrait atelier' ? 'Votre commande est prête : vous pouvez venir la retirer à l\'atelier.' : 'Votre commande est partie par Colissimo. Elle arrive bientôt !';
  case 'livree': return 'Votre commande est indiquée comme livrée. Belle flamme et bons souvenirs !';
  case 'annulee': return 'Votre commande a été annulée. Le tampon correspondant a été retiré de votre carte' + (o.remise ? ` et votre bon de ${eurosTexte(o.remise)} vous a été rendu` : '') + (o.cagnotte ? `, et ${eurosTexte(o.cagnotte)} sont revenus dans votre cagnotte parrainage` : '') + (o.reduction ? ', et votre réduction parrainage vous attend pour la prochaine fois' : '') + '.';
  }
  return null;
}
const messagePublic = m => ({ id: m.id, de: m.de, objet: m.objet, texte: m.texte, commande: m.commande, ref: m.commande ? refCmd(m.commande) : null, date: m.date, lu: m.lu });

// ---------- Notifications (Web Push, RFC 8291 aes128gcm + VAPID) ----------
let attendre = p => p;   // remplacé à chaque requête par ctx.waitUntil : l'envoi ne retarde pas la réponse
const b64url = o => btoa(String.fromCharCode(...o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function depuisB64url(t) { const s = atob(String(t).replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((String(t).length + 3) % 4)); return Uint8Array.from(s, c => c.charCodeAt(0)); }
const concat = (...p) => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
async function hkdf(sel, ikm, info, n) {
  const k = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: sel, info }, k, n * 8));
}
// Clés VAPID créées à la première utilisation, gardées dans la table des réglages
async function clesVapid(env) {
  let l = await env.DB.prepare("SELECT v FROM reglages WHERE k = 'vapid'").first();
  if (!l) {
    const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const v = { prive: await crypto.subtle.exportKey('jwk', k.privateKey), pub: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))) };
    await env.DB.prepare("INSERT INTO reglages (k, v) VALUES ('vapid', ?) ON CONFLICT(k) DO NOTHING").bind(JSON.stringify(v)).run();
    l = await env.DB.prepare("SELECT v FROM reglages WHERE k = 'vapid'").first();
  }
  return JSON.parse(l.v);
}
async function envoyerPush(env, ab, message) {
  const vapid = await clesVapid(env), t = new TextEncoder();
  const tete = b64url(t.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const corpsJwt = b64url(t.encode(JSON.stringify({ aud: new URL(ab.endpoint).origin, exp: maintenant() + 12 * 3600, sub: 'mailto:atelier@boudoir-vanille.invalid' })));
  const cleSig = await crypto.subtle.importKey('jwk', vapid.prive, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cleSig, t.encode(tete + '.' + corpsJwt)));
  const uaPub = depuisB64url(ab.cles.p256dh), auth = depuisB64url(ab.cles.auth);
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPub = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey));
  const uaCle = await crypto.subtle.importKey('raw', uaPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const partage = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaCle }, eph.privateKey, 256));
  const ikm = await hkdf(auth, partage, concat(t.encode('WebPush: info\0'), uaPub, asPub), 32);
  const sel = crypto.getRandomValues(new Uint8Array(16));
  const cle = await crypto.subtle.importKey('raw', await hkdf(sel, ikm, t.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['encrypt']);
  const nonce = await hkdf(sel, ikm, t.encode('Content-Encoding: nonce\0'), 12);
  const chiffre = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, cle, concat(t.encode(JSON.stringify(message)), new Uint8Array([2]))));
  return fetch(ab.endpoint, { method: 'POST', body: concat(sel, new Uint8Array([0, 0, 16, 0, 65]), asPub, chiffre), headers: {
    Authorization: `vapid t=${tete}.${corpsJwt}.${b64url(sig)}, k=${vapid.pub}`, 'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream', TTL: '86400', Urgency: 'high' } });
}
// Seuls les services de notification des navigateurs sont acceptés (jamais une adresse quelconque)
function serviceDePush(adresse, env) {
  let u; try { u = new URL(adresse); } catch { return false; }
  if (env.MODE_TEST === '1' && u.protocol === 'http:' && u.hostname === '127.0.0.1') return true;   // essais en local uniquement
  return u.protocol === 'https:' && String(adresse).length < 900 &&
    /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/.test(u.hostname);
}
// Envoie une notification aux appareils choisis ; un abonnement expiré (404/410) est oublié
async function pousser(env, ou, liens, genre, message) {
  const { results } = await env.DB.prepare(`SELECT * FROM abonnements WHERE ${ou}`).bind(...liens).all();
  await Promise.all(results.filter(a => { try { return JSON.parse(a.choix)[genre] !== false; } catch { return true; } }).map(async a => {
    try {
      const r = await envoyerPush(env, { endpoint: a.endpoint, cles: JSON.parse(a.cles) }, message);
      if (r.status === 404 || r.status === 410) await env.DB.prepare('DELETE FROM abonnements WHERE endpoint = ?').bind(a.endpoint).run();
    } catch (e) { console.error('notification', e); }
  }));
}
const prevenirClient = (env, numero, genre, titre, texte, vue = 'messages') =>
  attendre(pousser(env, "role = 'client' AND numero = ?", [numero], genre, { titre, texte, url: './?vue=' + vue, tag: genre }).catch(e => console.error(e)));
const prevenirAtelier = (env, genre, titre, texte) =>
  attendre(pousser(env, "role = 'atelier'", [], genre, { titre, texte, url: './#atelier', tag: 'atelier-' + genre }).catch(e => console.error(e)));
const prevenirTous = (env, genre, titre, texte) =>
  attendre(pousser(env, "role IN ('client', 'visiteur')", [], genre, { titre, texte, url: './?vue=reglages', tag: genre }).catch(e => console.error(e)));

// Tâche planifiée : une nouvelle version (version.json, « notifier » à vrai) est annoncée une seule fois
async function annoncerVersion(env) {
  await preparer(env);
  const v = await (await env.ASSETS.fetch(new Request('https://assets/version.json'))).json();
  const deja = await env.DB.prepare("SELECT v FROM reglages WHERE k = 'version_annoncee'").first();
  if (!v.notifier || (deja && deja.v === v.version)) return;
  await env.DB.prepare("INSERT INTO reglages (k, v) VALUES ('version_annoncee', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(v.version).run();
  await pousser(env, "role IN ('client', 'visiteur', 'atelier')", [], 'majs',
    { titre: `Boudoir & Vanille ${v.version} est disponible`, texte: (v.historique && v.historique[0] && v.historique[0].notes || []).slice(0, 2).join(' · ') || 'Ouvrez l’appli pour la mettre à jour.', url: './?vue=reglages', tag: 'majs' });
}

// Compteur par adresse IP (essais de code, inscriptions) : false une fois la limite atteinte sur la période.
async function limite(env, cle, max, secondes) {
  const t = maintenant();
  const r = await env.DB.prepare(`INSERT INTO limites (cle, n, fin) VALUES (?1, 1, ?2)
      ON CONFLICT(cle) DO UPDATE SET n = CASE WHEN fin < ?3 THEN 1 ELSE n + 1 END, fin = CASE WHEN fin < ?3 THEN ?2 ELSE fin END
      RETURNING n`).bind(cle, t + secondes, t).first();
  return r.n <= max;
}

let pret = null;
async function preparer(env) {
  if (!pret) pret = (async () => {
    await env.DB.batch(SCHEMA.map(s => env.DB.prepare(s)));
    // Bases créées avant la messagerie : colonne de l'adresse interne, puis une adresse pour chaque client
    try { await env.DB.prepare('ALTER TABLE clients ADD COLUMN courriel TEXT').run(); } catch { /* déjà là */ }
    const { results: sans } = await env.DB.prepare('SELECT numero, prenom, nom FROM clients WHERE courriel IS NULL ORDER BY numero').all();
    for (const c of sans) await env.DB.prepare('UPDATE clients SET courriel = ? WHERE numero = ?').bind(await adresseLibre(env, c.prenom, c.nom), c.numero).run();
    await env.DB.prepare('CREATE UNIQUE INDEX IF NOT EXISTS clients_courriel ON clients (courriel)').run();
    // Nouveau nom (Boudoir & Vanille) : les adresses créées sous l'ancien nom changent de domaine
    await env.DB.prepare("UPDATE clients SET courriel = REPLACE(courriel, '@la-madeleine', '@boudoir-vanille') WHERE courriel LIKE '%@la-madeleine'").run();
    // Clé secrète du QR code de la carte (sans elle, un numéro seul ne permet pas d'ouvrir la fiche)
    try { await env.DB.prepare('ALTER TABLE clients ADD COLUMN cle TEXT').run(); } catch { /* déjà là */ }
    const { results: sansCle } = await env.DB.prepare('SELECT numero FROM clients WHERE cle IS NULL').all();
    for (const c of sansCle) await env.DB.prepare('UPDATE clients SET cle = ? WHERE numero = ?').bind(hasard(8), c.numero).run();
    // Parrainage : parrain et cagnotte du client ; sur la commande, l'euro donné au parrain et la cagnotte dépensée
    for (const sql of ['ALTER TABLE clients ADD COLUMN parrain INTEGER', 'ALTER TABLE clients ADD COLUMN cagnotte REAL NOT NULL DEFAULT 0',
      'ALTER TABLE commandes ADD COLUMN parrainage REAL NOT NULL DEFAULT 0', 'ALTER TABLE commandes ADD COLUMN cagnotte REAL NOT NULL DEFAULT 0',
      'ALTER TABLE clients ADD COLUMN reductions INTEGER NOT NULL DEFAULT 0', 'ALTER TABLE commandes ADD COLUMN reduction REAL NOT NULL DEFAULT 0',
      'ALTER TABLE commandes ADD COLUMN promo TEXT', 'ALTER TABLE commandes ADD COLUMN promo_montant REAL NOT NULL DEFAULT 0'])
      try { await env.DB.prepare(sql).run(); } catch { /* déjà là */ }
    const { n } = await env.DB.prepare('SELECT COUNT(*) AS n FROM produits').first();
    if (n === 0) {
      const seed = await (await env.ASSETS.fetch(new Request('https://assets/produits.json'))).json();
      await env.DB.batch(seed.map((p, i) => {
        const { stock, ...data } = p;
        return env.DB.prepare('INSERT OR IGNORE INTO produits (id, data, stock, ordre) VALUES (?, ?, ?, ?)').bind(p.id, JSON.stringify(data), stock | 0, i);
      }));
    }
  })().catch(e => { pret = null; throw e; });
  await pret;
}

// ---------- Lectures ----------
async function produits(env) {
  const { results } = await env.DB.prepare('SELECT data, stock FROM produits ORDER BY ordre, id').all();
  return results.map(r => ({ ...JSON.parse(r.data), stock: r.stock }));
}
const clientPublic = c => c && ({ numero: c.numero, cle: c.cle, prenom: c.prenom, nom: c.nom, courriel: c.courriel, email: c.email, tel: c.tel,
  adresse: c.adresse, photo: c.photo, tampons: c.tampons, bons: c.bons, cree: c.cree, parrain: c.parrain, cagnotte: c.cagnotte || 0, reductions: c.reductions || 0 });
const commandePublique = c => ({ id: c.id, ref: refCmd(c.id), numero: c.numero, date: c.date,
  items: JSON.parse(c.items), mode: c.mode, adresse: c.adresse, port: c.port, remise: c.remise, cagnotte: c.cagnotte || 0, parrainage: c.parrainage || 0,
  reduction: c.reduction || 0, promo: c.promo || null, promoMontant: c.promo_montant || 0, statut: c.statut, tampon: c.tampon,
  total: arrondi(Math.max(0, JSON.parse(c.items).reduce((a, i) => a + i.q * i.prix, 0) - c.remise - (c.promo_montant || 0) - (c.reduction || 0) - (c.cagnotte || 0)) + c.port) });
// Code de réduction valable aujourd'hui pour ce montant ?
async function calculerPromo(env, code, base) {
  const p = await env.DB.prepare('SELECT * FROM promos WHERE code = ?').bind(String(code || '').trim().toUpperCase().slice(0, 30)).first();
  const jour = new Date().toISOString().slice(0, 10);
  if (!p || !p.actif || (p.debut && jour < p.debut) || (p.fin && jour > p.fin)) throw new Refus(400, 'Ce code de réduction n\'est pas valable.');
  if (p.max != null && p.utilisations >= p.max) throw new Refus(400, 'Ce code de réduction a déjà été utilisé le nombre de fois prévu.');
  if (base < p.minimum) throw new Refus(400, `Ce code est valable à partir de ${eurosTexte(p.minimum)} d'achat.`);
  const montant = arrondi(Math.min(base, p.type === 'pourcent' ? base * p.valeur / 100 : p.valeur));
  return { code: p.code, libelle: p.libelle || (p.type === 'pourcent' ? `${p.valeur} % de réduction` : `${eurosTexte(p.valeur)} de réduction`), montant, type: p.type, valeur: p.valeur, minimum: p.minimum };
}
const promoPublique = p => ({ code: p.code, libelle: p.libelle, type: p.type, valeur: p.valeur, minimum: p.minimum, debut: p.debut, fin: p.fin, max: p.max, utilisations: p.utilisations, actif: !!p.actif });

async function qui(request, env) {
  const h = request.headers.get('authorization') || '';
  const jeton = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (!/^[0-9a-f]{64}$/.test(jeton)) return null;
  const a = await env.DB.prepare('SELECT numero, role FROM appareils WHERE jeton = ?').bind(await empreinte(jeton)).first();
  if (!a) return null;
  if (a.role === 'atelier') return { role: 'atelier', jeton };
  const c = await env.DB.prepare('SELECT * FROM clients WHERE numero = ?').bind(a.numero).first();
  return c ? { role: 'client', client: c, jeton } : null;
}
async function nonLus(env, moi) {
  const r = moi.role === 'atelier'
    ? await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE de = 'client' AND lu = 0").first()
    : await env.DB.prepare("SELECT COUNT(*) AS n FROM messages WHERE numero = ? AND de = 'atelier' AND lu = 0").bind(moi.client.numero).first();
  return r.n;
}
async function nouvelAppareil(env, numero, role) {
  const jeton = hasard(32);
  await env.DB.prepare('INSERT INTO appareils (jeton, numero, role, cree) VALUES (?, ?, ?, ?)')
    .bind(await empreinte(jeton), numero, role, new Date().toISOString()).run();
  return jeton;
}

// ---------- Tampons ----------
function ajouterTampon(c) { c.tampons++; if (c.tampons >= TAMPONS_PAR_BON) { c.tampons -= TAMPONS_PAR_BON; c.bons++; } }
function retirerTampon(c) { if (c.tampons > 0) c.tampons--; else if (c.bons > 0) { c.bons--; c.tampons = TAMPONS_PAR_BON - 1; } }
const enregistrerCarte = (env, c) => env.DB.prepare('UPDATE clients SET tampons = ?, bons = ?, cagnotte = ?, reductions = ? WHERE numero = ?')
  .bind(c.tampons, c.bons, arrondi(c.cagnotte || 0), Math.max(0, c.reductions || 0), c.numero);
// Parrain désigné par le QR code de sa carte (ou son lien) : « numéro.clé »
async function parrainDuCode(env, code) {
  const m = String(code || '').match(/^(\d{1,7})\.([0-9a-f]{8,40})$/);
  return m ? env.DB.prepare('SELECT numero, prenom, nom FROM clients WHERE numero = ? AND cle = ?').bind(+m[1], m[2]).first() : null;
}
const crediterParrain = (env, numero, montant) => env.DB.prepare('UPDATE clients SET cagnotte = MAX(0, ROUND(cagnotte + ?, 2)) WHERE numero = ?').bind(montant, numero);
const eurosTexte = n => n.toFixed(2).replace('.', ',') + ' €';
const messageBon = (env, c) => messageAuto(env, c.numero, `Bravo ! ${VALEUR_BON} € offerts`,
  `Votre carte a reçu son ${TAMPONS_PAR_BON}e tampon : vous gagnez un bon de ${VALEUR_BON} € à utiliser sur votre prochaine commande (case à cocher dans le panier), ou à l'atelier.\n\nMerci pour votre fidélité !\nMélanie`);

// Retire du stock ; si une bougie manque, remet ce qui a été pris et refuse.
async function prendreStock(env, tous) {
  const items = tous.filter(i => !i.perso);
  if (!items.length) return;
  const r = await env.DB.batch(items.map(i => env.DB.prepare('UPDATE produits SET stock = stock - ?1 WHERE id = ?2 AND stock >= ?1').bind(i.q, i.id)));
  const manque = r.findIndex(x => !x.meta.changes);
  if (manque >= 0) {
    const pris = items.filter((_, k) => r[k].meta.changes);
    if (pris.length) await rendreStock(env, pris);
    throw new Refus(409, `Le stock a changé : « ${items[manque].nom || items[manque].id} » n'est plus disponible en quantité suffisante.`);
  }
}
const rendreStock = (env, tous) => { const items = tous.filter(i => !i.perso); return items.length ? env.DB.batch(items.map(i => env.DB.prepare('UPDATE produits SET stock = stock + ? WHERE id = ?').bind(i.q, i.id))) : null; };

// ---------- Routes ----------
async function api(request, env, chemin) {
  await preparer(env);
  await chargerReglages(env);
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  let corps = {};
  if (request.method === 'POST') {
    const brut = await request.text();
    try { corps = brut ? JSON.parse(brut) : {}; } catch { throw new Refus(400, 'Requête illisible.'); }
    if (!corps || typeof corps !== 'object') throw new Refus(400, 'Requête illisible.');
  }
  const moi = await qui(request, env);
  const exigerClient = () => { if (moi?.role !== 'client') throw new Refus(401, 'Connectez-vous pour continuer.'); return moi.client; };
  const exigerAtelier = () => { if (moi?.role !== 'atelier') throw new Refus(403, 'Réservé à l\'atelier.'); };

  switch (chemin) {
  case 'catalogue': {
    const l = await env.DB.prepare("SELECT v FROM reglages WHERE k = 'lettre'").first();
    return json({ produits: (await produits(env)).filter(p => !p.masque), lettre: l ? l.v : null, reglages: R, verrine: V });
  }

  case 'parrain': {
    // Vérifie le QR code scanné à l'inscription ; ne renvoie que le prénom et l'initiale du nom
    if (!await limite(env, 'parrain:' + ip, 60, 3600)) throw new Refus(429, 'Trop d\'essais. Réessayez dans une heure.');
    const p = await parrainDuCode(env, corps.code);
    if (!p) throw new Refus(404, 'Ce QR code n\'est pas celui d\'une carte Boudoir & Vanille.');
    return json({ prenom: p.prenom, initiale: (p.nom || '')[0] || '', numero: p.numero });
  }

  // --- Notifications ---
  case 'notifs/cle': return json({ cle: (await clesVapid(env)).pub });
  case 'notifs/abonner': {
    const ab = corps.abonnement || {};
    if (!serviceDePush(ab.endpoint, env) || !ab.keys || !ab.keys.p256dh || !ab.keys.auth) throw new Refus(400, 'Abonnement illisible.');
    const role = moi ? moi.role : 'visiteur', choix = {};
    for (const k of ['messages', 'suivi', 'nouveautes', 'majs', 'commandes']) choix[k] = corps.choix ? corps.choix[k] !== false : true;
    await env.DB.prepare(`INSERT INTO abonnements (endpoint, numero, role, cles, choix, cree) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(endpoint) DO UPDATE SET numero = excluded.numero, role = excluded.role, cles = excluded.cles, choix = excluded.choix`)
      .bind(ab.endpoint, moi && moi.role === 'client' ? moi.client.numero : null, role, JSON.stringify({ p256dh: txt(ab.keys.p256dh, 200), auth: txt(ab.keys.auth, 100) }), JSON.stringify(choix), new Date().toISOString()).run();
    return json({ ok: true, choix });
  }
  case 'notifs/desabonner': {
    await env.DB.prepare('DELETE FROM abonnements WHERE endpoint = ?').bind(txt(corps.endpoint, 900)).run();
    return json({ ok: true });
  }
  case 'notifs/essai': {
    const a = await env.DB.prepare('SELECT * FROM abonnements WHERE endpoint = ?').bind(txt(corps.endpoint, 900)).first();
    if (!a) throw new Refus(404, 'Cet appareil n\'est pas abonné aux notifications.');
    if (!await limite(env, 'essai:' + ip, 10, 3600)) throw new Refus(429, 'Assez d\'essais pour aujourd\'hui !');
    const r = await envoyerPush(env, { endpoint: a.endpoint, cles: JSON.parse(a.cles) }, { titre: 'Boudoir & Vanille', texte: 'Les notifications fonctionnent : vous serez prévenu(e) ici.', url: './?vue=reglages', tag: 'essai' });
    if (!r.ok) throw new Refus(502, 'Le service de notification de l\'appareil a refusé l\'envoi (' + r.status + ').');
    return json({ ok: true });
  }

  // --- Comptes clients ---
  case 'inscription': {
    if (!await limite(env, 'inscription:' + ip, 20, 3600)) throw new Refus(429, 'Trop d\'inscriptions depuis cette connexion. Réessayez dans une heure.');
    const prenom = txt(corps.prenom, 60), nom = txt(corps.nom, 60), email = txt(corps.email, 120).toLowerCase();
    if (!prenom || !nom) throw new Refus(400, 'Indiquez votre prénom et votre nom.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Refus(400, 'Adresse e-mail invalide.');
    if (await env.DB.prepare('SELECT 1 FROM clients WHERE email = ?').bind(email).first())
      throw new Refus(409, 'Un compte existe déjà avec cet e-mail. Utilisez « J\'ai déjà une carte ».');
    const photo = photoValide(corps.photo, 250000);
    let parrain = null;
    if (corps.parrain) {
      parrain = await parrainDuCode(env, corps.parrain);
      if (!parrain) throw new Refus(400, 'Le QR code de parrain n\'est pas reconnu : scannez à nouveau la carte de votre parrain, ou décochez « Je me fais parrainer ».');
    }
    const c = await env.DB.prepare(`INSERT INTO clients (prenom, nom, courriel, cle, email, tel, adresse, photo, cree, parrain) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`)
      .bind(prenom, nom, await adresseLibre(env, prenom, nom), hasard(8), email, txt(corps.tel, 30), txt(corps.adresse, 300), photo, new Date().toISOString().slice(0, 10), parrain ? parrain.numero : null).first();
    if (parrain) prevenirClient(env, parrain.numero, 'messages', 'Un nouveau filleul !', `${prenom} a rejoint Boudoir & Vanille grâce à vous : ${Math.round(TAUX_REDUCTION * 100)} % offerts sur votre prochaine commande.`, 'compte');
    if (parrain) await env.DB.batch([
      env.DB.prepare('UPDATE clients SET reductions = reductions + 1 WHERE numero = ?').bind(parrain.numero),
      messageAuto(env, parrain.numero, `Un nouveau filleul : ${Math.round(TAUX_REDUCTION * 100)} % offerts !`,
        `Bonne nouvelle ${parrain.prenom} : ${prenom} vient de créer sa carte Boudoir & Vanille grâce à vous.\n\nVous gagnez ${Math.round(TAUX_REDUCTION * 100)} % de réduction sur votre prochaine commande (appliqués tout seuls dans le panier), puis ${eurosTexte(GAIN_PARRAIN)} dans votre cagnotte à chacune de ses commandes. Merci de faire découvrir l'atelier !`),
    ]);
    await messageAuto(env, c.numero, 'Bienvenue chez Boudoir & Vanille',
      `Bonjour ${prenom},\n\nVotre carte n° ${String(c.numero).padStart(4, '0')} est prête. Voici votre messagerie : vous pouvez m'écrire ici pour toute question sur une bougie ou une commande, je vous répondrai au plus vite.\n\nMélanie`).run();
    return json({ jeton: await nouvelAppareil(env, c.numero, 'client'), client: clientPublic(c) });
  }
  case 'moi': {
    if (!moi) throw new Refus(401, 'Appareil non reconnu.');
    if (moi.role === 'atelier') return json({ role: 'atelier', courriel: ADRESSE_ATELIER });
    const { results } = await env.DB.prepare('SELECT * FROM commandes WHERE numero = ? ORDER BY id DESC').bind(moi.client.numero).all();
    const f = await env.DB.prepare('SELECT COUNT(*) AS n FROM clients WHERE parrain = ?').bind(moi.client.numero).first();
    return json({ role: 'client', client: clientPublic(moi.client), commandes: results.map(commandePublique), nonlus: await nonLus(env, moi), filleuls: f.n });
  }
  case 'nonlus': {
    if (!moi) throw new Refus(401, 'Appareil non reconnu.');
    return json({ nonlus: await nonLus(env, moi) });
  }

  // --- Messagerie ---
  case 'messages': {
    const c = exigerClient();
    const { results } = await env.DB.prepare('SELECT * FROM messages WHERE numero = ? ORDER BY id').bind(c.numero).all();
    if (corps.lu) await env.DB.prepare("UPDATE messages SET lu = 1 WHERE numero = ? AND de = 'atelier' AND lu = 0").bind(c.numero).run();
    return json({ messages: results.map(messagePublic), atelier: ADRESSE_ATELIER });
  }
  case 'message': {
    const c = exigerClient();
    if (!await limite(env, 'message:' + c.numero, 30, 3600)) throw new Refus(429, 'Beaucoup de messages en peu de temps : réessayez dans une heure.');
    const texte = txt(corps.texte, 4000);
    if (!texte) throw new Refus(400, 'Votre message est vide.');
    let commande = null;
    if (corps.commande) {
      const o = await env.DB.prepare('SELECT id FROM commandes WHERE id = ? AND numero = ?').bind(Math.floor(Number(corps.commande)), c.numero).first();
      commande = o ? o.id : null;
    }
    await env.DB.prepare("INSERT INTO messages (numero, de, objet, texte, commande, date) VALUES (?, 'client', ?, ?, ?, ?)")
      .bind(c.numero, txt(corps.objet, 120) || 'Sans objet', texte, commande, new Date().toISOString()).run();
    prevenirAtelier(env, 'messages', `Message de ${c.prenom} ${c.nom}`, txt(corps.objet, 120) || texte.slice(0, 100));
    return json({ ok: true });
  }
  case 'profil': {
    const c = exigerClient();
    const photo = corps.photo === undefined ? c.photo : photoValide(corps.photo, 250000);
    const r = await env.DB.prepare('UPDATE clients SET tel = ?, adresse = ?, photo = ? WHERE numero = ? RETURNING *')
      .bind(txt(corps.tel ?? c.tel, 30), txt(corps.adresse ?? c.adresse, 300), photo, c.numero).first();
    return json({ client: clientPublic(r) });
  }
  case 'code-liaison': {
    const c = exigerClient();
    const code = nouveauCode();
    await env.DB.prepare('DELETE FROM codes WHERE expire < ?').bind(maintenant()).run();
    await env.DB.prepare('INSERT INTO codes (code, numero, expire) VALUES (?, ?, ?)').bind(await empreinte(code), c.numero, maintenant() + 15 * 60).run();
    return json({ code, minutes: 15 });
  }
  case 'connexion': {
    if (!await limite(env, 'code:' + ip, 10, 3600)) throw new Refus(429, 'Trop d\'essais. Réessayez dans une heure.');
    const code = normaliserCode(corps.code);
    const h = await empreinte(code);
    const r = await env.DB.prepare('DELETE FROM codes WHERE code = ? AND expire >= ? RETURNING numero').bind(h, maintenant()).first();
    if (!r) throw new Refus(400, 'Code inconnu ou expiré. Demandez-en un nouveau.');
    const c = await env.DB.prepare('SELECT * FROM clients WHERE numero = ?').bind(r.numero).first();
    if (!c) throw new Refus(400, 'Ce compte n\'existe plus.');
    return json({ jeton: await nouvelAppareil(env, c.numero, 'client'), client: clientPublic(c) });
  }
  case 'deconnexion': {
    if (moi) await env.DB.prepare('DELETE FROM appareils WHERE jeton = ?').bind(await empreinte(moi.jeton)).run();
    return json({ ok: true });
  }

  // --- Commande ---
  case 'commande': {
    const c = exigerClient();
    const fusion = new Map(), persos = [];
    const lignes = Array.isArray(corps.items) ? corps.items : [];
    if (lignes.length > 40) throw new Refus(400, 'Panier trop long.');
    for (const i of lignes) {
      const q = Math.floor(Number(i?.q));
      if (typeof i?.id !== 'string' || !(q > 0 && q <= 50)) throw new Refus(400, 'Panier illisible.');
      if (i.id === 'verrine') persos.push(verrineCommandee(i.perso, Math.min(q, 10)));
      else fusion.set(i.id, (fusion.get(i.id) || 0) + q);
    }
    if (!fusion.size && !persos.length) throw new Refus(400, 'Votre panier est vide.');
    const catalogue = new Map((await produits(env)).map(p => [p.id, p]));
    const items = [...fusion].map(([id, q]) => {
      const p = catalogue.get(id);
      if (!p || p.masque) throw new Refus(409, 'Une bougie de votre panier n\'est plus en vitrine.');
      return { id, nom: p.nom, q, prix: p.prix };
    }).concat(persos);
    const mode = MODES.includes(corps.mode) ? corps.mode : null;
    if (!mode) throw new Refus(400, 'Choisissez un mode de réception.');
    if (mode === 'Colissimo' && !c.adresse) throw new Refus(400, 'Ajoutez une adresse de livraison dans votre compte, ou choisissez le retrait à l\'atelier.');
    const sousTotal = items.reduce((a, i) => a + i.q * i.prix, 0);
    const port = mode === 'Colissimo' && sousTotal < PORT_OFFERT ? PORT : 0;
    const remise = corps.bon && c.bons > 0 ? Math.min(VALEUR_BON, sousTotal) : 0;
    const promo = corps.promo ? await calculerPromo(env, corps.promo, sousTotal - remise) : null;
    const promoMontant = promo ? promo.montant : 0;
    const reduction = (c.reductions || 0) > 0 ? arrondi(TAUX_REDUCTION * (sousTotal - remise - promoMontant)) : 0;
    const cagnotte = corps.cagnotte ? arrondi(Math.min(c.cagnotte || 0, sousTotal - remise - promoMontant - reduction)) : 0;
    await prendreStock(env, items);
    if (remise) c.bons--;
    if (cagnotte) c.cagnotte = arrondi(c.cagnotte - cagnotte);
    if (reduction) c.reductions--;
    const bonsAvant = c.bons;
    ajouterTampon(c);
    const parrainage = c.parrain && await env.DB.prepare('SELECT 1 FROM clients WHERE numero = ?').bind(c.parrain).first() ? GAIN_PARRAIN : 0;
    const [cmd] = await env.DB.batch([
      env.DB.prepare(`INSERT INTO commandes (numero, date, items, mode, adresse, port, remise, promo, promo_montant, reduction, cagnotte, parrainage, statut, tampon)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'nouvelle', 1) RETURNING *`)
        .bind(c.numero, new Date().toISOString().slice(0, 10), JSON.stringify(items), mode, mode === 'Colissimo' ? c.adresse : '', port, remise, promo ? promo.code : null, promoMontant, reduction, cagnotte, parrainage),
      ...(promo ? [env.DB.prepare('UPDATE promos SET utilisations = utilisations + 1 WHERE code = ?').bind(promo.code)] : []),
      enregistrerCarte(env, c),
      ...(parrainage ? [crediterParrain(env, c.parrain, parrainage)] : []),
      ...(c.bons > bonsAvant ? [messageBon(env, c)] : []),
    ]);
    const nouvelle = commandePublique(cmd.results[0]);
    await messageAuto(env, c.numero, `Commande ${nouvelle.ref} bien reçue`,
      `Merci pour votre commande ! Mélanie va la préparer à la main.\n\n${items.map(i => `${i.q} × ${i.nom}${i.detail ? ` (${i.detail})` : ''}`).join('\n')}\nTotal : ${eurosTexte(nouvelle.total)}${remise ? ' (bon fidélité déduit)' : ''}${promo ? ` (code ${promo.code} : −${eurosTexte(promoMontant)})` : ''}${reduction ? ` (réduction parrainage : −${eurosTexte(reduction)})` : ''}${cagnotte ? ` (cagnotte parrainage : −${eurosTexte(cagnotte)})` : ''}\n\nVous recevrez ici chaque étape. Une question ? Répondez simplement à ce message.`, nouvelle.id).run();
    if (parrainage) await messageAuto(env, c.parrain, `Parrainage : +${eurosTexte(parrainage)}`,
      `${c.prenom}, votre filleul(e), vient de passer commande : ${eurosTexte(parrainage)} de plus dans votre cagnotte parrainage. Vous pouvez l'utiliser dans le panier sur votre prochaine commande.`).run();
    prevenirClient(env, c.numero, 'suivi', `Commande ${nouvelle.ref} bien reçue`, 'Mélanie va la préparer à la main. Vous serez prévenu(e) à chaque étape.', 'compte');
    if (parrainage) prevenirClient(env, c.parrain, 'messages', `Parrainage : +${eurosTexte(parrainage)}`, `${c.prenom} vient de passer commande.`);
    if (c.bons > bonsAvant) prevenirClient(env, c.numero, 'messages', `Bravo ! ${eurosTexte(VALEUR_BON)} offerts`, `Votre ${TAMPONS_PAR_BON}e tampon vous offre un bon pour votre prochaine commande.`, 'compte');
    prevenirAtelier(env, 'commandes', `Nouvelle commande ${nouvelle.ref}`, `${c.prenom} ${c.nom} · ${eurosTexte(nouvelle.total)} · ${mode}`);
    return json({ commande: nouvelle, client: clientPublic(c) });
  }

  case 'promo': {
    // Vérification d'un code de réduction depuis le panier
    exigerClient();
    if (!await limite(env, 'promo:' + ip, 40, 3600)) throw new Refus(429, 'Trop d\'essais. Réessayez dans une heure.');
    return json(await calculerPromo(env, corps.code, Math.max(0, Number(corps.base) || 0)));
  }

  // --- Atelier ---
  case 'atelier/reglages': {
    exigerAtelier();
    const r = nettoyerReglages(corps.reglages || {});
    await env.DB.prepare("INSERT INTO reglages (k, v) VALUES ('boutique', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(r)).run();
    await chargerReglages(env);
    return json({ reglages: R });
  }
  case 'atelier/verrine': {
    exigerAtelier();
    const v = nettoyerVerrine(corps.verrine || {});
    await env.DB.prepare("INSERT INTO reglages (k, v) VALUES ('verrine', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(v)).run();
    await chargerReglages(env);
    return json({ verrine: V });
  }
  case 'atelier/image': {
    // Photo envoyée par l'atelier (réduite dans le navigateur) : rangée en base, servie par /api/image/<id>
    exigerAtelier();
    const m = String(corps.data || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new Refus(400, 'Photo illisible.');
    if (m[2].length > 1800000) throw new Refus(413, 'Photo trop lourde.');
    const id = hasard(12);
    await env.DB.prepare('INSERT INTO images (id, type, data, cree) VALUES (?, ?, ?, ?)').bind(id, m[1], m[2], new Date().toISOString()).run();
    return json({ url: 'api/image/' + id });
  }
  case 'atelier/annonce': {
    // Annonce de Mélanie (nouvelle collection, marché…) envoyée en notification à tous les abonnés « nouveautés »
    exigerAtelier();
    const titre = txt(corps.titre, 80), texte = txt(corps.texte, 200);
    if (!titre) throw new Refus(400, 'Donnez un titre à votre annonce.');
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM abonnements WHERE role IN ('client', 'visiteur')").first();
    prevenirTous(env, 'nouveautes', titre, texte);
    return json({ ok: true, appareils: n });
  }
  case 'atelier/promo': {
    exigerAtelier();
    const p = corps.promo || {};
    const code = String(p.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9-]{3,30}$/.test(code)) throw new Refus(400, 'Code : 3 à 30 lettres ou chiffres, sans espace (ex. NOEL10).');
    const type = p.type === 'euros' ? 'euros' : 'pourcent';
    const valeur = nombre(p.valeur, 0, type === 'pourcent' ? 90 : 1000, 0);
    if (!(valeur > 0)) throw new Refus(400, 'Indiquez la valeur de la réduction.');
    const date = d => /^\d{4}-\d{2}-\d{2}$/.test(d || '') ? d : null;
    const max = p.max === '' || p.max == null ? null : Math.max(1, Math.round(Number(p.max)) || 1);
    await env.DB.prepare(`INSERT INTO promos (code, libelle, type, valeur, minimum, debut, fin, max, actif) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET libelle = excluded.libelle, type = excluded.type, valeur = excluded.valeur, minimum = excluded.minimum,
      debut = excluded.debut, fin = excluded.fin, max = excluded.max, actif = excluded.actif`)
      .bind(code, txt(p.libelle, 80), type, valeur, nombre(p.minimum, 0, 10000, 0), date(p.debut), date(p.fin), max, p.actif === false ? 0 : 1).run();
    return json({ ok: true });
  }
  case 'atelier/promo-suppr': {
    exigerAtelier();
    await env.DB.prepare('DELETE FROM promos WHERE code = ?').bind(String(corps.code || '').toUpperCase()).run();
    return json({ ok: true });
  }
  case 'atelier/entrer': {
    if (!env.CODE_ATELIER) throw new Refus(503, 'Le code de l\'atelier n\'est pas encore réglé dans Cloudflare (secret CODE_ATELIER).');
    if (!await limite(env, 'atelier:' + ip, 10, 3600)) throw new Refus(429, 'Trop d\'essais. Réessayez dans une heure.');
    if (await empreinte(txt(corps.code, 200)) !== await empreinte(env.CODE_ATELIER)) throw new Refus(403, 'Code de l\'atelier incorrect.');
    return json({ jeton: await nouvelAppareil(env, null, 'atelier') });
  }
  case 'atelier': {
    exigerAtelier();
    const [cmds, clients] = await env.DB.batch([
      env.DB.prepare('SELECT * FROM commandes ORDER BY id DESC'),
      env.DB.prepare(`SELECT numero, prenom, nom, courriel, email, tel, adresse, tampons, bons, cree, parrain, cagnotte, reductions,
        (SELECT COUNT(*) FROM clients f WHERE f.parrain = clients.numero) AS filleuls FROM clients ORDER BY numero`),
    ]);
    const { results: promos } = await env.DB.prepare('SELECT * FROM promos ORDER BY code').all();
    return json({ commandes: cmds.results.map(commandePublique), clients: clients.results, produits: await produits(env), nonlus: await nonLus(env, moi),
      promos: promos.map(promoPublique), reglages: R, verrine: V });
  }
  case 'atelier/boite': {
    // Une conversation par client : dernier message, messages non lus
    exigerAtelier();
    const { results } = await env.DB.prepare(`SELECT c.numero, c.prenom, c.nom, c.courriel, m.objet, m.de, m.date,
        (SELECT COUNT(*) FROM messages n WHERE n.numero = c.numero AND n.de = 'client' AND n.lu = 0) AS nonlus
      FROM clients c JOIN messages m ON m.id = (SELECT MAX(id) FROM messages WHERE numero = c.numero)
      ORDER BY m.id DESC`).all();
    return json({ conversations: results });
  }
  case 'atelier/conversation': {
    exigerAtelier();
    const numero = Math.floor(Number(corps.numero));
    const c = await env.DB.prepare('SELECT numero, prenom, nom, courriel FROM clients WHERE numero = ?').bind(numero).first();
    if (!c) throw new Refus(404, 'Aucun client avec ce numéro.');
    const { results } = await env.DB.prepare('SELECT * FROM messages WHERE numero = ? ORDER BY id').bind(numero).all();
    await env.DB.prepare("UPDATE messages SET lu = 1 WHERE numero = ? AND de = 'client' AND lu = 0").bind(numero).run();
    const { results: cmds } = await env.DB.prepare('SELECT id FROM commandes WHERE numero = ? ORDER BY id DESC').bind(numero).all();
    return json({ client: c, messages: results.map(messagePublic), commandes: cmds.map(o => ({ id: o.id, ref: refCmd(o.id) })) });
  }
  case 'atelier/message': {
    exigerAtelier();
    const numero = Math.floor(Number(corps.numero));
    if (!await env.DB.prepare('SELECT 1 FROM clients WHERE numero = ?').bind(numero).first()) throw new Refus(404, 'Aucun client avec ce numéro.');
    const texte = txt(corps.texte, 4000);
    if (!texte) throw new Refus(400, 'Le message est vide.');
    let commande = null;
    if (corps.commande) {
      const o = await env.DB.prepare('SELECT id FROM commandes WHERE id = ? AND numero = ?').bind(Math.floor(Number(corps.commande)), numero).first();
      commande = o ? o.id : null;
    }
    await messageAuto(env, numero, txt(corps.objet, 120) || 'Message de Mélanie', texte, commande).run();
    prevenirClient(env, numero, 'messages', 'Mélanie vous a répondu', txt(corps.objet, 120) || texte.slice(0, 100));
    return json({ ok: true });
  }
  case 'atelier/carte': {
    // QR code scanné par l'atelier : numéro + clé secrète de la carte
    exigerAtelier();
    const c = await env.DB.prepare('SELECT * FROM clients WHERE numero = ? AND cle = ?').bind(Math.floor(Number(corps.numero)), txt(corps.cle, 40)).first();
    if (!c) throw new Refus(404, 'Ce QR code ne correspond à aucune carte Boudoir & Vanille.');
    return json({ client: clientPublic(c) });
  }
  case 'atelier/client': {
    exigerAtelier();
    const c = await env.DB.prepare('SELECT * FROM clients WHERE numero = ?').bind(Math.floor(Number(corps.numero))).first();
    if (!c) throw new Refus(404, 'Aucun client avec ce numéro.');
    return json({ client: clientPublic(c) });
  }
  case 'atelier/statut': {
    exigerAtelier();
    const statut = STATUTS.includes(corps.statut) ? corps.statut : null;
    const o = await env.DB.prepare('SELECT * FROM commandes WHERE id = ?').bind(Math.floor(Number(corps.id))).first();
    if (!o || !statut) throw new Refus(400, 'Commande ou statut inconnu.');
    const items = JSON.parse(o.items);
    const c = await env.DB.prepare('SELECT * FROM clients WHERE numero = ?').bind(o.numero).first();
    const suite = [];
    let tampon = o.tampon;
    if (statut === 'annulee' && o.statut !== 'annulee') {
      // Annulation : bougies remises en stock, tampon retiré, bon rendu s'il avait servi
      await rendreStock(env, items);
      if (c) { if (o.tampon) retirerTampon(c); if (o.remise) c.bons++; if (o.cagnotte) c.cagnotte = arrondi((c.cagnotte || 0) + o.cagnotte); if (o.reduction) c.reductions = (c.reductions || 0) + 1; suite.push(enregistrerCarte(env, c)); }
      if (o.parrainage && c && c.parrain) suite.push(crediterParrain(env, c.parrain, -o.parrainage));
      if (o.promo) suite.push(env.DB.prepare('UPDATE promos SET utilisations = MAX(0, utilisations - 1) WHERE code = ?').bind(o.promo));
      tampon = 0;
    } else if (o.statut === 'annulee' && statut !== 'annulee') {
      if (o.remise && !(c && c.bons > 0)) throw new Refus(409, 'Le bon de 10 € de cette commande a déjà été utilisé ailleurs : impossible de la réactiver.');
      if (o.cagnotte && !(c && (c.cagnotte || 0) >= o.cagnotte)) throw new Refus(409, 'La cagnotte utilisée pour cette commande a déjà été dépensée ailleurs : impossible de la réactiver.');
      if (o.reduction && !(c && (c.reductions || 0) > 0)) throw new Refus(409, 'La réduction parrainage de cette commande a déjà servi ailleurs : impossible de la réactiver.');
      await prendreStock(env, items);
      if (c) { if (o.remise) c.bons--; if (o.cagnotte) c.cagnotte = arrondi(c.cagnotte - o.cagnotte); if (o.reduction) c.reductions--; ajouterTampon(c); suite.push(enregistrerCarte(env, c)); tampon = 1; }
      if (o.parrainage && c && c.parrain) suite.push(crediterParrain(env, c.parrain, o.parrainage));
      if (o.promo) suite.push(env.DB.prepare('UPDATE promos SET utilisations = utilisations + 1 WHERE code = ?').bind(o.promo));
    }
    const texte = statut !== o.statut ? texteStatut(statut, o) : null;
    if (texte) prevenirClient(env, o.numero, 'suivi', `Commande ${refCmd(o.id)}`, texte, 'compte');
    if (texte) suite.push(messageAuto(env, o.numero, `Commande ${refCmd(o.id)} : ${{ preparation: 'en préparation', prete: o.mode === 'Retrait atelier' ? 'prête à retirer' : 'expédiée', livree: 'livrée', annulee: 'annulée' }[statut]}`, texte, o.id));
    await env.DB.batch([env.DB.prepare('UPDATE commandes SET statut = ?, tampon = ? WHERE id = ?').bind(statut, tampon, o.id), ...suite]);
    return json({ ok: true });
  }
  case 'atelier/tampon': {
    // Tampon donné (ou retiré) à la main : vente sur un marché, erreur à corriger…
    exigerAtelier();
    const c = await env.DB.prepare('SELECT * FROM clients WHERE numero = ?').bind(Math.floor(Number(corps.numero))).first();
    if (!c) throw new Refus(404, 'Aucun client avec ce numéro.');
    const bonsAvant = c.bons;
    if (corps.delta > 0) ajouterTampon(c); else retirerTampon(c);
    await enregistrerCarte(env, c).run();
    if (c.bons > bonsAvant) { await messageBon(env, c).run(); prevenirClient(env, c.numero, 'messages', `Bravo ${c.prenom} ! ${eurosTexte(VALEUR_BON)} offerts`, `Votre ${TAMPONS_PAR_BON}e tampon vous offre un bon pour votre prochaine commande.`, 'compte'); }
    return json({ client: clientPublic(c) });
  }
  case 'atelier/bon': {
    // Bon de 10 € utilisé en direct (marché, atelier) sans commande en ligne
    exigerAtelier();
    const c = await env.DB.prepare('SELECT * FROM clients WHERE numero = ?').bind(Math.floor(Number(corps.numero))).first();
    if (!c || c.bons < 1) throw new Refus(400, 'Ce client n\'a pas de bon disponible.');
    c.bons--;
    await enregistrerCarte(env, c).run();
    return json({ client: clientPublic(c) });
  }
  case 'atelier/cagnotte': {
    // Cagnotte parrainage utilisée en direct (marché, atelier)
    exigerAtelier();
    const c = await env.DB.prepare('SELECT * FROM clients WHERE numero = ?').bind(Math.floor(Number(corps.numero))).first();
    const montant = arrondi(Number(corps.montant));
    if (!c) throw new Refus(404, 'Aucun client avec ce numéro.');
    if (!(montant > 0) || montant > (c.cagnotte || 0)) throw new Refus(400, `Montant impossible : la cagnotte est de ${eurosTexte(c.cagnotte || 0)}.`);
    c.cagnotte = arrondi(c.cagnotte - montant);
    await enregistrerCarte(env, c).run();
    return json({ client: clientPublic(c) });
  }
  case 'atelier/reactivation': {
    exigerAtelier();
    const c = await env.DB.prepare('SELECT numero FROM clients WHERE numero = ?').bind(Math.floor(Number(corps.numero))).first();
    if (!c) throw new Refus(404, 'Aucun client avec ce numéro.');
    const code = nouveauCode();
    await env.DB.prepare('INSERT INTO codes (code, numero, expire) VALUES (?, ?, ?)').bind(await empreinte(code), c.numero, maintenant() + 48 * 3600).run();
    return json({ code, heures: 48 });
  }
  case 'atelier/produit': {
    exigerAtelier();
    const p = corps.produit || {};
    const id = /^[a-z0-9]{1,20}$/.test(p.id || '') ? p.id : 'c' + hasard(4);
    const avant = await env.DB.prepare('SELECT data FROM produits WHERE id = ?').bind(id).first();
    const ancien = avant ? JSON.parse(avant.data) : {};
    const prix = Number(p.prix);
    if (!txt(p.nom, 80) || !(prix >= 0 && prix < 10000)) throw new Refus(400, 'Indiquez au moins un nom et un prix.');
    const data = { id, cat: txt(p.cat, 20) || 'gateau', nom: txt(p.nom, 80), parfum: txt(p.parfum, 120), cire: txt(p.cire, 40),
      poids: Math.max(0, Math.floor(Number(p.poids)) || 0), duree: Math.max(0, Math.floor(Number(p.duree)) || 0), prix,
      desc: txt(p.desc, 1000), c1: txt(p.c1 || ancien.c1, 20), c2: txt(p.c2 || ancien.c2, 20) };
    const prixAvant = Number(p.prixAvant);
    if (prixAvant > prix && prixAvant < 10000) data.prixAvant = arrondi(prixAvant);
    if (p.masque) data.masque = true;
    if (ancien.img) data.img = ancien.img;
    const photo = p.photo === undefined ? ancien.photo : (urlImage(p.photo) || photoValide(p.photo, 400000));
    if (photo) data.photo = photo;
    const stock = Math.max(0, Math.floor(Number(p.stock)) || 0);
    if (avant) await env.DB.prepare('UPDATE produits SET data = ?, stock = ? WHERE id = ?').bind(JSON.stringify(data), stock, id).run();
    else await env.DB.prepare('INSERT INTO produits (id, data, stock, ordre) VALUES (?, ?, ?, (SELECT COALESCE(MIN(ordre), 0) - 1 FROM produits))')
      .bind(id, JSON.stringify(data), stock).run();
    return json({ ok: true, id });
  }
  case 'atelier/stock': {
    exigerAtelier();
    await env.DB.prepare('UPDATE produits SET stock = MAX(0, stock + ?) WHERE id = ?').bind(Number(corps.delta) > 0 ? 1 : -1, txt(corps.id, 20)).run();
    return json({ ok: true });
  }
  case 'atelier/supprimer': {
    exigerAtelier();
    await env.DB.prepare('DELETE FROM produits WHERE id = ?').bind(txt(corps.id, 20)).run();
    return json({ ok: true });
  }
  case 'atelier/lettre': {
    exigerAtelier();
    if (corps.texte == null) await env.DB.prepare("DELETE FROM reglages WHERE k = 'lettre'").run();
    else await env.DB.prepare("INSERT INTO reglages (k, v) VALUES ('lettre', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(txt(corps.texte, 8000)).run();
    return json({ ok: true });
  }
  case 'atelier/sortir': {
    exigerAtelier();
    await env.DB.prepare('DELETE FROM appareils WHERE jeton = ?').bind(await empreinte(moi.jeton)).run();
    return json({ ok: true });
  }
  }
  throw new Refus(404, 'Adresse inconnue.');
}

export default {
  async fetch(request, env, ctx) {
    attendre = p => (ctx && ctx.waitUntil ? ctx.waitUntil(p) : p);
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const img = url.pathname.match(/^\/api\/image\/([0-9a-f]{24})$/);
    if (img) {
      // Photo envoyée depuis l'atelier : identifiant unique, jamais modifié → gardée en cache longtemps
      try {
        await preparer(env);
        const r = await env.DB.prepare('SELECT type, data FROM images WHERE id = ?').bind(img[1]).first();
        if (!r) return new Response('Photo introuvable', { status: 404 });
        const octets = Uint8Array.from(atob(r.data), ch => ch.charCodeAt(0));
        return new Response(octets, { headers: { 'content-type': r.type, 'cache-control': 'public, max-age=31536000, immutable' } });
      } catch (e) { console.error(e); return new Response('Erreur', { status: 500 }); }
    }
    try {
      return await api(request, env, url.pathname.slice(5).replace(/\/$/, ''));
    } catch (e) {
      if (e instanceof Refus) return json({ erreur: e.message }, e.statut);
      console.error(e);
      return json({ erreur: 'Erreur du serveur. Réessayez dans un instant.' }, 500);
    }
  },
  // Tâche planifiée (wrangler.jsonc › triggers) : annonce d'une nouvelle version de l'appli
  async scheduled(event, env, ctx) {
    attendre = p => ctx.waitUntil(p);
    ctx.waitUntil(annoncerVersion(env).catch(e => console.error('annonce version', e)));
  },
};
