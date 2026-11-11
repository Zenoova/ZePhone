# ZePhone

Softphone SIP desktop universel — **Tauri 2 + React + Rust + Baresip**.
macOS en priorité ; l'architecture est prête pour Windows et Linux.

ZePhone n'est pas un simulateur : la signalisation SIP et l'audio (RTP/SRTP) sont assurés par
[Baresip](https://github.com/baresip/baresip), embarqué dans l'application comme *sidecar* Tauri.
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

| Domaine | Ce qui est opérationnel |
| --- | --- |
| Comptes | Plusieurs comptes, ajout/modification/suppression, compte par défaut, activation, connexion/déconnexion, proxy sortant, intervalle d'enregistrement, SRTP. Statut en temps réel **issu des événements SIP** (Non configuré · Connexion en cours · Enregistré · Déconnecté · Erreur) avec le code SIP (401, 403, 404, 408, 503…). Un challenge 401 suivi d'une authentification réussie n'est **pas** un échec. |
| Appels sortants | Clavier, adresse SIP libre, appel depuis un contact ou l'historique, choix du compte, progression réelle (initialisation → composition → sonnerie distante → connecté), durée, micro coupé, attente/reprise, DTMF (RFC 4733), transfert aveugle (REFER), raccrochage. |
| Appels entrants | Sonnerie (Baresip), fenêtre d'appel entrant par-dessus n'importe quelle section, notification native, accepter/refuser (603), appel manqué, réception fenêtre fermée (icône dans la barre des menus). |
| Audio | Sélection micro/sortie (noms CoreAudio), périphériques USB/Bluetooth, G.711 PCMA/PCMU, SRTP ; G.722/Opus chargés **si présents** dans la build Baresip (voir limites). Permission micro macOS (`NSMicrophoneUsageDescription`, entitlement `audio-input`). |
| Historique | Entrants/sortants/manqués/refusés/échoués, durée réelle mesurée, compte, résultat ; rappel en un clic, suppression, recherche, filtres, badge « manqués non lus ». |
| Contacts | Prénom, nom, société, numéro/URI SIP, recherche, ajout/édition/suppression, appel direct ; le nom du contact s'affiche sur les appels entrants/sortants. |
| Paramètres | Comptes, audio, réseau (port SIP local, interface, CA TLS perso, trace SIP, redémarrage moteur, journal), notifications, général (thème clair/sombre/auto, démarrage à l'ouverture de session, démarrage réduit, icône barre des menus, rester actif à la fermeture), à propos. |
| Robustesse | Moteur supervisé et redémarré automatiquement (back-off), PBX injoignable ou mauvais identifiants sans plantage, aucun processus orphelin (voir [Sécurité](#sécurité)). |

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
src/                         React (app/, layouts/, features/{dialer,calls,contacts,history,settings},
                             components/ui = shadcn, services/telephony = API typée, stores/, hooks/, types/)
src-tauri/src/
  sip/engine/                trait SipEngine, netstring, parsing des événements Baresip
  sip/engine/baresip/        config, process (cycle de vie), client ctrl_tcp, BaresipEngine (supervision)
  sip/{manager,calls,registration,diagnostics,uri,types}.rs
  database/                  SQLite + migrations (PRAGMA user_version)
  security/                  Keychain (keyring), masquage des secrets dans les logs
  audio/                     liste des périphériques (cpal), permission micro macOS (objc2)
  app/, commands/            glue Tauri : événements, tray, notifications, API invoke
  tests/                     tests d'intégration contre le vrai Baresip
scripts/prepare-baresip.sh   prépare le sidecar relocalisable pour le bundle
```

## Choix du moteur

| | A — `libbaresip` (FFI C) | B — processus Baresip piloté (`ctrl_tcp`) ✅ |
| --- | --- | --- |
| Intégration | bindgen + édition de liens de libre/libbaresip/OpenSSL/modules dans le binaire Rust ; threading (« libre n'est pas thread-safe ») à gérer à la main | binaire autonome embarqué comme *sidecar* Tauri |
| Stabilité | un crash C emporte toute l'application | un crash du moteur est isolé et le moteur est **redémarré** par le superviseur |
| Mise en route / packaging macOS | chaîne de build C complexe | `scripts/prepare-baresip.sh` relocalise binaire + dylibs + modules |
| Latence de commande | appel direct | boucle locale TCP, négligeable pour du contrôle d'appel (l'audio ne transite pas par Rust) |
| Évolution | — | l'abstraction `SipEngine` permet de passer à (A) plus tard sans réécrire le reste |

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

Homebrew n'est utilisé **que pour développer** : l'application packagée embarque Baresip, libre et
OpenSSL, sans rien demander à l'utilisateur final.

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

**Signature / notarisation** : le build local est signé *ad hoc* (`signingIdentity: "-"`). Pour distribuer,
renseignez votre identité Developer ID et les variables `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`
(voir la doc Tauri) ; **l'ensemble des Mach-O du bundle (sidecar, dylibs, modules) doit être signé avec la même
identité**. Au premier lancement d'une app non notarisée, Gatekeeper demande une confirmation
(clic droit › Ouvrir).

**Build universel** : `prepare-baresip.sh` prépare l'architecture de la machine hôte. Pour un binaire universel, produisez
un Baresip/libre/OpenSSL `x86_64` (ex. via un Homebrew Rosetta) et fusionnez avec `lipo`, ou publiez deux builds
séparés (un `.dmg` par architecture) — non réalisé ici.

## Utiliser ZePhone avec votre PBX

1. Ouvrez ZePhone → **Paramètres › Comptes SIP › Ajouter**.
2. Renseignez : *Serveur SIP* (`sip.example.com`), *Port* (`5060` / `5061`), *Transport*, *Domaine* (si différent),
   *Identifiant*, *Identifiant d'authentification* (si différent), *Mot de passe* (saisi dans l'application,
   stocké dans le Trousseau, jamais en clair).
3. **Ajouter et connecter** : le statut passe à *Enregistré* (ou affiche le code SIP de l'erreur).
4. Composez un numéro dans **Clavier** et appelez ; autorisez le micro à la première demande.

Limitation de la syntaxe de compte Baresip : un mot de passe ne peut pas contenir le caractère `"` (refusé avec un
message clair).

## Tests

```bash
# Rust : unitaires (états, parsing, validation, base, manager scripté) — ne nécessitent rien
cd src-tauri && cargo test --lib

# Rust : bout en bout contre le VRAI Baresip (nécessite `npm run sidecar` ; modules de test ausine/aufile du Baresip local)
cargo test --test engine_integration --test manager_e2e -- --test-threads=1

# Frontend
npm run typecheck && npm run lint && npm test && npm run build
```

Ce que couvrent les tests d'intégration (aucun mock du moteur) :

- démarrage du sidecar, version/codecs, port de contrôle **sur loopback uniquement**, aucun fichier `accounts` ;
- arrêt sans processus orphelin ; redémarrage automatique après `SIGKILL` du moteur ;
- enregistrement via un registrar de test avec **challenge Digest 401** (puis 200), mot de passe erroné → **401**,
  403, 503, connexion TCP refusée ; aucun mot de passe dans les journaux ;
- **appel réel entre deux instances Baresip** avec RTP : un sinus 440 Hz et un sinus 880 Hz sont émis, reçus et écrits
  en WAV des deux côtés (audio bidirectionnel mesuré), DTMF, attente/reprise, muet, raccrochage, refus 603 ;
- `SipManager` complet (moteur réel + SQLite) : statuts, appel sortant/entrant, manqué, refusé, historique, nom de contact,
  notifications ;
- les noms de périphériques audio listés par l'UI sont acceptés par Baresip (CoreAudio).

Vérifié à la main sur l'application packagée : démarrage, lancement du sidecar, connexion `127.0.0.1`, fichiers en
`0600/0700`, quitter via ⌘Q / `SIGTERM` / `SIGKILL` **sans processus orphelin**.

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
5. **Windows** : le chien de garde anti-orphelin n'est pas implémenté (utiliser un *Job Object* `KILL_ON_JOB_CLOSE`) ; le nettoyage
   normal (fermeture, Ctrl-C) fonctionne.
6. `tauri build` produit alors `.msi`/`.exe` (Windows) et `.deb`/`.AppImage` (Linux).

**Cette partie n'a pas été exécutée ici** (machine macOS uniquement).

## Limites connues

- **Non vérifié sans matériel/serveur réel** : la capture/lecture sur le micro et les haut-parleurs réels pendant un appel
  (les tests utilisent des sources/puits audio synthétiques ; la sélection des périphériques CoreAudio et la permission micro
  sont, elles, vérifiées) ; l'affichage de l'invite micro et l'attribution TCC au sous-processus Baresip sur un **premier lancement
  propre**, la notification native macOS, la sonnerie sur le haut-parleur, un opérateur VoIP réel, TLS avec un vrai certificat.
- **Codecs** : la build Homebrew de Baresip ne fournit que G.711 (PCMA/PCMU). G.722 et Opus sont chargés automatiquement
  s'ils sont présents dans `engine/modules` ; voir `scripts/prepare-baresip.sh` (`BARESIP_PREFIX` vers une build personnalisée).
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
- G.711 est intégré à Baresip (domaine public / BSD) ; **Opus** (BSD-3-Clause) et **G.722** sont facultatifs.

Les textes de licence se trouvent dans `Contents/Resources/engine/licenses/` du bundle. Voir aussi
[`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). Les dépendances Rust/JS (Tauri, React, shadcn/ui, Radix, Tailwind, rusqlite,
keyring, cpal…) sont sous licences MIT / Apache-2.0.
