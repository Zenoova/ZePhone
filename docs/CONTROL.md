# Raccourcis globaux et commande externe

ZePhone se pilote sans remettre la fenêtre au premier plan : par des **raccourcis clavier globaux**, par le **menu de la barre des menus**, et par la **ligne de commande** `zephone ctl` (utilisable depuis un Stream Deck, un script, Raccourcis, Alfred…).

Les trois passent par **le même exécuteur**, celui qui vérifie que l'action a un sens à cet instant, choisit l'appel visé et appelle les mêmes fonctions que les boutons de l'interface. Ils ne peuvent donc pas se contredire.

## 1. Raccourcis globaux

*Réglages → Raccourcis.* Ils fonctionnent dans toutes les applications, y compris quand ZePhone est réduit dans la barre des menus, tant que ZePhone est lancé.

| Action | Défaut (macOS) | Ce qu'elle demande |
|---|---|---|
| Décrocher | ⌥⇧⌘A | décrocher l'appel entrant |
| Refuser l'appel entrant | ⌥⇧⌘D | refuser (603) |
| Raccrocher | ⌥⇧⌘H | raccrocher **un** appel |
| Couper / réactiver le micro | ⌥⇧⌘M | basculer le micro de l'appel visé |
| Mettre en attente / reprendre | ⌥⇧⌘P | basculer l'attente de l'appel visé |
| Afficher le clavier | ⌥⇧⌘N | affiche la fenêtre, prête à composer |
| Rechercher un contact | ⌥⇧⌘F | affiche la fenêtre sur la recherche de l'annuaire |
| Ne pas déranger | ⌥⇧⌘Z | bascule « Ne pas déranger » |

Pour chaque action, la page montre son nom, sa combinaison, sa portée (« Global »), son état, et permet de **modifier** (capture directement au clavier), **supprimer**, **désactiver** ou **rétablir** la combinaison par défaut, ainsi que de tout désactiver d'un coup. Les raccourcis qui ne marchent que fenêtre au premier plan (⌘1 à ⌘4, `/` dans l'annuaire) sont listés à part.

### États d'un raccourci

| État | Sens |
|---|---|
| **Actif** | enregistré auprès du système : le presser, où que vous soyez, lance l'action |
| **Non activé** | la combinaison est enregistrée dans vos réglages, **mais le système l'a refusée** (le plus souvent : une autre application la possède). Elle ne fait rien. Le motif est affiché. |
| Désactivé | éteint par vous ; la combinaison est gardée |
| Non attribué | aucune combinaison |
| En pause | pendant que vous enregistrez une combinaison |

### Règles

- **Pas de touche seule.** Une combinaison comporte au moins Ctrl, Option/Alt ou ⌘ (Maj seul ne compte pas) : une lettre tapée dans un autre logiciel ne doit jamais lancer une action téléphonique. Seules F13 à F24, que nul ne tape par accident, sont acceptées seules.
- **Option/Alt seul est refusé sur une touche de saisie** : il sert à écrire des accents et des symboles (sur macOS) ; le prendre globalement gênerait la frappe.
- **Les combinaisons que le système garde** (⌘Q, ⌘Tab, ⌘Espace, ⌘H, ⌘M, ⌃⌘Q, ⇧⌘3/4/5 ; Alt+F4, Alt+Tab, Ctrl+Alt+Suppr sur Windows) sont refusées avec la raison.
- **Pas de doublon** entre deux actions, quelle que soit l'écriture (`cmd+option+shift+a` = `CommandOrControl+Alt+Shift+A`). Le message nomme l'action qui possède déjà la combinaison.
- **Pendant l'enregistrement d'une combinaison, aucun raccourci n'est actif** : presser une combinaison existante pour la réutiliser ne lance pas son action. L'enregistrement s'arrête seul si la fenêtre perd le focus ou si la page est quittée.
- **Une pression, une action.** Une touche maintenue répète sa pression ; seule la première compte, la suivante n'est prise qu'après le relâchement (ou après deux secondes sans événement, si un relâchement s'était perdu), et jamais moins d'un quart de seconde après la précédente.
- **Libération.** Modifier, supprimer ou désactiver une combinaison la libère immédiatement auprès du système ; quitter ZePhone libère toutes les combinaisons.
- **Persistance.** Les préférences sont enregistrées (SQLite, clé `shortcuts`) et ré-enregistrées auprès du système à chaque lancement.

### Autorisations

**macOS : aucune.** Les raccourcis globaux utilisent l'enregistrement de touches d'accès rapide du système : ZePhone est seulement prévenu quand *l'une de ses propres combinaisons* est pressée, il ne lit pas le clavier. Aucune autorisation « Accessibilité » ou « Surveillance de l'entrée » n'est demandée ni nécessaire.

Si vous déclenchez ces raccourcis **depuis un Stream Deck** (action *Hotkey*), c'est l'application Stream Deck qui envoie des frappes : macOS lui demandera *Réglages Système → Confidentialité et sécurité → Accessibilité*. Cette autorisation concerne Stream Deck, pas ZePhone, et elle est inutile avec l'option « Open » décrite plus bas.

Windows et Linux : le même code s'appuie sur les mécanismes de ces systèmes, **non testés** (ZePhone n'y est pas encore construit). Sur Windows, Ctrl+Alt équivaut à AltGr sur de nombreux claviers : préférez d'autres combinaisons.

