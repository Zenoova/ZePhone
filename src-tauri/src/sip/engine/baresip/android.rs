//! Baresip on Android.
//!
//! Tauri sidecars do not exist on a phone, but the engine does not need one: the application's package carries
//! Baresip as `libbaresip.so` (the executable, renamed so that the package manager extracts it with the native
//! libraries) and the engine runs it exactly like on a computer, as a child process driven through `ctrl_tcp`.
//! Android lets an application run what sits in its own native-library folder (and nothing it downloaded), which
//! is why the package must be built with `useLegacyPackaging` (see `gen/android/app/build.gradle.kts`).
//!
//! Baresip is built STATIC (every module is inside the executable), so there is no module folder to ship, and the
//! two ring tones are embedded in the application and written next to the engine's configuration.

use std::{
    io,
    path::{Path, PathBuf},
    sync::OnceLock,
};

use super::process::BaresipPaths;

/// File name of the engine in the native-library folder.
pub const ENGINE_LIB: &str = "libbaresip.so";

/// File name of the application's own native library (what `cargo` builds): its folder is the native-library
/// folder of the package.
const APP_LIB: &str = "libzephone_lib.so";

/// The modules compiled into `libbaresip.so` (`scripts/build-baresip-android.sh`).
const STATIC_MODULES: &[&str] = &[
    "g711", "auconv", "auresamp", "aaudio", "srtp", "menu", "ctrl_tcp", "vumeter", "zeaudio",
    "opus",
];

const RING: &[u8] = include_bytes!("../../../../android/sounds/ring.wav");
const RINGBACK: &[u8] = include_bytes!("../../../../android/sounds/ringback.wav");

/// Whether the module a `module <name>.so` line asks for is part of the engine.
pub fn module_exists(file: &str) -> bool {
    let name = file.rsplit_once('.').map_or(file, |(name, _)| name);
    STATIC_MODULES.contains(&name)
}

/// The folder the package manager extracted the native libraries to, found through the memory map of the
/// process: the application's own library is loaded from there.
fn native_lib_dir() -> io::Result<PathBuf> {
    let maps = std::fs::read_to_string("/proc/self/maps")?;
    lib_dir_from_maps(&maps).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "the native library folder of the application was not found",
        )
    })
}

fn lib_dir_from_maps(maps: &str) -> Option<PathBuf> {
    maps.lines()
        .filter_map(|l| l.split_whitespace().last())
        .find(|p| p.ends_with(APP_LIB) && p.starts_with('/'))
        .and_then(|p| Path::new(p).parent())
        .map(Path::to_path_buf)
}

/// File the Android shell (`MainActivity.kt`) writes the DNS servers of the active network to, one per line,
/// in the application's data folder.
const DNS_FILE: &str = "dns-servers.txt";

static DNS_PATH: OnceLock<PathBuf> = OnceLock::new();

/// The DNS servers of the active network (empty when the shell has not written any yet).
pub fn dns_servers() -> Vec<String> {
    let Some(file) = DNS_PATH.get() else {
        return Vec::new();
    };
    std::fs::read_to_string(file)
        .map(|t| {
            t.lines()
                .map(|l| l.trim().to_owned())
                .filter(|l| !l.is_empty())
                .collect()
        })
        .unwrap_or_default()
}

/// Where the engine, its sounds and its working files are. Writes the sounds (they are tiny and cheap to rewrite
/// after an update). `data_dir` is the application's data folder, where the shell leaves what only Java can learn.
pub fn paths(work_dir: PathBuf, data_dir: &Path) -> io::Result<BaresipPaths> {
    let _ = DNS_PATH.set(data_dir.join(DNS_FILE));
    let exe = native_lib_dir()?.join(ENGINE_LIB);
    let sounds_dir = work_dir.join("sounds");
    std::fs::create_dir_all(&sounds_dir)?;
    for (name, bytes) in [("ring.wav", RING), ("ringback.wav", RINGBACK)] {
        std::fs::write(sounds_dir.join(name), bytes)?;
    }
    Ok(BaresipPaths {
        exe,
        modules_dir: work_dir.join("modules"),
        sounds_dir,
        work_dir,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_native_library_folder_in_a_memory_map() {
        let maps = "\
7f1000000000-7f1000100000 r--p 00000000 fd:00 1 /system/lib64/libc.so
7f2000000000-7f2000100000 r-xp 00000000 fd:00 2 /data/app/~~x==/app.zephone.softphone-y==/lib/arm64/libzephone_lib.so
7f3000000000-7f3000100000 r--p 00000000 fd:00 3 /data/app/~~x==/app.zephone.softphone-y==/lib/arm64/libzephone_lib.so";
        assert_eq!(
            lib_dir_from_maps(maps),
            Some(PathBuf::from(
                "/data/app/~~x==/app.zephone.softphone-y==/lib/arm64"
            ))
        );
        assert_eq!(lib_dir_from_maps("nothing here"), None);
    }

    #[test]
    fn static_modules_are_found_whatever_the_extension() {
        assert!(module_exists("opus.so"));
        assert!(module_exists("aaudio.so"));
        assert!(!module_exists("g722.so"));
        assert!(!module_exists("wasapi.so"));
    }
}
