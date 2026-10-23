//! Imports playtime other launchers already recorded (Heroic, Lutris, GOG Galaxy) into Mochi's
//! tracker, next to the Steam import. Every source is reduced to the same shape (`Entry`) and goes
//! through one planner (`plan`), which Steam uses too: a game only ever receives the difference
//! between the imported total and what Mochi already tracks, as one historic row dated by the
//! source's last-played time. Running an import twice therefore adds nothing.
//!
//! Games are matched by store identity, never by name. The UI sends one `Match` per library game
//! with the identity keys it can derive (`heroic:<appName>`, `lutris:<id>`, `gog:<id>`).
//!
//! Heroic's `store/timestamp.json` is `{ "<appName>": { firstPlayed, lastPlayed, totalPlayed } }`
//! with `totalPlayed` in MINUTES and ISO dates. Lutris' `games.playtime` is HOURS (a float) and
//! `lastplayed` unix seconds. Galaxy's `GameTimes.minutesInGame` is MINUTES. Both SQLite files are
//! copied to a temp folder first so a running launcher's locks and journal are never touched.
//! Everything is parsed defensively: unreadable data simply means nothing to import.

use crate::steam_playtime::ImportResult;
use crate::{platform, playtime, sources, util};
use rusqlite::{Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const GALAXY_DB: &str = "/Users/Shared/GOG.com/Galaxy/Storage/galaxy-2.0.db";

/// One library game that can receive imported playtime, with every store identity it has.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Match {
    pub keys: Vec<String>,
    pub game_id: String,
    pub name: String,
}

/// One game's playtime as a source recorded it; `keys` are its store identities.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub keys: Vec<String>,
    pub minutes: u64,
    /// Unix seconds; 0 when the source has no timestamp.
    pub last_played: u64,
}

/// One row of the preview: a library game and the minutes an import would add.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PreviewRow {
    pub game_id: String,
    pub name: String,
    pub minutes: u64,
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Plan {
    pub rows: Vec<playtime::HistoricCredit>,
    pub unchanged: u32,
    pub unmapped: u32,
}

/// Decides what one import changes. Pure, so the delta maths, the unmapped count and idempotency
/// are unit tested without touching the tracker.
///
/// `tracked` maps game id -> seconds Mochi already has; `now` dates entries without a timestamp.
/// A library game receives at most one row per run, from the first entry that maps to it.
pub fn plan(entries: &[Entry], targets: &[Match], tracked: &HashMap<String, u64>, now: u64) -> Plan {
    let mut by_key: HashMap<&str, &Match> = HashMap::new();
    for target in targets { for key in &target.keys { by_key.entry(key.as_str()).or_insert(target); } }
    let mut plan = Plan::default();
    let mut claimed: HashSet<&str> = HashSet::new();
    for entry in entries {
        let Some(target) = entry.keys.iter().find_map(|key| by_key.get(key.as_str())) else {
            // Playtime no Mochi game maps to is only counted, never an error.
            if entry.minutes > 0 { plan.unmapped += 1; }
            continue;
        };
        if !claimed.insert(target.game_id.as_str()) { continue; }
        let imported = entry.minutes.saturating_mul(60);
        let already = tracked.get(&target.game_id).copied().unwrap_or(0);
        // Only the missing part is recorded, as a single historic session. When Mochi already
        // tracks at least as much nothing is added, which also makes a second import a no-op.
        let delta = imported.saturating_sub(already);
        if delta > 0 {
            let at = if entry.last_played > 0 { entry.last_played } else { now };
            plan.rows.push(playtime::HistoricCredit { game_id: target.game_id.clone(), name: target.name.clone(), seconds: delta, at });
        } else {
            plan.unchanged += 1;
        }
    }
    plan
}

// ---------------------------------------------------------------------------
// Timestamps
// ---------------------------------------------------------------------------

