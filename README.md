# RoScouting

Radar de détection de jeux Roblox en phase de décollage. Deux morceaux :

- un **collecteur** (`collector/collect.mjs`) qui tourne sur GitHub Actions et scanne Roblox toutes les 5 minutes ;
- un **site** (racine du dépôt) publié par GitHub Pages, qui lit les données du collecteur.

Tout tourne sur l'offre gratuite de GitHub, PC éteint.

---

## 1. Installation

**a. Créer le dépôt.** Sur GitHub, nouveau dépôt **public** (Pages gratuit exige le public). Appelle-le par exemple `roscouting`.

**b. Envoyer les fichiers.** *Add file → Upload files*, dépose tout le contenu de ce dossier (garde les sous-dossiers `collector/`, `assets/`, `.github/`), puis *Commit*.

**c. Donner les droits d'écriture au robot.** *Settings → Actions → General → Workflow permissions* → coche **Read and write permissions** → *Save*. Sans ça le collecteur ne pourra pas publier ses données.

**d. Allumer Pages.** *Settings → Pages* → Source **Deploy from a branch** → branche `main`, dossier **/ (root)** → *Save*.

**e. Lancer le premier scan.** *Actions → RoScouting collector → Run workflow*. Pour un test rapide, mets `1` dans le champ « Nombre de cycles ». Le premier cycle prend deux à trois minutes.

**f. Ouvrir le site** : `https://TON-PSEUDO.github.io/roscouting/`

À partir de là le collecteur repart tout seul au début de chaque heure.

### Les deux choses à savoir au démarrage

- **Les pourcentages de croissance et les courbes ont besoin de plusieurs relevés.** Après le premier cycle, Δ 24 h affiche « — » et les sparklines sont vides. Compte une nuit pour que le radar devienne vraiment lisible, et 14 jours pour que les courbes soient pleines.
- **L'univers grossit progressivement.** Le premier cycle découvre quelques centaines de jeux, au bout de 24 h tu seras à plusieurs dizaines de milliers.

---

## 2. Comment il trouve les jeux tôt

Chaque cycle attaque la découverte par quatre angles différents, en parallèle :

