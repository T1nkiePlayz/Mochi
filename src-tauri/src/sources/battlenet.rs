//! Battle.net games, read from the Blizzard agent's `product.db` (a protobuf file): on macOS in
//! `/Users/Shared/Battle.net/Agent`, on Linux inside the Wine prefixes Battle.net was installed into
//! (Lutris, Bottles, Heroic, plain `~/.wine`). Only the few fields Mochi needs are decoded.

use super::{encode, make, percent_decode, sort_games, ImportedGame};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

const MAX_PRODUCT_DB_BYTES: u64 = 4 * 1024 * 1024;
/// `product.db` relative to a Wine prefix.
pub const PREFIX_PRODUCT_DB: &str = "drive_c/ProgramData/Battle.net/Agent/product.db";
/// The Battle.net client inside a Wine prefix, newest location first.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub const PREFIX_CLIENTS: [&str; 2] = ["drive_c/Program Files (x86)/Battle.net/Battle.net.exe", "drive_c/Program Files/Battle.net/Battle.net.exe"];

/// Agent uids that are Blizzard's own tools, not games.
const NOT_GAMES: [&str; 4] = ["agent", "bna", "battle.net", "catalogs"];

/// Battle.net uid -> (launch code for `battlenet://` / `--exec="launch CODE"`, display name).
const KNOWN: [(&str, &str, &str); 19] = [
    ("wow", "WoW", "World of Warcraft"),
    ("wow_classic", "WoWC", "World of Warcraft Classic"),
    ("wow_classic_era", "WoWC", "World of Warcraft Classic Era"),
    ("diablo3", "D3", "Diablo III"),
    ("osi", "OSI", "Diablo II: Resurrected"),
    ("fenris", "Fen", "Diablo IV"),
    ("anbs", "ANBS", "Diablo Immortal"),
    ("prometheus", "Pro", "Overwatch 2"),
    ("hs_beta", "WTCG", "Hearthstone"),
    ("heroes", "Hero", "Heroes of the Storm"),
    ("s2", "S2", "StarCraft II"),
    ("s1", "S1", "StarCraft: Remastered"),
    ("w3", "W3", "Warcraft III: Reforged"),
    ("odin", "ODIN", "Call of Duty: Modern Warfare"),
    ("viper", "VIPR", "Call of Duty: Black Ops 4"),
    ("zeus", "ZEUS", "Call of Duty: Black Ops Cold War"),
    ("fore", "FORE", "Call of Duty: Vanguard"),
    ("lazarus", "LAZR", "Call of Duty: Modern Warfare 2 Campaign Remastered"),
    ("rtro", "RTRO", "Blizzard Arcade Collection"),
];

/// One installed product from `product.db`.
#[derive(Debug, PartialEq, Eq)]
pub struct Product {
    pub uid: String,
    pub code: String,
    pub install_path: String,
    pub installed: bool,
}

// ---------------------------------------------------------------------------
// Minimal protobuf reading: varints and length-delimited fields are all product.db needs.
// ---------------------------------------------------------------------------

fn varint(bytes: &[u8], at: &mut usize) -> Option<u64> {
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *bytes.get(*at)?;
        *at += 1;
        value |= u64::from(byte & 0x7f) << shift;
        if byte & 0x80 == 0 { return Some(value); }
    }
    None
}

enum Field<'a> { Varint(u64), Bytes(&'a [u8]) }

/// The (field number, value) pairs of one message; stops at the first malformed field.
fn fields(bytes: &[u8]) -> Vec<(u64, Field<'_>)> {
    let mut out = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        let Some(key) = varint(bytes, &mut at) else { break };
        let value = match key & 7 {
            0 => match varint(bytes, &mut at) { Some(value) => Field::Varint(value), None => break },
            2 => {
                let Some(length) = varint(bytes, &mut at).and_then(|length| usize::try_from(length).ok()) else { break };
                let Some(slice) = at.checked_add(length).and_then(|end| bytes.get(at..end)) else { break };
                at += length;
                Field::Bytes(slice)
            }
            1 => { at += 8; if at > bytes.len() { break } continue; }
            5 => { at += 4; if at > bytes.len() { break } continue; }
            _ => break,
        };
        out.push((key >> 3, value));
    }
    out
}

