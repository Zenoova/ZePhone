/**
 * DEV-ONLY stand-in for the directory commands of the Rust backend, used by the browser preview (`/?mock`).
 *
 * Everything here is FICTIONAL DEMO DATA: invented people, an invented LDAP server, an invented Microsoft sign-in.
 * Every demo source carries "DEMO" in its name so it can never be taken for a real one. None of this exists in the
 * application itself, which only ever shows what a real source gave it.
 */
import type {
  DirectoryEntry,
  DirectoryPage,
  DirectoryQuery,
  GroupView,
  PhoneEntry,
  SourceKind,
  SourceRef,
  SourceView,
} from "@/types/directory";
import type { Contact } from "@/types/telephony";

type Args = Record<string, unknown> | undefined;

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const digitsOf = (s: string) => s.replace(/\D/g, "");

const FIRST = [
  "Élodie",
  "Jean",
  "Camille",
  "Hugo",
  "Léa",
  "Mathieu",
  "Inès",
  "Nicolas",
  "Sophie",
  "Antoine",
  "Chloé",
  "Julien",
  "Marion",
  "Thomas",
  "Manon",
  "Pierre",
  "Zoé",
  "Lucas",
  "Emma",
  "Raphaël",
  "Anaïs",
  "Maxime",
  "Océane",
  "Vincent",
  "Clémence",
  "Adrien",
  "Salomé",
  "Quentin",
  "Margaux",
  "Étienne",
];
const LAST = [
  "Dupont",
  "Martin",
  "Bernard",
  "Petit",
  "Durand",
  "Leroy",
  "Moreau",
  "Simon",
  "Laurent",
  "Lefèvre",
  "Michel",
  "Garcia",
  "David",
  "Bertrand",
  "Roux",
  "Vincent",
  "Fournier",
  "Morel",
  "Girard",
  "André",
  "Mercier",
  "Dupuis",
  "Lambert",
  "Fontaine",
  "Rousseau",
  "Blanc",
  "Guérin",
  "Muller",
  "Henry",
  "Perrin",
];
const DEPARTMENTS = ["Accounting", "Sales", "Support", "Human resources", "IT", "Legal", "Marketing", "Logistics"];
const TITLES = [
  "Project officer",
  "Manager",
  "Director",
  "Assistant",
  "Engineer",
  "Technician",
  "Advisor",
  "Project manager",
];

const DEMO_LDAP = "demo-ldap";
const DEMO_MS = "demo-ms";
const DEMO_OUTLOOK = "demo-outlook";
const DEMO_DEVICE = "demo-device";

function ref(sourceId: string, name: string, kind: SourceKind, external: string): SourceRef {
  return { recordId: `${sourceId}/${external}`, sourceId, sourceName: name, kind, externalId: external };
}

