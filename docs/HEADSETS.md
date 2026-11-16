# Casques, périphériques audio et boutons physiques

Brancher un casque, entendre les appels, répondre et couper le micro sans réglage compliqué, sans que ZePhone ne
se mêle de ce que fait une autre application. Ce document dit ce qui est fait, **comment c'est vérifié** et surtout
**ce qui ne l'est pas** : aucun casque réel n'a été essayé (voir « Essais matériels à faire »).

## Trois niveaux de compatibilité

Un casque compatible pour l'audio ne l'est pas forcément pour ses boutons, et inversement. ZePhone les traite
séparément et le diagnostic (Réglages → Audio → *Diagnostic audio*) les montre séparément.

| Niveau | Ce que c'est | Ce que ZePhone fait | Dépend de |
|---|---|---|---|
| **1. Audio** | Le casque comme micro et sortie | Tout périphérique que macOS expose (intégré, USB, Bluetooth, jack, écran) : liste, identité stable, choix par fonction, suivi des branchements | macOS seul. Aucun pilote ni constructeur |
| **2. Boutons** | Décrocher, raccrocher, couper le micro, attente | Lit les **rapports HID standard de la page Téléphonie** (0x0B) : *Hook Switch*, *Phone Mute*, *Drop*, *Hold*. Ne lit rien d'autre | Le casque doit les **déclarer**. Beaucoup de casques Bluetooth ne les exposent pas aux applications (macOS garde leur bouton d'appel pour lui) |
| **3. Extras** | Voyants, état du socle, batterie, « décrocher en soulevant » | **Non pris en charge.** ZePhone n'envoie aucun rapport de sortie (voyants), ne lit ni le socle ni la batterie | Protocoles propres à chaque constructeur, non standard et non documentés ici |

> Un casque branché en USB ou en Bluetooth **ne prouve pas** que ses boutons marchent. Le diagnostic liste, casque
> par casque, les boutons que **le casque déclare** ; seul un appui réel prouve qu'ils fonctionnent.

## 1. Choisir les périphériques

Trois choix séparés : **microphone**, **sortie des conversations**, **sonnerie**. Pour chacun :

| Choix | Sens |
|---|---|
| **Suivre le système** (défaut) | utilise ce que macOS utilise, et change avec lui |
| **Suivre la sortie des alertes** (sonnerie) | la sortie « effets sonores » de macOS, réglage séparé de la sortie principale |
| **Un périphérique précis** | le casque choisi, retrouvé par son **identifiant système** (UID) à chaque branchement |
| **Périphérique de secours** (avec un choix précis) | utilisé quand le périphérique choisi est absent |

- **Le périphérique réellement utilisé est affiché**, pas seulement celui demandé : « Utilisé : … » avec la manière
  dont il a été obtenu (suit le système / choix explicite / secours / défaut du système faute du choix). Ce qui est
  affiché est **ce que le moteur audio a confirmé** ; si le moteur refuse un changement, le périphérique précédent
  reste affiché avec le refus.
- **Un choix enregistré mais absent** est signalé (« non branché ») et **jamais effacé** : le même casque revenu est
  réutilisé tout seul.
- **Deux casques identiques ne sont jamais confondus** : un choix est retrouvé par identifiant ; un autre appareil de
  même nom est un autre appareil. Un choix enregistré avant que ZePhone retienne les identifiants (par nom seul) n'est
  retrouvé que si **un seul** appareil porte ce nom, puis complété par l'identifiant. Si l'identifiant d'un casque
  change (certains changent en changeant de port), il faut le choisir de nouveau.
- Le moteur audio (Baresip) choisit par **nom** : deux appareils de même nom, ou un nom avec virgule, `#` ou trop
  long, sont signalés comme non fiables.
- **macOS n'a pas de périphérique « de communication »** distinct du périphérique par défaut (Windows en a un).
  ZePhone le dit dans les réglages au lieu de le simuler.
- **La sonnerie a son propre périphérique** : la commande `auplay` de Baresip déplace aussi la sonnerie sur le
  périphérique des conversations ; un petit ajout au module `zeaudio` (`zealert`) la remet sur son périphérique après
  chaque changement, sans redémarrer le moteur.