fn text(fields: &[(u64, Field<'_>)], number: u64) -> Option<String> {
    fields.iter().find_map(|(n, value)| match value { Field::Bytes(bytes) if *n == number => std::str::from_utf8(bytes).ok().map(str::to_owned), _ => None })
}

fn message<'a>(fields: &[(u64, Field<'a>)], number: u64) -> Option<&'a [u8]> {
    fields.iter().find_map(|(n, value)| match value { Field::Bytes(bytes) if *n == number => Some(*bytes), _ => None })
}

/// `Database.product_install` (1) -> `ProductInstall { uid = 1, product_code = 2, settings = 3 { install_path = 1 },
/// cached_product_state = 4 { base_product_state = 1 { installed = 1 } } }`.
pub fn parse_product_db(bytes: &[u8]) -> Vec<Product> {
    fields(bytes).into_iter().filter_map(|(number, value)| match value { Field::Bytes(install) if number == 1 => Some(install), _ => None })
        .filter_map(|install| {
            let install = fields(install);
            let uid = text(&install, 1)?;
            let code = text(&install, 2).unwrap_or_else(|| uid.clone());
            let install_path = message(&install, 3).map(fields).and_then(|settings| text(&settings, 1)).unwrap_or_default();
            let installed = message(&install, 4).map(fields).and_then(|state| message(&state, 1).map(fields))
                .and_then(|base| base.iter().find_map(|(n, value)| match value { Field::Varint(v) if *n == 1 => Some(*v != 0), _ => None }))
                .unwrap_or(false);
            Some(Product { uid, code, install_path, installed })
        }).collect()
}

fn read_product_db(path: &Path) -> Vec<Product> {
    let mut bytes = Vec::new();
    match fs::File::open(path) {
        Ok(file) if (&file).take(MAX_PRODUCT_DB_BYTES).read_to_end(&mut bytes).is_ok() => parse_product_db(&bytes),
        _ => Vec::new(),
    }
}

fn known(uid: &str) -> Option<(&'static str, &'static str)> {
    KNOWN.iter().find(|(id, _, _)| id.eq_ignore_ascii_case(uid)).map(|(_, code, name)| (*code, *name))
}

