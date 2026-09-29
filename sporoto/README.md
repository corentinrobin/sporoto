# Sporoto

Simulateur d'ingénierie de course dans le navigateur. JavaScript pur, sans framework ; seul three.js (r170) est utilisé pour la 3D, **en local** (`js/lib/three.module.js`), comme les polices (`fonts/`). Aucun accès réseau n'est nécessaire.

*Pensé par Corentin ROBIN, développé par Claude.*

## Lancer

Les modules ES exigent un serveur HTTP : avec MAMP, ouvrir <http://localhost:8888/sporoto/>.
N'importe quel serveur statique convient (`python3 -m http.server` dans ce dossier, par exemple).

## Contenu

- **24 circuits réels** avec tracé et altimétrie : Spa-Francorchamps, Suzuka (pont du croisement), Monza, Monaco, Le Mans, Silverstone, Brands Hatch (GP), Nürburgring GP, Nordschleife complète (20,8 km, 287 m de dénivelé), Indianapolis ovale (virages relevés à 9°12′) et circuit routier, Red Bull Ring, Imola, Interlagos, Zandvoort, Barcelone, Hungaroring, Mugello, Portimão, COTA, Bahreïn, Watkins Glen, Mexico, Montréal.
  - Tracés : [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT) ; Le Mans, Nordschleife, Brands Hatch : © contributeurs OpenStreetMap (ODbL), tronçons assemblés dans le sens de course.
  - Altimétrie et relief : EU-DEM 25 m / SRTM 30 m / USGS NED 10 m via opentopodata.org, lissés. Dévers (virages relevés) pris en compte par la physique et le rendu. Altitude absolue prise en compte (densité de l'air : Mexico à 2 226 m, Interlagos, Red Bull Ring…).
- **Voitures** : F1, F2, F3, Hypercar, LMP2, LMP3, GT3 (données des règlements et fiches publiques) et une voiture **libre**. Plus de 50 paramètres réglables : puissance, régimes, turbo, hybride (kW, MJ/tour), rendement, débit carburant, rapports, V. max de boîte, temps de passage, masse, répartition, CdG, empattement, voie, largeur, hauteur, Cx, Cz, équilibre aéro, ailerons AV/AR, hauteurs de caisse, écopes de freins, pneus (6 types), pressions, carrossages, couvertures chauffantes, répartiteur, disques carbone/acier, ABS, antipatinage, différentiel, raideur, anti-roulis, pilote…
- **Conditions** : sec / pluie / neige (intensité), jour / nuit, vent (vitesse et direction réelle par rapport au cap de chaque portion), températures de l'air et de la piste, revêtement asphalte / glace / terre / gazon.
- **Temps réel** : 3D, chronos de chaque tour et secteurs, tour moyen, échelle de temps (×¼ à ×100), 5 caméras, état de la voiture en direct (4 pneus : température, usure, pression à chaud ; freins ; carburant ; hybride ; appui ; traînée ; hauteur dynamique ; équilibre), trace de vitesse comparée au meilleur tour, trajectoire colorée gaz/frein.
- **Mode conduite** : vous pilotez (accélérer, freiner, tourner, au clavier ou à la manette) ; boîte automatique, ABS directionnel, antipatinage, aide au contre-braquage et contrôle de stabilité sont gérés automatiquement. Dynamique transitoire « bicyclette » (dérive des pneus, lacet, transferts de charge) branchée sur le même moteur physique (adhérence, aéro, moteur, freins, thermique et usure des pneus). La trajectoire idéale colorée et le tour de référence simulé servent de guide.
- **Simulation rapide** : N tours sans rendu 3D, tour moyen, graphiques et tableau.
- **Compte rendu JSON** exportable et importable.
- Interface en **français** et **espagnol**.

## Physique (`js/physics.js`)

Méthode quasi-statique transitoire, standard en ingénierie de course :

1. **Trajectoire** (`js/trackgeo.js`) : dévers des virages relevés (la gravité fournit une part de l'effort latéral et augmente la charge des pneus) ; minimisation de la courbure dans les limites de la piste ; courbure horizontale, pente et courbure verticale (compressions et bosses, ex. Eau Rouge) calculées en 3D.
2. **Vitesse limite en virage** : équilibre des deux essieux (efforts latéraux répartis selon les masses), transferts de charge latéral (répartition anti-roulis) et longitudinal, appui aéro avant/arrière, charge verticale en compression, sensibilité des pneus à la charge, carrossage, ellipse de friction.
3. **Freinage** (passe arrière) : adhérence de chaque essieu, répartiteur, capacité et température des freins, traînée, pente.
4. **Accélération** (passe avant, intégrée dans le temps) : courbe de puissance et rapports, limiteur, coupure au passage, débit carburant maxi, hybride, motricité, traînée avec vent, résistance au roulement (surface, pression).
5. **État intégré à chaque pas** : température des 4 pneus (glissement, flexion, convection, conduction piste, pluie), usure (énergie de glissement × abrasivité × surchauffe, falaise), pression à chaud (loi des gaz), température des freins (convection + rayonnement, écopes), carburant et masse. Le pilote gère ses pneus s'ils sortent durablement de leur fenêtre.
6. **Air** : densité selon altitude, température et humidité ; perte de puissance des moteurs atmosphériques en altitude.
7. **Aquaplaning** selon pression, sculpture et intensité de pluie.

Calibrage : en F1 (carburant de qualification), l'écart moyen avec les poles réelles des 18 circuits référencés est d'environ −1 % (écart-type ≈ 2 %). Hypercar, LMP2 et GT3 sont cohérents avec les temps du WEC au Mans, à Spa et à Monza.

Outils de calibrage (Node ≥ 18) :

```
node tools/test.mjs F1            # tous les circuits, comparaison aux références
node tools/stint.mjs F1 silverstone 25   # relais : températures, usure, carburant
node tools/ideal.mjs HYPERCAR     # adhérence idéale (isole la géométrie et l'aéro)
node tools/drivebot.mjs F1 monza  # mode conduite piloté par un pilote automatique (stabilité, dérive, chronos)
```

## Structure

```
index.html            écrans (garage, temps réel, résultats)
css/style.css         interface
js/main.js            garage, synthèse, lancements, import
js/hud.js             simulation temps réel et HUD
js/drive.js           mode conduite (dynamique transitoire, commandes, aides)
js/results.js         simulation rapide, résultats, graphiques
js/render3d.js        rendu three.js (relief, piste, météo, caméras)
js/car3d.js           modèles 3D des voitures + suspension visuelle (tangage, roulis, écrasement, braquage)
js/carshapes.js       géométrie des voitures (profils partagés par les vues 2D et 3D)
js/audio.js           sons de la voiture (Web Audio, synthétisés)
js/physics.js         dynamique du véhicule
js/trackgeo.js        géométrie et trajectoire
js/session.js         enchaînement des tours, stands, compte rendu JSON
js/draw.js            cartes et graphiques 2D
js/i18n.js            français / espagnol
js/data/              circuits, relief, voitures
```
