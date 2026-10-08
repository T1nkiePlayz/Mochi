//! One place for HTTP client construction and bounded body reads.
//!
//! Every client shares the same transport defaults (gzip, keep-alive, pooled connections) and is
//! created once per purpose, so TLS sessions and connections are reused across requests.

use std::{sync::OnceLock, time::Duration};

/// A client builder with the transport settings every Mochi client shares.
pub fn builder() -> reqwest::ClientBuilder {
    reqwest::Client::builder()
        .gzip(true)
        .tcp_keepalive(Duration::from_secs(30))
        .pool_idle_timeout(Duration::from_secs(60))
        .pool_max_idle_per_host(4)
}

/// A lazily built, process-wide client. A failed build is remembered and reported on every use.
pub struct SharedClient(OnceLock<Result<reqwest::Client, String>>);

impl SharedClient {
    pub const fn new() -> Self { Self(OnceLock::new()) }

    pub fn get(&self, build: impl FnOnce() -> Result<reqwest::Client, reqwest::Error>, failure: &str) -> Result<&reqwest::Client, String> {
        self.0.get_or_init(|| build().map_err(|error| format!("{failure}: {error}"))).as_ref().map_err(Clone::clone)
    }
}

#[derive(Debug)]
pub enum BodyError {
    TooLarge,
    Network(reqwest::Error),
}

/// Reads a response body while enforcing `max` bytes: a chunked response has no Content-Length and
/// must not be buffered without limit.
pub async fn read_capped(response: &mut reqwest::Response, max: usize) -> Result<Vec<u8>, BodyError> {
    if response.content_length().is_some_and(|length| length > max as u64) { return Err(BodyError::TooLarge); }
    let mut body = Vec::with_capacity(response.content_length().map_or(0, |length| length as usize).min(max).min(1 << 20));
    while let Some(chunk) = response.chunk().await.map_err(BodyError::Network)? {
        if body.len() + chunk.len() > max { return Err(BodyError::TooLarge); }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};

    /// Serves `body` once over plain HTTP on a loopback port.
    fn serve(body: Vec<u8>, chunked: bool) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0u8; 1024];
            let _ = stream.read(&mut request);
            let mut out = Vec::new();
            if chunked {
                out.extend_from_slice(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
                for part in body.chunks(7) { out.extend_from_slice(format!("{:x}\r\n", part.len()).as_bytes()); out.extend_from_slice(part); out.extend_from_slice(b"\r\n"); }
                out.extend_from_slice(b"0\r\n\r\n");
            } else {
                out.extend_from_slice(format!("HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", body.len()).as_bytes());
                out.extend_from_slice(&body);
            }
            let _ = stream.write_all(&out);
        });
        port
    }

    fn fetch(body: &[u8], chunked: bool, max: usize) -> Result<Vec<u8>, BodyError> {
        let port = serve(body.to_vec(), chunked);
        tauri::async_runtime::block_on(async move {
            let client = builder().no_proxy().build().unwrap();
            let mut response = client.get(format!("http://127.0.0.1:{port}/")).send().await.unwrap();
            read_capped(&mut response, max).await
        })
    }

    #[test]
    fn reads_bodies_within_the_cap() {
        assert_eq!(fetch(b"hello world", false, 11).unwrap(), b"hello world");
        assert_eq!(fetch(b"hello world", true, 11).unwrap(), b"hello world");
    }

    #[test]
    fn rejects_bodies_over_the_cap_with_or_without_content_length() {
        assert!(matches!(fetch(b"hello world", false, 10), Err(BodyError::TooLarge)));
        assert!(matches!(fetch(b"hello world", true, 10), Err(BodyError::TooLarge)));
    }

    #[test]
    fn shared_client_builds_once_and_remembers_failure() {
        static OK: SharedClient = SharedClient::new();
        let first = OK.get(|| builder().build(), "x").unwrap() as *const reqwest::Client;
        let second = OK.get(|| panic!("must not rebuild"), "x").unwrap() as *const reqwest::Client;
        assert_eq!(first, second);
    }
}