/// A launch code safe to put in a URL or a Battle.net command line.
fn launch_code(product: &Product) -> Option<String> {
    let code = known(&product.uid).map(|(code, _)| code.to_owned()).unwrap_or_else(|| product.code.clone());
    (!code.is_empty() && code.len() <= 32 && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')).then_some(code)
}

fn display_name(product: &Product, install: &Path) -> String {
    known(&product.uid).map(|(_, name)| name.to_owned())
        .or_else(|| install.file_name().map(|name| name.to_string_lossy().into_owned()))
        .unwrap_or_else(|| product.uid.clone())
}

/// Where a Windows path (`C:/Program Files (x86)/Game`, `C:\Games\X`) lives inside a Wine prefix.
pub fn wine_path(prefix: &Path, windows: &str) -> Option<PathBuf> {
    let normal = windows.replace('\\', "/");
    let rest = normal.strip_prefix("C:/").or_else(|| normal.strip_prefix("c:/"))?;
    if rest.split('/').any(|part| part == "..") { return None; }
    Some(prefix.join("drive_c").join(rest))
}

/// Games from one `product.db`. `prefix` is the Wine prefix on Linux, `None` on macOS (native paths).
pub fn games_from(products: Vec<Product>, prefix: Option<&Path>) -> Vec<ImportedGame> {
    products.into_iter().filter(|product| product.installed && !NOT_GAMES.contains(&product.uid.to_ascii_lowercase().as_str()))
        .filter_map(|product| {
            let code = launch_code(&product)?;
            let install = match prefix { Some(prefix) => wine_path(prefix, &product.install_path)?, None => PathBuf::from(&product.install_path) };
            if !install.is_dir() { return None; }
            let name = display_name(&product, &install);
            let target = match prefix {
                Some(prefix) => wine_target(prefix, &code)?,
                None => format!("battlenet://{code}"),
            };
            let id = match prefix { Some(prefix) => format!("battlenet:{}:{}", encode(&prefix.to_string_lossy()), product.uid), None => format!("battlenet:{}", product.uid) };
            Some(make(id, name, "battlenet", target, install.to_str().map(str::to_owned)))
        }).collect()
}

/// `battlenet-wine://<percent-encoded prefix>/<launch code>`: Battle.net in that prefix, told to launch the game.
pub fn wine_target(prefix: &Path, code: &str) -> Option<String> { Some(format!("battlenet-wine://{}/{code}", encode(prefix.to_str()?))) }

/// The prefix and launch code of a `battlenet-wine://` target; the prefix must be an absolute folder path.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn parse_wine_target(target: &str) -> Option<(PathBuf, String)> {
    let (prefix, code) = target.strip_prefix("battlenet-wine://")?.rsplit_once('/')?;
    let prefix = PathBuf::from(percent_decode(prefix)?);
    let valid_code = !code.is_empty() && code.len() <= 32 && code.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_');
    (prefix.is_absolute() && valid_code && !prefix.components().any(|part| matches!(part, std::path::Component::ParentDir))).then(|| (prefix, code.to_owned()))
}

/// Battle.net games in each Wine prefix that has a `product.db`.
#[cfg_attr(not(target_os = "linux"), allow(dead_code))]
pub fn scan_prefixes(prefixes: &[PathBuf]) -> Vec<ImportedGame> {
    let mut seen = std::collections::HashSet::new();
    let games = prefixes.iter().flat_map(|prefix| games_from(read_product_db(&prefix.join(PREFIX_PRODUCT_DB)), Some(prefix)))
        .filter(|game| seen.insert(game.id.clone())).collect();
    sort_games(games)
}

