# Droid Battle

Combat de droïdes néon en arène 2D (vue de dessus), jouable dans le navigateur.

- **Arcade** : survie par vagues contre des droïdes IA, boss OVERLORD toutes les 5 vagues, combos jusqu'à ×8, **classement en ligne** (PostgreSQL).
- **Duel** : 1 contre 1 en local (même clavier ou manettes) ou contre le CPU (facile / normal / difficile), en 2 manches gagnantes.
- **3 droïdes** : Striker (polyvalent, spéciale NOVA), Titan (blindé, SALVE de missiles), Viper (rapide, RAIL perforant).
- **Effets** : particules additives, grille élastique qui ondule sous les explosions, screen shake, hit-stop, slow-motion et zoom sur les K.O., traînées de dash, traces de brûlure au sol. Le son est entièrement synthétisé (Web Audio), musique synthwave procédurale comprise.
- Front sans dépendance (Canvas 2D + modules ES), back Node/Express. Polices auto-hébergées, aucun appel externe.

## Commandes

| | Arcade (clavier + souris) | Duel J1 | Duel J2 | Manette |
|---|---|---|---|---|
| Bouger | ZQSD / WASD / flèches | ZQSD | Flèches | Stick gauche |
| Viser | Souris | auto | auto | Stick droit (sinon auto) |
| Tirer | Clic gauche | F | K / Pavé 1 | RT / RB |
| Dash (invulnérable) | Espace / Maj | G | L / Pavé 2 | A / LB |
| Spéciale | Clic droit / E | H | M (`;`) / Pavé 3 | B / Y |
| Pause | Échap / P | Échap | Échap | Start |

Les touches sont lues par position physique : AZERTY et QWERTY fonctionnent tous les deux.

## Lancer en local

```bash
npm install
npm start            # http://localhost:8080
npm test             # tests de validation des scores
```

Sans base de données, le classement est gardé en mémoire (perdu au redémarrage). Pour utiliser PostgreSQL en local :

```bash
POSTGRESQL_ADDON_URI=postgresql://user:pass@localhost:5432/droidbattle npm start
```

La table `scores` est créée automatiquement au démarrage.

## Déploiement Clever Cloud (application Docker)

1. L'application Docker est déjà reliée au dépôt : chaque push sur la branche déployée lance un build du `Dockerfile`. Le serveur écoute sur le port **8080**, celui qu'attend Clever Cloud.
2. Créer un add-on **PostgreSQL** et le **lier** à l'application. Clever Cloud injecte alors `POSTGRESQL_ADDON_URI`, que le serveur lit directement.
3. Ajouter la variable d'environnement **`SCORE_SECRET`** (une longue chaîne aléatoire, par exemple `openssl rand -hex 32`). Elle signe les jetons de partie. Sans elle, un secret aléatoire est généré à chaque démarrage : les parties en cours au moment d'un redéploiement ne pourraient plus être enregistrées, et plusieurs instances ne partageraient pas le même secret.
4. Redéployer.

Variables optionnelles :

| Variable | Défaut | Rôle |
|---|---|---|
| `PG_SSL` | auto | `true` / `false` pour forcer le SSL (par défaut : essaie SSL puis sans) |
| `PG_POOL_MAX` | `4` | Connexions max (le plan DEV de Clever Cloud en autorise 5) |
| `TRUST_PROXY` | `1` | Nombre de proxys de confiance (IP réelle pour la limitation de débit) |
| `PORT` | `8080` | Port d'écoute |

Si la base est momentanément injoignable, le jeu reste jouable : le classement répond 503 et le serveur retente la connexion toutes les 15 s.

## API

| Méthode | Route | Description |
|---|---|---|
| `GET` | `/api/health` | État du serveur et du stockage |
| `POST` | `/api/runs` | Démarre une partie arcade, renvoie un jeton signé |
| `POST` | `/api/scores` | Enregistre un score (`runId`, `startedAt`, `token`, `name`, `score`, `wave`, `kills`, `droid`, `durationMs`) |
| `GET` | `/api/scores?period=all\|week\|day&limit=10` | Meilleurs scores |

Anti-triche basique côté serveur : jeton HMAC par partie, une seule soumission par partie, durée cohérente avec le temps réellement écoulé et avec la vague atteinte, plafond de score plausible, validation du pseudo, limitation de débit par IP.

## Structure

```
server/            API Express, stockage PostgreSQL / mémoire, validation des scores
public/js/
  main.js          écrans, navigation clavier / souris / manette, boucle principale
  game.js          simulation, modes arcade / duel / démo, caméra, rendu
  droid.js         droïdes jouables (tir, dash, spéciales, rendu vectoriel)
  enemies.js       ennemis et boss
  ai.js            IA de duel (bots du mode CPU et de la démo du menu)
  fx.js, grid.js   particules et grille élastique
  audio.js         SFX et musique synthétisés
  hud.js           interface en jeu
  config.js        équilibrage (dégâts, PV, vitesses, score)
```

Pour déboguer, ouvrir le jeu avec `?debug` : l'état de l'application est alors exposé dans `window.__app`.