export function createMockDirectory(emit: (event: string, payload: unknown) => void, getLocal: () => Contact[]) {
  // `?mock=showcase` (store screenshots) uses plain names; everywhere else the demo sources say what they are.
  const showcase = new URLSearchParams(window.location.search).get("mock") === "showcase";
  const ldapName = showcase ? "Acme directory (LDAP)" : "DEMO · LDAP directory (fictional)";
  const msName = showcase ? "Microsoft 365" : "DEMO · Microsoft 365 (fictional)";
  const outlookName = showcase ? "Outlook contacts" : "DEMO · Outlook contacts (fictional)";

  const people: DirectoryEntry[] = [];
  const add = (e: DirectoryEntry) => people.push(e);

  // a few people that show what the directory handles
  add({
    id: `${DEMO_LDAP}/uid-0`,
    displayName: "Élodie Dupont",
    firstName: "Élodie",
    lastName: "Dupont",
    company: showcase ? "Acme" : "Demo Company",
    department: "Accounting",
    title: "Chief financial officer",
    email: "elodie.dupont@demo.invalid",
    phones: [
      { kind: "work", number: "+33 1 23 45 67 89" },
      { kind: "mobile", number: "06 12-34-56-78" },
      { kind: "extension", number: "4567" },
    ],
    sources: [ref(DEMO_LDAP, ldapName, "ldap", "uid-0")],
    favorite: false,
    groups: [],
    readOnly: true,
  });
  for (const [n, dept, phone] of [
    ["1", "Sales", "01.11.11.11.11"],
    ["2", "Support", "01.22.22.22.22 poste 4242"],
  ] as const) {
    add({
      id: `${DEMO_LDAP}/uid-m${n}`,
      displayName: "Jean Martin",
      firstName: "Jean",
      lastName: "Martin",
      company: showcase ? "Acme" : "Demo Company",
      department: dept,
      title: null,
      email: `jean.martin${n}@demo.invalid`,
      phones: [{ kind: "work", number: phone }],
      sources: [ref(DEMO_LDAP, ldapName, "ldap", `uid-m${n}`)],
      favorite: false,
      groups: [],
      readOnly: true,
    });
  }
  // one person found in two sources: joined on the e-mail address, with both provenances kept
  add({
    id: `${DEMO_LDAP}/uid-c`,
    displayName: "Camille Rousseau",
    firstName: "Camille",
    lastName: "Rousseau",
    company: showcase ? "Acme" : "Demo Company",
    department: "IT",
    title: "Head of systems",
    email: "camille.rousseau@demo.invalid",
    phones: [
      { kind: "work", number: "+33 1 40 00 00 01" },
      { kind: "mobile", number: "+33 6 00 00 00 01" },
      { kind: "sip", number: "sip:camille@pbx.demo.invalid" },
    ],
    sources: [ref(DEMO_LDAP, ldapName, "ldap", "uid-c"), ref(DEMO_MS, msName, "microsoftOrg", "g-c")],
    favorite: false,
    groups: [],
    readOnly: true,
  });
  // The showcase has 30 × 30 distinct names: no two people look alike in the first rows.
  for (let i = 0; i < (showcase ? 900 : 3000); i++) {
    const first = FIRST[i % FIRST.length]!;
    const last = LAST[(i * 7 + Math.floor(i / 30)) % LAST.length]!;
    const phones: PhoneEntry[] = [
      {
        kind: "work",
        number: `+33 1 40 ${String(10 + (i % 80)).padStart(2, "0")} ${String(Math.floor(i / 80) % 100).padStart(2, "0")} ${String(i % 97).padStart(2, "0")}`,
      },
    ];
    if (i % 3 === 0)
      phones.push({
        kind: "mobile",
        number: `06 ${String(i % 100).padStart(2, "0")} 12 34 ${String((i * 7) % 100).padStart(2, "0")}`,
      });
    if (i % 5 === 0) phones.push({ kind: "extension", number: String(1000 + (i % 9000)) });
    add({
      id: `${DEMO_LDAP}/uid-${i + 1}`,
      displayName: `${first} ${last}`,
      firstName: first,
      lastName: last,
      company: showcase ? "Acme" : "Demo Company",
      department: DEPARTMENTS[i % DEPARTMENTS.length]!,
      title: TITLES[i % TITLES.length]!,
      email: `${fold(first).replace(/ /g, "")}.${fold(last).replace(/ /g, "")}.${i}@demo.invalid`,
      phones,
      sources: [ref(DEMO_LDAP, ldapName, "ldap", `uid-${i + 1}`)],
      favorite: false,
      groups: [],
      readOnly: true,
    });
  }
  for (let i = 0; i < 28; i++) {
    add({
      id: `${DEMO_MS}/g-${i}`,
      displayName: `${FIRST[(i * 3) % FIRST.length]} ${LAST[(i * 11) % LAST.length]}`,
      firstName: FIRST[(i * 3) % FIRST.length]!,
      lastName: LAST[(i * 11) % LAST.length]!,
      company: "Contoso Demo",
      department: DEPARTMENTS[(i + 2) % DEPARTMENTS.length]!,
      title: TITLES[(i + 3) % TITLES.length]!,
      email: `ms.${i}@contoso-demo.invalid`,
      phones: [{ kind: "work", number: `+33 1 55 00 00 ${String(i).padStart(2, "0")}` }],
      sources: [ref(DEMO_MS, msName, "microsoftOrg", `g-${i}`)],
      favorite: false,
      groups: [],
      readOnly: true,
    });
  }

  // The device's own address book (connected on demand): invented cards, like everything here.
  const deviceName = showcase ? "Contacts of this Mac" : "DEMO · Mac contacts (fictional)";
  for (const [i, [first, last, number, kind]] of (
    [
      ["Mom", "(demo)", "06 11 22 33 44", "mobile"],
      ["Doctor", "Demo", "01 55 55 55 55", "work"],
      ["Plumber", "Demo", "06 99 88 77 66", "mobile"],
      ["Mamie", "Demo", "02 99 00 11 22", "home"],
    ] as const
  ).entries()) {
    add({
      id: `${DEMO_DEVICE}/c-${i}`,
      displayName: `${first} ${last}`,
      firstName: first,
      lastName: last,
      company: null,
      department: null,
      title: null,
      email: null,
      phones: [{ kind, number }],
      sources: [ref(DEMO_DEVICE, deviceName, "systemContacts", `c-${i}`)],
      favorite: false,
      groups: [],
      readOnly: true,
    });
  }

  let sources: SourceView[] = [
    {
      id: DEMO_LDAP,
      kind: "ldap",
      name: ldapName,
      enabled: true,
      readOnly: true,
      state: "idle",
      contactCount: 3004,
      lastSuccessAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      lastAttemptAt: new Date(Date.now() - 12 * 60_000).toISOString(),
      lastError: null,
      errorKind: null,
      syncIntervalMin: 360,
      stale: false,
      config: {
        url: "ldaps://ldap.demo.invalid",
        baseDn: "ou=people,dc=demo,dc=invalid",
        bindDn: "cn=reader,dc=demo,dc=invalid",
        pageSize: 500,
      },
    },
    {
      id: DEMO_MS,
      kind: "microsoftOrg",
      name: msName,
      enabled: true,
      readOnly: true,
      state: showcase ? "idle" : "needsReauth",
      contactCount: 29,
      lastSuccessAt: new Date(Date.now() - (showcase ? 12 : 26) * 60_000).toISOString(),
      lastAttemptAt: new Date(Date.now() - (showcase ? 12 : 120) * 60_000).toISOString(),
      lastError: showcase ? null : "The Microsoft sign-in has expired or was revoked: reconnect the source.",
      errorKind: showcase ? null : "auth",
      syncIntervalMin: 360,
      stale: false,
      config: { clientId: "00000000-0000-0000-0000-000000000000", tenant: "organizations", level: "full" },
    },
    {
      id: DEMO_OUTLOOK,
      kind: "microsoftPersonal",
      name: outlookName,
      enabled: false,
      readOnly: true,
      state: "disabled",
      contactCount: 0,
      lastSuccessAt: null,
      lastAttemptAt: null,
      lastError: null,
      errorKind: null,
      syncIntervalMin: 360,
      stale: false,
      config: { clientId: "00000000-0000-0000-0000-000000000000", tenant: "common", level: "full" },
    },
  ];

  const favorites = new Set<string>();
  let groups: GroupView[] = [{ id: "g-clients", name: "Key clients", memberCount: 0 }];
  const members = new Map<string, Set<string>>([["g-clients", new Set()]]);
  let seq = 1;
  const changed = () => setTimeout(() => emit("directory:changed", null), 0);

  const localEntries = (): DirectoryEntry[] =>
    getLocal().map((c) => ({
      id: `local/${c.id}`,
      displayName: `${c.firstName} ${c.lastName}`.trim() || c.company || c.number,
      firstName: c.firstName,
      lastName: c.lastName,
      company: c.company,
      department: null,
      title: null,
      email: null,
      phones: [{ kind: c.number.startsWith("sip:") ? "sip" : "other", number: c.number }],
      sources: [ref("local", "Local contacts", "local", c.id)],
      favorite: false,
      groups: [],
      readOnly: false,
    }));

  const visible = (e: DirectoryEntry) =>
    e.sources.some((s) => s.sourceId === "local" || sources.find((x) => x.id === s.sourceId)?.enabled);

  function search(q: DirectoryQuery): DirectoryPage {
    const phoneDigits =
      /^[\d\s+\-.()/]+$/.test(q.text.trim()) && digitsOf(q.text).length >= 3 ? digitsOf(q.text) : null;
    const extension = /^(poste|ext)\s*(\d+)$/i.exec(fold(q.text))?.[2];
    const tokens = fold(q.text).split(" ").filter(Boolean);
    const groupMembers = q.groupId ? members.get(q.groupId) : null;
    const scored: Array<[number, DirectoryEntry]> = [];
    for (const base of [...localEntries(), ...people]) {
      if (!visible(base)) continue;
      const e: DirectoryEntry = {
        ...base,
        favorite: base.sources.some((s) => favorites.has(s.recordId)),
        groups: groups.filter((g) => base.sources.some((s) => members.get(g.id)?.has(s.recordId))).map((g) => g.id),
      };
      if (q.sourceIds.length && !e.sources.some((s) => q.sourceIds.includes(s.sourceId))) continue;
      if (q.favoritesOnly && !e.favorite) continue;
      if (q.department && e.department !== q.department) continue;
      if (groupMembers && !e.sources.some((s) => groupMembers.has(s.recordId))) continue;
      let score = 0;
      if (extension) {
        if (
          !e.phones.some(
            (p) => digitsOf(p.number.split(/poste/i)[1] ?? (p.kind === "extension" ? p.number : "")) === extension,
          )
        )
          continue;
      } else if (phoneDigits) {
        if (
          !e.phones.some(
            (p) =>
              digitsOf(p.number).includes(phoneDigits) || digitsOf(p.number).includes(phoneDigits.replace(/^0/, "")),
          )
        )
          continue;
      } else if (tokens.length) {
        const name = fold(e.displayName);
        const hay = fold(
          [
            e.displayName,
            e.company,
            e.department,
            e.title,
            e.email,
            ...e.phones.map((p) => (p.kind === "sip" ? p.number : "")),
          ].join(" "),
        );
        let ok = true;
        for (const t of tokens) {
          if (name.split(" ").some((w) => w.startsWith(t))) continue;
          if (name.includes(t)) score += 1;
          else if (hay.includes(t) || (/^\d{2,}$/.test(t) && e.phones.some((p) => digitsOf(p.number).includes(t))))
            score += 2;
          else ok = false;
        }
        if (!ok) continue;
      }
      scored.push([score, e]);
    }
    scored.sort((a, b) => a[0] - b[0] || fold(a[1].displayName).localeCompare(fold(b[1].displayName)));
    const limit = Math.min(q.limit || 50, 500);
    return { items: scored.slice(q.offset, q.offset + limit).map((x) => x[1]), total: scored.length, offset: q.offset };
  }

  function refreshCounts() {
    groups = groups.map((g) => ({ ...g, memberCount: members.get(g.id)?.size ?? 0 }));
  }

  const syncLater = (id: string) => {
    sources = sources.map((s) => (s.id === id ? { ...s, state: "syncing" } : s));
    changed();
    setTimeout(() => {
      sources = sources.map((s) =>
        s.id === id && s.state === "syncing"
          ? { ...s, state: "idle", lastSuccessAt: new Date().toISOString(), lastError: null, errorKind: null }
          : s,
      );
      changed();
    }, 1600);
  };

  return {
    directory_search: (a: Args) => search(a?.query as DirectoryQuery),
    directory_departments: () => {
      const counts = new Map<string, number>();
      for (const e of people)
        if (e.department && visible(e)) counts.set(e.department, (counts.get(e.department) ?? 0) + 1);
      return [...counts].sort((a, b) => a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count }));
    },
    directory_sources: () => [
      {
        id: "local",
        kind: "local" as const,
        name: "Local contacts",
        enabled: true,
        readOnly: false,
        state: "idle" as const,
        contactCount: getLocal().length,
        lastSuccessAt: null,
        lastAttemptAt: null,
        lastError: null,
        errorKind: null,
        syncIntervalMin: 0,
        stale: false,
        config: {},
      },
      ...sources,
    ],
    directory_dialable: (a: Args) => {
      const n = String(a?.number ?? "").trim();
      if (/^sips?:|@/.test(n)) return n;
      const main = n.replace(/\s*(poste|ext\.?|x)\s*\d+$/i, "").replace(/\(0\)/g, "");
      const cleaned = main.replace(/(?!^\+)[^\d*#]/g, "");
      return /\d/.test(cleaned) ? cleaned : null;
    },
    directory_test_ldap: (a: Args) => {
      const input = a?.input as { config: { url: string; baseDn: string }; password?: string };
      if (/fail|panne/i.test(input.config.url)) {
        return {
          ok: false,
          report: null,
          error: { kind: "network", message: "The server refuses the connection: check the address and the port." },
        };
      }
      if (/mauvais|wrong/i.test(input.password ?? "")) {
        return {
          ok: false,
          report: null,
          error: {
            kind: "auth",
            message:
              "The server refused the credentials: check the account and the password, then reconnect the source.",
          },
        };
      }
      return {
        ok: true,
        error: null,
        report: {
          authenticated: true,
          skipped: 0,
          warnings: [],
          preview: people.slice(0, 8).map((p) => ({
            externalId: p.sources[0]!.externalId,
            firstName: p.firstName,
            lastName: p.lastName,
            displayName: p.displayName,
            company: p.company,
            department: p.department,
            title: p.title,
            email: p.email,
            phones: p.phones,
          })),
        },
      };
    },
    directory_system_contacts_info: () => ({
      available: true,
      name: "Mac contacts",
      access: sources.some((s) => s.id === DEMO_DEVICE) ? "authorized" : "notDetermined",
    }),
    directory_connect_system_contacts: async () => {
      await new Promise((r) => setTimeout(r, 1500)); // the system's question, answered
      if (!sources.some((s) => s.id === DEMO_DEVICE)) {
        sources = [
          ...sources,
          {
            id: DEMO_DEVICE,
            kind: "systemContacts",
            name: deviceName,
            enabled: true,
            readOnly: true,
            state: "idle",
            contactCount: 4,
            lastSuccessAt: new Date().toISOString(),
            lastAttemptAt: new Date().toISOString(),
            lastError: null,
            errorKind: null,
            syncIntervalMin: 15,
            stale: false,
            config: {},
          },
        ];
        changed();
      }
      return sources.find((s) => s.id === DEMO_DEVICE);
    },
    directory_open_contacts_privacy_settings: () => undefined,
    directory_save_ldap: (a: Args) => {
      const input = a?.input as { id?: string; name: string; config: Record<string, unknown>; syncIntervalMin: number };
      if (input.id) {
        sources = sources.map((s) =>
          s.id === input.id
            ? {
                ...s,
                name: input.name,
                config: input.config,
                syncIntervalMin: input.syncIntervalMin,
                state: "idle",
                lastError: null,
                errorKind: null,
              }
            : s,
        );
        changed();
        return sources.find((s) => s.id === input.id);
      }
      const id = `demo-new-${seq++}`;
      sources = [
        ...sources,
        {
          id,
          kind: "ldap",
          name: `DEMO · ${input.name}`,
          enabled: true,
          readOnly: true,
          state: "idle",
          contactCount: 40,
          lastSuccessAt: new Date().toISOString(),
          lastAttemptAt: new Date().toISOString(),
          lastError: null,
          errorKind: null,
          syncIntervalMin: input.syncIntervalMin,
          stale: false,
          config: input.config,
        },
      ];
      changed();
      return sources.at(-1);
    },
    directory_connect_microsoft: async (a: Args) => {
      const input = a?.input as {
        sourceId?: string;
        kind: SourceKind;
        name: string;
        config: Record<string, unknown>;
        syncIntervalMin: number;
      };
      await new Promise((r) => setTimeout(r, 1800)); // the browser sign-in
      if (input.sourceId) {
        sources = sources.map((s) =>
          s.id === input.sourceId
            ? {
                ...s,
                enabled: true,
                state: "idle",
                lastError: null,
                errorKind: null,
                lastSuccessAt: new Date().toISOString(),
              }
            : s,
        );
        changed();
        return sources.find((s) => s.id === input.sourceId);
      }
      const id = `demo-new-${seq++}`;
      sources = [
        ...sources,
        {
          id,
          kind: input.kind,
          name: `DEMO · ${input.name}`,
          enabled: true,
          readOnly: true,
          state: "idle",
          contactCount: 12,
          lastSuccessAt: new Date().toISOString(),
          lastAttemptAt: new Date().toISOString(),
          lastError: null,
          errorKind: null,
          syncIntervalMin: input.syncIntervalMin,
          stale: false,
          config: input.config,
        },
      ];
      changed();
      return sources.at(-1);
    },
    directory_cancel_connect: () => undefined,
    directory_sync: (a: Args) => {
      syncLater(String(a?.id));
    },
    directory_set_source: (a: Args) => {
      const id = String(a?.id);
      sources = sources.map((s) =>
        s.id === id
          ? {
              ...s,
              name: String(a?.name),
              enabled: Boolean(a?.enabled),
              syncIntervalMin: Number(a?.syncIntervalMin),
              state: a?.enabled ? (s.errorKind === "auth" ? "needsReauth" : "idle") : "disabled",
            }
          : s,
      );
      changed();
      return sources.find((s) => s.id === id);
    },
    directory_disconnect: (a: Args) => {
      const id = String(a?.id);
      sources = sources.map((s) =>
        s.id === id
          ? {
              ...s,
              enabled: false,
              state: "disabled",
              contactCount: 0,
              lastSuccessAt: null,
              lastError: null,
              errorKind: null,
            }
          : s,
      );
      changed();
    },
    directory_clear_cache: (a: Args) => {
      const id = String(a?.id);
      sources = sources.map((s) => (s.id === id ? { ...s, contactCount: 0, lastSuccessAt: null } : s));
      changed();
    },
    directory_remove_source: (a: Args) => {
      sources = sources.filter((s) => s.id !== String(a?.id));
      changed();
    },
    directory_set_favorite: (a: Args) => {
      for (const id of a?.ids as string[]) {
        if (a?.favorite) favorites.add(id);
        else favorites.delete(id);
      }
      changed();
    },
    directory_groups: () => {
      refreshCounts();
      return groups;
    },
    directory_create_group: (a: Args) => {
      const name = String(a?.name ?? "").trim();
      if (!name || groups.some((g) => g.name.toLowerCase() === name.toLowerCase())) {
        throw {
          kind: "validation",
          message: name ? "A group already has this name" : "The group name must be 1 to 60 characters long",
        };
      }
      const g = { id: `g-${seq++}`, name, memberCount: 0 };
      groups = [...groups, g];
      members.set(g.id, new Set());
      changed();
      return g;
    },
    directory_rename_group: (a: Args) => {
      groups = groups.map((g) => (g.id === a?.id ? { ...g, name: String(a?.name) } : g));
      changed();
    },
    directory_delete_group: (a: Args) => {
      groups = groups.filter((g) => g.id !== a?.id);
      members.delete(String(a?.id));
      changed();
    },
    directory_group_add: (a: Args) => {
      const set = members.get(String(a?.groupId));
      for (const id of a?.ids as string[]) set?.add(id);
      changed();
    },
    directory_group_remove: (a: Args) => {
      const set = members.get(String(a?.groupId));
      for (const id of a?.ids as string[]) set?.delete(id);
      changed();
    },
  };
}
