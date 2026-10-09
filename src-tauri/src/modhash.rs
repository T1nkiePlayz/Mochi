//! File identification hashes for installed mods: SHA-1 (Modrinth), MD5 (Nexus Mods `md5_search`) and the
//! CurseForge fingerprint (32-bit MurmurHash2, seed 1, over the file with whitespace bytes 9, 10, 13 and 32 removed).
//! MD5 and MurmurHash2 are small enough to keep here instead of adding crates; both are checked against known vectors.
use sha1::{Digest, Sha1};
use std::{fs, io::Read, path::Path};

const BUFFER: usize = 256 * 1024;

// ---------------------------------------------------------------------------
// MD5 (RFC 1321)
// ---------------------------------------------------------------------------

const MD5_K: [u32; 64] = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];
const MD5_S: [u32; 16] = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];

pub struct Md5 { state: [u32; 4], block: [u8; 64], filled: usize, length: u64 }

impl Default for Md5 {
    fn default() -> Self { Self { state: [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476], block: [0; 64], filled: 0, length: 0 } }
}

impl Md5 {
    fn compress(state: &mut [u32; 4], block: &[u8; 64]) {
        let mut m = [0u32; 16];
        for (i, word) in m.iter_mut().enumerate() { *word = u32::from_le_bytes([block[i * 4], block[i * 4 + 1], block[i * 4 + 2], block[i * 4 + 3]]); }
        let [mut a, mut b, mut c, mut d] = *state;
        for i in 0..64 {
            let (f, g) = match i / 16 {
                0 => ((b & c) | (!b & d), i),
                1 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                2 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let rotated = a.wrapping_add(f).wrapping_add(MD5_K[i]).wrapping_add(m[g]).rotate_left(MD5_S[(i / 16) * 4 + i % 4]);
            a = d; d = c; c = b; b = b.wrapping_add(rotated);
        }
        state[0] = state[0].wrapping_add(a); state[1] = state[1].wrapping_add(b); state[2] = state[2].wrapping_add(c); state[3] = state[3].wrapping_add(d);
    }

    pub fn update(&mut self, mut data: &[u8]) {
        self.length = self.length.wrapping_add(data.len() as u64);
        while !data.is_empty() {
            let take = (64 - self.filled).min(data.len());
            self.block[self.filled..self.filled + take].copy_from_slice(&data[..take]);
            self.filled += take;
            data = &data[take..];
            if self.filled == 64 { Self::compress(&mut self.state, &self.block); self.filled = 0; }
        }
    }

    pub fn finish(mut self) -> [u8; 16] {
        let bits = self.length.wrapping_mul(8);
        self.update(&[0x80]);
        while self.filled != 56 { self.update(&[0]); }
        self.update(&bits.to_le_bytes());
        let mut out = [0u8; 16];
        for (i, word) in self.state.iter().enumerate() { out[i * 4..i * 4 + 4].copy_from_slice(&word.to_le_bytes()); }
        out
    }
}

// ---------------------------------------------------------------------------
// CurseForge fingerprint (MurmurHash2, whitespace stripped)
// ---------------------------------------------------------------------------

const fn is_cf_whitespace(byte: u8) -> bool { matches!(byte, 9 | 10 | 13 | 32) }

/// Streaming MurmurHash2 over the non-whitespace bytes; `length` (the count of those bytes) must be known up front.
pub struct Murmur2 { hash: u32, chunk: [u8; 4], filled: usize }

const MURMUR_M: u32 = 0x5bd1_e995;

impl Murmur2 {
    pub fn new(length: u32) -> Self { Self { hash: 1 ^ length, chunk: [0; 4], filled: 0 } }

    #[inline(always)]
    fn mix(&mut self, word: u32) {
        let mut k = word.wrapping_mul(MURMUR_M);
        k ^= k >> 24;
        k = k.wrapping_mul(MURMUR_M);
        self.hash = self.hash.wrapping_mul(MURMUR_M) ^ k;
    }

