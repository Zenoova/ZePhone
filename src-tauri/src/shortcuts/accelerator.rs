//! Keyboard combinations: reading, checking and writing them in one canonical form.
//!
//! A combination is stored as text such as `CommandOrControl+Alt+Shift+A`. The same text means the same keys
//! on every system (`CommandOrControl` is ⌘ on macOS and Ctrl elsewhere), and it is what the operating-system
//! layer (the global-shortcut plugin) reads.
//!
//! What is refused, and why:
//! * a combination without a modifier (a letter typed in another application must never start an action),
//!   except the function keys F13–F24, which no keyboard types by accident;
//! * Option/Alt as the only modifier on a key that types text: on macOS it types accents and symbols, on Windows
//!   Ctrl+Alt is AltGr — taking it globally would break typing;
//! * the few combinations the system keeps for itself (⌘Q, ⌘Tab, Alt+F4…).

use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccelError {
    Empty,
    UnknownModifier(String),
    UnknownKey(String),
    NoKey,
    TwoKeys,
    /// No modifier at all (or only Shift).
    NeedsModifier,
    /// Option/Alt alone with a key that types text.
    AltOnly,
    Reserved(&'static str),
}

impl fmt::Display for AccelError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AccelError::Empty => write!(f, "No key combination"),
            AccelError::UnknownModifier(m) => write!(f, "Unknown modifier: “{m}”"),
            AccelError::UnknownKey(k) => write!(f, "Unsupported key: “{k}”"),
            AccelError::NoKey => {
                write!(f, "The main key is missing (in addition to the modifiers)")
            }
            AccelError::TwoKeys => write!(f, "Only one main key is possible"),
            AccelError::NeedsModifier => write!(
                f,
                "Add Ctrl, Option/Alt or ⌘: a bare key would fire the action while you type in another application"
            ),
            AccelError::AltOnly => write!(
                f,
                "Option/Alt alone is used to type characters: add Ctrl or ⌘ so as not to interfere with typing"
            ),
            AccelError::Reserved(why) => write!(f, "Combination reserved by the system ({why})"),
        }
    }
}

impl std::error::Error for AccelError {}

/// A parsed, valid combination.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Accelerator {
    /// `CommandOrControl`: ⌘ on macOS, Ctrl elsewhere.
    primary: bool,
    ctrl: bool,
    alt: bool,
    shift: bool,
    /// ⌘ on macOS, the Windows key elsewhere.
    meta: bool,
    key: Key,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
enum Key {
    Letter(char),
    Digit(char),
    F(u8),
    Named(&'static str),
}

const NAMED: &[&str] = &[
    "Space",
    "Enter",
    "Tab",
    "Backspace",
    "Delete",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "Up",
    "Down",
    "Left",
    "Right",
];

impl Key {
    fn parse(token: &str) -> Result<Key, AccelError> {
        let t = token.trim();
        let upper = t.to_ascii_uppercase();
        let mut chars = t.chars();
        if let (Some(c), None) = (chars.next(), chars.next()) {
            if c.is_ascii_alphabetic() {
                return Ok(Key::Letter(c.to_ascii_uppercase()));
            }
            if c.is_ascii_digit() {
                return Ok(Key::Digit(c));
            }
        }
        if let Some(n) = upper.strip_prefix('F').and_then(|n| n.parse::<u8>().ok())
            && (1..=24).contains(&n)
            && upper.len() == format!("F{n}").len()
        {
            return Ok(Key::F(n));
        }
        let alias = match upper.as_str() {
            "RETURN" => "Enter",
            "ARROWUP" => "Up",
            "ARROWDOWN" => "Down",
            "ARROWLEFT" => "Left",
            "ARROWRIGHT" => "Right",
            "PGUP" => "PageUp",
            "PGDN" => "PageDown",
            "DEL" => "Delete",
            _ => "",
        };
        let wanted = if alias.is_empty() {
            upper.as_str()
        } else {
            alias
        };
        NAMED
            .iter()
            .find(|n| n.eq_ignore_ascii_case(wanted))
            .map(|n| Key::Named(n))
            .ok_or_else(|| AccelError::UnknownKey(t.to_owned()))
    }

