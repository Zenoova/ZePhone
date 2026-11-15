# ZePhone

Softphone SIP desktop universel — **Tauri 2 + React + Rust + Baresip**.
macOS en priorité ; l'architecture est prête pour Windows et Linux.

ZePhone n'est pas un simulateur : la signalisation SIP et l'audio (RTP/SRTP) sont assurés par
[Baresip](https://github.com/baresip/baresip), embarqué dans l'application comme _sidecar_ Tauri.
Aucun PBX n'est codé en dur : vous renseignez votre serveur, domaine, identifiants, port et transport
(UDP, TCP, TLS).

> **Statut honnête** : le moteur, les comptes, les appels (sortants/entrants), l'audio bidirectionnel, DTMF,
> attente, transfert, l'historique et les contacts sont testés automatiquement contre le **vrai** Baresip
> (voir [Tests](#tests)). Ce qui ne peut pas être validé sans matériel/serveur réel est listé dans
> [Limites connues](#limites-connues).

## Sommaire

- [Fonctionnalités](#fonctionnalités)
- [Architecture](#architecture)
- [Choix du moteur : processus Baresip vs libbaresip](#choix-du-moteur)
- [Prérequis](#prérequis)
- [Lancer en développement](#lancer-en-développement)
- [Construire l'application macOS (.app / .dmg)](#construire-lapplication-macos)
- [Utiliser ZePhone avec votre PBX](#utiliser-zephone-avec-votre-pbx)
- [Tests](#tests)
- [Sécurité](#sécurité)
- [Windows et Linux](#windows-et-linux)
- [Limites connues](#limites-connues)
- [Licences](#licences)

## Fonctionnalités

| Domaine         | Ce qui est opérationnel                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Comptes         | Un **onglet du dock** liste les comptes avec leur petit visage ([blobatar](https://blobatar.dev), dessiné localement depuis l'adresse du compte) et leur état : plusieurs comptes, ajout/modification/suppression, compte par défaut, activation, connexion/déconnexion, proxy sortant, intervalle d'enregistrement, SRTP. Statut en temps réel **issu des événements SIP** (Non configuré · Connexion en cours · Enregistré · Déconnecté · Erreur) avec le code SIP (401, 403, 404, 408, 503…). Un challenge 401 suivi d'une authentification réussie n'est **pas** un échec.                                                                           |
| Fenêtre d'appel | **Les appels s'ouvrent dans une fenêtre à part** (la fenêtre principale reste libre : clavier, contacts, historique). La voix du correspondant est un orbe vivant (niveau audio **réel** mesuré par Baresip ; « réfléchit » pendant la sonnerie, « parle » quand la voix est là), micro coupé = mention « Micro coupé », commandes alignées (micro, attente, clavier, transfert, raccrocher), pavé DTMF en verre flouté. **En haut à droite : les volumes, et un menu d'options** (garder au premier plan, ouvrir ZePhone, et pour les développeurs : informations de l'appel, journal du moteur SIP, copier l'identifiant d'appel). La fenêtre se ferme seule à la fin de l'appel. |
| Appels sortants | Clavier, adresse SIP libre, appel depuis un contact ou l'historique, choix du compte, progression réelle (initialisation → composition → sonnerie distante → connecté), durée, micro coupé, attente/reprise, DTMF (RFC 4733), transfert aveugle (REFER), raccrochage.                                                                                                                                                                                                                    |
| Appels entrants | Sonnerie (Baresip), fenêtre d'appel entrant par-dessus n'importe quelle section, notification native, accepter/refuser (603), appel manqué, réception fenêtre fermée (icône dans la barre des menus).                                                                                                                                                                                                                                                                                    |
| Audio           | Sélection micro/sortie (noms CoreAudio), périphériques USB/Bluetooth, G.711 PCMA/PCMU, **G.722 et Opus** (build Baresip personnalisée, `npm run sidecar:hd`), SRTP ; les codecs large bande sont préférés, G.711 reste le repli universel. Permission micro macOS (`NSMicrophoneUsageDescription`, entitlement `audio-input`).                                                                                                                                                           |
| Volumes         | Deux curseurs ([Fluid Slider](https://www.sonaui.com/docs/fluid-slider) de Sona UI) : **son entrant** (ce que vous entendez) et **son sortant** (ce que votre correspondant entend de votre micro), de 0 à 200 %. Dans la fenêtre d'appel et dans Paramètres → Audio ; appliqués **en direct** pendant l'appel par le module `zeaudio` de Baresip, mémorisés ensuite. |
| Enregistrement  | **Automatique** : chaque appel décroché est enregistré **localement**, sans bouton ni mention pendant l'appel (désactivable dans Paramètres → Audio). Les deux voix sont écrites par le module `zeaudio`, puis mixées en un WAV mono (≤ 16 kHz) dans le dossier de données de l'app ; l'onglet **Enregistrements** les liste avec le lecteur [Voice note](https://detentui.com/components/voicenote) de Detent (pleine largeur, forme d'onde, vitesse, lecture). Rien ne quitte le Mac. |
| Historique      | Entrants/sortants/manqués/refusés/échoués, durée réelle mesurée, compte, résultat ; rappel en un clic, suppression, recherche, filtres, badge « manqués non lus ».                                                                                                                                                                                                                                                                                                                       |
| Contacts        | Prénom, nom, société, numéro/URI SIP, recherche, ajout/édition/suppression, appel direct ; le nom du contact s'affiche sur les appels entrants/sortants.                                                                                                                                                                                                                                                                                                                                 |
| Paramètres      | audio (volumes, enregistrement), réseau (port SIP local, interface, CA TLS perso, trace SIP, redémarrage moteur, journal), notifications, général (thème clair/sombre/auto, démarrage à l'ouverture de session, démarrage réduit, icône barre des menus, rester actif à la fermeture), à propos.                                                                                                                                                                                                          |
| Robustesse      | Moteur supervisé et redémarré automatiquement (back-off), PBX injoignable ou mauvais identifiants sans plantage, aucun processus orphelin (voir [Sécurité](#sécurité)).                                                                                                                                                                                                                                                                                                                  |

## Architecture

```
┌──────────────────────── ZePhone.app ─────────────────────────┐
│  Webview (React + TS strict + Tailwind + shadcn/ui + Zustand)  │
│    stores ◄── events ──┐         ▲ invoke (commandes typées)    │
│                         │         │                             │
│  Rust (Tauri 2)         │         │                             │
│   commands/ ───────► SipManager ◄─┘  (toute la logique d'appel) │
│                        │  ▲  │   ├─ SQLite (comptes*, contacts, │
│                        │  │  │   │   historique, réglages)      │
│                        │  │  │   └─ Keychain (mots de passe)    │
│                        ▼  │  ▼                                   │
│                    trait SipEngine  ◄── implémentable : FFI, autre│
│                        │                                         │
│                BaresipEngine (supervise le sidecar)              │
└────────────────────────┼─────────────────────────────────────────┘
                         │ ctrl_tcp (JSON/netstring) 127.0.0.1:<port aléatoire>
                    ┌────▼─────┐  RTP/SRTP, SIP (UDP/TCP/TLS)
                    │ baresip  │◄──────────────────────────────► PBX / opérateur
                    └──────────┘  CoreAudio ◄──► micro / haut-parleurs
```

\* sans mots de passe.

- **Le frontend ne connaît pas SIP** : il envoie des intentions (`dial`, `answer_call`, `hold_call`…) et
  reçoit de l'état (`account:status`, `call:update`, `engine:state`, `history:changed`).
- **La logique d'appel est en Rust** (`src-tauri/src/sip/manager.rs`) : un appel entrant est traité
  (sonnerie, notification, historique) même si la webview est masquée ou rechargée.
- **Machines à états pures et testées** : `sip/registration.rs`, `sip/calls.rs`.
- **Abstraction moteur** : `sip/engine/mod.rs` (`trait SipEngine`, événements neutres). Remplacer Baresip
  par `libbaresip` en FFI ou par une autre pile ne touche ni le manager, ni les commandes, ni l'UI.

```
src/                         React (app/, layouts/, features/{dialer,calls,contacts,history,recordings,settings},
                             components/arc = Arc UI, components/ui = shadcn (champs de formulaire, dock, slider Sona),
                             components/detent = lecteur Voice note, components/orbs = orbes OrbKit,
                             components/icons = icônes Lucide animées (AnimateIcons),
                             services/telephony = API typée, stores/, hooks/, types/)
src-tauri/src/
  sip/engine/                trait SipEngine, netstring, parsing des événements Baresip
  sip/engine/baresip/        config, process (cycle de vie), client ctrl_tcp, BaresipEngine (supervision)
  sip/{manager,calls,registration,diagnostics,uri,types}.rs
  database/                  SQLite + migrations (PRAGMA user_version)
  security/                  Keychain (keyring), masquage des secrets dans les logs
  audio/                     liste des périphériques (cpal), permission micro macOS (objc2)
  recording/                 mixage des deux voix d'un appel en un WAV (streaming), forme d'onde
  app/, commands/            glue Tauri : événements, tray, notifications, API invoke
  tests/                     tests d'intégration contre le vrai Baresip
scripts/baresip-modules/     zeaudio : filtre audio de ZePhone pour Baresip (volumes, enregistrement)
scripts/prepare-baresip.sh   prépare le sidecar relocalisable pour le bundle
```

## Choix du moteur

|                                 | A — `libbaresip` (FFI C)                                                                                                                            | B — processus Baresip piloté (`ctrl_tcp`) ✅                                               |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Intégration                     | bindgen + édition de liens de libre/libbaresip/OpenSSL/modules dans le binaire Rust ; threading (« libre n'est pas thread-safe ») à gérer à la main | binaire autonome embarqué comme _sidecar_ Tauri                                            |
| Stabilité                       | un crash C emporte toute l'application                                                                                                              | un crash du moteur est isolé et le moteur est **redémarré** par le superviseur             |
| Mise en route / packaging macOS | chaîne de build C complexe                                                                                                                          | `scripts/prepare-baresip.sh` relocalise binaire + dylibs + modules                         |
| Latence de commande             | appel direct                                                                                                                                        | boucle locale TCP, négligeable pour du contrôle d'appel (l'audio ne transite pas par Rust) |
| Évolution                       | —                                                                                                                                                   | l'abstraction `SipEngine` permet de passer à (A) plus tard sans réécrire le reste          |

**Décision : B pour la v1.** Un seul processus Baresip pour toute la durée de vie de l'app (jamais un
processus par appel), supervisé, arrêté proprement, et contrôlé via le module `ctrl_tcp`
(framing netstring `<len>:<json>,` — vérifié dans le code de Baresip 4.13, pas seulement dans la doc).

Points vérifiés dans les sources de Baresip 4.13 (et non supposés) :

- `ctrl_tcp` écoute **0.0.0.0:4444 par défaut, sans authentification** : ZePhone force
  `127.0.0.1:<port libre aléatoire>` à chaque démarrage ;
- une seule connexion cliente ; les événements ont `"event": true` (la doc dit `"true"` : les deux sont acceptés) ;
- `REGISTER_OK/FAIL` portent `"<code> <raison>"` ; seul le résultat **final** de la transaction est notifié
  (le 401 intermédiaire n'est jamais un échec) ;
- `CALL_HOLD/CALL_RESUME` ne sont émis que pour les mises en attente **distantes** : l'état « en attente »
  local est suivi côté Rust ;
- Baresip ignore les adresses loopback pour les appels sauf si `net_interface` les désigne explicitement.

## Prérequis

macOS 11+ (Apple Silicon ou Intel), Xcode Command Line Tools, Node 20+, Rust stable.

```bash
brew install baresip rustup
rustup default stable
rustup target add x86_64-apple-darwin   # facultatif : build Intel / universelle
npm install
```

Pour embarquer **G.722 et Opus** (absents de la bouteille Homebrew de Baresip) :

```bash
brew install cmake pkgconf opus spandsp
npm run sidecar:hd        # compile Baresip depuis les sources (tag = version de libre) puis prépare le sidecar
```

Homebrew n'est utilisé **que pour développer** : l'application packagée embarque Baresip, libre, OpenSSL
(et Opus/spandsp avec la build HD) sans rien demander à l'utilisateur final.

## Lancer en développement

```bash
npm run tauri dev
```

`npm run sidecar` (appelé automatiquement avant `dev` et `build`) copie Baresip depuis Homebrew (ou
`BARESIP_PREFIX=/chemin`) vers `src-tauri/binaries/` et `src-tauri/resources/` en réécrivant les
chemins de bibliothèques (`@rpath`), puis signe ad hoc. Pour recréer : `npm run sidecar -- --force`.

Aperçu de l'interface **sans backend** (relecture visuelle uniquement, aucune communication SIP) :
`npm run dev` puis ouvrir <http://localhost:1420/?mock>.

## Construire l'application macOS

```bash
npm run tauri build                          # .app + .dmg (macOS)
npm run tauri build -- --bundles app         # .app seulement
npm run tauri build -- --target universal-apple-darwin   # Apple Silicon + Intel (voir ci-dessous)
```

Sorties : `src-tauri/target/release/bundle/macos/ZePhone.app` et
`src-tauri/target/release/bundle/dmg/ZePhone_<version>_<arch>.dmg`.

Contenu du bundle : `Contents/MacOS/{zephone,baresip}`, `Contents/Frameworks/{libbaresip,libre,libssl,libcrypto}.dylib`,
`Contents/Resources/engine/{modules,sounds,licenses}`. Le `Info.plist` contient `NSMicrophoneUsageDescription` ;
`Entitlements.plist` accorde `audio-input` (hardened runtime) et `disable-library-validation` (Baresip charge ses
modules par `dlopen`).

**Signature / notarisation** : le build local est signé _ad hoc_ (`signingIdentity: "-"`). Pour distribuer,
renseignez votre identité Developer ID et les variables `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`
(voir la doc Tauri) ; **l'ensemble des Mach-O du bundle (sidecar, dylibs, modules) doit être signé avec la même
identité**. Au premier lancement d'une app non notarisée, Gatekeeper demande une confirmation
(clic droit › Ouvrir).

**Build universel** : `prepare-baresip.sh` prépare l'architecture de la machine hôte. Pour un binaire universel, produisez
un Baresip/libre/OpenSSL `x86_64` (ex. via un Homebrew Rosetta) et fusionnez avec `lipo`, ou publiez deux builds
séparés (un `.dmg` par architecture) — non réalisé ici.

## Utiliser ZePhone avec votre PBX

1. Ouvrez ZePhone → **Paramètres › Comptes SIP › Ajouter**.
2. Renseignez : _Serveur SIP_ (`sip.example.com`), _Port_ (`5060` / `5061`), _Transport_, _Domaine_ (si différent),
   _Identifiant_, _Identifiant d'authentification_ (si différent), _Mot de passe_ (saisi dans l'application,
   stocké dans le Trousseau, jamais en clair).
3. **Ajouter et connecter** : le statut passe à _Enregistré_ (ou affiche le code SIP de l'erreur).
4. Composez un numéro dans **Clavier** et appelez ; autorisez le micro à la première demande.

Limitation de la syntaxe de compte Baresip : un mot de passe ne peut pas contenir le caractère `"` (refusé avec un
message clair).

## Tests

```bash
# Rust : unitaires (états, parsing, validation, base, manager scripté) — ne nécessitent rien
cd src-tauri && cargo test --lib

# Rust : bout en bout contre le VRAI Baresip (nécessite `npm run sidecar` ; modules de test ausine/aufile du Baresip local)
npm run test:e2e

# Rust : interopérabilité contre un VRAI PBX (FreeSWITCH lancé à la volée, loopback, mot de passe aléatoire, nettoyé ensuite)
brew install freeswitch && npm run test:pbx

# Frontend
npm run typecheck && npm run lint && npm test && npm run build
```

Ce que couvrent les tests d'intégration (aucun mock du moteur) :

- démarrage du sidecar, version/codecs (dont Opus et G.722 s'ils sont embarqués), port de contrôle **sur loopback uniquement**,
  aucun fichier `accounts` ;
- arrêt sans processus orphelin ; redémarrage automatique après `SIGKILL` du moteur ;
- enregistrement via un registrar de test avec **challenge Digest 401** (puis 200), mot de passe erroné → **401**,
  403, 503, connexion TCP refusée ; aucun mot de passe dans les journaux ;
- **appel réel entre deux instances Baresip** avec RTP : un sinus 440 Hz et un sinus 880 Hz sont émis, reçus et écrits
  en WAV des deux côtés (audio bidirectionnel mesuré, en Opus), DTMF, attente/reprise, muet, raccrochage, refus 603 ;
- `SipManager` complet (moteur réel + SQLite) : statuts, appel sortant/entrant, manqué, refusé, historique, nom de contact,
  notifications ;
- **FreeSWITCH (PBX tiers réel)** : enregistrement Digest, mauvais mot de passe → `403 Forbidden`, appel sortant vers un poste par
  son numéro, audio dans les deux sens relayé par le PBX, DTMF, attente/reprise, appel entrant avec nom du contact, **transfert aveugle (REFER)**
  vers un 3e poste, appel manqué ;
- les noms de périphériques audio listés par l'UI sont acceptés par Baresip (CoreAudio) et un nom inconnu est refusé.

Vérifié à la main sur l'application packagée (debug et release) : démarrage, lancement du sidecar, connexion `127.0.0.1`, fichiers en
`0600/0700`, quitter via ⌘Q (événement Apple) / `SIGTERM` / `SIGKILL` **sans processus orphelin** ; `.dmg` vérifié (`hdiutil verify`)
et signature ad hoc valide après montage.

## Sécurité

- Mots de passe SIP : **Trousseau macOS** (`keyring`) — pas de colonne mot de passe en base, `SecretString` côté Rust,
  masquage systématique (`auth_pass=***`) dans les journaux et messages d'erreur.
- Aucun fichier de configuration contenant des identifiants : les comptes sont créés en mémoire dans Baresip via
  le socket de contrôle local. Le dossier moteur est `0700`, les fichiers `0600`.
- `ctrl_tcp` : `127.0.0.1` uniquement, port aléatoire, **jamais exposé au frontend** (capacités Tauri minimales :
  `core:default`, pas de plugin shell/fs/http pour la webview). Limite connue : `ctrl_tcp` n'a pas
  d'authentification ; un processus local du même utilisateur pourrait s'y connecter.
- Validation stricte des entrées avant tout envoi au moteur (`sip/uri.rs`) : espaces, `;`, `"`, `<>`, retours à la ligne refusés.
- Vérification des certificats TLS **toujours activée** (`sip_verify_server yes`) ; CA système, plus un fichier PEM optionnel.
- CSP stricte dans la webview ; aucune télémétrie.
- Cycle de vie du moteur : arrêt gracieux (hangup → désenregistrement → `quit`), nettoyage sur ⌘Q, `SIGTERM/INT/HUP`,
  chien de garde pour `SIGKILL`/plantage (macOS/Linux), nettoyage d'une instance périmée au démarrage suivant.
- Baresip ouvre des écouteurs SIP (UDP/TCP) sur les interfaces locales pour recevoir des appels, comme tout softphone ;
  c'est inhérent à la réception d'appels (utilisez un pare-feu ou « Interface locale » dans Réseau pour restreindre).

## Windows et Linux

Le code Rust est portable (pilote audio, extension des modules, chemins, trousseau et watchdog sélectionnés par
`cfg`). Il reste à fournir le sidecar pour chaque plateforme :

1. **Obtenir/compiler Baresip** pour la cible (Windows : MSVC/vcpkg ou MSYS2 ; Linux : paquet `baresip` ou build CMake) avec les modules
   `g711`, `auconv`, `auresamp`, `srtp`, `menu`, `ctrl_tcp`, le pilote audio de la plateforme (`winwave`/`wasapi` ; `alsa`/`pulse`/`pipewire`) et si possible `g722`, `opus`.
2. **Nommer le binaire** `src-tauri/binaries/baresip-<triple>` (`x86_64-pc-windows-msvc.exe`, `x86_64-unknown-linux-gnu`…, voir `rustc -vV`),
   copier les modules dans `src-tauri/resources/baresip/{modules,sounds,licenses}` et les bibliothèques partagées à côté du binaire
   (`.dll`) ou en `rpath` (`$ORIGIN/../lib/zephone`).
3. **Pilote audio** : adapter `audio_driver()` dans `src-tauri/src/sip/engine/baresip/config.rs` si besoin (`winwave` est le défaut Windows).
4. **Linux** : dépendances de build `libwebkit2gtk-4.1-dev`, `libdbus-1-dev`, `libasound2-dev` ; le trousseau passe par Secret Service.
5. **Windows** : le chien de garde anti-orphelin n'est pas implémenté (utiliser un _Job Object_ `KILL_ON_JOB_CLOSE`) ; le nettoyage
   normal (fermeture, Ctrl-C) fonctionne.
6. `tauri build` produit alors `.msi`/`.exe` (Windows) et `.deb`/`.AppImage` (Linux).

**Cette partie n'a pas été exécutée ici** (machine macOS uniquement).

## Limites connues

- **Enregistrer un appel peut exiger l'accord de l'autre personne** (selon le pays) : l'enregistrement est automatique mais purement local, et désactivable dans Paramètres → Audio ; à vous d'informer vos correspondants. Un seul appel est enregistré à la fois ; les fichiers sont des WAV mono (≈ 115 Mo par heure à 16 kHz), non compressés.
- **Vérifié avec le vrai moteur, pas dans la vraie fenêtre** : l'enregistrement des deux voix et les volumes sont testés avec deux Baresip réels (voix synthétiques, fichiers complets, amplitude divisée par 2 à 50 %, silence à 0 %) ; l'ouverture de la fenêtre d'appel, le lecteur d'enregistrements et le menu n'ont été vus que dans l'aperçu navigateur (`npm run dev`, `/?mock`, `/?mock&window=call`) — les tester avec un vrai appel.
- **Composants** : les composants d'[Arc UI](https://uiarc.dev) (dialogues, boutons standard, interrupteurs, pastilles, onglets — les mêmes dans l'historique et les paramètres —, menu, popover) sont utilisés partout où leur API le permet ; les champs de formulaire (saisie, liste déroulante, étiquette), les boutons à style sur mesure (boutons d'appel, icônes) et le dock restent en shadcn / composants maison. Les alertes utilisent [Ding](https://ding.yusufcengiz.dev).
- **Orbes OrbKit** : seuls les 14 orbes sous licence MIT sont embarqués. Les 19 autres sont des portages de shaders de @XorDev, réservés à un usage **non commercial** avec attribution : ils ne sont pas inclus (voir `src/components/orbs/README.md` pour les ajouter dans un build personnel). Les orbes sont des shaders WebGL : le plus lourd (volumétrique) coûte du GPU, la résolution est plafonnée à 1,5× ; WebGL n'a été vérifié que dans l'aperçu navigateur, pas dans la fenêtre WKWebView de l'app.
- **Fond translucide** : il utilise l'API privée `macOSPrivateApi` de Tauri (fenêtre transparente + `NSVisualEffectView`), incompatible avec le Mac App Store ; ce n'est pas le matériau « Liquid Glass » natif de macOS 26 mais l'effet de transparence classique. Sur Windows/Linux il est ignoré.

- **Non vérifié sans matériel/serveur réel** : la capture/lecture sur le micro et les haut-parleurs réels pendant un appel
  (les tests utilisent des sources/puits audio synthétiques ; la sélection des périphériques CoreAudio et la permission micro
  sont, elles, vérifiées) ; l'affichage de l'invite micro et l'attribution TCC au sous-processus Baresip sur un **premier lancement
  propre**, la notification native macOS, la sonnerie sur le haut-parleur, un opérateur VoIP réel, TLS avec un vrai certificat.
- **Codecs** : la bouteille Homebrew de Baresip ne fournit que G.711 ; Opus et G.722 viennent de `npm run sidecar:hd`. G.722 s'appuie
  sur **spandsp (LGPL-2.1, liée dynamiquement, projet non maintenu)** : voir `THIRD_PARTY_NOTICES.md`. Sans ces modules l'application
  retombe automatiquement sur G.711.
- **Transfert** : transfert aveugle (REFER) ; pas de transfert supervisé dans l'interface. Un appel sortant à la fois en cours d'établissement.
- **NAT** : pas de STUN/TURN/ICE configurable dans l'UI v1 (modules disponibles dans Baresip).
- **Vidéo, messagerie instantanée, présence, BLF** : hors périmètre.
- **Un seul client `ctrl_tcp`** à la fois (limitation de Baresip) et **pas d'authentification** sur ce canal (voir Sécurité).
- Build universelle macOS, notarisation, Windows, Linux : documentés, non exécutés.
- Mot de passe SIP contenant `"` : non supporté (limitation de la syntaxe d'adresse de Baresip).

## Licences

ZePhone embarque :

- **Baresip** et **libre** — BSD-3-Clause ;
- **OpenSSL** (`libssl`/`libcrypto`) — Apache-2.0 ;
- Baresip y est compilé avec **un seul changement** : le module `vumeter` rapporte les niveaux audio toutes les 60 ms au lieu de 500 ms (`scripts/build-baresip.sh`), plus le module maison `zeaudio` (`scripts/baresip-modules/zeaudio`, BSD-3) ;
- **Opus** (BSD-3-Clause) et **spandsp** pour G.722 (LGPL-2.1, dynamique), plus leurs dépendances (libtiff, libjpeg-turbo, libwebp, xz, zstd) ;
- G.711 est intégré à Baresip.

Les textes de licence se trouvent dans `Contents/Resources/engine/licenses/` du bundle (`MANIFEST.txt` liste les versions).
Voir aussi [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). **Aucune licence n'est encore déclarée pour le code de ZePhone lui-même.** Les dépendances Rust/JS (Tauri, React, shadcn/ui, Radix, Tailwind, rusqlite,
keyring, cpal…) sont sous licences MIT / Apache-2.0.
