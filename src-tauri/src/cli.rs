//! The `mochi` command line and `mochi://` links: `mochi launch <game>`, `mochi open <game>`, `mochi list`,
//! `mochi://launch/<id-or-name>`, `mochi://open/<id-or-name>`.
//!
//! Parsing is strict and pure: only these verbs are understood, queries are plain text (never passed to a
//! shell or executed), and anything else becomes `Intent::Unknown` and is ignored. The library lives in the
//! webview's storage, so Mochi mirrors it into `library-index.json` (see `write_library_index`); `list` and the
//! "game not found" exit code read that file. Launching always happens inside the app, through the normal path.
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const MAX_QUERY_CHARS: usize = 200;
const MAX_MATCHES: usize = 12;
const MAX_INDEX_ENTRIES: usize = 20_000;
pub const INDEX_FILE: &str = "library-index.json";
const APP_IDENTIFIER: &str = "dev.sidequestgames.Mochilauncher";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Intent {
    Launch { query: String },
    Open { query: String },
    List { json: bool },
    BigPicture,
    Help,
    Unknown,
}

/// Cleans a game query: URL-decoded by the caller, trimmed, non-empty, bounded, no control characters.
fn clean_query(raw: &str) -> Option<String> {
    let query = raw.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS || query.chars().any(char::is_control) { return None; }
    Some(query.to_string())
}