    fn name(&self) -> String {
        match self {
            Key::Letter(c) | Key::Digit(c) => c.to_string(),
            Key::F(n) => format!("F{n}"),
            Key::Named(n) => (*n).to_owned(),
        }
    }

    fn types_text(&self) -> bool {
        matches!(self, Key::Letter(_) | Key::Digit(_) | Key::Named("Space"))
    }
}

impl Accelerator {
    /// Reads and checks a combination for the current system.
    pub fn parse(text: &str) -> Result<Accelerator, AccelError> {
        Self::parse_for(text, cfg!(target_os = "macos"))
    }

    pub fn parse_for(text: &str, mac: bool) -> Result<Accelerator, AccelError> {
        let text = text.trim();
        if text.is_empty() {
            return Err(AccelError::Empty);
        }
        let (mut primary, mut ctrl, mut alt, mut shift, mut meta) =
            (false, false, false, false, false);
        let mut others: Vec<&str> = Vec::new();
        for token in text.split('+').map(str::trim) {
            if token.is_empty() {
                // "Ctrl++" would mean the plus key: not offered.
                return Err(AccelError::UnknownKey(String::new()));
            }
            match token.to_ascii_uppercase().as_str() {
                "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => {
                    primary = true
                }
                "CTRL" | "CONTROL" => ctrl = true,
                "ALT" | "OPTION" => alt = true,
                "SHIFT" => shift = true,
                "SUPER" | "META" | "COMMAND" | "CMD" | "WIN" | "WINDOWS" => meta = true,
                _ => others.push(token),
            }
        }
        // What is not a modifier is the key: one, and the last. A word before it that is no key either was
        // meant as a modifier.
        let mut key: Option<Key> = None;
        if let Some((last, before)) = others.split_last() {
            if let Some(word) = before.first() {
                return Err(match Key::parse(word) {
                    Ok(_) => AccelError::TwoKeys,
                    Err(_) => AccelError::UnknownModifier((*word).to_owned()),
                });
            }
            key = Some(Key::parse(last)?);
        }
        let key = key.ok_or(AccelError::NoKey)?;
        let a = Accelerator {
            primary,
            ctrl,
            alt,
            shift,
            meta,
            key,
        };
        a.check(mac)?;
        Ok(a)
    }

    fn physical(&self, mac: bool) -> (bool, bool, bool, bool) {
        (
            self.ctrl || (self.primary && !mac),
            self.alt,
            self.shift,
            self.meta || (self.primary && mac),
        )
    }

    fn check(&self, mac: bool) -> Result<(), AccelError> {
        let (ctrl, alt, shift, meta) = self.physical(mac);
        let strong = ctrl || meta;
        if !strong && !alt {
            return match self.key {
                Key::F(n) if n >= 13 => Ok(()),
                _ => Err(AccelError::NeedsModifier),
            };
        }
        if alt && !strong && self.key.types_text() {
            return Err(AccelError::AltOnly);
        }
        if let Some(why) = self.reserved(mac, (ctrl, alt, shift, meta)) {
            return Err(AccelError::Reserved(why));
        }
        Ok(())
    }

