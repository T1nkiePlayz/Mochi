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
}
