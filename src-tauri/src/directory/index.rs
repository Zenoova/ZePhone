//! The searchable view of the directory, kept in memory: every contact with its text folded and its numbers
//! reduced to digits once, so that a search over several thousand contacts is a single pass that takes
//! milliseconds. It is rebuilt from the cache after each synchronisation, and never written anywhere.

use std::collections::{HashMap, HashSet};

use super::{
    model::{
        Contact, DepartmentCount, DirectoryEntry, DirectoryPage, DirectoryQuery, PhoneEntry,
        PhoneKind, SourceKind, SourceRef,
    },
    normalize::{
        digits_match, extension_digits, extension_query, fold, is_sip_address, link_key,
        phone_digits, phone_query, same_number,
    },
};

/// What the index needs to know about a source, besides its contacts.
#[derive(Debug, Clone)]
pub struct SourceMeta {
    pub name: String,
    pub kind: SourceKind,
}

/// The personal data a search consults: favourites and groups. Kept outside the index because they change
/// without any contact changing.
pub struct SearchContext<'a> {
    pub favorites: &'a HashSet<String>,
    /// For every contact id, the groups it is in.
    pub memberships: &'a HashMap<String, Vec<String>>,
    /// When searching inside one group: the ids of its members.
    pub group_members: Option<&'a HashSet<String>>,
}

struct Entry {
    contact: Contact,
    kind: SourceKind,
    source_name: String,
    name: String,
    name_fold: String,
    /// Name, company, department, title and e-mail, folded.
    hay: String,
    dept_fold: String,
    /// Digits of every number, and of every extension.
    digit_keys: Vec<String>,
    /// The extensions alone: written after a number, or numbers of the internal-extension kind.
    ext_keys: Vec<String>,
    link: Option<String>,
}

pub struct Index {
    entries: Vec<Entry>,
}

const DEFAULT_LIMIT: usize = 50;
const MAX_LIMIT: usize = 500;

enum TextQuery {
    All,
    /// "poste 4567": an extension, exactly.
    Extension(String),
    Phone(String),
    Tokens(Vec<String>),
}

impl TextQuery {
    fn parse(text: &str) -> Self {
        if text.trim().is_empty() {
            return Self::All;
        }
        if let Some(d) = extension_query(text) {
            return Self::Extension(d);
        }
        if let Some(d) = phone_query(text) {
            return Self::Phone(d);
        }
        let tokens: Vec<String> = fold(text).split(' ').map(str::to_owned).collect();
        if tokens.iter().all(String::is_empty) {
            Self::All
        } else {
            Self::Tokens(tokens.into_iter().filter(|t| !t.is_empty()).collect())
        }
    }
}

impl Entry {
    fn new(contact: Contact, metas: &HashMap<String, SourceMeta>) -> Self {
        let r = &contact.remote;
        let name = r.name();
        let name_fold = fold(&name);
        // SIP addresses are searched as text too ("chloe pbx"); telephone numbers are searched as digits.
        let sip: String = r
            .phones
            .iter()
            .filter(|p| is_sip_address(&p.number))
            .map(|p| p.number.as_str())
            .collect::<Vec<_>>()
            .join(" ");
        let hay = fold(&format!(
            "{} {} {} {} {} {} {} {}",
            name,
            r.first_name,
            r.last_name,
            r.company.as_deref().unwrap_or(""),
            r.department.as_deref().unwrap_or(""),
            r.title.as_deref().unwrap_or(""),
            r.email.as_deref().unwrap_or(""),
            sip,
        ));
        let mut digit_keys = Vec::new();
        let mut ext_keys = Vec::new();
        for p in &r.phones {
            let d = phone_digits(&p.number);
            if !d.is_empty() {
                if p.kind == PhoneKind::Extension {
                    ext_keys.push(d.clone());
                }
                digit_keys.push(d);
            }
            if let Some(ext) = extension_digits(&p.number) {
                ext_keys.push(ext.clone());
                digit_keys.push(ext);
            }
        }
        let meta = metas.get(&contact.source_id);
        Self {
            kind: meta.map_or(SourceKind::Ldap, |m| m.kind),
            source_name: meta.map(|m| m.name.clone()).unwrap_or_default(),
            link: link_key(r.email.as_deref()),
            dept_fold: fold(r.department.as_deref().unwrap_or("")),
            name,
            name_fold,
            hay,
            digit_keys,
            ext_keys,
            contact,
        }
    }