    pub fn update(&mut self, data: &[u8]) {
        // Compact the non-whitespace bytes into a stack buffer with a branchless write, then hash whole words from it.
        // Most of a jar is compressed data with almost no whitespace, so this keeps the hot loop branch-free.
        let mut stage = [0u8; 4096 + 4];
        for piece in data.chunks(4096) {
            let mut n = self.filled;
            stage[..n].copy_from_slice(&self.chunk[..n]);
            for &byte in piece {
                stage[n] = byte;
                n += usize::from(!is_cf_whitespace(byte));
            }
            let words = n / 4;
            for word in stage[..words * 4].as_chunks::<4>().0 { self.mix(u32::from_le_bytes(*word)); }
            let rest = n - words * 4;
            self.chunk[..rest].copy_from_slice(&stage[words * 4..n]);
            self.filled = rest;
        }
    }

    pub fn finish(self) -> u32 {
        let mut h = self.hash;
        if self.filled > 0 {
            if self.filled >= 3 { h ^= u32::from(self.chunk[2]) << 16; }
            if self.filled >= 2 { h ^= u32::from(self.chunk[1]) << 8; }
            h ^= u32::from(self.chunk[0]);
            h = h.wrapping_mul(MURMUR_M);
        }
        h ^= h >> 13;
        h = h.wrapping_mul(MURMUR_M);
        h ^ (h >> 15)
    }
}

/// CurseForge fingerprint of an in-memory buffer.
#[cfg(test)]
pub fn cf_fingerprint(data: &[u8]) -> u32 {
    let length = data.iter().filter(|b| !is_cf_whitespace(**b)).count() as u32;
    let mut hasher = Murmur2::new(length);
    hasher.update(data);
    hasher.finish()
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq)]
pub struct FileHashes { pub size: u64, pub sha1: String, pub md5: String, pub fingerprint: u32 }

/// Files up to this size are read once and hashed on three threads; bigger ones stream (two sequential reads).
const IN_MEMORY_MAX: u64 = 64 * 1024 * 1024;

fn hash_in_memory(path: &Path, len: u64) -> Result<FileHashes, String> {
    let mut data = Vec::with_capacity(len as usize);
    fs::File::open(path).and_then(|mut f| f.read_to_end(&mut data)).map_err(|e| e.to_string())?;
    let data = data.as_slice();
    let (sha1, md5, fingerprint) = std::thread::scope(|scope| {
        let sha1 = scope.spawn(|| { let mut h = Sha1::new(); h.update(data); crate::util::hex(&h.finalize()) });
        let md5 = scope.spawn(|| { let mut h = Md5::default(); h.update(data); crate::util::hex(&h.finish()) });
        let stripped = data.iter().map(|&b| u64::from(!is_cf_whitespace(b))).sum::<u64>();
        let mut murmur = Murmur2::new(stripped as u32);
        murmur.update(data);
        (sha1.join(), md5.join(), murmur.finish())
    });
    Ok(FileHashes { size: data.len() as u64, sha1: sha1.map_err(|_| "Hashing failed.")?, md5: md5.map_err(|_| "Hashing failed.")?, fingerprint })
}

/// All three identifiers of one file in two sequential reads (the fingerprint needs the stripped length first).
pub fn hash_file(path: &Path, max_bytes: u64) -> Result<FileHashes, String> {
    let meta = fs::metadata(path).map_err(|e| e.to_string())?;
    if !meta.is_file() { return Err("Not a file.".into()); }
    if meta.len() > max_bytes { return Err("The file is too large to identify.".into()); }
    if meta.len() <= IN_MEMORY_MAX { hash_in_memory(path, meta.len()) } else { hash_streaming(path) }
}

