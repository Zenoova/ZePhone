# OrbKit orbs

Voice orbs of the call screen: WebGL shader orbs from [OrbKit](https://orbkit.zzzzshawn.cloud)
([source](https://github.com/zzzzshawn/orbkit)), copied here as source the way `npx shadcn@latest add zzzzshawn/orbkit/<id>`
would (from `https://orbkit.zzzzshawn.cloud/r/all.json`). The runtime and these 14 orbs are MIT licensed: see `LICENSE`.

| File | What |
| --- | --- |
| `orbkit-core.tsx` | the dependency-free WebGL runtime (`ShaderOrb`) |
| `shdr-11` `12` `13` `14` `16` `17` `21` `23` `24` `27` `29` `30` `32` `33` | one orb each |

`src/lib/voice-orbs.ts` lists them (names, lazy loading) and `src/components/ShaderVoiceOrb.tsx` drives them with the
real audio level of the call.

## Local changes to the upstream files

- The import path of the runtime: `@/components/ui/orbkit-core` → `@/components/orbs/orbkit-core` (in every orb).
- Four non-null assertions (`!`) in `orbkit-core.tsx` (`hexToRgb` and the colour spring), for `noUncheckedIndexedAccess`.

The folder is excluded from ESLint and Prettier so it stays diffable against upstream.

## Not included: the 19 orbs ported from XorDev's shaders

`shdr-01…10`, `15`, `18`, `19`, `20`, `22`, `25`, `26`, `28`, `31` are ported from shaders by [@XorDev](https://x.com/XorDev)
for **non-commercial use only, with attribution** (each file carries the notice and must keep it). They are left out so
that ZePhone can be distributed under any licence. For a strictly personal build you may add some: copy the file here,
change its import path as above, keep its header, and add an entry to `VOICE_ORBS`.
