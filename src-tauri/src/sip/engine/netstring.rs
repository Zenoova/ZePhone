//! Netstring framing used by Baresip's `ctrl_tcp` module: `<len>:<payload>,`.
//! Spec: <https://cr.yp.to/proto/netstrings.txt>.

/// Hard cap on a single frame we accept from the engine (Baresip itself allows ~1 GB).
pub const MAX_FRAME: usize = 4 * 1024 * 1024;

pub fn encode(payload: &[u8]) -> Vec<u8> {
    let header = payload.len().to_string();
    let mut out = Vec::with_capacity(header.len() + payload.len() + 2);
    out.extend_from_slice(header.as_bytes());
    out.push(b':');
    out.extend_from_slice(payload);
    out.push(b',');
    out
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DecodeError {
    #[error("invalid netstring length")]
    InvalidLength,
    #[error("netstring is missing its trailing comma")]
    MissingTerminator,
    #[error("netstring frame of {0} bytes exceeds the limit")]
    TooLarge(usize),
}

/// Incremental decoder: feed it whatever arrives on the socket, pull frames out.
#[derive(Debug, Default)]
pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, data: &[u8]) {
        self.buf.extend_from_slice(data);
    }

    pub fn buffered(&self) -> usize {
        self.buf.len()
    }

    /// Returns the next complete frame, `Ok(None)` if more data is needed, or an
    /// error if the stream is corrupt (the caller should then drop the connection).
    pub fn next_frame(&mut self) -> Result<Option<Vec<u8>>, DecodeError> {
        // The length prefix is at most 10 digits; look for the colon within it.
        let colon = match self.buf.iter().take(11).position(|b| *b == b':') {
            Some(i) => i,
            None => {
                // No colon yet: either incomplete (all digits so far) or garbage.
                if self.buf.len() >= 11 || self.buf.iter().any(|b| !b.is_ascii_digit()) {
                    return Err(DecodeError::InvalidLength);
                }
                return Ok(None);
            }
        };
        if colon == 0 || !self.buf[..colon].iter().all(u8::is_ascii_digit) {
            return Err(DecodeError::InvalidLength);
        }
        if colon > 1 && self.buf[0] == b'0' {
            return Err(DecodeError::InvalidLength); // leading zero
        }
        let len: usize = std::str::from_utf8(&self.buf[..colon])
            .ok()
            .and_then(|s| s.parse().ok())
            .ok_or(DecodeError::InvalidLength)?;
        if len > MAX_FRAME {
            return Err(DecodeError::TooLarge(len));
        }
        let total = colon + 1 + len + 1;
        if self.buf.len() < total {
            return Ok(None);
        }
        if self.buf[total - 1] != b',' {
            return Err(DecodeError::MissingTerminator);
        }
        let payload = self.buf[colon + 1..colon + 1 + len].to_vec();
        self.buf.drain(..total);
        Ok(Some(payload))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_like_the_spec() {
        assert_eq!(encode(b"hello world!"), b"12:hello world!,");
        assert_eq!(encode(b""), b"0:,");
    }

    #[test]
    fn decodes_single_frame() {
        let mut d = Decoder::new();
        d.push(b"5:hello,");
        assert_eq!(d.next_frame().unwrap().unwrap(), b"hello");
        assert_eq!(d.next_frame().unwrap(), None);
    }

    #[test]
    fn decodes_empty_payload() {
        let mut d = Decoder::new();
        d.push(b"0:,");
        assert_eq!(d.next_frame().unwrap().unwrap(), b"");
    }

    #[test]
    fn handles_frames_split_across_reads() {
        let mut d = Decoder::new();
        let full = encode(br#"{"event":true,"type":"CREATE"}"#);
        for chunk in full.chunks(3) {
            assert_eq!(d.next_frame().unwrap(), None);
            d.push(chunk);
        }
        assert_eq!(
            d.next_frame().unwrap().unwrap(),
            br#"{"event":true,"type":"CREATE"}"#
        );
    }

    #[test]
    fn handles_several_frames_in_one_read() {
        let mut d = Decoder::new();
        let mut data = encode(b"one");
        data.extend(encode(b"two"));
        data.extend(b"3:th");
        d.push(&data);
        assert_eq!(d.next_frame().unwrap().unwrap(), b"one");
        assert_eq!(d.next_frame().unwrap().unwrap(), b"two");
        assert_eq!(d.next_frame().unwrap(), None);
        d.push(b"r,");
        assert_eq!(d.next_frame().unwrap().unwrap(), b"thr");
    }

    #[test]
    fn payload_may_contain_colons_and_commas() {
        let mut d = Decoder::new();
        d.push(&encode(b"a:b,c:"));
        assert_eq!(d.next_frame().unwrap().unwrap(), b"a:b,c:");
    }

    #[test]
    fn rejects_corrupt_streams() {
        for bad in [
            &b"x:abc,"[..],
            b":,",
            b"03:abc,",
            b"3:abcX",
            b"12345678901:",
            b"-1:a,",
        ] {
            let mut d = Decoder::new();
            d.push(bad);
            assert!(
                d.next_frame().is_err(),
                "should reject {:?}",
                String::from_utf8_lossy(bad)
            );
        }
    }

    #[test]
    fn rejects_oversized_frames() {
        let mut d = Decoder::new();
        d.push(format!("{}:", MAX_FRAME + 1).as_bytes());
        assert_eq!(d.next_frame(), Err(DecodeError::TooLarge(MAX_FRAME + 1)));
    }

    #[test]
    fn multibyte_utf8_length_is_in_bytes() {
        let payload = "é€".as_bytes(); // 2 + 3 bytes
        let mut d = Decoder::new();
        d.push(&encode(payload));
        assert_eq!(d.next_frame().unwrap().unwrap(), payload);
    }
}