    fn reserved(
        &self,
        mac: bool,
        (ctrl, alt, shift, meta): (bool, bool, bool, bool),
    ) -> Option<&'static str> {
        let key = self.key.name();
        let k = key.as_str();
        if mac {
            return match (ctrl, alt, shift, meta, k) {
                (false, false, false, true, "Q") => Some("⌘Q quits the active application"),
                (false, false, false, true, "Tab") => Some("⌘Tab switches application"),
                (false, false, false, true, "Space") => Some("⌘Space opens Spotlight"),
                (false, false, false, true, "H") => Some("⌘H hides the application"),
                (false, false, false, true, "M") => Some("⌘M minimizes the window"),
                (true, false, false, true, "Q") => Some("⌃⌘Q locks the screen"),
                (false, false, true, true, "3" | "4" | "5") => Some("⇧⌘3, 4, 5: screenshots"),
                _ => None,
            };
        }
        match (ctrl, alt, shift, meta, k) {
            (false, true, false, false, "Tab") => Some("Alt+Tab switches windows"),
            (false, true, false, false, "F4") => Some("Alt+F4 closes the window"),
            (true, true, false, false, "Delete") => Some("Ctrl+Alt+Suppr"),
            (false, false, false, true, "L" | "D" | "E" | "R" | "Tab") => Some("Windows shortcut"),
            _ => None,
        }
    }

    /// The canonical text: always in the same order, so two spellings of one combination compare equal.
    pub fn canonical(&self) -> String {
        let mut parts: Vec<String> = Vec::new();
        if self.primary {
            parts.push("CommandOrControl".into());
        }
        if self.ctrl {
            parts.push("Control".into());
        }
        if self.alt {
            parts.push("Alt".into());
        }
        if self.shift {
            parts.push("Shift".into());
        }
        if self.meta {
            parts.push("Super".into());
        }
        parts.push(self.key.name());
        parts.join("+")
    }

    /// The keys actually pressed on this system: two combinations with the same value cannot both be registered.
    pub fn same_keys_as(&self, other: &Accelerator, mac: bool) -> bool {
        self.key == other.key && self.physical(mac) == other.physical(mac)
    }

    /// For people: `⌃⌥⇧⌘A` on macOS, `Ctrl+Alt+Shift+A` elsewhere.
    pub fn display(&self, mac: bool) -> String {
        let (ctrl, alt, shift, meta) = self.physical(mac);
        if mac {
            format!(
                "{}{}{}{}{}",
                if ctrl { "⌃" } else { "" },
                if alt { "⌥" } else { "" },
                if shift { "⇧" } else { "" },
                if meta { "⌘" } else { "" },
                self.key.name()
            )
        } else {
            let mut parts = Vec::new();
            if ctrl {
                parts.push("Ctrl");
            }
            if alt {
                parts.push("Alt");
            }
            if shift {
                parts.push("Maj");
            }
            if meta {
                parts.push("Win");
            }
            let key = self.key.name();
            parts.push(&key);
            parts.join("+")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ok(s: &str) -> Accelerator {
        Accelerator::parse_for(s, true).unwrap_or_else(|e| panic!("{s}: {e}"))
    }
    fn err(s: &str) -> AccelError {
        Accelerator::parse_for(s, true).expect_err(s)
    }

    #[test]
    fn spellings_of_the_same_combination_become_one_text() {
        let canon = "CommandOrControl+Alt+Shift+A";
        for s in [
            "CommandOrControl+Alt+Shift+A",
            "cmdorctrl+option+shift+a",
            "Shift+Alt+CommandOrControl+a",
            " CmdOrCtrl + Alt + Shift + A ",
        ] {
            assert_eq!(ok(s).canonical(), canon, "{s}");
        }
        assert_eq!(
            ok("Ctrl+Option+Cmd+Space").canonical(),
            "Control+Alt+Super+Space"
        );
        assert_eq!(ok("Ctrl+ArrowUp").canonical(), "Control+Up");
        assert_eq!(ok("Ctrl+f5").canonical(), "Control+F5");
    }

    #[test]
    fn the_same_keys_are_recognised_across_spellings_and_systems() {
        // ⌘ is "CommandOrControl" on a Mac and "Super" too: the same keys.
        assert!(ok("CommandOrControl+Alt+K").same_keys_as(&ok("Super+Alt+K"), true));
        assert!(!ok("CommandOrControl+Alt+K").same_keys_as(&ok("Control+Alt+K"), true));
        // Elsewhere "CommandOrControl" is Ctrl.
        let a = Accelerator::parse_for("CommandOrControl+Alt+K", false).unwrap();
        let b = Accelerator::parse_for("Control+Alt+K", false).unwrap();
        assert!(a.same_keys_as(&b, false));
        assert!(!ok("Control+Alt+K").same_keys_as(&ok("Control+Alt+J"), true));
    }

    #[test]
    fn a_bare_key_is_refused_but_a_far_function_key_is_allowed() {
        for s in [
            "A", "5", "Space", "Shift+A", "F5", "F12", "Shift+F1", "Enter",
        ] {
            assert_eq!(err(s), AccelError::NeedsModifier, "{s}");
        }
        assert_eq!(ok("F13").canonical(), "F13");
        assert_eq!(ok("F24").canonical(), "F24");
    }

    #[test]
    fn alt_alone_would_break_typing() {
        assert_eq!(err("Alt+E"), AccelError::AltOnly);
        assert_eq!(err("Alt+Shift+Space"), AccelError::AltOnly);
        ok("Alt+F9"); // not a key that types text
        ok("Alt+Control+E");
    }

    #[test]
    fn what_the_system_keeps_is_refused_with_the_reason() {
        for s in [
            "Cmd+Q",
            "Cmd+Tab",
            "Cmd+Space",
            "Cmd+H",
            "Control+Cmd+Q",
            "Cmd+Shift+4",
        ] {
            assert!(matches!(err(s), AccelError::Reserved(_)), "{s}");
        }
        assert!(matches!(
            Accelerator::parse_for("Alt+F4", false),
            Err(AccelError::Reserved(_))
        ));
        // The same keys are free on the other system.
        assert!(Accelerator::parse_for("Cmd+Q", false).is_ok());
    }

    #[test]
    fn malformed_input_is_explained() {
        assert_eq!(err(""), AccelError::Empty);
        assert_eq!(err("   "), AccelError::Empty);
        assert_eq!(err("Ctrl+Shift"), AccelError::NoKey);
        assert_eq!(err("Ctrl+A+B"), AccelError::TwoKeys);
        assert!(matches!(err("Ctrl+Banana"), AccelError::UnknownKey(_)));
        assert!(matches!(err("Banana+A"), AccelError::UnknownModifier(_)));
        assert!(matches!(err("Ctrl+F25"), AccelError::UnknownKey(_)));
        assert!(matches!(err("Ctrl+F0"), AccelError::UnknownKey(_)));
        assert!(matches!(err("Ctrl++"), AccelError::UnknownKey(_)));
        assert!(
            matches!(err("Ctrl+Escape"), AccelError::UnknownKey(_)),
            "Escape is not offered"
        );
        for m in [err("Banana+A"), err("Ctrl+Shift"), err("A")] {
            assert!(!m.to_string().is_empty());
        }
    }

    #[test]
    fn displays_for_people() {
        assert_eq!(ok("CommandOrControl+Alt+Shift+A").display(true), "⌥⇧⌘A");
        assert_eq!(ok("Control+Alt+Super+M").display(true), "⌃⌥⌘M");
        assert_eq!(
            Accelerator::parse_for("CommandOrControl+Shift+M", false)
                .unwrap()
                .display(false),
            "Ctrl+Maj+M"
        );
    }

    #[test]
    fn what_we_write_is_what_the_operating_system_layer_reads() {
        use std::str::FromStr;
        for s in [
            "CommandOrControl+Alt+Shift+A",
            "Control+Alt+Super+Space",
            "Control+PageDown",
            "Control+Up",
            "Control+Enter",
            "Control+Backspace",
            "Control+Delete",
            "Control+Home",
            "Control+End",
            "Control+Tab",
            "Control+Left",
            "Control+Right",
            "Control+PageUp",
            "Control+F24",
            "F13",
            "Control+0",
        ] {
            let canon = Accelerator::parse_for(s, true)
                .unwrap_or_else(|e| panic!("{s}: {e}"))
                .canonical();
            tauri_plugin_global_shortcut::Shortcut::from_str(&canon)
                .unwrap_or_else(|e| panic!("the plugin cannot read {canon}: {e}"));
        }
    }
}