## 2. Quel appel est visé ?

Une commande peut **nommer son appel** (`--call <id>`). Sinon, la règle est la même pour les raccourcis, le menu et la ligne de commande :

| Action | Appels candidats | Sans identifiant |
|---|---|---|
| Décrocher, Refuser | appels **entrants** en attente | un seul → lui. **Plusieurs → rien n'est fait** (ambigu) |
| Raccrocher | appels en cours d'établissement ou établis (jamais un appel entrant qui sonne : c'est « Refuser ») | un seul → lui ; plusieurs → **celui qui n'est pas en attente** s'il est seul à ne pas l'être ; sinon ambigu |
| Micro | appels établis | idem |
| Attente (mettre) | appels établis | idem : l'appel actif |
| Attente (reprendre) | appels établis | un seul → lui ; plusieurs → **celui qui est en attente** s'il est seul ; sinon ambigu |

- **Raccrocher ne devient jamais « tout raccrocher ».** Il n'existe aucune commande pour cela.
- **Aucun candidat** → la commande ne fait rien (état `unavailable`) : « décrocher » sans appel entrant ne déclenche rien d'autre, « attente » ne touche pas un appel qui sonne.
- **Ambigu** → rien n'est fait. La réponse liste les appels candidats pour que l'appelant en nomme un. Depuis un raccourci, ZePhone se met au premier plan et le dit dans une notification.
- Les requêtes qui agissent sur des appels sont traitées **une à la fois** : deux bascules rapprochées lisent chacune l'état laissé par la précédente.
- L'interface affiche **l'état confirmé par le moteur d'appel**, pas celui demandé. Si le moteur refuse, l'état reste celui qu'il confirme et la réponse est `failed`.

## 3. Ne pas déranger

*Réglages → Notifications*, raccourci, ou menu de la barre des menus. Activé, tout **nouvel appel entrant est refusé immédiatement** (486 *Busy Here*), avant toute sonnerie, fenêtre ou notification. L'appelant entend « occupé » (son serveur peut le diriger vers une messagerie). L'appel apparaît dans l'historique comme **manqué**, sans notification. Les appels que vous passez ne sont pas touchés ; un appel déjà en cours de sonnerie n'est pas refusé rétroactivement.

## 4. Commande externe : `zephone ctl`

Le même exécutable que l'application, lancé avec `ctl`, parle à l'instance **déjà ouverte** puis s'arrête. Il ne lance jamais ZePhone ni une seconde fenêtre.