/// Unix seconds for `YYYY-MM-DD[T| ]HH:MM:SS...` (any fraction or zone suffix is ignored).
fn iso_to_secs(text: &str) -> Option<u64> {
    let text = text.trim();
    if !text.is_ascii() || text.len() < 10 { return None; }
    let num = |range: std::ops::Range<usize>| text.get(range)?.parse::<i64>().ok();
    let (year, month, day) = (num(0..4)?, num(5..7)?, num(8..10)?);
    if text.as_bytes()[4] != b'-' || text.as_bytes()[7] != b'-' || !(1..=12).contains(&month) || !(1..=31).contains(&day) { return None; }
    let time = if text.len() >= 19 && matches!(text.as_bytes()[10], b'T' | b' ') { (num(11..13)?, num(14..16)?, num(17..19)?) } else { (0, 0, 0) };
    // Days since 1970-01-01 (civil-from-days inverse).
    let y = if month <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (if month > 2 { month - 3 } else { month + 9 }) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    u64::try_from(days * 86_400 + time.0 * 3_600 + time.1 * 60 + time.2).ok()
}

/// A timestamp as a number (seconds, or milliseconds when implausibly large) or an ISO string.
fn timestamp(value: Option<&Value>) -> u64 {
    let from_number = |n: u64| if n > 100_000_000_000 { n / 1_000 } else { n };
    match value {
        Some(Value::Number(n)) => n.as_f64().filter(|f| *f > 0.0).map(|f| from_number(f as u64)).unwrap_or(0),
        Some(Value::String(text)) => text.trim().parse::<u64>().map(from_number).ok().or_else(|| iso_to_secs(text)).unwrap_or(0),
        _ => 0,
    }
}

fn minutes_of(value: Option<&Value>) -> Option<u64> {
    let number = match value? { Value::Number(n) => n.as_f64()?, Value::String(text) => text.trim().parse::<f64>().ok()?, _ => return None };
    (number.is_finite() && number > 0.0).then(|| number.round() as u64)
}

// ---------------------------------------------------------------------------
// Heroic
// ---------------------------------------------------------------------------

/// Entries of one `timestamp.json`. A game Heroic launched through the GOG store has its GOG id as
/// `appName`, so it also carries the `gog:` identity that Galaxy and GOG installs use.
fn parse_heroic(text: &str) -> Vec<Entry> {
    let Ok(Value::Object(games)) = serde_json::from_str::<Value>(text) else { return Vec::new() };
    games.iter().filter_map(|(app, value)| {
        let minutes = minutes_of(value.get("totalPlayed"))?;
        let last = timestamp(value.get("lastPlayed"));
        let last_played = if last > 0 { last } else { timestamp(value.get("firstPlayed")) };
        Some(Entry { keys: vec![format!("heroic:{app}"), format!("gog:{app}")], minutes, last_played })
    }).collect()
}

fn heroic_entries(roots: &[PathBuf]) -> Vec<Entry> {
    roots.iter().filter_map(|root| sources::read(&root.join("store/timestamp.json"))).flat_map(|text| parse_heroic(&text)).collect()
}

fn heroic_present(roots: &[PathBuf]) -> bool { roots.iter().any(|root| root.join("store/timestamp.json").is_file()) }

// ---------------------------------------------------------------------------
// SQLite sources
// ---------------------------------------------------------------------------

/// Opens a private copy of a launcher's database (plus its write-ahead log) and hands it to `read`.
fn with_copy<T>(db: &Path, read: impl FnOnce(&Connection) -> Option<T>) -> Option<T> {
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("mochi-playtime-{}-{nanos}", std::process::id()));
    fs::create_dir_all(&dir).ok()?;
    let result = (|| {
        let copy = dir.join("db.sqlite");
        fs::copy(db, &copy).ok()?;
        let mut wal = db.as_os_str().to_owned();
        wal.push("-wal");
        if Path::new(&wal).is_file() { let _ = fs::copy(&wal, dir.join("db.sqlite-wal")); }
        let connection = Connection::open_with_flags(&copy, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX).ok()?;
        read(&connection)
    })();
    let _ = fs::remove_dir_all(&dir);
    result
}

fn lutris_dbs(home: &Path) -> Vec<PathBuf> {
    let data = std::env::var_os("XDG_DATA_HOME").map(PathBuf::from).filter(|dir| dir.is_absolute()).unwrap_or_else(|| home.join(".local/share"));
    vec![data.join("lutris/pga.db"), home.join(".var/app/net.lutris.Lutris/data/lutris/pga.db")]
}

