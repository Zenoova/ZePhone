# Annuaire d'entreprise

ZePhone réunit en un seul endroit — l'onglet **Annuaire** — trois sources de contacts :

| Source                                | Ce que c'est                                                  | Modifiable ici ? |
| ------------------------------------- | ------------------------------------------------------------- | ---------------- |
| **Contacts locaux**                   | Le carnet d'adresses de ZePhone (toujours là)                  | oui              |
| **Annuaire LDAP / Active Directory**  | Les personnes d'un serveur LDAP de l'entreprise               | non (lecture seule) |
| **Microsoft 365 · organisation**      | Les personnes de l'annuaire Microsoft Entra ID de l'entreprise | non              |
| **Outlook · contacts personnels**     | Les contacts Outlook **de l'utilisateur** (pas ceux de l'entreprise) | non         |
| **Contacts du Mac**                   | L'application Contacts de l'ordinateur (macOS)                | non (lecture seule) |

Les deux sources Microsoft sont **deux choses différentes** (un annuaire partagé par toute l'entreprise, et un carnet
privé) : elles se connectent séparément et ne se confondent jamais.

Ce qui reste à vous : vos **favoris** et vos **groupes** personnels. Ils sont stockés à part des données synchronisées,
repérés par l'identifiant stable de chaque contact, et survivent donc aux mises à jour et aux pannes.

## Trouver, appeler, transférer

- La recherche ignore la casse et les accents (« elodie » trouve « Élodie ») et cherche dans le nom, le prénom, l'entreprise,
  le service, la fonction, l'e-mail, les adresses SIP et les numéros. Un numéro se retrouve malgré les espaces, points et tirets
  (`06 12-34-56-78` = `0612345678`), sous sa forme nationale ou internationale (`01 23…` = `+33 1 23…`), et un poste interne se
  cherche par `4567` ou `poste 4567`.
- Un contact qui a **plusieurs numéros** ne s'appelle jamais « au hasard » : le bouton d'appel demande lequel (professionnel,
  mobile, poste interne…). Chaque numéro est affiché **tel que la source l'a écrit**.
- Un appel passe par la numérotation de ZePhone (`dial`), un transfert par son transfert (`transfer_call`). Les numéros sont
  nettoyés pour la numérotation (`+33 (0)1 23-45.67.89` → `+33123456789`) ; une **adresse SIP** et un **poste interne** restent
  tels quels.
- **Transférer** est proposé quand un appel est en cours (pas un appel en attente). Dans la fenêtre d'appel, « Transférer »
  ouvre aussi une recherche dans l'annuaire.
- Clavier : `/` va à la recherche · `↓` descend dans les résultats · `↑ ↓ Début Fin Page↑ Page↓` se déplacent ·
  `Entrée` ouvre la fiche · `Ctrl/⌘ + Entrée` appelle (si un seul numéro) · `F` met en favori · `Échap` revient à la recherche.
- La liste est virtualisée : quelques milliers de contacts restent fluides (20 000 contacts : ~10 ms par recherche, mesuré).

## Nommer les appels

Un appel — entrant ou sortant — dont le numéro n'est pas dans **vos contacts locaux** est nommé par l'annuaire d'entreprise, sur
l'écran de sonnerie, dans la notification et pendant l'appel. L'ordre est : **vos contacts locaux**, puis **l'annuaire**, puis le nom
que l'appelant envoie de lui-même.

