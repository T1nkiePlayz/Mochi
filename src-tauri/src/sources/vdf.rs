//! Minimal readers for the two Valve file formats Mochi needs.

use std::collections::HashMap;

/// Reads `"key"  "value"` from one line of a text VDF/ACF file.
pub fn quoted_value(line: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\"");
    let rest = line.trim().strip_prefix(&marker)?.trim().strip_prefix('"')?;
    let mut value = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return Some(value),
            '\\' => match chars.next()? { 'n' => value.push('\n'), 't' => value.push('\t'), other => value.push(other) },
            other => value.push(other),
        }
    }
    None
}

/// Folder paths listed in `libraryfolders.vdf`: `"path"` entries (current format) or numbered
/// entries whose value is an absolute path (older format: `"1"  "/mnt/games/Steam"`).
pub fn library_paths(text: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for line in text.lines() {
        let mut parts = line.trim().splitn(2, char::is_whitespace);
        let (Some(key), Some(rest)) = (parts.next(), parts.next()) else { continue };
        let key = key.trim_matches('"');
        let numbered = !key.is_empty() && key.bytes().all(|b| b.is_ascii_digit());
        if key != "path" && !numbered { continue; }
        if let Some(value) = quoted_value(&format!("\"{key}\" {}", rest.trim()), key) {
            if value.starts_with('/') && !paths.contains(&value) { paths.push(value); }
        }
    }
    paths
}

#[derive(Default)]
struct Node {
    strings: HashMap<String, String>,
    ints: HashMap<String, i32>,
    objects: Vec<(String, Node)>,
}

fn cstring(data: &[u8], start: usize) -> Option<(String, usize)> {
    let end = start + data.get(start..)?.iter().position(|&b| b == 0)?;
    Some((String::from_utf8_lossy(&data[start..end]).into_owned(), end + 1))
}

fn parse_object(data: &[u8], mut pos: usize, depth: usize) -> Option<(Node, usize)> {
    if depth > 16 { return None; }
    let mut node = Node::default();
    while pos < data.len() {
        let kind = data[pos];
        pos += 1;
        if kind == 0x08 { return Some((node, pos)); }
        let (key, next) = cstring(data, pos)?;
        pos = next;
        match kind {
            0x00 => { let (child, next) = parse_object(data, pos, depth + 1)?; pos = next; node.objects.push((key, child)); }
            0x01 => { let (value, next) = cstring(data, pos)?; pos = next; node.strings.insert(key, value); }
            0x02 => {
                let bytes: [u8; 4] = data.get(pos..pos + 4)?.try_into().ok()?;
                pos += 4;
                node.ints.insert(key, i32::from_le_bytes(bytes));
            }
            _ => return None,
        }
    }
    Some((node, pos))
}

pub struct Shortcut {
    pub app_id: u32,
    pub name: String,
    pub exe: Option<String>,
    pub start_dir: Option<String>,
}

/// Parses `userdata/<id>/config/shortcuts.vdf` (binary VDF).
pub fn parse_shortcuts(data: &[u8]) -> Vec<Shortcut> {
    let Some((root, _)) = parse_object(data, 0, 0) else { return Vec::new() };
    let Some((_, shortcuts)) = root.objects.iter().find(|(key, _)| key.eq_ignore_ascii_case("shortcuts")) else { return Vec::new() };
    shortcuts.objects.iter().filter_map(|(_, shortcut)| {
        let get = |a: &str, b: &str| shortcut.strings.get(a).or_else(|| shortcut.strings.get(b)).cloned();
        let name = get("AppName", "appname").filter(|name| !name.trim().is_empty())?;
        let app_id = shortcut.ints.get("appid").map(|id| *id as u32).or_else(|| shortcut.strings.get("appid").and_then(|id| id.parse().ok()))?;
        Some(Shortcut { app_id, name, exe: get("Exe", "exe"), start_dir: get("StartDir", "startdir") })
    }).collect()
}

/// An order-preserving binary VDF value, so a file can be read, extended and written back unchanged.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Map(Vec<(String, Value)>),
    Str(String),
    Int(i32),
}

impl Value {
    pub fn get(&self, key: &str) -> Option<&Value> {
        match self { Value::Map(items) => items.iter().find(|(k, _)| k.eq_ignore_ascii_case(key)).map(|(_, v)| v), _ => None }
    }
    pub fn as_str(&self) -> Option<&str> { match self { Value::Str(s) => Some(s), _ => None } }
}

fn parse_map(data: &[u8], mut pos: usize, depth: usize) -> Option<(Vec<(String, Value)>, usize)> {
    if depth > 16 { return None; }
    let mut items = Vec::new();
    while pos < data.len() {
        let kind = data[pos];
        pos += 1;
        if kind == 0x08 { return Some((items, pos)); }
        let (key, next) = cstring(data, pos)?;
        pos = next;
        let value = match kind {
            0x00 => { let (children, next) = parse_map(data, pos, depth + 1)?; pos = next; Value::Map(children) }
            0x01 => { let (text, next) = cstring(data, pos)?; pos = next; Value::Str(text) }
            0x02 => { let bytes: [u8; 4] = data.get(pos..pos + 4)?.try_into().ok()?; pos += 4; Value::Int(i32::from_le_bytes(bytes)) }
            // Other value types (floats, 64-bit ints, ...) are not used by shortcuts.vdf; refuse rather than drop them.
            _ => return None,
        };
        items.push((key, value));
    }
    // A map without its end marker is truncated.
    None
}

