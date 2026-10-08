//! Helpers shared by several modules (one copy each, with tests): clock, hex, id validation,
//! poison-tolerant locking, atomic file writes and the HTTP client/download helpers.

pub mod fsio;
pub mod http;

use std::{
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or_default()
}

/// Seconds since the Unix epoch of `time` (0 for times before it).
pub fn epoch_secs(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH).unwrap_or_default().as_secs()
}

/// Lowercase hex of `bytes` (digests, cache file names).
pub fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[usize::from(byte >> 4)] as char);
        out.push(DIGITS[usize::from(byte & 0x0f)] as char);
    }
    out
}

/// Non-empty, at most `max` bytes, only ASCII letters, digits, `-` and `_`: safe as a file name segment.
pub fn valid_id(id: &str, max: usize) -> bool {
    !id.is_empty() && id.len() <= max && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Runs blocking work (file I/O, hashing, image decoding) on the blocking pool so it never stalls an async worker.
pub async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work).await.map_err(|error| error.to_string())
}

/// Locking that survives a panic in another holder: the guarded data in this app is plain state that
/// stays usable, and refusing it forever would disable the feature for the rest of the session.
pub trait MutexExt<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T>;
}

impl<T> MutexExt<T> for Mutex<T> {
    fn lock_recover(&self) -> MutexGuard<'_, T> {
        self.lock().unwrap_or_else(std::sync::PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_matches_the_format_macro() {
        let bytes: Vec<u8> = (0..=255).collect();
        let expected: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(hex(&bytes), expected);
        assert_eq!(hex(&[]), "");
    }

    #[test]
    fn ids_are_restricted() {
        assert!(valid_id("a-B_9", 80));
        assert!(!valid_id("", 80));
        assert!(!valid_id("a b", 80));
        assert!(!valid_id("../x", 80));
        assert!(!valid_id("é", 80));
        assert!(valid_id(&"a".repeat(80), 80));
        assert!(!valid_id(&"a".repeat(81), 80));
    }

    #[test]
    fn a_poisoned_lock_is_still_usable() {
        let lock = std::sync::Arc::new(Mutex::new(1));
        let other = lock.clone();
        let _ = std::thread::spawn(move || { let _guard = other.lock().unwrap(); panic!("poison it"); }).join();
        assert!(lock.is_poisoned());
        *lock.lock_recover() += 1;
        assert_eq!(*lock.lock_recover(), 2);
    }

    #[test]
    fn blocking_returns_the_value_and_reports_panics() {
        assert_eq!(tauri::async_runtime::block_on(blocking(|| 7)).unwrap(), 7);
        assert!(tauri::async_runtime::block_on(blocking(|| -> u8 { panic!("boom") })).is_err());
    }

    #[test]
    fn clock_helpers_agree() {
        assert!(now_ms() / 1000 >= now_secs().saturating_sub(1));
        assert_eq!(epoch_secs(UNIX_EPOCH), 0);
    }
}