```bash
Z=/Applications/ZePhone.app/Contents/MacOS/zephone

$Z ctl dial 1002                    # extension
$Z ctl dial "+33 1 23 45 67 89"     # numéro
$Z ctl dial sip:bob@example.com     # adresse SIP
$Z ctl dial 1002 --account <id>     # avec un compte précis (défaut : le compte par défaut)
$Z ctl answer                       # décrocher l'appel entrant
$Z ctl reject                       # le refuser
$Z ctl hangup                       # raccrocher (un seul appel, règle ci-dessus)
$Z ctl hangup --call <id>           # raccrocher cet appel
$Z ctl mute            # bascule      $Z ctl mute on   $Z ctl mute off     # explicite
$Z ctl hold            # bascule      $Z ctl hold on   $Z ctl hold off
$Z ctl dnd             # bascule      $Z ctl dnd on    $Z ctl dnd off
$Z ctl show | dialer | search       # fenêtre, clavier, recherche de contacts
$Z ctl status --pretty              # état de l'application et des appels
```

Les numéros, extensions internes, adresses SIP et règles de numérotation sont **ceux du clavier de l'application** : la même validation est appliquée.

**Commandes explicites.** `mute on` / `mute off`, `hold on` / `hold off`, `dnd on` / `dnd off` mènent l'appel à cet état. **Les répéter ne change rien de plus** : `mute on` sur un appel déjà muet répond `ok` avec `"changed": false` et n'envoie aucune requête au moteur. Les formes sans argument (bascules) sont faites pour le clavier.

### Réponse

Une ligne de JSON sur la sortie standard (`--pretty` pour l'indenter) :

```json
{"status":"ok","message":"Micro coupé","changed":true,"settled":true,
 "call":{"id":"…","state":"connected","muted":true,"heldLocally":false, …}}
```

| `status` | Code de sortie | Sens |
|---|---|---|
| `ok` | 0 | accepté |
| `failed` | 1 | le moteur a refusé ou échoué |
| `invalid` | 2 | commande ou paramètre invalide |
| `notFound` | 3 | l'appel (ou le compte) nommé n'existe pas |
| `ambiguous` | 4 | plusieurs appels conviennent ; `candidates` les liste. Rien n'a été fait |
| `unavailable` | 5 | rien à faire dans l'état actuel (pas d'appel entrant, rien en attente…) |
| `disconnected` | 6 | ZePhone n'est pas lancé, le moteur est arrêté ou aucun compte n'est connecté |