- **Seulement si c'est sûr.** Le nom n'est affiché que si le numéro n'appartient qu'à **une seule personne** : deux personnes
  qui partagent un numéro, ou un même poste dans deux sources, ne donnent **aucun nom** (on garde le numéro, ou le nom que
  l'appelant envoie). Deux fiches de sources différentes qui ont la même adresse e-mail comptent pour une seule personne.
- **Comment le numéro est reconnu.** Par ses chiffres, quelle que soit son écriture : `0123456789`, `+33 1 23 45 67 89`,
  `0033123456789` et `+33 (0)1 23 45 67 89` désignent la même ligne. Un poste interne doit être **identique** (`456` n'est pas
  `4567`). Une adresse SIP se reconnaît par son utilisateur **et** son serveur : `sip:chloe@pbx.entreprise.fr` n'est pas
  `sip:chloe@autre.fr`. Moins de 3 chiffres : jamais de nom.
- **Pas dans l'historique.** Le nom tiré de l'annuaire est affiché pendant l'appel mais **n'est pas copié dans l'historique** :
  l'historique survit à la déconnexion d'une source, dont la mémoire est effacée. L'historique garde ce qu'il gardait déjà (votre
  contact local, ou le nom envoyé par l'appelant).
- Une source déconnectée, désactivée, ou dont la mémoire a expiré ne nomme plus personne.

**Présence** : ZePhone n'a pas de fonction de présence (BLF, SIMPLE) ; l'annuaire n'affiche donc **aucune disponibilité**.
Figurer dans l'annuaire ne dit rien de la joignabilité d'une personne.

## Connecter un annuaire LDAP

Réglages → Annuaire → Ajouter une source → *Annuaire LDAP ou Active Directory*.

| Champ                  | Exemple                                          | Remarque |
| ---------------------- | ------------------------------------------------ | -------- |
| Adresse                | `ldaps://ldap.entreprise.fr:636`                 | `ldaps://` recommandé, ou `ldap://` + StartTLS |
| Compte (Bind DN)       | `cn=lecteur,dc=entreprise,dc=fr`                 | vide = lecture anonyme |
| Mot de passe           | —                                                | stocké dans le **trousseau** du système, jamais dans un fichier |
| Base de recherche      | `ou=people,dc=entreprise,dc=fr`                  |          |
| Filtre                 | `(objectClass=inetOrgPerson)`                    | pour Active Directory : `(&(objectCategory=person)(objectClass=user)(!(userAccountControl:1.2.840.113556.1.4.803:=2)))` |
| Correspondance         | prérenseignée (OpenLDAP ou Active Directory)    | un ou plusieurs attributs par champ ; les numéros ont un type |

- **Pourquoi aucun service intermédiaire** : ZePhone est une application native ; son moteur Rust ouvre lui-même la connexion LDAP
  (une page web ne le pourrait pas). Rien ne passe par un serveur tiers.
- **Tester la connexion** se connecte, s'authentifie et montre les **dix premiers contacts** tels que la configuration les
  produirait, avec les avertissements utiles (aucune entrée, aucun numéro, pas d'identifiant). **« Enregistrer et activer » n'est
  possible qu'après un test réussi des réglages tels qu'ils sont** : un changement demande un nouveau test.
- **Sécurité** : le certificat du serveur est **toujours vérifié** (magasin du système, plus l'autorité de certification de
  *Paramètres → Réseau* si votre entreprise a la sienne) ; il n'existe aucune option pour le désactiver. Un mot de passe n'est
  jamais envoyé en clair : `ldap://` sans StartTLS est refusé dès qu'un compte est indiqué. Les noms d'attributs et le filtre sont
  validés avant tout envoi.
- **Droits** : l'annuaire montre ce que le **compte de connexion** a le droit de lire, rien de plus. Un serveur qui répond « base
  introuvable » à un compte sans droits est expliqué comme tel.
- **Identifiant stable** : `entryUUID` (OpenLDAP) ou `objectGUID` (Active Directory) ; le DN, qui change quand on renomme une
  entrée, n'est utilisé qu'en dernier recours.
- **Pas de groupes techniques** : seules les personnes sont lues. Les « services » proposés comme filtre sont les valeurs du
  champ *service* des fiches ; les groupes de sécurité du serveur ne deviennent jamais des catégories.
- LDAP n'a pas de mécanisme standard pour signaler les suppressions : chaque synchronisation relit **tout** l'annuaire par pages
  (500 par défaut), ce qui permet de détecter les personnes parties.

## Connecter Microsoft 365

Réglages → Annuaire → Ajouter une source → *Microsoft 365 : annuaire de l'organisation* ou *Outlook : mes contacts personnels*.

ZePhone utilise le flux officiel **OAuth 2.0 « code d'autorisation + PKCE »** (RFC 7636) avec Microsoft Graph : la connexion se
fait **dans votre navigateur, sur la page de Microsoft** ; ZePhone ne voit jamais votre mot de passe, ne détient **aucun secret
d'application** (client public) et ne garde que le jeton de rafraîchissement, dans le trousseau.

### Ce qu'il faut préparer (une fois, par l'administrateur ou l'utilisateur)

ZePhone ne fournit pas d'identifiant d'application : **c'est à votre organisation d'en inscrire un** (Centre d'administration
Microsoft Entra → Inscriptions d'applications → Nouvelle inscription).

1. Types de comptes : *organisation uniquement* (annuaire) ; *organisation et comptes personnels* (contacts Outlook).
2. URI de redirection : plateforme **Application mobile et de bureau**, valeur `http://localhost`.
3. Authentification → **Autoriser les flux clients publics : Oui**.
4. Autorisations d'API → Microsoft Graph → **Déléguées**, puis, si nécessaire, **Accorder le consentement de l'administrateur** :

| Source                         | Autorisations (lecture seule)                       | Consentement administrateur |
| ------------------------------ | --------------------------------------------------- | --------------------------- |
| Organisation — niveau complet  | `User.Read.All` + `offline_access`                  | **oui** (en général)        |
| Organisation — niveau basique  | `User.ReadBasic.All` + `offline_access`             | non (nom et e-mail seulement, **sans numéros**) |
| Contacts Outlook personnels    | `Contacts.Read` + `offline_access`                  | non                         |

5. Copiez l'**identifiant d'application (client)** dans ZePhone ; le tenant est `organizations`, `common`, un identifiant de tenant
   ou un domaine.

### Restrictions possibles, et ce que ZePhone vous dit

| Situation                                              | Message / action |
| ------------------------------------------------------ | ---------------- |
| L'administrateur n'a pas consenti                      | « L'administrateur doit autoriser l'application… » avec la liste des autorisations à lui transmettre, puis **Reconnecter** |
| Règle d'accès conditionnel                             | « Une règle d'accès conditionnel bloque cette connexion » |
| Compte sans boîte aux lettres (contacts personnels)    | « Ce compte n'a pas de boîte aux lettres Outlook » |
| Jeton révoqué / expiré / mot de passe changé           | **Reconnecter** — jamais réessayé automatiquement |
| Limitation de débit (429)                              | attente de la durée demandée par Microsoft (plafonnée à 1 h) |

L'annuaire de l'organisation se synchronise **par différences** (`/users/delta`) au niveau complet ; si le lien de
synchronisation expire, ZePhone relit tout. Les contacts personnels sont relus en entier (identifiants Outlook stables).

## Contacts du Mac

Réglages → Annuaire → Ajouter une source → **Contacts du Mac (lecture seule)**. Les contacts de l'application Contacts s'ajoutent à
l'annuaire : recherche, fiche, appel, transfert, groupes, favoris, et nom affiché sur les appels, comme pour les autres sources.

- **Une autorisation, la vôtre.** macOS pose sa propre question la première fois (« ZePhone souhaite accéder à vos
  contacts »). Si vous refusez, **rien n'est créé** et ZePhone vous dit où changer d'avis (*Réglages Système → Confidentialité et
  sécurité → Contacts*, avec un bouton qui y mène). Si vous retirez l'autorisation plus tard, la source passe en erreur avec un
  bouton **Autoriser l'accès** ; elle n'est jamais retentée toute seule.
- **Lecture seule, locale.** ZePhone ne modifie, n'ajoute et ne supprime **aucun** contact. Rien ne passe par le réseau, aucun mot de
  passe n'est en jeu. Ne sont lus que : nom, surnom, société, service, fonction, e-mail, numéros et adresses SIP. **Pas** les
  photos, notes, anniversaires ni adresses postales.
- **Une fiche par personne** : si la même personne est dans plusieurs comptes (iCloud, Google…), macOS la présente déjà
  unifiée. Les numéros de fax et de récepteur d'appel sont écartés ; les libellés (`mobile`, `iPhone`, `travail`, `domicile`,
  « Portable », « Bureau », « Poste »…) donnent le type du numéro, et un libellé libre est gardé tel que vous l'avez écrit.
- **Priorité** : vos contacts (ZePhone puis ceux du Mac) passent avant l'annuaire de l'entreprise pour nommer une fiche ou un
  appel. Deux fiches ne sont réunies que si elles ont la même adresse e-mail.
- **Relecture** : tout le carnet est relu toutes les 15 minutes (c'est local, donc rapide), ou à la demande (« Synchroniser »). La
  mémoire de ZePhone est effacée à la déconnexion de la source, comme pour les autres.
- **Technique** : framework Contacts d'Apple (`CNContactStore`) ; l'application déclare l'usage dans `Info.plist`
  (`NSContactsUsageDescription`) et le droit d'accès au carnet d'adresses dans ses entitlements. Le même code Rust servira
  d'autres plateformes : seule la lecture native est propre à chacune (iOS, Android : à écrire).

## Synchronisation, mémoire locale, pannes

- **Première synchronisation** à la connexion ; **rafraîchissement manuel** (« Synchroniser ») ; **fréquence automatique**
  réglable par source (15 min, 1 h, 6 h, 24 h, ou manuelle). Les lectures se font en tâche de fond : l'interface ne se bloque jamais.
- Chaque contact garde son **identifiant stable** (`<source>/<identifiant de la source>`) et sa **provenance**. Deux personnes ne
  sont **jamais** rapprochées sur leur seul nom ; deux fiches de sources différentes ne sont réunies que si elles ont la **même
  adresse e-mail**, et la fiche montre alors les deux provenances.
- **Une panne n'efface jamais l'annuaire.** Les contacts ne sont remplacés qu'après une lecture **complète et réussie**, en une
  seule transaction. Une erreur (réseau, serveur, authentification, limitation) est notée sur la source, qui affiche son erreur et
  la date de sa dernière réussite. Une source qui répond soudain « personne » alors qu'elle avait des contacts est refusée.
- Un contact supprimé de la source disparaît **après une synchronisation réussie**, avec les favoris et appartenances de groupe qui
  ne désignaient plus personne.
- **Reprises** : espacées (1, 2, 4… minutes, jamais plus d'une heure), jamais en boucle ; une erreur qui demande une action de
  l'utilisateur (identifiants, autorisation, configuration) n'est **pas** retentée seule.
- **Mémoire locale** (SQLite, dans le dossier de données de l'application) : effacée à la **déconnexion**, à la demande
  (« Effacer la mémoire »), et **après 30 jours sans synchronisation réussie**. Les favoris et groupes sont conservés, et
  retrouvent leurs contacts si la source est reconnectée.
- Les journaux ne contiennent ni nom, ni numéro, ni identifiant : seulement des compteurs et des types d'erreur.

## Vérification

| Parcours                                                        | Comment c'est vérifié |
| --------------------------------------------------------------- | --------------------- |
| « elodie » trouve « Élodie » ; numéros avec espaces/tirets      | tests Rust (`directory::index`), tests d'interface, **serveur OpenLDAP réel** |
| Plusieurs numéros, appel sur le bon                             | tests d'interface (`DirectoryPage`, `ContactSheet`) ; la numérotation passe par `dial` |
| Postes internes et adresses SIP utilisables                     | test Rust contre `sip::uri::normalize_target` |
| Mise à jour conserve favoris et groupes                         | tests Rust (`store`, `service`) et **OpenLDAP réel** |
| Même nom ≠ même personne                                        | tests Rust (`index`) et **OpenLDAP réel** (deux « Jean Martin ») |
| Une panne ne vide pas l'annuaire                                | tests Rust, **OpenLDAP réel arrêté puis relancé**, faux service Microsoft |
| Supprimer un groupe garde les contacts                          | tests Rust (`store`, `service`) |
| Erreur d'authentification → action claire                       | tests Rust + d'interface (« Reconnecter ») |
| Appel et transfert par les vraies fonctions SIP                 | tests d'interface (`dial`, `transfer_call`) + normalisation SIP réelle |
| Contacts du Mac : permission, refus, retrait, libellés, lecture seule | tests Rust (`system_contacts`, `service`) avec un carnet factice ; **état d'autorisation et garde « pas de question hors application »** testés sur macOS sans lire aucun contact ; interface testée |
| Appels nommés par l'annuaire, seulement si c'est sûr            | tests Rust (`index`, `service`, gestionnaire) et **vrais appels entre deux moteurs Baresip** (`manager_e2e`) : nom de l'annuaire, deux personnes possibles = aucun nom, contact local prioritaire, historique sans le nom |

Lancer les tests : `cd src-tauri && cargo test --lib directory`, `cargo test --test directory_ldap -- --test-threads=1`
(lance un vrai `slapd` — `brew install openldap openssl@3` — sur loopback, en TLS avec un certificat jetable),
`cargo test --test directory_microsoft`, et `npm test`.

**Ce qui n'est pas vérifié sans connexion réelle** : la lecture de **vrais** contacts du Mac (elle exige votre autorisation dans l'application installée ; un test à lancer à la main, `cargo test --lib reads_the_real_address_book -- --ignored --nocapture`, n'affiche que des nombres) ; le connecteur Microsoft est testé contre un **service de substitution**
(vrai code HTTP, vrai PKCE vérifié côté serveur, pagination, delta, 429, expiration du jeton…), pas contre un vrai locataire
Microsoft 365 ; la connexion à un vrai Active Directory n'a pas non plus été essayée (OpenLDAP l'a été).