fn hash_streaming(path: &Path) -> Result<FileHashes, String> {
    let mut buffer = vec![0u8; BUFFER];
    let (mut sha1, mut md5, mut stripped, mut size) = (Sha1::new(), Md5::default(), 0u64, 0u64);
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 { break; }
        let chunk = &buffer[..read];
        sha1.update(chunk);
        md5.update(chunk);
        stripped += chunk.iter().map(|&b| u64::from(!is_cf_whitespace(b))).sum::<u64>();
        size += read as u64;
    }
    let mut murmur = Murmur2::new(stripped as u32);
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    loop {
        let read = file.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 { break; }
        murmur.update(&buffer[..read]);
    }
    Ok(FileHashes { size, sha1: crate::util::hex(&sha1.finalize()), md5: crate::util::hex(&md5.finish()), fingerprint: murmur.finish() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn md5_hex(data: &[u8]) -> String { let mut h = Md5::default(); h.update(data); crate::util::hex(&h.finish()) }

    #[test]
    fn md5_matches_rfc_vectors() {
        assert_eq!(md5_hex(b""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(md5_hex(b"message digest"), "f96b697d7cb7938d525a2f31aaf161d0");
        assert_eq!(md5_hex(b"The quick brown fox jumps over the lazy dog"), "9e107d9d372bb6826bd81d3542a419d6");
        assert_eq!(md5_hex(b"12345678901234567890123456789012345678901234567890123456789012345678901234567890"), "57edf4a22be3c955ac49da2e2107b67a");
        // Streaming in odd pieces gives the same digest.
        let data: Vec<u8> = (0..1000u32).map(|i| (i % 251) as u8).collect();
        let mut h = Md5::default();
        for piece in data.chunks(37) { h.update(piece); }
        assert_eq!(crate::util::hex(&h.finish()), md5_hex(&data));
    }

    #[test]
    fn fingerprint_ignores_whitespace_and_streams() {
        // Reference values from an independent MurmurHash2 (seed 1) over the whitespace-stripped bytes.
        assert_eq!(cf_fingerprint(b""), 0x5bd15e36);
        assert_eq!(cf_fingerprint(b"Hello, CurseForge! fingerprint test 123"), 0x0bfd3774);
        assert_eq!(cf_fingerprint(b"a b\tc\r\nd"), cf_fingerprint(b"abcd"));
        let data: Vec<u8> = (0..5000u32).map(|i| if i % 13 == 0 { b' ' } else { (i % 251) as u8 }).collect();
        let length = data.iter().filter(|b| !is_cf_whitespace(**b)).count() as u32;
        let mut streamed = Murmur2::new(length);
        for piece in data.chunks(7) { streamed.update(piece); }
        assert_eq!(streamed.finish(), cf_fingerprint(&data));
    }

    #[test]
    fn streaming_and_in_memory_paths_agree() {
        let dir = std::env::temp_dir().join(format!("mochi-modhash-paths-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("b.jar");
        // Larger than the read buffer, with whitespace sprinkled in and an odd length.
        let data: Vec<u8> = (0..(BUFFER as u32 * 2 + 12_345)).map(|i| if i % 11 == 0 { b' ' } else { (i.wrapping_mul(2_654_435_761) >> 13) as u8 }).collect();
        fs::write(&path, &data).unwrap();
        let fast = hash_in_memory(&path, data.len() as u64).unwrap();
        assert_eq!(fast, hash_streaming(&path).unwrap());
        assert_eq!(fast.fingerprint, cf_fingerprint(&data));
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn hashes_a_file() {
        let dir = std::env::temp_dir().join(format!("mochi-modhash-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("a.jar");
        fs::write(&path, b"abc").unwrap();
        let hashes = hash_file(&path, 1024).unwrap();
        assert_eq!(hashes.sha1, "a9993e364706816aba3e25717850c26c9cd0d89d");
        assert_eq!(hashes.md5, "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(hashes.fingerprint, cf_fingerprint(b"abc"));
        assert_eq!(hashes.size, 3);
        assert!(hash_file(&path, 2).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}

#[cfg(test)]
mod bench {
    use super::*;

    /// `cargo test --release bench_hash_file -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_hash_file() {
        let dir = std::env::temp_dir().join(format!("mochi-modhash-bench-{}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("big.jar");
        let data: Vec<u8> = (0..64u64 * 1024 * 1024).map(|i| (i.wrapping_mul(2654435761) >> 7) as u8).collect();
        fs::write(&path, &data).unwrap();
        let start = std::time::Instant::now();
        let hashes = hash_file(&path, u64::MAX).unwrap();
        eprintln!("64 MiB in {:?} (fingerprint {})", start.elapsed(), hashes.fingerprint);
        let t = std::time::Instant::now(); let mut h = Sha1::new(); for c in data.chunks(BUFFER) { h.update(c); } let _ = h.finalize(); eprintln!("sha1 {:?}", t.elapsed());
        let t = std::time::Instant::now(); let mut h = Md5::default(); for c in data.chunks(BUFFER) { h.update(c); } let _ = h.finish(); eprintln!("md5 {:?}", t.elapsed());
        let t = std::time::Instant::now(); let mut h = Murmur2::new(1); for c in data.chunks(BUFFER) { h.update(c); } let _ = h.finish(); eprintln!("murmur {:?}", t.elapsed());
        let _ = fs::remove_dir_all(&dir);
    }
}
