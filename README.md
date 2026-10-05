# La Madeleine · Chandellerie d'autrefois

Maquette de boutique en ligne (PWA) pour les bougies gourmandes de Mélanie.

## Contenu
- `index.html` : tout le site (vitrine, page « Notre histoire », comptes, panier, atelier)
- `manifest.webmanifest` + `sw.js` : installation sur téléphone et ouverture hors ligne
- `icons/` : icônes de l'application
- `img/` : photos de la vitrine (photos d'inspiration, à remplacer par celles de Mélanie en gardant les mêmes noms p1.jpg à p10.jpg)

## Comptes de démonstration
- Client : client@exemple.fr / demo
- Atelier : melanie@lamadeleine.fr / bougie

## Le mot de Mélanie
Le texte personnel de la page « Notre histoire » se modifie depuis l'atelier, onglet « Mon mot ».

## Limites de la maquette
Les comptes, paniers et commandes sont enregistrés dans le navigateur de chaque visiteur.
Pour une vraie boutique : base de données en ligne (Supabase, Firebase) et paiement (Stripe, SumUp).

## Mise à jour
À chaque modification, incrémenter `CACHE` dans `sw.js` (madeleine-v2 → madeleine-v3…).
