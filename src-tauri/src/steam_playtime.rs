//! Imports Steam's own playtime history (`userdata/<accountid>/config/localconfig.vdf`) into
//! Mochi's tracker, so Stats and per-game totals are not empty for players who mostly played in
//! Steam before installing Mochi.
//!
//! Steam writes `Playtime` in MINUTES — the same unit as the Web API's `playtime_forever` — and
//! `LastPlayed` in unix seconds. Both are assumptions documented here and encoded in `plan`
//! below. Everything is read defensively: a missing key, an unexpected nesting level or a value
//! that is not a number simply means "nothing to import" for that app.
//!
//! The mapping from a Steam app id to a Mochi game comes from the UI (`steamAppIdOf`), so the
//! native side never needs the library itself.

use crate::{playtime, playtime_import, platform, sources, steam_achievements, util};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

/// One library game that can receive Steam's playtime.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub appid: u32,
    pub game_id: String,
    pub name: String,
}

/// What one import changed. Importing the same data again reports zeros.
#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    /// Games that were behind Steam's total and received the missing part.
    pub imported: u32,
    /// Library games whose tracked total already matched Steam's (or was ahead of it).
    pub unchanged: u32,
    /// Apps Steam has playtime for that no game in the library maps to.
    pub unmapped: u32,
}

/// One app's playtime as Steam recorded it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct AppPlaytime {
    /// `Playtime` is in MINUTES (Steam's convention, also used by its Web API).
    pub minutes: u64,
    /// `LastPlayed`, unix seconds; 0 when Steam has no timestamp.
    pub last_played: u64,
}

// ---------------------------------------------------------------------------
// Text VDF
// ---------------------------------------------------------------------------

#[derive(Debug, PartialEq)]
enum Tok {
    Str(String),
    Open,
    Close,
}

fn push_unquoted(first: char, chars: &mut std::iter::Peekable<std::str::Chars<'_>>, out: &mut Vec<Tok>) {
    let mut value = String::new();
    value.push(first);
    while let Some(&next) = chars.peek() {
        if next.is_whitespace() || next == '{' || next == '}' || next == '"' { break; }
        value.push(next);
        chars.next();
    }
    out.push(Tok::Str(value));
}

/// Splits a text VDF into strings (quoted with `\"` escapes, or bare), braces and `//` comments.
fn tokenize(text: &str) -> Vec<Tok> {
    let mut out = Vec::new();
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' => {
                let mut value = String::new();
                while let Some(c) = chars.next() {
                    match c {
                        '"' => break,
                        '\\' => match chars.next() {
                            Some('n') => value.push('\n'),
                            Some('t') => value.push('\t'),
                            Some(other) => value.push(other),
                            None => {}
                        },
                        other => value.push(other),
                    }
                }
                out.push(Tok::Str(value));
            }
            '{' => out.push(Tok::Open),
            '}' => out.push(Tok::Close),
            '/' if chars.peek() == Some(&'/') => {
                for c in chars.by_ref() { if c == '\n' { break; } }
            }
            c if c.is_whitespace() => {}
            c => push_unquoted(c, &mut chars, &mut out),
        }
    }
    out
}

#[derive(Debug, Default, PartialEq)]
struct Node {
    entries: Vec<(String, Value)>,
}

#[derive(Debug, PartialEq)]
enum Value {
    Str(String),
    Obj(Node),
}

impl Node {
    /// Case-insensitive lookup: Steam's key casing is not consistent across versions.
    fn get(&self, key: &str) -> Option<&Value> {
        self.entries.iter().find(|(name, _)| name.eq_ignore_ascii_case(key)).map(|(_, value)| value)
    }
    fn object(&self, key: &str) -> Option<&Node> {
        match self.get(key) { Some(Value::Obj(node)) => Some(node), _ => None }
    }
    fn text(&self, key: &str) -> Option<&str> {
        match self.get(key) { Some(Value::Str(value)) => Some(value), _ => None }
    }
    fn number(&self, key: &str) -> Option<u64> {
        self.text(key)?.trim().parse().ok()
    }
}

/// Attaches one entry to the object currently being built (`root` when nothing is open).
fn push_entry(root: &mut Node, stack: &mut [Node], key: String, value: Value) {
    match stack.last_mut() {
        Some(node) => node.entries.push((key, value)),
        None => root.entries.push((key, value)),
    }
}