**Accepté n'est pas terminé.** `settled` distingue les deux : pour le micro et l'attente, la réponse n'est envoyée qu'après la confirmation du moteur (`settled: true`, `call` montre l'état confirmé). Pour décrocher, raccrocher, refuser et composer, le moteur *accepte* la demande tout de suite mais l'appel ne change d'état que lorsque l'autre côté suit : `settled: false`. Relisez `ctl status` pour le résultat final.

`ctl status` renvoie, dans `app` : `engineRunning`, `doNotDisturb`, `accounts` (avec `connected`) et `calls` (état, `muted`, `heldLocally`, `heldRemotely`…).

### Sécurité

- **Pas de port réseau.** La commande passe par un **socket Unix** (`~/Library/Application Support/app.zephone.softphone/control.sock` sur macOS), de mode `0600` : seul votre utilisateur peut s'y connecter, et ZePhone vérifie en plus l'identité de l'utilisateur de chaque connexion. Une page web ne peut pas ouvrir un socket Unix : aucune page ne peut piloter ZePhone, et il n'y a ni jeton ni en-tête à protéger.
- Seules les commandes ci-dessus existent. Rien n'est exécuté, aucun fichier n'est lu ; un champ inconnu (`{"cmd":"hangup","all":true}`) est refusé.
- Les paramètres sont validés strictement (longueurs, caractères d'identifiant, destinataire) avant d'atteindre le moteur ; une requête dépasse 4 Ko → refusée.
- Les journaux notent le nom de la commande et son résultat, **jamais le numéro composé**.
- Un socket laissé par un plantage est remplacé ; un fichier qui n'est pas un socket n'est jamais supprimé ; une seconde instance ne vole pas le socket de la première.
- Pour un autre langage que le shell : une requête = une ligne JSON envoyée au socket, une réponse = une ligne JSON. `ZEPHONE_CONTROL_SOCKET` remplace le chemin (utile si le chemin par défaut dépasse la limite de 100 octets).

Windows : le socket Unix n'existe pas ; un tube nommé serait le choix naturel. **Non fait.**

## 5. Stream Deck

Deux façons, sans plugin à installer.

### Option A — action « Hotkey » (la plus simple)

Dans Stream Deck, glissez **Système → Raccourci clavier (Hotkey)** sur une touche et enregistrez la combinaison de l'action (par défaut ⌥⇧⌘H pour raccrocher, ⌥⇧⌘A pour décrocher, ⌥⇧⌘M pour le micro, ⌥⇧⌘N pour afficher le clavier). Rien d'autre à configurer côté ZePhone. Limites : ce sont des **bascules** (micro, attente), et macOS demande l'autorisation Accessibilité à l'application Stream Deck.

### Option B — action « Open » + commande explicite

`integrations/streamdeck/make-buttons.sh` fabrique une petite application par action (micro coupé / actif, décrocher, raccrocher, afficher…) qui lance `zephone ctl …` et se ferme. Aucune autorisation, aucun secret.

```bash
integrations/streamdeck/make-buttons.sh                       # crée ~/Documents/ZePhone Stream Deck/
integrations/streamdeck/make-buttons.sh --app /Applications/ZePhone.app --out ~/StreamDeckZePhone
```

Dans Stream Deck : **Système → Ouvrir (Open)**, puis choisissez l'application voulue (`ZePhone - Hang up.app`, `ZePhone - Mute ON.app`, `ZePhone - Show.app`…).

Boutons créés : *Answer, Decline, Hang up, Mute (toggle), Mute ON, Mute OFF, Hold (toggle), Do not disturb (toggle), Show, Dialer, Search contacts.*

### Ce que les touches affichent

**Les touches Stream Deck n'affichent pas l'état du micro ni de l'appel.** Les actions d'origine de Stream Deck n'ont aucun moyen de lire `ctl status`, et aucun plugin n'est fourni : une icône de micro barré ne saurait pas si le micro est vraiment coupé. Pour ne jamais avoir de doute, utilisez deux touches distinctes **Mute ON** / **Mute OFF** (explicites : les presser plusieurs fois ne change rien de plus) et regardez la fenêtre ou la barre des menus pour l'état réel. Un plugin Stream Deck qui interrogerait `zephone ctl status` toutes les secondes pourrait afficher l'état confirmé ; il n'est pas écrit.

## 6. Ce qui est vérifié

| Vérifié | Comment |
|---|---|
| Sélection de l'appel visé, idempotence des commandes explicites, refus sans effet de bord, pas de double déclenchement de bascules simultanées, validation des commandes | tests automatiques (`control::*`) |
| Décrocher, refuser, raccrocher, micro, attente, composer, « Ne pas déranger » sur de **vrais appels** (deux moteurs Baresip réels), état confirmé par le moteur, 486 reçu par l'appelant | `tests/control_e2e.rs` |
| Socket : mode `0600`, requêtes invalides refusées (JSON inconnu, champ en trop, HTTP, UTF-8 invalide, trop long), remplacement d'un socket périmé, pas de vol d'un socket vivant, pas de suppression d'un fichier ordinaire | tests automatiques + test réel |
| Lecture/écriture/libération des combinaisons, doublons, combinaisons refusées, préférences conservées au redémarrage, pause pendant l'enregistrement, anti-répétition | tests automatiques (`shortcuts::*`) |
| Page de réglages : capture au clavier, aucune action pendant l'enregistrement, motif du refus, rétablir, supprimer, désactiver | tests du composant |
| Texte des combinaisons accepté par la couche système | test automatique (`Shortcut::from_str`) |

Voir le bilan en fin de livraison pour ce qui a été exécuté **dans le système réel** (raccourci pressé depuis une autre application, fenêtre réduite, conflit avec une autre application, Stream Deck).