    /// How well the entry answers the text: lower is better, `None` is no match.
    fn score(&self, q: &TextQuery) -> Option<u32> {
        match q {
            TextQuery::All => Some(0),
            TextQuery::Extension(d) => self.ext_keys.iter().any(|k| k == d).then_some(0),
            TextQuery::Phone(d) => self
                .digit_keys
                .iter()
                .any(|k| digits_match(d, k))
                .then_some(0),
            TextQuery::Tokens(tokens) => {
                let mut total = 0;
                for t in tokens {
                    let in_digits = t.len() >= 2
                        && t.chars().all(|c| c.is_ascii_digit())
                        && self.digit_keys.iter().any(|k| k.contains(t.as_str()));
                    total += if self.name_fold.split(' ').any(|w| w.starts_with(t.as_str())) {
                        0
                    } else if self.name_fold.contains(t.as_str()) {
                        1
                    } else if self.hay.contains(t.as_str()) || in_digits {
                        2
                    } else {
                        return None;
                    };
                }
                Some(total)
            }
        }
    }
}

impl Index {
    pub fn build(contacts: Vec<Contact>, sources: &HashMap<String, SourceMeta>) -> Self {
        Self {
            entries: contacts
                .into_iter()
                .map(|c| Entry::new(c, sources))
                .collect(),
        }
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    /// The departments the sources provide, with how many contacts each has. These are what the directory
    /// offers as company groupings: the departments only, never the technical or security groups of a server.
    pub fn departments(&self) -> Vec<DepartmentCount> {
        let mut counts: HashMap<String, (String, usize)> = HashMap::new();
        for e in &self.entries {
            if let Some(d) = e.contact.remote.department.as_deref().map(str::trim)
                && !d.is_empty()
            {
                counts.entry(fold(d)).or_insert_with(|| (d.to_owned(), 0)).1 += 1;
            }
        }
        let mut out: Vec<DepartmentCount> = counts
            .into_values()
            .map(|(name, count)| DepartmentCount { name, count })
            .collect();
        out.sort_by_key(|d| fold(&d.name));
        out
    }

    pub fn search(&self, q: &DirectoryQuery, ctx: &SearchContext<'_>) -> DirectoryPage {
        let text = TextQuery::parse(&q.text);
        let dept = q.department.as_deref().map(fold).filter(|d| !d.is_empty());
        let sources: HashSet<&str> = q.source_ids.iter().map(String::as_str).collect();

        let mut hits: Vec<(u32, &Entry)> = self
            .entries
            .iter()
            .filter(|e| sources.is_empty() || sources.contains(e.contact.source_id.as_str()))
            .filter(|e| dept.as_deref().is_none_or(|d| e.dept_fold == d))
            .filter(|e| !q.favorites_only || ctx.favorites.contains(&e.contact.id))
            .filter(|e| ctx.group_members.is_none_or(|m| m.contains(&e.contact.id)))
            .filter_map(|e| e.score(&text).map(|s| (s, e)))
            .collect();
        hits.sort_by(|a, b| {
            (a.0, &a.1.name_fold, &a.1.contact.id).cmp(&(b.0, &b.1.name_fold, &b.1.contact.id))
        });

        // Records that share a proper e-mail address are one person, shown once with every provenance.
        // Records that merely share a name are never merged.
        let mut groups: Vec<Vec<&Entry>> = Vec::new();
        let mut by_link: HashMap<&str, usize> = HashMap::new();
        for (_, e) in hits {
            match e.link.as_deref() {
                Some(k) => match by_link.get(k) {
                    Some(&i) => groups[i].push(e),
                    None => {
                        by_link.insert(k, groups.len());
                        groups.push(vec![e]);
                    }
                },
                None => groups.push(vec![e]),
            }
        }

        let total = groups.len();
        let limit = if q.limit == 0 {
            DEFAULT_LIMIT
        } else {
            q.limit.min(MAX_LIMIT)
        };
        let items = groups
            .into_iter()
            .skip(q.offset)
            .take(limit)
            .map(|g| entry_of(g, ctx))
            .collect();
        DirectoryPage {
            items,
            total,
            offset: q.offset,
        }
    }
}

/// One person from one or several records.
fn entry_of(mut records: Vec<&Entry>, ctx: &SearchContext<'_>) -> DirectoryEntry {
    records.sort_by(|a, b| {
        (a.kind.priority(), &a.contact.id).cmp(&(b.kind.priority(), &b.contact.id))
    });
    let primary = records[0];
    let r = &primary.contact.remote;

    let pick = |get: fn(&Entry) -> Option<&str>| -> Option<String> {
        records
            .iter()
            .find_map(|e| get(e).map(str::trim).filter(|s| !s.is_empty()))
            .map(str::to_owned)
    };

    // The same line written two ways (national and international) is listed once.
    let mut phones: Vec<PhoneEntry> = Vec::new();
    let mut seen: Vec<(String, Option<String>)> = Vec::new();
    for e in &records {
        for p in &e.contact.remote.phones {
            let key = (phone_digits(&p.number), extension_digits(&p.number));
            let known = seen.iter().any(|(d, x)| {
                if key.0.is_empty() {
                    d.is_empty()
                        && phones
                            .iter()
                            .any(|q| q.number.eq_ignore_ascii_case(&p.number))
                } else {
                    same_number(d, &key.0) && *x == key.1
                }
            });
            if !known {
                seen.push(key);
                phones.push(p.clone());
            }
        }
    }

    let ids: Vec<&str> = records.iter().map(|e| e.contact.id.as_str()).collect();
    let mut groups: Vec<String> = ids
        .iter()
        .filter_map(|id| ctx.memberships.get(*id))
        .flatten()
        .cloned()
        .collect();
    groups.sort();
    groups.dedup();

    DirectoryEntry {
        id: primary.contact.id.clone(),
        display_name: primary.name.clone(),
        first_name: r.first_name.clone(),
        last_name: r.last_name.clone(),
        company: pick(|e| e.contact.remote.company.as_deref()),
        department: pick(|e| e.contact.remote.department.as_deref()),
        title: pick(|e| e.contact.remote.title.as_deref()),
        email: pick(|e| e.contact.remote.email.as_deref()),
        phones,
        sources: records
            .iter()
            .map(|e| SourceRef {
                record_id: e.contact.id.clone(),
                source_id: e.contact.source_id.clone(),
                source_name: e.source_name.clone(),
                kind: e.kind,
                external_id: e.contact.remote.external_id.clone(),
            })
            .collect(),
        favorite: ids.iter().any(|id| ctx.favorites.contains(*id)),
        groups,
        read_only: primary.kind.read_only(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::directory::model::{PhoneKind, RemoteContact, contact_id};

    fn rc(id: &str, name: &str) -> RemoteContact {
        RemoteContact {
            external_id: id.into(),
            display_name: name.into(),
            ..Default::default()
        }
    }

    fn with_phone(mut c: RemoteContact, kind: PhoneKind, n: &str) -> RemoteContact {
        c.phones.push(PhoneEntry::new(kind, n));
        c
    }

    struct Fixture {
        index: Index,
        favorites: HashSet<String>,
        memberships: HashMap<String, Vec<String>>,
    }

    impl Fixture {
        fn new(sources: &[(&str, SourceKind)], contacts: Vec<(&str, RemoteContact)>) -> Self {
            let metas = sources
                .iter()
                .map(|(id, kind)| {
                    (
                        (*id).to_owned(),
                        SourceMeta {
                            name: format!("Source {id}"),
                            kind: *kind,
                        },
                    )
                })
                .collect();
            let list = contacts
                .into_iter()
                .map(|(src, remote)| Contact {
                    id: contact_id(src, &remote.external_id),
                    source_id: src.into(),
                    remote,
                })
                .collect();
            Self {
                index: Index::build(list, &metas),
                favorites: HashSet::new(),
                memberships: HashMap::new(),
            }
        }

        fn search(&self, text: &str) -> DirectoryPage {
            self.query(DirectoryQuery {
                text: text.into(),
                ..Default::default()
            })
        }

        fn query(&self, q: DirectoryQuery) -> DirectoryPage {
            self.index.search(
                &q,
                &SearchContext {
                    favorites: &self.favorites,
                    memberships: &self.memberships,
                    group_members: None,
                },
            )
        }
    }

    fn names(p: &DirectoryPage) -> Vec<&str> {
        p.items.iter().map(|e| e.display_name.as_str()).collect()
    }

    fn company_directory() -> Fixture {
        let mut elodie = with_phone(
            rc("1", "Élodie Dupont"),
            PhoneKind::Work,
            "+33 1 23 45 67 89",
        );
        elodie.company = Some("Société Générale".into());
        elodie.department = Some("Comptabilité".into());
        elodie.title = Some("Directrice financière".into());
        elodie.email = Some("elodie.dupont@example.com".into());
        elodie
            .phones
            .push(PhoneEntry::new(PhoneKind::Mobile, "06 12-34-56-78"));
        elodie
            .phones
            .push(PhoneEntry::new(PhoneKind::Extension, "4567"));
        let mut bob = with_phone(
            rc("2", "Bob Martin"),
            PhoneKind::Work,
            "01.98.76.54.32 poste 12",
        );
        bob.department = Some("Comptabilité".into());
        let mut sip = with_phone(
            rc("3", "Chloé Bernard"),
            PhoneKind::Sip,
            "sip:chloe@pbx.example.com",
        );
        sip.department = Some("Support".into());
        Fixture::new(
            &[("ldap", SourceKind::Ldap)],
            vec![("ldap", elodie), ("ldap", bob), ("ldap", sip)],
        )
    }

    #[test]
    fn elodie_is_found_by_typing_elodie() {
        let f = company_directory();
        for q in [
            "elodie",
            "ELODIE",
            "Élodie",
            "élodie dupont",
            "dupont elodie",
            "lodie",
        ] {
            assert_eq!(names(&f.search(q)), vec!["Élodie Dupont"], "{q}");
        }
    }

    #[test]
    fn every_field_is_searched_whatever_the_accents() {
        let f = company_directory();
        for q in [
            "societe generale",
            "comptabilite",
            "directrice financiere",
            "example.com",
        ] {
            assert!(names(&f.search(q)).contains(&"Élodie Dupont"), "{q}");
        }
        assert_eq!(names(&f.search("chloe")), vec!["Chloé Bernard"]);
    }

    #[test]
    fn a_number_is_found_whatever_its_spaces_dots_and_dashes() {
        let f = company_directory();
        for q in [
            "0612345678",
            "06 12 34 56 78",
            "06-12-34-56-78",
            "06.12.34.56.78",
            "12 34 56",
        ] {
            assert_eq!(names(&f.search(q)), vec!["Élodie Dupont"], "{q}");
        }
        // the international number is found from its national form, and the other way round
        assert_eq!(names(&f.search("01 23 45 67 89")), vec!["Élodie Dupont"]);
        assert_eq!(names(&f.search("+33 1 98 76 54 32")), vec!["Bob Martin"]);
    }

    #[test]
    fn internal_extensions_and_sip_addresses_stay_searchable() {
        let f = company_directory();
        assert_eq!(names(&f.search("4567")), vec!["Élodie Dupont"]);
        assert_eq!(names(&f.search("poste 12")), vec!["Bob Martin"]);
        assert_eq!(names(&f.search("chloe pbx")), vec!["Chloé Bernard"]);
        // a SIP address is kept exactly as the source gave it
        let c = &f.search("chloe").items[0];
        assert_eq!(c.phones[0].number, "sip:chloe@pbx.example.com");
        assert_eq!(c.phones[0].kind, PhoneKind::Sip);
    }

    #[test]
    fn original_numbers_are_preserved_as_written() {
        let f = company_directory();
        let e = &f.search("elodie").items[0];
        let numbers: Vec<&str> = e.phones.iter().map(|p| p.number.as_str()).collect();
        assert_eq!(numbers, ["+33 1 23 45 67 89", "06 12-34-56-78", "4567"]);
    }

    #[test]
    fn a_name_match_ranks_above_a_match_in_another_field() {
        let mut a = with_phone(rc("1", "Martin Durand"), PhoneKind::Work, "1");
        a.company = Some("X".into());
        let mut b = with_phone(rc("2", "Zoé Petit"), PhoneKind::Work, "2");
        b.company = Some("Martin & Fils".into());
        let f = Fixture::new(&[("s", SourceKind::Ldap)], vec![("s", b), ("s", a)]);
        assert_eq!(
            names(&f.search("martin")),
            vec!["Martin Durand", "Zoé Petit"]
        );
    }

    #[test]
    fn two_people_with_the_same_name_are_never_merged() {
        let a = with_phone(rc("1", "Jean Martin"), PhoneKind::Work, "1111");
        let b = with_phone(rc("2", "Jean Martin"), PhoneKind::Work, "2222");
        let f = Fixture::new(&[("s", SourceKind::Ldap)], vec![("s", a), ("s", b)]);
        let p = f.search("jean martin");
        assert_eq!(p.total, 2);
        assert_ne!(p.items[0].id, p.items[1].id);
        // even across two sources, and even with the same phone number
        let a = with_phone(rc("1", "Jean Martin"), PhoneKind::Work, "1111");
        let b = with_phone(rc("9", "Jean Martin"), PhoneKind::Work, "1111");
        let f = Fixture::new(
            &[("ldap", SourceKind::Ldap), ("ms", SourceKind::MicrosoftOrg)],
            vec![("ldap", a), ("ms", b)],
        );
        assert_eq!(f.search("jean").total, 2);
    }

    #[test]
    fn records_sharing_an_email_address_are_one_person_with_every_provenance() {
        let mut ldap = with_phone(rc("u1", "Élodie Dupont"), PhoneKind::Work, "01 23 45 67 89");
        ldap.email = Some("Elodie.Dupont@example.com".into());
        ldap.department = Some("Comptabilité".into());
        let mut ms = with_phone(
            rc("g1", "Elodie DUPONT"),
            PhoneKind::Mobile,
            "06 12 34 56 78",
        );
        ms.email = Some("elodie.dupont@example.com".into());
        ms.phones
            .push(PhoneEntry::new(PhoneKind::Work, "+33 1 23 45 67 89")); // the same number, written otherwise
        ms.title = Some("Directrice".into());
        let f = Fixture::new(
            &[("ldap", SourceKind::Ldap), ("ms", SourceKind::MicrosoftOrg)],
            vec![("ms", ms), ("ldap", ldap)],
        );
        let p = f.search("elodie");
        assert_eq!(p.total, 1);
        let e = &p.items[0];
        assert_eq!(e.sources.len(), 2, "both provenances are kept");
        assert_eq!(
            e.sources[0].kind,
            SourceKind::Ldap,
            "the main record is the higher-priority source's"
        );
        assert_eq!(
            e.phones.len(),
            2,
            "the number written two ways is listed once: {:?}",
            e.phones
        );
        assert_eq!(
            e.title.as_deref(),
            Some("Directrice"),
            "missing fields come from the other record"
        );
        assert_eq!(e.department.as_deref(), Some("Comptabilité"));
    }

    #[test]
    fn filtering_by_source_does_not_pull_in_other_sources() {
        let mut a = with_phone(rc("1", "Élodie Dupont"), PhoneKind::Work, "1");
        a.email = Some("e@example.com".into());
        let mut b = with_phone(rc("2", "Élodie Dupont"), PhoneKind::Work, "2");
        b.email = Some("e@example.com".into());
        let f = Fixture::new(
            &[("ldap", SourceKind::Ldap), ("ms", SourceKind::MicrosoftOrg)],
            vec![("ldap", a), ("ms", b)],
        );
        let only_ms = f.query(DirectoryQuery {
            source_ids: vec!["ms".into()],
            ..Default::default()
        });
        assert_eq!(only_ms.total, 1);
        assert_eq!(only_ms.items[0].sources.len(), 1);
        assert_eq!(only_ms.items[0].sources[0].source_id, "ms");
    }

    #[test]
    fn favourites_and_groups_filter_and_flag_entries() {
        let mut f = company_directory();
        let elodie = contact_id("ldap", "1");
        f.favorites.insert(elodie.clone());
        f.memberships
            .insert(elodie.clone(), vec!["g1".into(), "g2".into()]);

        let favs = f.query(DirectoryQuery {
            favorites_only: true,
            ..Default::default()
        });
        assert_eq!(names(&favs), vec!["Élodie Dupont"]);
        assert!(favs.items[0].favorite);
        assert_eq!(favs.items[0].groups, vec!["g1", "g2"]);

        let members = HashSet::from([elodie]);
        let in_group = f.index.search(
            &DirectoryQuery::default(),
            &SearchContext {
                favorites: &f.favorites,
                memberships: &f.memberships,
                group_members: Some(&members),
            },
        );
        assert_eq!(names(&in_group), vec!["Élodie Dupont"]);
        assert!(!f.search("bob").items[0].favorite);
    }

    #[test]
    fn a_department_filter_and_the_list_of_departments() {
        let f = company_directory();
        let q = f.query(DirectoryQuery {
            department: Some("comptabilite".into()),
            ..Default::default()
        });
        assert_eq!(names(&q), vec!["Bob Martin", "Élodie Dupont"]);
        let depts: Vec<(String, usize)> = f
            .index
            .departments()
            .into_iter()
            .map(|d| (d.name, d.count))
            .collect();
        assert_eq!(
            depts,
            vec![("Comptabilité".into(), 2), ("Support".into(), 1)]
        );
    }

    #[test]
    fn results_are_paged_and_the_total_is_the_whole_match() {
        let contacts: Vec<(&str, RemoteContact)> = (0..230)
            .map(|i| {
                (
                    "s",
                    with_phone(
                        rc(&i.to_string(), &format!("Personne {i:03}")),
                        PhoneKind::Work,
                        &format!("{i}"),
                    ),
                )
            })
            .collect();
        let f = Fixture::new(&[("s", SourceKind::Ldap)], contacts);
        let first = f.query(DirectoryQuery {
            limit: 100,
            ..Default::default()
        });
        assert_eq!(
            (first.items.len(), first.total, first.offset),
            (100, 230, 0)
        );
        let last = f.query(DirectoryQuery {
            offset: 200,
            limit: 100,
            ..Default::default()
        });
        assert_eq!((last.items.len(), last.total), (30, 230));
        assert_eq!(last.items[0].display_name, "Personne 200");
        assert_eq!(
            f.query(DirectoryQuery::default()).items.len(),
            50,
            "default page"
        );
        assert_eq!(
            f.query(DirectoryQuery {
                limit: 100_000,
                ..Default::default()
            })
            .items
            .len(),
            230,
            "a page is capped, here by the whole directory"
        );
    }

    #[test]
    fn no_match_is_an_empty_page_and_a_blank_query_lists_everything() {
        let f = company_directory();
        assert_eq!(f.search("zzzz").total, 0);
        assert_eq!(f.search("   ").total, 3);
        assert_eq!(f.search("--").total, 3);
    }

    #[test]
    fn several_thousand_contacts_are_searched_in_one_quick_pass() {
        let contacts: Vec<(&str, RemoteContact)> = (0..20_000)
            .map(|i| {
                let mut c = with_phone(
                    rc(&i.to_string(), &format!("Prénom{i} Nom{}", i % 977)),
                    PhoneKind::Work,
                    &format!(
                        "+33 1 {:02} {:02} {:02} {:02}",
                        i % 100,
                        (i / 100) % 100,
                        (i / 10_000) % 100,
                        i % 97
                    ),
                );
                c.email = Some(format!("user{i}@example.com"));
                c.department = Some(format!("Service {}", i % 40));
                ("s", c)
            })
            .collect();
        let f = Fixture::new(&[("s", SourceKind::Ldap)], contacts);
        let started = std::time::Instant::now();
        for q in ["prenom1999", "nom42", "45 23 01", "service 7"] {
            let p = f.search(q);
            assert!(p.total > 0, "{q}");
        }
        let per_search = started.elapsed() / 4;
        println!("20 000 contacts: {per_search:?} per search (debug build)");
        assert!(
            per_search < std::time::Duration::from_millis(400),
            "searching is too slow: {per_search:?}"
        );
    }
}
