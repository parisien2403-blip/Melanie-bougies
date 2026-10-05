# La Madeleine · Chandellerie d'autrefois

Boutique en ligne (PWA) des bougies gourmandes de Mélanie, avec carte de fidélité.

## Contenu
- `public/` : le site publié (seul ce dossier est servi en ligne)
  - `index.html` : tout le site (vitrine, « Notre histoire », carte de fidélité, messagerie, panier, atelier)
  - `produits.json` : catalogue de départ (copié dans la base au premier lancement, puis géré depuis l'atelier)
  - `manifest.webmanifest` + `sw.js` : installation sur téléphone et ouverture hors ligne
  - `icons/`, `img/` : icônes et photos de la vitrine (photos d'inspiration, à remplacer en gardant les noms p1.jpg à p10.jpg)
- `worker.js` : le serveur Cloudflare (comptes, cartes, tampons, commandes, stock, atelier)
- `wrangler.jsonc` : réglages du déploiement Cloudflare

## Carte de fidélité
- Inscription sans mot de passe : prénom, nom, e-mail, téléphone, adresse, photo. La carte reste ouverte sur l'appareil.
- Numéro de client dans l'ordre des inscriptions : 0001, 0002…
- Carte recto (photo, nom, numéro) / verso (10 cases), à retourner et à télécharger en image.
- Un tampon par commande, retiré si la commande est annulée. Au 10e tampon : un bon de 10 € à utiliser dans le panier.
- Autre appareil : « Ma carte › Ajouter un appareil » affiche un code (15 min) à saisir sur l'autre appareil.
- Téléphone perdu : dans l'atelier, « Clients & tampons › Gérer › Code de réactivation » (48 h).
- Vente en direct (marché) : l'atelier tamponne une carte par son numéro et peut utiliser un bon.

## Messagerie
- Chaque client reçoit une adresse `prenom.nom@la-madeleine` (prenom.nom2… en cas d'homonyme), utilisable seulement sur le site.
- Le client écrit à `melanie@la-madeleine`, éventuellement à propos d'une de ses commandes ; Mélanie répond depuis l'atelier (onglet Messagerie).
- Messages automatiques : bienvenue, commande bien reçue, en préparation, prête / expédiée, livrée, annulée.
- Pastille du nombre de messages non lus, vérifiée chaque minute.

## Atelier de Mélanie (partie cachée)
Aucun lien visible pour les clients. Mélanie ouvre l'adresse du site suivie de `#atelier`
(ex. `https://la-madeleine.….workers.dev/#atelier`), saisit le code `CODE_ATELIER` une fois :
l'atelier reste ouvert sur cet appareil et apparaît dans le menu.

## Application (PC, Android, iPhone)
Le site est une application installable (PWA), sans passer par les magasins d'applications :
- Android et ordinateur (Chrome, Edge) : bouton « Installer l'application » (pied de page, menu, ou bandeau sur téléphone).
- iPhone / iPad : dans Safari, Partager › « Sur l'écran d'accueil » (mode d'emploi affiché par le même bouton).
- Une fois installée : icône, plein écran, barre d'onglets en bas sur téléphone, bouton retour d'Android,
  raccourcis par appui long (Ma carte, Messages, Boutique), ouverture hors ligne, mise à jour automatique.
- `public/captures/` : captures montrées dans la fenêtre d'installation d'Android et de Chrome.

## Mise en ligne sur Cloudflare (une seule fois)
1. Cloudflare › Workers & Pages › Créer › Importer un dépôt Git › choisir `Melanie-bougies`.
   Cloudflare lit `wrangler.jsonc`, crée la base D1 `la-madeleine` et redéploie à chaque publication sur `main`.
2. Workers › la-madeleine › Paramètres › Variables et secrets › ajouter le secret `CODE_ATELIER`
   (le code que Mélanie tapera sur la page cachée …/#atelier). Jamais dans le dépôt.
3. Ouvrir l'adresse donnée par Cloudflare (…workers.dev) suivie de `#atelier`, avec ce code.

## Essai en local
Créer un fichier `.dev.vars` (ignoré par git) contenant `CODE_ATELIER="essai"`, puis `npx wrangler dev`.

## Limites
Le paiement en ligne n'est pas branché (Stripe ou SumUp à ajouter) : les commandes sont réglées à part.

## Mise à jour
À chaque modification, incrémenter `CACHE` dans `public/sw.js` (madeleine-v4 → madeleine-v5…).