1. **Les classements publics** de Roblox (l'API `explore`), qui montrent ce que l'algo pousse à l'instant.
2. **La recherche par mots-clés**, 12 requêtes par cycle en rotation sur une liste de 38, plus les 6 tendances calculées au cycle précédent. C'est ce qui attrape les jeux trop petits pour figurer dans un classement.
3. **Les « jeux similaires »** des 30 jeux les plus chauds. Quand une niche explose, Roblox recommande les nouveaux entrants de cette niche avant qu'ils n'atteignent un classement — c'est le canal de détection le plus précoce des quatre.
4. **La veille créateurs** : les 25 studios les mieux notés du radar sont interrogés sur leurs jeux triés par date de création. Un studio qui a déjà fait un hit sort souvent le suivant, et on le voit le jour de la mise en ligne.

Ensuite, le rafraîchissement est hiérarchisé : les jeux **nouvellement découverts**, les **500 plus chauds** et les **700 de moins de 30 jours** sont remesurés à chaque cycle ; le reste tourne par rotation. Plafond de 2 600 jeux détaillés par cycle, réglable via `MAX_DETAIL` dans le workflow.

**Pourquoi un run par heure et pas un cron toutes les 5 minutes :** les crons GitHub sont fréquemment retardés de 10 à 20 minutes quand la file est chargée, et chaque déclenchement paye 20 à 30 secondes de démarrage de machine. Un seul run qui boucle onze fois donne une cadence réelle de 5 minutes, bien plus régulière.

---

## 3. Le filtre anti-modded

Un jeu est écarté si son **titre** correspond à l'un de ces motifs — `modded`, `mod`, `unlimited`, `infinite`, `x100` / `1000x`, `free gamepass` / `free admin` / `free spawner`, `all unlocked`, `max stats`, `hacked`, `script`, `exploit`, `auto farm`, `dupe`, `no cooldown`, `private server`, `uncopylocked`, `test place`, `remake`, `clone`, `copy`, une balise du type `[MOD]`, un `admin panel` — ou s'il **reprend le nom d'un gros jeu en ajoutant quelque chose autour** (« Grow a Garden Deluxe », « Adopt Me 2 »). S'y ajoutent la description (mêmes mots) et le spam d'émojis (5 ou plus dans le titre).

Les mots des jeux écartés sont aussi exclus du calcul des tendances, pour que « modded » ne remonte jamais comme mot-clé porteur.

Le compteur de jeux écartés est visible dans le résumé de chaque run Actions. Les listes sont en haut de `collector/collect.mjs` :

- `MOD_PATTERNS` — les motifs interdits. Pour en ajouter un : `[/\bton mot\b/i, "étiquette"],`
- `BIG_TITLES` — les gros jeux dont on refuse les dérivés. **À rafraîchir tous les mois**, c'est la liste qui vieillit le plus vite.

À côté de ça, les **clones entre eux** (deux jeux au titre quasi identique, sans être des copies de gros jeux) sont regroupés plutôt que supprimés : le meilleur des deux est affiché avec un badge « N clones détectés ». Le nombre de clones est un signal de niche chaude. Le bouton « Regrouper les clones » dans la barre de filtres permet de tout déplier.

---

## 4. Les mots-clés tendance

Deux sources se combinent :

- `TREND_SEED` en haut de `collect.mjs` : ta liste à toi (`egg`, `hatch`, `steal`, `rng`, `aura`…). Édite-la quand une nouvelle vague arrive.
- **Le calcul automatique** : à chaque cycle, le collecteur regarde quels mots reviennent dans les titres des jeux de moins de 120 jours qui montent le plus. Un mot n'est retenu que s'il apparaît chez **au moins 4 studios différents** — sinon une famille de clones d'un même dev suffirait à inventer une fausse tendance. Les 16 meilleurs s'affichent dans « Tags tendance » à droite, et sont réinjectés dans les recherches du cycle suivant.

Un jeu dont le titre contient un mot tendance gagne des points de score, décroche le stade **Trending** et apparaît dans l'onglet **À venir** s'il a moins de 21 jours.

`SEED_QUERIES` est une troisième liste, différente : ce sont les recherches lancées pour **trouver** des jeux. Ajoutes-y tes niches.

---

## 5. Comment lire le site

**Score de percée (0-100)** = moyenne pondérée de six signaux : Momentum 32 %, Trafic 20 %, Qualité 14 %, Rétention 12 %, Fraîcheur 12 %, Demande 10 %, plus un bonus mot-clé. Grade A à partir de 68, B à partir de 58, C en dessous.

**Stades** : *Ignition* (moins de 21 jours, moins de 900 joueurs, +20 % en 24 h) · *Climbing* (+45 % en 24 h) · *Warming* (+12 %) · *Trending* (mot-clé porteur, moins de 45 jours) · *Steady* · *Établi*.

**Onglets** : Tous · Climbing · Nouveaux (≤ 21 j) · Forte croissance (trafic ≥ 30× la moyenne vie) · Sous-évalués (moins de 0,50 $ par joueur connecté, donc mal monétisés — une niche à prendre) · Watchlist.

**Momentum / « +18,7× »** = trafic estimé du jour divisé par la moyenne quotidienne depuis la sortie. C'est l'indicateur le plus parlant pour repérer un décollage.

### Deux chiffres à prendre avec des pincettes

- **Revenu estimé** : Roblox ne publie pas les revenus. Le chiffre est reconstruit depuis le trafic estimé, le nombre de gamepasses et leur prix médian, avec un taux de conversion supposé. C'est un **ordre de grandeur pour comparer deux jeux entre eux**, pas une vérité comptable.
- **Engagement** : ce n'est pas la rétention J1, que l'API ne donne pas. C'est un indice construit à partir du rapport entre joueurs connectés et trafic horaire. Utile pour classer, pas pour citer.

---

## 6. Réglages

Dans le workflow `.github/workflows/collector.yml` :

| Variable | Défaut | Effet |
|---|---|---|
| `cycles` (champ du bouton Run) | 11 | nombre de cycles par run |
| `MAX_DETAIL` | 2600 | jeux remesurés par cycle — monte à 4000 si les cycles tiennent en moins de 3 min |
| `cron` | `2 * * * *` | heure de démarrage du run |

Dans `collector/collect.mjs`, les seuils de stades sont dans le bloc `const stage =`, les poids du score dans `const W = [...]`, et le nombre de jeux envoyés au site dans `out.slice(0, 1200)`.

Dans `config.js`, tu peux forcer un dépôt précis si tu sers le site ailleurs que sur GitHub Pages.

---

## 7. Si ça coince

| Symptôme | Cause et remède |
|---|---|
| « Le radar n'a pas encore de données » | le premier run n'a pas tourné, ou la branche `data` n'existe pas encore. Vérifie l'onglet Actions. |
| Le workflow échoue sur `git push` | les droits d'écriture ne sont pas donnés : *Settings → Actions → General → Workflow permissions*. |
| Δ 24 h affiche « — » partout | il n'y a eu qu'un seul relevé. Normal, attends 20 minutes. |
| Sparklines vides | il faut deux jours de relevés pour tracer une courbe quotidienne. |
| `⚠️ aucune donnée reçue` dans les logs | Roblox a limité le débit ; le collecteur bascule seul sur ses proxys de repli au cycle suivant. |
| Le site affiche de vieux chiffres | `raw.githubusercontent.com` met en cache environ 5 minutes. Recharge plus tard, ou attends : la page se rafraîchit seule toutes les 2 minutes. |
| Trop de jeux légitimes écartés | assouplis `MOD_PATTERNS`, en commençant par la ligne `remake/clone`. |

---

## 8. Structure

```
index.html · styles.css · app.js · config.js · icons.js · assets/   → le site (GitHub Pages, branche main)
collector/collect.mjs                                              → le collecteur
.github/workflows/collector.yml                                    → la boucle de 5 minutes
branche « data » : radar.json, history.json, state.json            → les données, réécrites à chaque cycle
```

La branche `data` est réécrite en force à chaque cycle et ne garde qu'un seul commit : sans ça, 288 versions par jour d'un fichier d'historique de plusieurs mégaoctets feraient gonfler le dépôt jusqu'à le rendre inutilisable en quelques semaines.