/// `games(id, slug, playtime hours, lastplayed secs)`; matched by numeric id or slug.
fn read_lutris(db: &Path) -> Vec<Entry> {
    with_copy(db, |conn| {
        let mut statement = conn.prepare("SELECT id, slug, playtime, lastplayed FROM games WHERE playtime > 0").ok()?;
        let rows = statement.query_map([], |row| {
            let id: Option<i64> = row.get(0).ok();
            let slug: Option<String> = row.get(1).ok();
            let hours: f64 = row.get(2).unwrap_or(0.0);
            let last: Option<i64> = row.get(3).ok();
            Ok((id, slug, hours, last))
        }).ok()?;
        let mut out = Vec::new();
        for (id, slug, hours, last) in rows.flatten() {
            let minutes = (hours * 60.0).round();
            if !minutes.is_finite() || minutes < 1.0 { continue; }
            let keys: Vec<String> = id.map(|id| format!("lutris:{id}")).into_iter().chain(slug.filter(|s| !s.is_empty()).map(|s| format!("lutris:{s}"))).collect();
            if keys.is_empty() { continue; }
            out.push(Entry { keys, minutes: minutes as u64, last_played: last.and_then(|n| u64::try_from(n).ok()).map(|n| timestamp(Some(&Value::from(n)))).unwrap_or(0) });
        }
        Some(out)
    }).unwrap_or_default()
}

/// `GameTimes(releaseKey, minutesInGame)` joined with `LastPlayedDates(gameReleaseKey, lastPlayedDate)`.
/// Only `gog_<id>` release keys are read; other stores' keys are not GOG games.
fn read_galaxy(db: &Path) -> Vec<Entry> {
    with_copy(db, |conn| {
        let mut last: HashMap<String, u64> = HashMap::new();
        if let Ok(mut statement) = conn.prepare("SELECT gameReleaseKey, lastPlayedDate FROM LastPlayedDates") {
            if let Ok(rows) = statement.query_map([], |row| {
                let key: String = row.get(0)?;
                let value: rusqlite::types::Value = row.get(1)?;
                Ok((key, value))
            }) {
                for (key, value) in rows.flatten() {
                    let json = match value { rusqlite::types::Value::Integer(n) => Value::from(n), rusqlite::types::Value::Real(f) => Value::from(f), rusqlite::types::Value::Text(t) => Value::from(t), _ => continue };
                    last.insert(key, timestamp(Some(&json)));
                }
            }
        }
        let mut statement = conn.prepare("SELECT releaseKey, minutesInGame FROM GameTimes").ok()?;
        let rows = statement.query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<i64>>(1)?.unwrap_or(0)))).ok()?;
        let mut out = Vec::new();
        for (key, minutes) in rows.flatten() {
            let Some(id) = key.strip_prefix("gog_").filter(|id| !id.is_empty()) else { continue };
            if minutes <= 0 { continue; }
            out.push(Entry { keys: vec![format!("gog:{id}")], minutes: minutes as u64, last_played: last.get(&key).copied().unwrap_or(0) });
        }
        Some(out)
    }).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Sources whose playtime data exists on this device (the UI only offers these).
pub fn detected_sources() -> Vec<String> {
    let Some(home) = platform::home_dir() else { return Vec::new() };
    let mut out = Vec::new();
    if heroic_present(&sources::heroic_roots(&home)) { out.push("heroic".to_owned()); }
    if lutris_dbs(&home).iter().any(|db| db.is_file()) { out.push("lutris".to_owned()); }
    if Path::new(GALAXY_DB).is_file() { out.push("gog".to_owned()); }
    out
}

fn entries_for(source: &str) -> Result<Vec<Entry>, String> {
    let home = platform::home_dir().ok_or("Mochi could not find your home folder.")?;
    let entries = match source {
        "heroic" => heroic_entries(&sources::heroic_roots(&home)),
        "lutris" => lutris_dbs(&home).iter().filter(|db| db.is_file()).flat_map(|db| read_lutris(db)).collect(),
        "gog" => if Path::new(GALAXY_DB).is_file() { read_galaxy(Path::new(GALAXY_DB)) } else { Vec::new() },
        _ => return Err("That playtime source is not supported.".into()),
    };
    if entries.is_empty() { return Err("No saved playtime was found for that source on this device.".into()); }
    Ok(entries)
}

fn planned(source: &str, targets: &[Match]) -> Result<Plan, String> {
    let entries = entries_for(source)?;
    let tracked: HashMap<String, u64> = playtime::list()?.into_iter().map(|entry| (entry.game_id, entry.seconds)).collect();
    Ok(plan(&entries, targets, &tracked, util::now_secs()))
}

