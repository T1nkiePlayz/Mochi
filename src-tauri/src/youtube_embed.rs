//! Minimal loopback page for YouTube embeds in packaged Tauri builds.
//!
//! YouTube error 153 occurs when the embedded player has no HTTP Referer.
//! The app's custom Tauri origin does not provide one on Linux, so serve only
//! a tiny, validated embed document from a loopback HTTP origin. Mochi's main
//! window remains on Tauri's trusted origin and retains its IPC bridge.

use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
};

pub struct EmbedServerPort(pub u16);

pub fn start() -> std::io::Result<u16> {
    let listener = TcpListener::bind(("127.0.0.1", 0))?;
    let port = listener.local_addr()?.port();

    thread::Builder::new()
        .name("mochi-youtube-embed".into())
        .spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let _ = stream.set_read_timeout(Some(std::time::Duration::from_secs(2)));
                thread::spawn(move || {
                    let mut request = [0_u8; 2048];
                    let Ok(read) = stream.read(&mut request) else { return };
                    let line = String::from_utf8_lossy(&request[..read]);
                    let Some(path) = line.lines().next().and_then(|line| line.split_whitespace().nth(1)) else {
                        return;
                    };

                    let Some(id) = path.strip_prefix("/embed/") else {
                        respond(&mut stream, "404 Not Found", "text/plain; charset=utf-8", "Not found");
                        return;
                    };
                    if id.len() < 6 || id.len() > 20 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
                        respond(&mut stream, "400 Bad Request", "text/plain; charset=utf-8", "Invalid video id");
                        return;
                    }

                    let html = format!(r#"<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin-when-cross-origin">
<style>html,body,iframe{{width:100%;height:100%;margin:0;border:0;background:#000;overflow:hidden}}</style></head>
<body><iframe src="https://www.youtube.com/embed/{id}?controls=1&playsinline=1&autoplay=1"
title="Game trailer" referrerpolicy="strict-origin-when-cross-origin"
allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></body></html>"#);
                    respond(&mut stream, "200 OK", "text/html; charset=utf-8", &html);
                });
            }
        })?;
    Ok(port)
}

fn respond(stream: &mut std::net::TcpStream, status: &str, content_type: &str, body: &str) {
    let headers = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nX-Content-Type-Options: nosniff\r\nContent-Security-Policy: default-src 'none'; frame-src https://www.youtube.com; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'\r\nConnection: close\r\n\r\n",
        body.len()
    );
    let _ = stream.write_all(headers.as_bytes());
    let _ = stream.write_all(body.as_bytes());
}