/// Parses a whole binary VDF file into its top-level map. Strict: a truncated or unknown file is `None`.
pub fn parse_tree(data: &[u8]) -> Option<Vec<(String, Value)>> {
    let (items, end) = parse_map(data, 0, 0)?;
    (end == data.len()).then_some(items)
}

fn write_map(out: &mut Vec<u8>, items: &[(String, Value)]) {
    for (key, value) in items {
        match value {
            Value::Map(children) => { out.push(0x00); out.extend(key.bytes().filter(|&b| b != 0)); out.push(0); write_map(out, children); }
            Value::Str(text) => { out.push(0x01); out.extend(key.bytes().filter(|&b| b != 0)); out.push(0); out.extend(text.bytes().filter(|&b| b != 0)); out.push(0); }
            Value::Int(number) => { out.push(0x02); out.extend(key.bytes().filter(|&b| b != 0)); out.push(0); out.extend(number.to_le_bytes()); }
        }
    }
    out.push(0x08);
}

/// Serialises a tree the way Steam does (each map ends with `0x08`, the root map included).
pub fn write_tree(items: &[(String, Value)]) -> Vec<u8> {
    let mut out = Vec::new();
    write_map(&mut out, items);
    out
}

/// Steam's id for a non-Steam shortcut: CRC-32 of the quoted exe followed by the name, high bit set.
pub fn shortcut_app_id(exe: &str, name: &str) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for byte in exe.bytes().chain(name.bytes()) {
        crc ^= u32::from(byte);
        for _ in 0..8 { crc = if crc & 1 != 0 { (crc >> 1) ^ 0xEDB8_8320 } else { crc >> 1 }; }
    }
    (!crc) | 0x8000_0000
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_quoted_values() {
        assert_eq!(quoted_value("\t\"name\"\t\t\"Half-Life 2\"", "name").as_deref(), Some("Half-Life 2"));
        assert_eq!(quoted_value("\"path\"\t\"C:\\\\Games\"", "path").as_deref(), Some("C:\\Games"));
        assert_eq!(quoted_value("\"appid\"\t\"220\"", "name"), None);
    }

    #[test]
    fn parses_shortcuts() {
        let mut data = vec![0u8];
        data.extend(b"shortcuts\0");
        data.push(0);
        data.extend(b"0\0");
        data.extend([2]); data.extend(b"appid\0"); data.extend((-1_000_000i32).to_le_bytes());
        data.extend([1]); data.extend(b"AppName\0Cool Game\0");
        data.extend([8, 8, 8]);
        let shortcuts = parse_shortcuts(&data);
        assert_eq!(shortcuts.len(), 1);
        assert_eq!(shortcuts[0].name, "Cool Game");
        assert_eq!(shortcuts[0].app_id, (-1_000_000i32) as u32);
    }

    fn sample_bytes() -> Vec<u8> {
        let mut data = vec![0u8];
        data.extend(b"shortcuts\0");
        data.push(0);
        data.extend(b"0\0");
        data.push(2); data.extend(b"appid\0"); data.extend((-1_000_000i32).to_le_bytes());
        data.push(1); data.extend(b"AppName\0Cool Game\0");
        data.push(0); data.extend(b"tags\0"); data.push(8);
        data.extend([8, 8, 8]);
        data
    }

    #[test]
    fn tree_round_trips_byte_for_byte() {
        let bytes = sample_bytes();
        let tree = parse_tree(&bytes).expect("parses");
        assert_eq!(write_tree(&tree), bytes);
        assert_eq!(parse_tree(&write_tree(&tree)), Some(tree));
    }

    #[test]
    fn tree_rejects_truncated_and_unknown_data() {
        let bytes = sample_bytes();
        assert!(parse_tree(&bytes[..bytes.len() - 3]).is_none());
        assert!(parse_tree(&[0, b'a', 0, 7, b'x', 0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8]).is_none());
    }

    #[test]
    fn crc_matches_the_standard_check_value_and_shortcut_ids_set_the_high_bit() {
        // CRC-32 of "123456789" is the published check value 0xCBF43926 (its high bit is already set).
        assert_eq!(shortcut_app_id("1234", "56789"), 0xCBF4_3926);
        // Cross-checked with Python's zlib.crc32(...) | 0x80000000.
        assert_eq!(shortcut_app_id("\"/usr/bin/xdg-open\"", "Test Game"), 0xD114_A57D);
        assert_eq!(shortcut_app_id("a", "b") & 0x8000_0000, 0x8000_0000);
    }
}