/// What an import from `source` would add, per game (minutes, rounded up so short sessions show).
pub fn preview(source: &str, targets: &[Match]) -> Result<Vec<PreviewRow>, String> {
    Ok(planned(source, targets)?.rows.into_iter().map(|row| PreviewRow { game_id: row.game_id, name: row.name, minutes: row.seconds.div_ceil(60) }).collect())
}

/// Adds what Mochi is missing from `source`. Idempotent: a second run reports zero imported.
pub fn import(source: &str, targets: &[Match]) -> Result<ImportResult, String> {
    let steps = planned(source, targets)?;
    playtime::record_historics(&steps.rows)?;
    Ok(ImportResult { imported: steps.rows.len() as u32, unchanged: steps.unchanged, unmapped: steps.unmapped })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;
    const HEROIC: &str = include_str!("../fixtures/heroic_timestamp.json");

    fn m(keys: &[&str], game_id: &str, name: &str) -> Match { Match { keys: keys.iter().map(|k| k.to_string()).collect(), game_id: game_id.into(), name: name.into() } }
    fn tracked(entries: &[(&str, u64)]) -> HashMap<String, u64> { entries.iter().map(|(id, s)| (id.to_string(), *s)).collect() }

    #[test]
    fn parses_iso_and_numeric_timestamps() {
        assert_eq!(iso_to_secs("1970-01-02T00:00:00.000Z"), Some(86_400));
        assert_eq!(iso_to_secs("2023-11-14T22:13:20.000Z"), Some(1_700_000_000));
        assert_eq!(iso_to_secs("2023-11-14 22:13:20+0000"), Some(1_700_000_000));
        assert_eq!(iso_to_secs("2000-02-29"), Some(951_782_400));
        assert_eq!(iso_to_secs("nope"), None);
        assert_eq!(timestamp(Some(&Value::from(1_700_000_000_000u64))), 1_700_000_000);
        assert_eq!(timestamp(Some(&Value::from("1700000000"))), 1_700_000_000);
        assert_eq!(timestamp(None), 0);
    }

    #[test]
    fn parses_the_heroic_fixture_tolerantly() {
        let entries = parse_heroic(HEROIC);
        let get = |app: &str| entries.iter().find(|e| e.keys[0] == format!("heroic:{app}")).unwrap_or_else(|| panic!("{app}"));
        assert_eq!(get("Fortnite").minutes, 90);
        assert_eq!(get("Fortnite").last_played, 1_700_000_000);
        assert_eq!(get("1207658924").minutes, 125); // 124.6 rounds
        assert_eq!(get("1207658924").last_played, 1_600_000_000); // lastPlayed missing: firstPlayed
        assert_eq!(get("sideload1").minutes, 15); // numeric string
        assert!(entries.iter().all(|e| !e.keys[0].contains("broken") && !e.keys[0].contains("empty")));
        assert!(parse_heroic("").is_empty() && parse_heroic("[]").is_empty() && parse_heroic("garbage").is_empty());
    }

    #[test]
    fn heroic_reads_every_root() {
        let root = temp_dir("heroic");
        let missing = root.join("none");
        fs::create_dir_all(root.join("store")).expect("store");
        fs::write(root.join("store/timestamp.json"), HEROIC).expect("write");
        assert!(heroic_present(&[missing.clone(), root.clone()]));
        assert!(!heroic_present(std::slice::from_ref(&missing)));
        assert_eq!(heroic_entries(&[missing, root.clone()]).len(), 3);
        let _ = fs::remove_dir_all(&root);
    }

    fn make_db(path: &Path, sql: &str) {
        let conn = Connection::open(path).expect("open");
        conn.execute_batch(sql).expect("schema");
    }

    #[test]
    fn reads_lutris_playtime_hours_from_a_copy() {
        let dir = temp_dir("lutris");
        let db = dir.join("pga.db");
        make_db(&db, "CREATE TABLE games (id INTEGER PRIMARY KEY, slug TEXT, name TEXT, playtime REAL, lastplayed INTEGER);
            INSERT INTO games VALUES (3, 'hades', 'Hades', 2.5, 1700000000), (4, 'unplayed', 'Unplayed', 0, NULL), (5, 'nolast', 'No Last', 0.25, NULL), (6, NULL, 'Null slug', 1, 5);");
        let entries = read_lutris(&db);
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0], Entry { keys: vec!["lutris:3".into(), "lutris:hades".into()], minutes: 150, last_played: 1_700_000_000 });
        assert_eq!(entries[1].minutes, 15);
        assert_eq!(entries[1].last_played, 0);
        assert_eq!(entries[2].keys, vec!["lutris:6".to_string()]);
        // A database without the table, or a file that is not SQLite, means nothing to import.
        let other = dir.join("other.db");
        make_db(&other, "CREATE TABLE x (a)");
        assert!(read_lutris(&other).is_empty());
        let junk = dir.join("junk.db");
        fs::write(&junk, "not sqlite").expect("junk");
        assert!(read_lutris(&junk).is_empty() && read_lutris(&dir.join("absent.db")).is_empty());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn reads_gog_galaxy_game_times() {
        let dir = temp_dir("galaxy");
        let db = dir.join("galaxy-2.0.db");
        make_db(&db, "CREATE TABLE GameTimes (userId INTEGER, releaseKey TEXT, minutesInGame INTEGER);
            CREATE TABLE LastPlayedDates (gameReleaseKey TEXT, lastPlayedDate TEXT);
            INSERT INTO GameTimes VALUES (1, 'gog_1207658924', 300), (1, 'steam_220', 50), (1, 'gog_55', 0), (1, 'gog_77', 10);
            INSERT INTO LastPlayedDates VALUES ('gog_1207658924', '2023-11-14T22:13:20+0000'), ('steam_220', '2020-01-01T00:00:00');");
        let entries = read_galaxy(&db);
        assert_eq!(entries, vec![
            Entry { keys: vec!["gog:1207658924".into()], minutes: 300, last_played: 1_700_000_000 },
            Entry { keys: vec!["gog:77".into()], minutes: 10, last_played: 0 },
        ]);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn plan_matches_by_identity_and_adds_only_the_missing_part() {
        let entries = vec![
            Entry { keys: vec!["lutris:3".into(), "lutris:hades".into()], minutes: 150, last_played: 1_700_000_000 },
            Entry { keys: vec!["lutris:9".into()], minutes: 20, last_played: 0 },
            Entry { keys: vec!["lutris:10".into()], minutes: 5, last_played: 0 },
            Entry { keys: vec!["lutris:11".into()], minutes: 0, last_played: 0 },
        ];
        let targets = [m(&["lutris:hades"], "g-hades", "Hades"), m(&["lutris:9"], "g-nine", "Nine"), m(&["other"], "g-other", "Other")];
        let steps = plan(&entries, &targets, &tracked(&[("g-hades", 3_600), ("g-nine", 99_999)]), 42);
        assert_eq!(steps.rows, vec![playtime::HistoricCredit { game_id: "g-hades".into(), name: "Hades".into(), seconds: 5_400, at: 1_700_000_000 }]);
        assert_eq!((steps.unchanged, steps.unmapped), (1, 1));
        // A game that maps from two entries is credited once per run.
        let twice = [Entry { keys: vec!["a".into()], minutes: 1, last_played: 0 }, Entry { keys: vec!["b".into()], minutes: 2, last_played: 0 }];
        assert_eq!(plan(&twice, &[m(&["a", "b"], "g", "G")], &HashMap::new(), 1).rows.len(), 1);
    }

    #[test]
    fn a_second_import_adds_nothing() {
        let entries = parse_heroic(HEROIC);
        let targets = [m(&["heroic:Fortnite"], "heroic:legendary:Fortnite", "Fortnite"), m(&["gog:1207658924"], "gog:1207658924", "Witcher")];
        let mut totals = tracked(&[("heroic:legendary:Fortnite", 600)]);
        let first = plan(&entries, &targets, &totals, 5);
        assert_eq!(first.rows.len(), 2);
        for row in &first.rows { *totals.entry(row.game_id.clone()).or_default() += row.seconds; }
        assert_eq!(totals["heroic:legendary:Fortnite"], 5_400);
        assert_eq!(totals["gog:1207658924"], 125 * 60);
        let second = plan(&entries, &targets, &totals, 5);
        assert!(second.rows.is_empty());
        assert_eq!((second.unchanged, second.unmapped), (2, 1));
    }
}
