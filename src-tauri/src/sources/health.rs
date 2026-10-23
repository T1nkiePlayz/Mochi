//! Scanner health: records which launcher files a scan looked at and which of them could not be
//! read or parsed, so a format change shows up as a problem instead of as "no games".
//!
//! Scanners report through the thread-local collector below; it is only active between
//! `collect` calls, so scanners called directly (tests, manual scans) record nothing.

use serde::Serialize;
use std::{cell::RefCell, collections::{BTreeMap, BTreeSet}, path::Path};

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Debug)]
#[serde(rename_all = "snake_case")]
pub enum HealthStatus {
    Ok,
    NotInstalled,
    Empty,
    Partial,
    ParseError,
}

#[derive(Clone, Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileFailure {
    pub path: String,
    pub reason: String,
}

#[derive(Clone, Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SourceHealth {
    pub id: String,
    pub name: String,
    pub status: HealthStatus,
    pub files_examined: usize,
    pub failures: Vec<FileFailure>,
    pub game_count: usize,
}

/// What one scan looked at.
#[derive(Default, Debug)]
pub struct Collector {
    examined: BTreeSet<String>,
    failed: BTreeMap<String, String>,
}

thread_local! { static CURRENT: RefCell<Option<Collector>> = const { RefCell::new(None) }; }

/// Runs `scan` with a collector active on this thread and returns it with the scan's result.
pub fn collect<T>(scan: impl FnOnce() -> T) -> (T, Collector) {
    let previous = CURRENT.with(|current| current.replace(Some(Collector::default())));
    let result = scan();
    let collector = CURRENT.with(|current| current.replace(previous)).unwrap_or_default();
    (result, collector)
}

fn with(f: impl FnOnce(&mut Collector)) { CURRENT.with(|current| { if let Some(collector) = current.borrow_mut().as_mut() { f(collector); } }); }

/// A data file the scanner opened (whether or not it turned out to be readable).
pub fn examined(path: &Path) { with(|c| { c.examined.insert(path.to_string_lossy().into_owned()); }); }

/// A data file that exists but could not be read or understood. Keeps the first reason per file.
pub fn failed(path: &Path, reason: impl Into<String>) {
    with(|c| {
        let key = path.to_string_lossy().into_owned();
        c.examined.insert(key.clone());
        c.failed.entry(key).or_insert_with(|| short(reason.into()));
    });
}

fn short(mut reason: String) -> String {
    reason = reason.replace('\n', " ");
    if reason.chars().count() > 160 { reason = reason.chars().take(160).collect::<String>() + "…"; }
    reason
}

/// Derives the status. `installed`: the launcher (or its data folder) exists on this machine.
pub fn status(collector: &Collector, games: usize, installed: bool) -> HealthStatus {
    let failed = collector.failed.len();
    let readable = collector.examined.len() - failed;
    if failed > 0 && readable == 0 { HealthStatus::ParseError }
    else if failed > 0 { HealthStatus::Partial }
    else if games > 0 { HealthStatus::Ok }
    else if installed || !collector.examined.is_empty() { HealthStatus::Empty }
    else { HealthStatus::NotInstalled }
}

/// Builds the report entry; `home` is replaced by `~` in every path.
pub fn report(id: &str, name: &str, collector: &Collector, games: usize, installed: bool, home: &Path) -> SourceHealth {
    let strip = |text: &str| { let home = home.to_string_lossy(); if home.len() > 1 { text.replace(home.as_ref(), "~") } else { text.to_owned() } };
    SourceHealth {
        id: id.into(),
        name: name.into(),
        status: status(collector, games, installed),
        files_examined: collector.examined.len(),
        failures: collector.failed.iter().map(|(path, reason)| FileFailure { path: strip(path), reason: strip(reason) }).collect(),
        game_count: games,
    }
}

#[cfg(test)]
impl Collector {
    pub fn failed_paths(&self) -> Vec<&str> { self.failed.keys().map(String::as_str).collect() }
}