/// Parses a whole text VDF file. Iterative (no recursion) and lenient: a key without a value, a
/// stray brace or an unbalanced file just yields a shorter tree instead of failing the import.
fn parse_text_vdf(text: &str) -> Node {
    let tokens = tokenize(text);
    let mut root = Node::default();
    let mut stack: Vec<Node> = Vec::new();
    // The key each currently open object will be stored under.
    let mut keys: Vec<String> = Vec::new();
    let mut index = 0;
    while index < tokens.len() {
        match &tokens[index] {
            // A string followed by a string is a key/value pair; followed by `{` it names an object.
            Tok::Str(key) => match tokens.get(index + 1) {
                Some(Tok::Str(value)) => { push_entry(&mut root, &mut stack, key.clone(), Value::Str(value.clone())); index += 2; }
                Some(Tok::Open) => { stack.push(Node::default()); keys.push(key.clone()); index += 2; }
                _ => index += 1,
            },
            Tok::Open => { stack.push(Node::default()); keys.push(String::new()); index += 1; }
            Tok::Close => {
                if let (Some(node), Some(key)) = (stack.pop(), keys.pop()) { push_entry(&mut root, &mut stack, key, Value::Obj(node)); }
                index += 1;
            }
        }
    }
    // An unbalanced (truncated) file keeps whatever objects were still open at the end.
    while let (Some(node), Some(key)) = (stack.pop(), keys.pop()) { push_entry(&mut root, &mut stack, key, Value::Obj(node)); }
    root
}

fn walk<'a>(start: &'a Node, path: &[&str]) -> Option<&'a Node> {
    let mut node = start;
    for key in path { node = node.object(key)?; }
    Some(node)
}

/// Depth-first search for an object by name (alternate nestings the canonical walk misses).
fn find_object<'a>(node: &'a Node, name: &str, depth: usize) -> Option<&'a Node> {
    if depth > 8 { return None; }
    if let Some(found) = node.object(name) { return Some(found); }
    node.entries.iter().find_map(|(_, value)| match value {
        Value::Obj(child) => find_object(child, name, depth + 1),
        Value::Str(_) => None,
    })
}

/// `UserLocalConfigStore → Software → Valve → Steam → apps`, tolerating a file that starts at
/// any level of that path, then falling back to the first `apps` object with app children.
fn find_apps(root: &Node) -> Option<&Node> {
    const PATH: [&str; 5] = ["UserLocalConfigStore", "Software", "Valve", "Steam", "apps"];
    (0..PATH.len()).find_map(|skip| walk(root, &PATH[skip..])).or_else(|| {
        find_object(root, "apps", 0).filter(|node| {
            node.entries.iter().any(|(key, value)| matches!(value, Value::Obj(_)) && !key.is_empty() && key.bytes().all(|b| b.is_ascii_digit()))
        })
    })
}

/// Every app in `apps` with a readable `Playtime`, in app id order.
fn parse_apps(text: &str) -> BTreeMap<u32, AppPlaytime> {
    let root = parse_text_vdf(text);
    let Some(apps) = find_apps(&root) else { return BTreeMap::new() };
    let mut out = BTreeMap::new();
    for (key, value) in &apps.entries {
        let (Ok(appid), Value::Obj(app)) = (key.trim().parse::<u32>(), value) else { continue };
        let Some(minutes) = app.number("Playtime") else { continue };
        out.insert(appid, AppPlaytime { minutes, last_played: app.number("LastPlayed").unwrap_or(0) });
    }
    out
}

// ---------------------------------------------------------------------------
// The import itself
// ---------------------------------------------------------------------------

use playtime_import::Plan;
#[cfg(test)]
type PlanRow = playtime::HistoricCredit;

/// Decides what one import changes, through the planner every playtime source shares. Steam apps
/// are matched by app id (the identity key is the id as text).
///
/// `tracked` maps game id -> seconds Mochi already has; `now` dates apps Steam never stamped.
fn plan(apps: &BTreeMap<u32, AppPlaytime>, targets: &[Target], tracked: &HashMap<String, u64>, now: u64) -> Plan {
    let entries: Vec<playtime_import::Entry> = apps.iter()
        .map(|(appid, steam)| playtime_import::Entry { keys: vec![appid.to_string()], minutes: steam.minutes, last_played: steam.last_played })
        .collect();
    let matches: Vec<playtime_import::Match> = targets.iter()
        .map(|target| playtime_import::Match { keys: vec![target.appid.to_string()], game_id: target.game_id.clone(), name: target.name.clone() })
        .collect();
    playtime_import::plan(&entries, &matches, tracked, now)
}