/// Decodes `%XX` escapes; invalid escapes or invalid UTF-8 reject the whole value.
fn percent_decode(input: &str) -> Option<String> {
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = input.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

pub fn is_mochi_url(arg: &str) -> bool { arg.len() >= 8 && arg[..8].eq_ignore_ascii_case("mochi://") }

/// `mochi://<verb>/<query>`. `auth` links belong to the sign-in flow and are not ours (`None`).
pub fn parse_url(url: &str) -> Option<Intent> {
    if !is_mochi_url(url) { return None; }
    let rest = &url[8..];
    let (verb, tail) = match rest.find(['/', '?', '#']) { Some(at) => (&rest[..at], &rest[at..]), None => (rest, "") };
    let verb = verb.to_ascii_lowercase();
    if verb == "auth" || verb == "nxm" { return None; }
    if verb == "bigpicture" { return Some(Intent::BigPicture); }
    let path = tail.strip_prefix('/').unwrap_or("");
    let path = path.split(['?', '#']).next().unwrap_or("").trim_end_matches('/');
    let query = percent_decode(path).and_then(|decoded| clean_query(&decoded));
    Some(match (verb.as_str(), query) {
        ("launch", Some(query)) => Intent::Launch { query },
        ("open", Some(query)) => Intent::Open { query },
        _ => Intent::Unknown,
    })
}

/// `mochi launch <game>`, `mochi open <game>`, `mochi list [--json]`, `mochi help`. `args` excludes the program name.
/// Plain starts and flag-only starts (`--big-picture`, `--autostart`) are not commands (`None`).
pub fn parse_subcommand(args: &[String]) -> Option<Intent> {
    let first = args.first()?.as_str();
    if first.starts_with('-') && first != "--help" && first != "-h" { return None; }
    // Anything that is not a plain word (another scheme's link, a file path) is not ours: the app just starts.
    if !first.chars().all(|c| c.is_ascii_alphabetic() || c == '-') { return None; }
    let rest = &args[1..];
    // A game name may be given as several words: `mochi launch Hollow Knight`.
    let query = || clean_query(&rest.join(" "));
    Some(match first.to_ascii_lowercase().as_str() {
        "launch" | "play" => query().map_or(Intent::Unknown, |query| Intent::Launch { query }),
        "open" => query().map_or(Intent::Unknown, |query| Intent::Open { query }),
        "list" => Intent::List { json: rest.iter().any(|arg| arg == "--json") },
        "help" | "--help" | "-h" => Intent::Help,
        _ => Intent::Unknown,
    })
}

/// The intent in a full `argv` (program name first): a `mochi://` link wins, then a subcommand.
pub fn parse_argv(argv: &[String]) -> Option<Intent> {
    let args = argv.get(1..)?;
    args.iter().find_map(|arg| parse_url(arg)).or_else(|| parse_subcommand(args))
}

/// Intents that have to reach the frontend. Links are excluded on purpose: the deep-link plugin
/// delivers those itself (also for a second instance), so forwarding them here would run them twice.
pub fn frontend_intent(argv: &[String]) -> Option<(&'static str, String)> {
    match parse_subcommand(argv.get(1..)?)? {
        Intent::Launch { query } => Some(("launch", query)),
        Intent::Open { query } => Some(("open", query)),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// Library index and matching
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IndexEntry {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub kind: String,
}

#[derive(Debug, PartialEq, Eq)]
pub enum Resolution<'a> {
    None,
    One(&'a IndexEntry),
    Many(Vec<&'a IndexEntry>),
}

/// Exact id, then exact name (ignoring case), then names starting with the query, then names containing it.
/// The first step with any hit decides: one hit launches, several are ambiguous. Mirrors `src/lib/cliIntent.ts`.
pub fn resolve<'a>(entries: &'a [IndexEntry], query: &str) -> Resolution<'a> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() { return Resolution::None; }
    let steps: [&dyn Fn(&IndexEntry) -> bool; 4] = [
        &|entry| entry.id == query.trim(),
        &|entry| entry.name.trim().to_lowercase() == needle,
        &|entry| entry.name.to_lowercase().starts_with(&needle),
        &|entry| entry.name.to_lowercase().contains(&needle),
    ];
    for step in steps {
        let mut hits: Vec<&IndexEntry> = entries.iter().filter(|entry| step(entry)).collect();
        match hits.len() {
            0 => continue,
            1 => return Resolution::One(hits[0]),
            _ => { hits.truncate(MAX_MATCHES); return Resolution::Many(hits); }
        }
    }
    Resolution::None
}

/// Where Mochi keeps its data, matching Tauri's `app_data_dir`, without needing the GUI.
fn data_dir(macos: bool, home: &Path, xdg_data_home: Option<PathBuf>) -> PathBuf {
    if macos { return home.join("Library/Application Support").join(APP_IDENTIFIER); }
    xdg_data_home.filter(|path| path.is_absolute()).unwrap_or_else(|| home.join(".local/share")).join(APP_IDENTIFIER)
}

fn index_path() -> Option<PathBuf> {
    let home = crate::platform::home_dir()?;
    Some(data_dir(cfg!(target_os = "macos"), &home, std::env::var_os("XDG_DATA_HOME").map(PathBuf::from)).join(INDEX_FILE))
}

fn read_index(path: &Path) -> Option<Vec<IndexEntry>> {
    serde_json::from_slice(&std::fs::read(path).ok()?).ok()
}

const USAGE: &str = "Usage:
  mochi launch <game>   Start a game from your library (id or name)
  mochi open <game>     Show a game's page in Mochi
  mochi list [--json]   List your library (as of the last time Mochi ran)
  mochi mochi://launch/<game>   The same, as a link
Exit codes: 0 ok, 2 game not found, 1 other problems.";

/// Handles the commands that must not start the app (`list`, `help`, a game that is not in the library).
/// Returns the exit code to quit with, or `None` to carry on starting (or forwarding to the running) Mochi.
pub fn run_early(argv: &[String]) -> Option<i32> { run_early_with(argv, index_path().as_deref(), &mut std::io::stdout(), &mut std::io::stderr()) }

fn run_early_with(argv: &[String], index: Option<&Path>, out: &mut dyn std::io::Write, err: &mut dyn std::io::Write) -> Option<i32> {
    let intent = parse_argv(argv)?;
    let entries = index.and_then(read_index);
    match intent {
        Intent::Help => { let _ = writeln!(out, "{USAGE}"); Some(0) }
        Intent::List { json } => {
            let Some(entries) = entries else { let _ = writeln!(err, "No library index yet: start Mochi once so it can write one."); return Some(1); };
            if json { let _ = writeln!(out, "{}", serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".into())); }
            else { for entry in &entries { let _ = writeln!(out, "{}\t{}", entry.id, entry.name.replace(['\t', '\n', '\r'], " ")); } }
            Some(0)
        }
        Intent::Launch { query } | Intent::Open { query } => {
            // Without an index (first run, or never written) the app decides; a known library can say no right away.
            let entries = entries?;
            match resolve(&entries, &query) {
                Resolution::None => { let _ = writeln!(err, "No game in your Mochi library matches \"{query}\"."); Some(2) }
                _ => None,
            }
        }
        // A link with an unknown verb is ignored (the app starts as usual); a mistyped command gets the usage text.
        Intent::Unknown if argv.iter().skip(1).any(|arg| is_mochi_url(arg)) => { let _ = writeln!(err, "Mochi ignored a link it does not understand."); None }
        Intent::Unknown => { let _ = writeln!(err, "Unrecognised Mochi command.\n{USAGE}"); Some(1) }
        Intent::BigPicture => None,
    }
}

/// `window.__MOCHI_CLI__`, read by the frontend once the library is ready (first start only).
pub fn boot_script(argv: &[String]) -> String {
    match frontend_intent(argv) {
        Some((kind, query)) => format!("window.__MOCHI_CLI__ = {};", serde_json::json!({ "kind": kind, "query": query })),
        None => String::new(),
    }
}

/// Writes the library index (called by the frontend after library changes). Skips the write when nothing changed.
pub fn save_index(dir: &Path, mut entries: Vec<IndexEntry>) -> Result<(), String> {
    entries.truncate(MAX_INDEX_ENTRIES);
    for entry in &mut entries { entry.name.truncate(entry.name.floor_char_boundary(MAX_QUERY_CHARS * 2)); }
    let bytes = serde_json::to_vec_pretty(&entries).map_err(|e| e.to_string())?;
    let path = dir.join(INDEX_FILE);
    if std::fs::read(&path).is_ok_and(|existing| existing == bytes) { return Ok(()); }
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    crate::util::fsio::write_atomic(&path, &bytes).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn args(items: &[&str]) -> Vec<String> { items.iter().map(|item| item.to_string()).collect() }
    fn entry(id: &str, name: &str) -> IndexEntry { IndexEntry { id: id.into(), name: name.into(), kind: "game".into() } }
    fn launch(query: &str) -> Intent { Intent::Launch { query: query.into() } }

    #[test]
    fn parses_links() {
        assert_eq!(parse_url("mochi://launch/abc-123"), Some(launch("abc-123")));
        assert_eq!(parse_url("mochi://launch/Hollow%20Knight/"), Some(launch("Hollow Knight")));
        assert_eq!(parse_url("MOCHI://Launch/x?y=1#z"), Some(launch("x")));
        assert_eq!(parse_url("mochi://open/Celeste"), Some(Intent::Open { query: "Celeste".into() }));
        assert_eq!(parse_url("mochi://bigpicture"), Some(Intent::BigPicture));
        assert_eq!(parse_url("mochi://auth/callback?code=1"), None);
        assert_eq!(parse_url("https://launch/x"), None);
    }

    #[test]
    fn rejects_unknown_verbs_and_bad_queries() {
        for url in ["mochi://run/calc", "mochi://launch", "mochi://launch/", "mochi://launch/%zz", "mochi://launch/%ff", "mochi://launch/a%00b", "mochi://launch/a%0Ab", "mochi://exec/rm"] {
            assert_eq!(parse_url(url), Some(Intent::Unknown), "{url}");
        }
        let long = format!("mochi://launch/{}", "a".repeat(MAX_QUERY_CHARS + 1));
        assert_eq!(parse_url(&long), Some(Intent::Unknown));
    }

    #[test]
    fn parses_subcommands() {
        assert_eq!(parse_subcommand(&args(&["launch", "Hollow", "Knight"])), Some(launch("Hollow Knight")));
        assert_eq!(parse_subcommand(&args(&["LAUNCH", "x"])), Some(launch("x")));
        assert_eq!(parse_subcommand(&args(&["open", "x"])), Some(Intent::Open { query: "x".into() }));
        assert_eq!(parse_subcommand(&args(&["list"])), Some(Intent::List { json: false }));
        assert_eq!(parse_subcommand(&args(&["list", "--json"])), Some(Intent::List { json: true }));
        assert_eq!(parse_subcommand(&args(&["launch"])), Some(Intent::Unknown));
        assert_eq!(parse_subcommand(&args(&["rm", "-rf", "/"])), Some(Intent::Unknown));
        assert_eq!(parse_subcommand(&args(&["--big-picture"])), None);
        assert_eq!(parse_subcommand(&args(&["--autostart"])), None);
        assert_eq!(parse_subcommand(&args(&["mochi://launch/x"])), None);
        assert_eq!(parse_subcommand(&args(&["nxm://a/mods/1"])), None);
        assert_eq!(parse_subcommand(&args(&["/tmp/file.txt"])), None);
        assert_eq!(parse_subcommand(&[]), None);
    }

    #[test]
    fn argv_prefers_links_and_forwards_only_commands() {
        assert_eq!(parse_argv(&args(&["mochi", "mochi://launch/x"])), Some(launch("x")));
        assert_eq!(parse_argv(&args(&["mochi"])), None);
        assert_eq!(frontend_intent(&args(&["mochi", "launch", "x"])), Some(("launch", "x".into())));
        assert_eq!(frontend_intent(&args(&["mochi", "mochi://launch/x"])), None);
        assert_eq!(frontend_intent(&args(&["mochi", "list"])), None);
        assert!(boot_script(&args(&["mochi", "--autostart"])).is_empty());
        assert!(boot_script(&args(&["mochi", "open", "a\"b"])).contains("\"kind\":\"open\""));
    }

    #[test]
    fn resolves_in_priority_order() {
        let library = vec![entry("1", "Celeste"), entry("celeste-2", "Celeste Classic"), entry("3", "Hollow Knight"), entry("4", "Knight Club"), entry("5", "Hades")];
        assert_eq!(resolve(&library, "celeste-2"), Resolution::One(&library[1]));
        assert_eq!(resolve(&library, "celeste"), Resolution::One(&library[0]));
        assert_eq!(resolve(&library, "HADES"), Resolution::One(&library[4]));
        assert_eq!(resolve(&library, "hol"), Resolution::One(&library[2]));
        assert_eq!(resolve(&library, "cel"), Resolution::Many(vec![&library[0], &library[1]]));
        assert_eq!(resolve(&library, "knight"), Resolution::One(&library[3]));
        assert_eq!(resolve(&library, "night"), Resolution::Many(vec![&library[2], &library[3]]));
        assert_eq!(resolve(&library, "zelda"), Resolution::None);
        assert_eq!(resolve(&library, "  "), Resolution::None);
    }

    #[test]
    fn data_dir_matches_tauri() {
        let home = Path::new("/home/a");
        assert_eq!(data_dir(false, home, None), PathBuf::from("/home/a/.local/share/dev.sidequestgames.Mochilauncher"));
        assert_eq!(data_dir(false, home, Some("/x".into())), PathBuf::from("/x/dev.sidequestgames.Mochilauncher"));
        assert_eq!(data_dir(false, home, Some("rel".into())), PathBuf::from("/home/a/.local/share/dev.sidequestgames.Mochilauncher"));
        assert_eq!(data_dir(true, home, None), PathBuf::from("/home/a/Library/Application Support/dev.sidequestgames.Mochilauncher"));
    }

    #[test]
    fn early_commands_use_the_index() {
        let dir = std::env::temp_dir().join(format!("mochi-cli-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let path = dir.join(INDEX_FILE);
        let run = |items: &[&str], index: Option<&Path>| {
            let (mut out, mut err) = (Vec::new(), Vec::new());
            let code = run_early_with(&args(items), index, &mut out, &mut err);
            (code, String::from_utf8(out).unwrap(), String::from_utf8(err).unwrap())
        };
        assert_eq!(run(&["mochi", "list"], Some(&path)).0, Some(1));
        assert_eq!(run(&["mochi", "launch", "x"], Some(&path)).0, None);
        save_index(&dir, vec![entry("a", "Alpha"), entry("b", "Be\tta")]).unwrap();
        save_index(&dir, vec![entry("a", "Alpha"), entry("b", "Be\tta")]).unwrap();
        assert_eq!(run(&["mochi", "list"], Some(&path)), (Some(0), "a\tAlpha\nb\tBe ta\n".into(), String::new()));
        assert!(run(&["mochi", "list", "--json"], Some(&path)).1.contains("\"id\": \"a\""));
        assert_eq!(run(&["mochi", "launch", "alp"], Some(&path)).0, None);
        assert_eq!(run(&["mochi", "mochi://open/zzz"], Some(&path)).0, Some(2));
        assert_eq!(run(&["mochi", "frobnicate"], Some(&path)).0, Some(1));
        assert_eq!(run(&["mochi"], Some(&path)).0, None);
        assert_eq!(run(&["mochi", "mochi://run/x"], Some(&path)).0, None);
        assert_eq!(run(&["mochi", "nxm://game/mods/1"], Some(&path)).0, None);
        assert_eq!(run(&["mochi", "--help"], None).0, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