- **Pendant un appel**, le bouton micro de la barre d'appel ouvre l'accès rapide : noms lisibles, périphérique en
  cours coché, indicateur « Micro actif / coupé », choix pour **cet appel** ou à garder.

## 2. Branchements et débranchements

macOS signale les ajouts, retraits et changements de périphérique par défaut ; ZePhone les écoute (CoreAudio).

- **Un même branchement provoque souvent plusieurs notifications** : ZePhone attend **0,5 s de calme** et ne regarde
  qu'une fois (testé : 20 notifications → 1 évaluation).
- **Hors appel** : le moteur suit tout de suite ce que le choix donne.
- **Pendant un appel, si le périphérique utilisé disparaît** :
  1. **la session SIP reste ouverte**, l'appel n'est jamais coupé ;
  2. un **délai de grâce de 2,5 s** laisse revenir un périphérique qui n'a fait que cligner (Bluetooth) ;
  3. ensuite, selon la règle choisie : **Me demander** · **Périphérique de secours** (défaut ; sinon on demande) ·
     **Défaut du système** ;
  4. **la conversation ne passe jamais toute seule sur des haut-parleurs publics** (haut-parleurs de l'ordinateur,
     d'un écran) **sans autorisation explicite** (réglage séparé, désactivé par défaut) : on le dit et on propose le
     choix. C'est le cas typique d'un casque Bluetooth qui se déconnecte : macOS bascule alors sur les haut-parleurs du
     Mac ;
  5. un **bandeau** sur l'écran d'appel dit immédiatement ce qui s'est passé, avec « Choisir un autre périphérique ».
- **Un rôle qui suit le système va où va le système** (c'est ce qu'il demande), avec la même protection pour les
  haut-parleurs publics.
- **Micro coupé et attente sont conservés** lors d'un changement : le micro coupé est renvoyé au moteur après chaque
  changement ; l'attente est un état SIP qu'un changement audio ne touche pas.
- **Un changement refusé par le moteur** donne un état clair (« n'a pas pu être utilisé », périphérique précédent
  conservé), n'est pas retenté en boucle, et se retente dès que la situation ou les réglages changent. Un nouveau choix
  fonctionne immédiatement (récupération).
- **Veille / reprise, perte du Bluetooth** : macOS ré-énumère les périphériques, ZePhone réévalue. **Non vérifié sur
  matériel** (voir plus bas).

## 3. Boutons du casque

La chaîne a trois étages séparés : **la source** (ce que le matériel dit) → **l'interprète** (ce que ça signifie, vu
l'état réel des appels) → **l'exécuteur** commun (le même que les raccourcis clavier et la ligne de commande, qui
choisit l'appel par la règle documentée dans [`CONTROL.md`](CONTROL.md)).

| Bouton (HID Téléphonie) | Ce que ZePhone en fait |
|---|---|
| *Hook Switch* (bouton d'appel) passe à « décroché » | **Décroche l'appel entrant qui sonne.** Rien d'autre : jamais de composition, jamais d'action sur un appel en cours |
| *Hook Switch* passe à « raccroché » | **Raccroche l'appel en cours ou en cours d'établissement.** **Jamais** un refus d'appel qui sonne, jamais rien si aucun appel |
| *Phone Mute* | Bascule le micro de l'appel (appui **court**, agit au relâchement) |
| *Drop* | Raccroche l'appel en cours |
| *Hold* | Bascule l'attente d'un appel établi |
| *Flash*, tout le reste | Ignoré |

Garde-fous (tous testés, voir plus bas) :

- **Doublons** : le même rapport deux fois en 150 ms est un seul événement ; un état de crochet répété n'est pas un
  changement.
- **Appui prolongé** : un appui de plus de 800 ms (réglable) est **ignoré**, jamais pris pour un appui court.
- **Selon l'état réel** : une action n'a lieu que si elle a un sens (rien à décrocher = rien). Sans appel de ZePhone,
  **aucun bouton ne fait rien**, quoi que fasse une autre application.
- **Plusieurs appels** : règle de l'exécuteur — deux appels qui sonnent ne sont **pas** devinés (rien n'est fait, le
  diagnostic le dit) ; micro, attente et raccrochage visent l'appel actif.
- **Socle, charge, connexion** : ce ne sont pas des rapports HID standard et ZePhone ne les lit pas ; ils ne peuvent
  donc jamais être pris pour un ordre de décrocher, refuser ou raccrocher. Un casque qui annoncerait le socle *par le
  crochet standard* provoquerait un « raccroché » : c'est un raccrochage, jamais un refus.
- **« Décrocher en soulevant le casque »** : aucun mécanisme standard ne distingue « soulevé » de « bouton pressé » ;
  elle n'est offerte que comme le bouton d'appel (réglage **Le bouton d'appel décroche**, désactivable), et la
  détection par capteur du constructeur n'existe pas ici.
- **On peut tout désactiver sans toucher à l'audio** : mode *Désactivées*, ou chaque action séparément.
- **Mode de gestion** : *Automatique*, *Commandes standard du système*, *Intégration constructeur*, *Désactivées*.
  Aucune intégration constructeur n'est incluse (aucune n'a été vérifiée dans sa documentation officielle) : ce choix
  est affiché comme non disponible et ne traite aucun bouton. Il n'y a **qu'un seul mécanisme actif** : un même bouton
  ne peut pas être traité deux fois.
- **Seulement le casque utilisé** : les boutons d'un autre casque, ou d'un casque que ZePhone n'utilise pas, sont
  ignorés (rapprochement par le nom que le casque annonce et le nom du périphérique audio).

## 4. Microphone : demandé, confirmé, honnête

- L'interface affiche **l'état confirmé par le moteur d'appel**, jamais celui demandé. Les trois chemins (bouton de
  l'interface, raccourci clavier, commande externe, bouton du casque) passent par le même exécuteur et la même
  fonction du gestionnaire d'appels.
- **Aucune boucle** : ZePhone n'envoie aucun rapport au casque (pas de voyant), donc un changement logiciel ne
  provoque jamais un événement matériel qui le renverserait.
- **Coupure matérielle** : si le casque a un interrupteur de micro matériel, ZePhone **ne peut ni le commander ni
  l'observer** : l'indicateur « Micro coupé » ne la reflète pas. C'est écrit dans les réglages.
- **Voyants** : non pris en charge (niveau 3). Aucun voyant ne laisserait croire à un état que ZePhone ne connaît pas.

## 5. Teams et les autres applications

- ZePhone **n'agit sur les boutons que s'il a lui-même un appel** (qui sonne ou en cours). Ouvert sans appel, il ne
  réagit à rien.
- **Il n'accapare pas le casque** : ses lectures HID ne prennent pas le périphérique en exclusivité, donc Teams et le
  système continuent de recevoir les mêmes rapports. **Il ne peut pas non plus empêcher Teams de réagir** : macOS
  n'attribue pas les boutons d'un casque à une application précise.
- **ZePhone ne sait pas** si Teams (ou autre) a un appel en cours : aucune information système ne le dit, et il ne
  prétend ni le détecter ni le contrôler. Le diagnostic montre seulement qu'un périphérique est « utilisé par une
  application » (sans dire laquelle).
- **Contournement simple** : fermer l'autre application d'appel, ou choisir *Désactivées* dans l'une des deux (par
  exemple le mode *Désactivées* de ZePhone, tout en gardant l'audio du casque).

## 6. USB et Bluetooth

- Un même casque expose souvent **plusieurs périphériques** (une sortie, une entrée, parfois deux profils
  Bluetooth) : la liste les montre séparément avec leur type de connexion.
- **Bluetooth** : utiliser le micro d'un casque Bluetooth le fait passer en profil « téléphone » (son moins
  fidèle). ZePhone l'explique quand le périphérique utilisé est un casque Bluetooth ; c'est une contrainte du
  Bluetooth, pas quelque chose que l'application corrige.
- La présence d'un adaptateur USB ou d'une connexion Bluetooth **ne dit rien** des boutons : le diagnostic liste ce que
  chaque casque déclare.
- ZePhone ne force aucun format : il ouvre les périphériques tels que le système et le moteur audio les acceptent.

## 7. Diagnostic audio

*Réglages → Audio → Ouvrir le diagnostic audio.*

- les périphériques détectés (type de connexion, entrée/sortie, défaut du système, haut-parleur public, utilisé par
  une application, utilisés par ZePhone et pour quoi) ;
- ce que ZePhone utilise pour chaque fonction, avec les problèmes en clair (périphérique absent, nom ambigu…) et les
  refus du moteur ;
- la **permission du microphone** (autorisée, refusée, restreinte) avec accès aux réglages système ;
- des **tests lancés par vous** : tonalité sur la sortie, vraie sonnerie sur la sortie de sonnerie, niveau du micro
  en direct. Ils jouent **directement sur le périphérique**, jamais dans un appel : votre correspondant ne les entend
  pas. Ils sont **désactivés pendant un appel**. Aucun enregistrement de test n'est fait ;
- l'état de la lecture des boutons (active, autorisation nécessaire, indisponible), les casques qui exposent des
  boutons standard **avec les boutons qu'ils déclarent**, et les 25 derniers événements avec ce qu'ils sont devenus
  (« Aucun appel entrant à décrocher », « Appui long ignoré », « Micro coupé (fait) »…).

**Autorisation « Surveillance de l'entrée »** : ZePhone n'ouvre que les périphériques de la page Téléphonie (jamais
un clavier ni une souris). Si macOS demande tout de même une autorisation, le diagnostic le dit et indique où
l'accorder ; sans elle, l'audio du casque marche mais pas ses boutons.

## 8. Ce qui est vérifié, et comment

### Tests automatiques (simulations de la logique, **pas** des essais matériels)

| Vérifié | Où |
|---|---|
| Choix du périphérique par rôle, suivi du système, choix explicite, secours, retour du même casque, deux casques identiques jamais confondus, choix enregistrés par nom, noms non fiables | `audio::routing` |
| Pendant un appel : casque qui disparaît, délai de grâce, secours, refus des haut-parleurs publics, suivi du système, micro non soumis à la règle | `audio::routing`, `audio::router` |
| Machine d'état : rien ne se fait deux fois, un changement refusé n'est pas retenté, le choix de l'utilisateur tient jusqu'à la fin de l'appel, la sonnerie n'est jamais changée en appel, rafale de notifications = une évaluation, micro coupé renvoyé après un changement | `audio::router` |
| Interprétation des boutons : doublons, crochet, appui court/long, jamais de refus par le socle ou le crochet, rien sans appel, désactivation par action, casque non utilisé ignoré | `headset::tests` |
| Boutons → exécuteur réel : appel choisi par la règle, deux appels qui sonnent non devinés, rien sans appel | `headset::service` |
| Migration des anciens choix par nom, état du moteur, micro coupé conservé | `database::settings`, `sip::manager` |
| Réglages, accès rapide en appel, bandeau d'incident, diagnostic (tests refusés en appel, permission, boutons déclarés) | tests de l'interface |

### Moteur Baresip réel et vrais appels (audio synthétique, pas de matériel)

`tests/audio_e2e.rs`, deux moteurs réels, vrais appels, mesure du signal :

- changer le **micro** en plein appel : la session SIP reste ouverte ; **muet avant le changement, il reste muet**
  (silence mesuré chez l'autre) ; démuter : l'autre entend la **nouvelle** source, pas l'ancienne ;
- changer la **sortie** : ce que l'on entend arrive bien sur le **nouveau** périphérique ;
- **attente** : un appel en attente le reste pendant un changement, puis reprend sur les nouveaux périphériques ;
- un périphérique inconnu est refusé sans couper l'appel, et un bon changement ensuite fonctionne (**récupération**).

`tests/engine_integration.rs` : tous les périphériques que CoreAudio liste sur cette machine sont acceptés par le
vrai moteur, y compris la commande `zealert` (sonnerie) et un changement de sortie qui ne l'écrase pas.

### Dans le système réel (application packagée, macOS 26, MacBook Pro Apple Silicon, périphériques intégrés)

- **CoreAudio réel** : liste de 3 périphériques (micro et haut-parleurs intégrés, un micro virtuel), type de
  connexion, valeurs par défaut du système ; tous acceptés par le vrai moteur ;
- **un périphérique qui apparaît puis disparaît sur le système réel** : un périphérique agrégé temporaire est créé
  puis détruit (changement réel de la liste, sans toucher à aucun réglage ni périphérique par défaut) ; l'application
  packagée le voit apparaître (3 → 4 périphériques) puis disparaître (4 → 3), **une évaluation par rafale** ;
- **lecture HID réelle** : démarre et s'arrête proprement ; aucun périphérique Téléphonie n'est branché ici, donc
  aucune détection de bouton n'a été exercée ;
- l'application packagée démarre, le moteur démarre sur les périphériques que le choix donne, les commandes de contrôle
  répondent.

## 9. Les dix situations à risque

| # | Situation | État |
|---|---|---|
| 1 | Casque branché avant / après le lancement | logique, liste réelle et apparition d'un périphérique après le lancement **sur le système réel** testées ; **pas avec un casque** |
| 2 | Débranchement et reconnexion pendant un appel | logique + changement de périphérique en appel réel testés (synthétique) ; **pas avec un casque** |
| 3 | Changement du périphérique par défaut du système | logique testée, et la notification système est vue sur un vrai changement de liste ; le changement du **défaut** lui-même **n'a pas été essayé** (cela modifierait un réglage système de la machine) |
| 4 | Micro coupé conservé lors d'un changement | **testé sur appel réel** (silence mesuré) |
| 5 | Boutons avec l'application en arrière-plan | la lecture HID tourne sur son propre fil, indépendamment de la fenêtre ; **pas de casque pour l'éprouver** |
| 6 | Aucune double action si l'événement arrive par deux mécanismes | un seul mécanisme actif ; doublons testés |
| 7 | Aucun rejet automatique quand le casque repose sur son socle | **testé** (interprète) ; le socle n'est de toute façon pas lu |
| 8 | Bonne sélection de l'appel avec plusieurs appels | **testé** (règle de l'exécuteur) |
| 9 | Teams ou une autre application utilise aussi le casque | **non vérifiable ici** ; comportement documenté ci-dessus |
| 10 | Récupération après veille ou perte Bluetooth | logique testée ; **non éprouvé sur matériel** |

## Essais matériels à faire

Aucun casque n'a été essayé : la machine de développement n'a que les périphériques intégrés. Pour chaque essai,
noter **modèle, version de macOS, type de connexion (USB, Bluetooth, jack, adaptateur), fonctions vérifiées**. Ne
déduire aucune compatibilité d'une marque entière d'un seul modèle.

1. Brancher le casque (USB) **avant** puis **après** le lancement : apparaît dans le diagnostic, le choix explicite le
   retrouve.
2. Diagnostic → boutons déclarés : lesquels ? Presser chacun et lire le journal d'événements.
3. Appel entrant : le bouton d'appel décroche ? Un second appui raccroche ? Le bouton mute bascule-t-il le micro de
   ZePhone ? Y a-t-il en plus une coupure matérielle que l'indicateur ne reflète pas ?
4. Appel en cours, **débrancher** le casque : bandeau, appel toujours ouvert, rien n'est passé sur les haut-parleurs ;
   rebrancher : retour au casque ?
5. Même essai en **Bluetooth** : le micro passe-t-il en profil téléphone ? macOS bascule-t-il sur les haut-parleurs ?
   ZePhone refuse-t-il de suivre sans autorisation ?
6. Casque sur son **socle** / retiré du socle pendant un appel qui sonne : rien ne doit être refusé.
7. **Teams** ouverte avec le même casque : qui réagit aux boutons ? (Les deux, attendu.) Le contournement fonctionne-t-il ?
8. **Mise en veille** du Mac pendant un appel puis réveil ; **perte du Bluetooth** puis retour.
9. Changer le périphérique par défaut dans Réglages Système pendant un appel (rôle qui suit le système).
10. Deux casques identiques : le choix du premier n'est pas pris pour le second.