/// Steam's `localconfig.vdf` for one account, from any of the given installs (capped and read
/// leniently, like the other Steam text files). The discovered account's folder wins; when
/// `loginusers.vdf` and the `userdata` folders disagree, any other account's file is read.
fn localconfig(roots: &[PathBuf], account: u32) -> Option<String> {
    let read = |root: &Path, user: &str| sources::read(&root.join("userdata").join(user).join("config/localconfig.vdf"));
    let preferred = account.to_string();
    for root in roots {
        if let Some(text) = read(root, &preferred) { return Some(text); }
        let Ok(entries) = fs::read_dir(root.join("userdata")) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let Some(user) = name.to_str().filter(|name| !name.is_empty() && name.bytes().all(|byte| byte.is_ascii_digit())) else { continue };
            if user != preferred { if let Some(text) = read(root, user) { return Some(text); } }
        }
    }
    None
}

/// Reads Steam's saved playtime for the signed-in account and adds whatever Mochi is missing for
/// every `target`. Idempotent: each game only ever receives the difference between Steam's total
/// and the total Mochi already tracks. Apps outside the library are counted, not an error.
pub fn import(targets: &[Target]) -> Result<ImportResult, String> {
    const NO_PLAYTIME: &str = "Steam has no saved playtime for this account on this device.";
    let home = platform::home_dir().ok_or("Mochi could not find your home folder.")?;
    let roots = sources::steam_install_roots(&home);
    let steam_id = steam_achievements::find_steam_id(&roots)
        .ok_or("Mochi could not find a signed-in Steam account on this device. Sign in to Steam once, then try again.")?;
    let account = steam_achievements::account_id(&steam_id).ok_or("Mochi could not read this device's Steam account.")?;
    let apps = localconfig(&roots, account).map(|text| parse_apps(&text)).unwrap_or_default();
    if apps.is_empty() { return Err(NO_PLAYTIME.into()); }
    let tracked: HashMap<String, u64> = playtime::list()?.into_iter().map(|entry| (entry.game_id, entry.seconds)).collect();
    let steps = plan(&apps, targets, &tracked, util::now_secs());
    playtime::record_historics(&steps.rows)?;
    Ok(ImportResult { imported: steps.rows.len() as u32, unchanged: steps.unchanged, unmapped: steps.unmapped })
}

#[cfg(test)]
mod tests {
    use super::*;
    const LOCALCONFIG: &str = include_str!("../fixtures/localconfig.vdf");

    fn target(appid: u32, game_id: &str, name: &str) -> Target { Target { appid, game_id: game_id.into(), name: name.into() } }

    fn targets() -> Vec<Target> {
        vec![target(220, "steam:220", "Half-Life 2"), target(400, "steam:400", "Portal"), target(620, "steam:620", "Portal 2")]
    }

    fn tracked(entries: &[(&str, u64)]) -> HashMap<String, u64> {
        entries.iter().map(|(id, seconds)| (id.to_string(), *seconds)).collect()
    }

    /// What `playtime::record_historics` would do to the totals (the tracker itself is global
    /// state and deliberately untested here).
    fn apply(rows: &[PlanRow], totals: &mut HashMap<String, u64>) {
        for row in rows { *totals.entry(row.game_id.clone()).or_default() += row.seconds; }
    }

    #[test]
    fn parses_the_localconfig_fixture() {
        let apps = parse_apps(LOCALCONFIG);
        assert_eq!(apps.len(), 4);
        assert_eq!(apps[&220], AppPlaytime { minutes: 1500, last_played: 1_700_000_000 });
        assert_eq!(apps[&400], AppPlaytime { minutes: 10, last_played: 0 });
        assert_eq!(apps[&620], AppPlaytime { minutes: 240, last_played: 1_650_000_000 });
        assert_eq!(apps[&999999], AppPlaytime { minutes: 42, last_played: 1_600_000_000 });
    }

    #[test]
    fn adds_only_the_missing_part_and_counts_unmapped_apps() {
        let apps = parse_apps(LOCALCONFIG);
        let now = 1_700_000_100u64;
        // Mochi already has 1 h of Half-Life 2 and more Portal 2 time than Steam knows about.
        let steps = plan(&apps, &targets(), &tracked(&[("steam:220", 3_600), ("steam:620", 20_000)]), now);
        assert_eq!(steps.rows.len(), 2);
        // 1500 minutes of Steam playtime minus the 3600 s already tracked, dated by LastPlayed.
        assert_eq!(steps.rows[0], PlanRow { game_id: "steam:220".into(), name: "Half-Life 2".into(), seconds: 86_400, at: 1_700_000_000 });
        // No LastPlayed: the import is dated now, and 10 minutes become 600 seconds.
        assert_eq!(steps.rows[1], PlanRow { game_id: "steam:400".into(), name: "Portal".into(), seconds: 600, at: now });
        // Portal 2: Mochi already tracks more than Steam's 240 minutes, so no row.
        assert_eq!(steps.unchanged, 1);
        assert_eq!(steps.unmapped, 1);
    }