/// macOS: the native agent database.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn scan_native(product_db: &Path) -> Vec<ImportedGame> { sort_games(games_from(read_product_db(product_db), None)) }

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::sources::testutil::temp_dir;

    fn tag(number: u64, wire: u64) -> Vec<u8> { encode_varint((number << 3) | wire) }
    fn encode_varint(mut value: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop { let byte = (value & 0x7f) as u8; value >>= 7; if value == 0 { out.push(byte); return out; } out.push(byte | 0x80); }
    }
    fn bytes(number: u64, data: &[u8]) -> Vec<u8> { [tag(number, 2), encode_varint(data.len() as u64), data.to_vec()].concat() }
    fn flag(number: u64, value: bool) -> Vec<u8> { [tag(number, 0), vec![u8::from(value)]].concat() }

    /// A `ProductInstall` message as the agent writes it (plus unrelated fields to skip).
    pub fn product(uid: &str, code: &str, path: &str, installed: bool) -> Vec<u8> {
        let settings = [bytes(1, path.as_bytes()), bytes(2, b"EU"), [tag(9, 5), vec![0, 0, 0, 0]].concat()].concat();
        let base = [flag(1, installed), flag(2, installed), bytes(7, b"1.2.3")].concat();
        let state = bytes(1, &base);
        bytes(1, &[bytes(1, uid.as_bytes()), bytes(2, code.as_bytes()), bytes(3, &settings), bytes(4, &state), [tag(6, 1), vec![0; 8]].concat()].concat())
    }

    #[test]
    fn product_db_is_decoded() {
        let db = [product("wow", "wow", "C:/Program Files (x86)/World of Warcraft", true), product("agent", "agent", "C:/x", true), bytes(2, b"handshake"), product("s2", "s2", "", false)].concat();
        let products = parse_product_db(&db);
        assert_eq!(products.len(), 3);
        assert_eq!(products[0], Product { uid: "wow".into(), code: "wow".into(), install_path: "C:/Program Files (x86)/World of Warcraft".into(), installed: true });
        assert!(!products[2].installed);
        // Truncated or garbage input never panics.
        for cut in 0..db.len() { let _ = parse_product_db(&db[..cut]); }
        assert!(parse_product_db(&[0xff; 12]).is_empty());
    }

    #[test]
    fn wine_prefix_games_are_listed_with_their_launch_codes() {
        let prefix = temp_dir("bnet-prefix");
        fs::create_dir_all(prefix.join("drive_c/Program Files (x86)/World of Warcraft")).unwrap();
        fs::create_dir_all(prefix.join("drive_c/Games/Mystery Game")).unwrap();
        let db = [
            product("wow", "wow", "C:/Program Files (x86)/World of Warcraft", true),
            product("newgame", "newgame", "C:\\Games\\Mystery Game", true),
            product("osi", "osi", "C:/Program Files (x86)/Diablo II Resurrected", true),
            product("agent", "agent", "C:/Program Files (x86)/World of Warcraft", true),
            product("evil", "x;rm", "C:/Games/Mystery Game", true),
        ].concat();
        fs::create_dir_all(prefix.join("drive_c/ProgramData/Battle.net/Agent")).unwrap();
        fs::write(prefix.join(PREFIX_PRODUCT_DB), db).unwrap();
        let games = scan_prefixes(std::slice::from_ref(&prefix));
        let summary: Vec<_> = games.iter().map(|game| game.name.as_str()).collect();
        assert_eq!(summary, ["Mystery Game", "World of Warcraft"]);
        let wow = &games[1];
        assert_eq!(parse_wine_target(&wow.launch_target), Some((prefix.clone(), "WoW".into())));
        assert!(wow.install_path.as_deref().unwrap().ends_with("drive_c/Program Files (x86)/World of Warcraft"));
        assert!(games[0].launch_target.ends_with("/newgame"));
        let _ = fs::remove_dir_all(prefix);
    }

    #[test]
    fn macos_games_use_battlenet_urls() {
        let dir = temp_dir("bnet-mac");
        let game = dir.join("Applications/Hearthstone");
        fs::create_dir_all(&game).unwrap();
        fs::write(dir.join("product.db"), product("hs_beta", "hs_beta", game.to_str().unwrap(), true)).unwrap();
        let games = scan_native(&dir.join("product.db"));
        assert_eq!((games[0].name.as_str(), games[0].launch_target.as_str()), ("Hearthstone", "battlenet://WTCG"));
        assert!(scan_native(&dir.join("missing.db")).is_empty());
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn wine_paths_and_targets_are_validated() {
        let prefix = Path::new("/home/me/Games/battlenet");
        assert_eq!(wine_path(prefix, "C:\\Program Files (x86)\\Diablo IV"), Some(prefix.join("drive_c/Program Files (x86)/Diablo IV")));
        assert_eq!(wine_path(prefix, "D:/Games/x"), None);
        assert_eq!(wine_path(prefix, "C:/../../etc"), None);
        assert_eq!(parse_wine_target("battlenet-wine://relative/WoW"), None);
        assert_eq!(parse_wine_target("battlenet-wine://%2Fa%2F..%2Fb/WoW"), None);
        assert_eq!(parse_wine_target("battlenet-wine://%2Fa/Wo W"), None);
        assert_eq!(parse_wine_target("battlenet-wine://%2Fhome%2Fme%2Fp/D3"), Some((PathBuf::from("/home/me/p"), "D3".into())));
    }
}