    #[test]
    fn already_tracked_playtime_never_goes_backwards() {
        let apps = parse_apps(LOCALCONFIG);
        // Every mapped game is already at (or ahead of) Steam's total.
        let steps = plan(&apps, &targets(), &tracked(&[("steam:220", 90_000), ("steam:400", 600), ("steam:620", 50_000)]), 1);
        assert!(steps.rows.is_empty());
        assert_eq!(steps.unchanged, 3);
        assert_eq!(steps.unmapped, 1);
    }

    #[test]
    fn a_second_import_adds_nothing() {
        let apps = parse_apps(LOCALCONFIG);
        let targets = targets();
        let mut totals = tracked(&[("steam:220", 3_600), ("steam:620", 14_400)]);
        let first = plan(&apps, &targets, &totals, 1_700_000_100);
        assert_eq!(first.rows.len(), 2);
        apply(&first.rows, &mut totals);
        assert_eq!(totals["steam:220"], 90_000);
        assert_eq!(totals["steam:400"], 600);
        let second = plan(&apps, &targets, &totals, 1_700_000_100);
        assert!(second.rows.is_empty());
        assert_eq!(second.unchanged, 3);
        assert_eq!(second.unmapped, 1);
    }

    #[test]
    fn tolerates_missing_keys_and_other_nesting() {
        assert!(parse_apps("").is_empty());
        assert!(parse_apps("garbage").is_empty());
        assert!(parse_apps("\"UserLocalConfigStore\" { \"Software\" { \"Valve\" { \"Steam\" { } } } }").is_empty());
        // An app without Playtime, with a non-numeric Playtime, or under a non-numeric key.
        assert!(parse_apps("\"apps\" { \"not-a-number\" { \"Playtime\" \"5\" } \"220\" { \"Playtime\" \"soon\" } \"221\" { \"LastPlayed\" \"7\" } }").is_empty());
        let app = "\"220\" { \"Playtime\" \"5\" \"LastPlayed\" \"7\" }";
        // The file may start one level down, at the apps object itself, or somewhere unexpected.
        for root in [
            format!("\"Software\" {{ \"Valve\" {{ \"Steam\" {{ \"apps\" {{ {app} }} }} }} }}"),
            format!("\"apps\" {{ {app} }}"),
            format!("\"SomethingElse\" {{ \"nested\" {{ \"apps\" {{ {app} }} }} }}"),
        ] {
            let apps = parse_apps(&root);
            assert_eq!(apps.get(&220), Some(&AppPlaytime { minutes: 5, last_played: 7 }), "{root}");
        }
        // A file cut short (a crash mid-write) keeps the apps it had fully read.
        let mut torn = LOCALCONFIG.to_string();
        torn.truncate(torn.find("\"620\"").expect("620 is in the fixture"));
        let torn = parse_apps(&torn);
        assert!(torn.contains_key(&220) && torn.contains_key(&400));
        assert!(!torn.contains_key(&620) && !torn.contains_key(&999999));
    }

    #[test]
    fn localconfig_comes_from_the_discovered_account_then_any_other() {
        use crate::sources::testutil::temp_dir;
        let root = temp_dir("localconfig");
        assert!(localconfig(std::slice::from_ref(&root), 456).is_none());
        let config = root.join("userdata/456/config");
        fs::create_dir_all(&config).expect("config dir");
        fs::create_dir_all(root.join("userdata/anonymous")).expect("stray folder");
        fs::write(config.join("localconfig.vdf"), LOCALCONFIG).expect("write fixture");
        // The account found in loginusers.vdf is read directly...
        assert_eq!(localconfig(std::slice::from_ref(&root), 456).as_deref(), Some(LOCALCONFIG));
        // ...and any other account's folder still works when the two disagree.
        assert_eq!(localconfig(std::slice::from_ref(&root), 123).as_deref(), Some(LOCALCONFIG));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn tokenizer_handles_comments_escapes_and_unquoted_tokens() {
        let root = parse_text_vdf("// leading comment\n\"outer\"\n{\n\t\"say\" \"line \\\"quoted\\\"\" // trailing comment\n\tunquoted value\t\"n\" \"42\"\n}\n");
        let outer = root.object("outer").expect("outer object");
        assert_eq!(outer.text("say"), Some("line \"quoted\""));
        assert_eq!(outer.text("unquoted"), Some("value"));
        assert_eq!(outer.number("n"), Some(42));
        // A path-like bare token keeps its slashes; only `//` at a token start is a comment.
        let tree = parse_text_vdf("\"a\" { \"path\" \"some//where\" }");
        let object = tree.object("a").expect("a object");
        assert_eq!(object.text("path"), Some("some//where"));
    }
}
