//! WAV reading, mixing and writing for call recordings.
//!
//! The engine writes the two sides of a call as separate mono 16-bit WAV files, as the call goes, and
//! fixes their headers when they are closed. This module reads them (tolerating a header that was never
//! fixed, after a crash), mixes them into one mono file at a voice-friendly rate, and works out the
//! waveform shown by the player. It streams: a long call never has to fit in memory.

use std::{
    fs::File,
    io::{self, BufWriter, Read, Seek, SeekFrom, Write},
    path::Path,
};

/// The recording is stored at most at this rate: plenty for a voice, a third of the size of 48 kHz.
pub const MAX_OUT_RATE: u32 = 16_000;
/// Bars of the waveform.
pub const PEAK_BINS: usize = 96;
const HEADER_LEN: u64 = 44;
/// Samples mixed per block.
const BLOCK: usize = 16_000;

/// A mono 16-bit WAV file on disk, read in blocks.
pub struct Source {
    file: File,
    pub rate: u32,
    /// Samples in the file.
    pub len: u64,
    data_start: u64,
}

impl Source {
    /// Opens `path`. `Ok(None)` when the file does not exist or holds no audio.
    pub fn open(path: &Path) -> io::Result<Option<Self>> {
        let mut file = match File::open(path) {
            Ok(f) => f,
            Err(e) if e.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(e) => return Err(e),
        };
        let file_len = file.metadata()?.len();
        let mut head = [0u8; HEADER_LEN as usize];
        if file_len < HEADER_LEN || file.read_exact(&mut head).is_err() {
            return Ok(None);
        }
        if &head[0..4] != b"RIFF" || &head[8..16] != b"WAVEfmt " {
            return Err(io::Error::new(io::ErrorKind::InvalidData, "not a WAV file"));
        }
        let le16 = |o: usize| u16::from_le_bytes([head[o], head[o + 1]]);
        let le32 = |o: usize| u32::from_le_bytes([head[o], head[o + 1], head[o + 2], head[o + 3]]);
        if le16(20) != 1 || le16(34) != 16 || &head[36..40] != b"data" {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "unsupported WAV layout (16-bit PCM expected)",
            ));
        }
        let channels = u64::from(le16(22)).max(1);
        let rate = le32(24);
        if rate == 0 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "bad sample rate",
            ));
        }
        // A header that was never finalised says 0 bytes: trust the file length instead.
        let declared = u64::from(le32(40));
        let available = file_len - HEADER_LEN;
        let bytes = if declared == 0 || declared > available {
            available
        } else {
            declared
        };
        let len = bytes / (2 * channels);
        if len == 0 {
            return Ok(None);
        }
        // Only mono is ever written by the engine; a stereo file would be read as its left channel.
        if channels != 1 {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                "mono WAV expected",
            ));
        }
        Ok(Some(Self {
            file,
            rate,
            len,
            data_start: HEADER_LEN,
        }))
    }

    /// Reads `count` samples from `start`; past the end the result is padded with silence.
    fn read(&mut self, start: u64, count: usize) -> io::Result<Vec<i16>> {
        let mut out = vec![0i16; count];
        if start >= self.len {
            return Ok(out);
        }
        let n = count.min((self.len - start) as usize);
        self.file
            .seek(SeekFrom::Start(self.data_start + start * 2))?;
        let mut raw = vec![0u8; n * 2];
        self.file.read_exact(&mut raw)?;
        let (pairs, _) = raw.as_chunks::<2>();
        for (o, b) in out.iter_mut().zip(pairs) {
            *o = i16::from_le_bytes(*b);
        }
        Ok(out)
    }

    fn seconds(&self) -> f64 {
        self.len as f64 / f64::from(self.rate)
    }
}

/// `n` output samples, starting at output sample `first`, of `src` resampled to `out_rate`: area average
/// when going down (a crude but sufficient low-pass for voice), linear interpolation when going up.
fn resampled(src: &mut Source, out_rate: u32, first: u64, n: usize) -> io::Result<Vec<f32>> {
    let ratio = f64::from(src.rate) / f64::from(out_rate); // source samples per output sample
    let from = (first as f64 * ratio).floor() as u64;
    let span = (n as f64 * ratio).ceil() as usize + 2;
    let raw = src.read(from, span)?;
    let at = |i: i64| -> f32 {
        let j = (i - from as i64).clamp(0, raw.len() as i64 - 1) as usize;
        f32::from(raw[j])
    };
    let mut out = Vec::with_capacity(n);
    for k in 0..n {
        let pos = (first + k as u64) as f64 * ratio;
        if ratio > 1.0 {
            let (a, b) = (pos.floor() as i64, (pos + ratio).floor() as i64);
            let mut sum = 0.0f32;
            let mut cnt = 0u32;
            for i in a..b.max(a + 1) {
                sum += at(i);
                cnt += 1;
            }
            out.push(sum / cnt as f32);
        } else {
            let i = pos.floor() as i64;
            let frac = (pos - i as f64) as f32;
            out.push(at(i) * (1.0 - frac) + at(i + 1) * frac);
        }
    }
    Ok(out)
}

fn write_header(w: &mut impl Write, rate: u32, samples: u64) -> io::Result<()> {
    let bytes = (samples * 2).min(u64::from(u32::MAX - 36)) as u32;
    w.write_all(b"RIFF")?;
    w.write_all(&(36 + bytes).to_le_bytes())?;
    w.write_all(b"WAVEfmt ")?;
    w.write_all(&16u32.to_le_bytes())?;
    w.write_all(&1u16.to_le_bytes())?; // PCM
    w.write_all(&1u16.to_le_bytes())?; // mono
    w.write_all(&rate.to_le_bytes())?;
    w.write_all(&(rate * 2).to_le_bytes())?;
    w.write_all(&2u16.to_le_bytes())?;
    w.write_all(&16u16.to_le_bytes())?;
    w.write_all(b"data")?;
    w.write_all(&bytes.to_le_bytes())
}

/// What a finished recording looks like.
#[derive(Debug, Clone, PartialEq)]
pub struct Mixed {
    pub duration_secs: u64,
    pub size_bytes: u64,
    /// Loudness across the call, `PEAK_BINS` values, 0 (silence) to 255 (loudest).
    pub peaks: Vec<u8>,
    pub rate: u32,
}

/// Mixes the two sides of a call into one mono WAV at `out`. `Ok(None)` when neither side recorded any
/// audio (nothing is written then).
pub fn mix(tx: &Path, rx: &Path, out: &Path) -> io::Result<Option<Mixed>> {
    let mut sources: Vec<Source> = [tx, rx]
        .into_iter()
        .map(Source::open)
        .collect::<io::Result<Vec<_>>>()?
        .into_iter()
        .flatten()
        .collect();
    if sources.is_empty() {
        return Ok(None);
    }
    let out_rate = sources
        .iter()
        .map(|s| s.rate)
        .max()
        .unwrap_or(MAX_OUT_RATE)
        .min(MAX_OUT_RATE);
    let seconds = sources.iter().map(Source::seconds).fold(0.0, f64::max);
    let total = (seconds * f64::from(out_rate)).round() as u64;
    if total == 0 {
        return Ok(None);
    }

    let mut w = BufWriter::new(File::create(out)?);
    write_header(&mut w, out_rate, total)?;

    let mut bins = [0u16; PEAK_BINS];
    let mut done = 0u64;
    while done < total {
        let n = BLOCK.min((total - done) as usize);
        let mut mix = vec![0f32; n];
        for s in &mut sources {
            for (m, v) in mix.iter_mut().zip(resampled(s, out_rate, done, n)?) {
                *m += v;
            }
        }
        for (k, m) in mix.iter().enumerate() {
            let v = m.round().clamp(-32768.0, 32767.0) as i16;
            w.write_all(&v.to_le_bytes())?;
            let bin = (((done + k as u64) * PEAK_BINS as u64) / total) as usize;
            let b = &mut bins[bin.min(PEAK_BINS - 1)];
            *b = (*b).max(v.unsigned_abs());
        }
        done += n as u64;
    }
    w.flush()?;
    drop(w);

    // Scale the bars to the loudest one so a quiet call still draws a readable waveform.
    let loudest = bins.iter().copied().max().unwrap_or(0).max(1);
    let peaks = bins
        .iter()
        .map(|&b| ((f32::from(b) / f32::from(loudest)) * 255.0).round() as u8)
        .collect();
    Ok(Some(Mixed {
        duration_secs: seconds.round() as u64,
        size_bytes: std::fs::metadata(out)?.len(),
        peaks,
        rate: out_rate,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine(rate: u32, secs: f64, freq: f64, amp: f64) -> Vec<i16> {
        (0..(rate as f64 * secs) as usize)
            .map(|i| {
                (amp * (2.0 * std::f64::consts::PI * freq * i as f64 / f64::from(rate)).sin())
                    as i16
            })
            .collect()
    }

    /// A WAV like the engine writes it while recording: the header says 0 bytes until it is closed.
    fn write_raw(path: &Path, rate: u32, samples: &[i16], finalised: bool) {
        let mut f = File::create(path).unwrap();
        let bytes = if finalised { samples.len() * 2 } else { 0 } as u32;
        f.write_all(b"RIFF").unwrap();
        f.write_all(&(36 + bytes).to_le_bytes()).unwrap();
        f.write_all(b"WAVEfmt ").unwrap();
        f.write_all(&16u32.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&1u16.to_le_bytes()).unwrap();
        f.write_all(&rate.to_le_bytes()).unwrap();
        f.write_all(&(rate * 2).to_le_bytes()).unwrap();
        f.write_all(&2u16.to_le_bytes()).unwrap();
        f.write_all(&16u16.to_le_bytes()).unwrap();
        f.write_all(b"data").unwrap();
        f.write_all(&bytes.to_le_bytes()).unwrap();
        for s in samples {
            f.write_all(&s.to_le_bytes()).unwrap();
        }
    }

    fn read_back(path: &Path) -> (u32, Vec<i16>) {
        let mut s = Source::open(path).unwrap().unwrap();
        let n = s.len as usize;
        (s.rate, s.read(0, n).unwrap())
    }

    fn rms(v: &[i16]) -> f64 {
        (v.iter().map(|&s| f64::from(s).powi(2)).sum::<f64>() / v.len() as f64).sqrt()
    }

    #[test]
    fn mixes_both_sides_at_the_higher_rate_up_to_16_khz() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx, out) = (
            dir.path().join("t-tx.wav"),
            dir.path().join("t-rx.wav"),
            dir.path().join("t.wav"),
        );
        write_raw(&tx, 8_000, &sine(8_000, 2.0, 440.0, 8_000.0), false);
        write_raw(&rx, 48_000, &sine(48_000, 2.0, 880.0, 8_000.0), false);

        let m = mix(&tx, &rx, &out).unwrap().unwrap();
        assert_eq!(m.rate, 16_000);
        assert_eq!(m.duration_secs, 2);
        assert_eq!(m.peaks.len(), PEAK_BINS);
        assert_eq!(m.peaks.iter().copied().max(), Some(255));
        assert_eq!(m.size_bytes, 44 + 2 * 16_000 * 2);

        let (rate, samples) = read_back(&out);
        assert_eq!((rate, samples.len()), (16_000, 32_000));
        // Both voices are there: louder than either alone (440 Hz + 880 Hz tones of RMS ~5657 each).
        assert!(rms(&samples) > 6_000.0, "rms = {}", rms(&samples));
    }

    #[test]
    fn a_single_side_is_enough_and_silence_pads_the_shorter_one() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx, out) = (
            dir.path().join("a-tx.wav"),
            dir.path().join("a-rx.wav"),
            dir.path().join("a.wav"),
        );
        write_raw(&rx, 16_000, &sine(16_000, 1.0, 300.0, 10_000.0), true);
        let m = mix(&tx, &rx, &out).unwrap().unwrap();
        assert_eq!((m.rate, m.duration_secs), (16_000, 1));

        // The microphone side is shorter: the rest of the call is the other voice alone.
        write_raw(&tx, 16_000, &sine(16_000, 0.5, 500.0, 10_000.0), true);
        let m = mix(&tx, &rx, &out).unwrap().unwrap();
        assert_eq!(m.duration_secs, 1);
        let (_, samples) = read_back(&out);
        assert_eq!(samples.len(), 16_000);
    }

    #[test]
    fn nothing_recorded_means_no_file() {
        let dir = tempfile::tempdir().unwrap();
        let out = dir.path().join("none.wav");
        assert!(
            mix(
                &dir.path().join("x-tx.wav"),
                &dir.path().join("x-rx.wav"),
                &out
            )
            .unwrap()
            .is_none()
        );
        assert!(!out.exists());

        // Headers only, no samples.
        let (tx, rx) = (dir.path().join("e-tx.wav"), dir.path().join("e-rx.wav"));
        write_raw(&tx, 8_000, &[], false);
        write_raw(&rx, 8_000, &[], true);
        assert!(mix(&tx, &rx, &out).unwrap().is_none());
    }

    #[test]
    fn a_truncated_file_after_a_crash_is_still_read() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx, out) = (
            dir.path().join("c-tx.wav"),
            dir.path().join("c-rx.wav"),
            dir.path().join("c.wav"),
        );
        write_raw(&tx, 8_000, &sine(8_000, 1.0, 440.0, 5_000.0), false);
        // Cut in the middle of a sample.
        let f = std::fs::OpenOptions::new().write(true).open(&tx).unwrap();
        f.set_len(44 + 8_000 * 2 - 1).unwrap();
        let m = mix(&tx, &rx, &out).unwrap().unwrap();
        assert_eq!(m.rate, 8_000);
        assert_eq!(read_back(&out).1.len(), 7_999);
    }

    #[test]
    fn rejects_files_that_are_not_16_bit_mono_wav() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("bad.wav");
        std::fs::write(&p, vec![b'x'; 100]).unwrap();
        assert!(Source::open(&p).is_err());
    }

    #[test]
    fn peaks_follow_the_loudness_of_the_call() {
        let dir = tempfile::tempdir().unwrap();
        let (tx, rx, out) = (
            dir.path().join("p-tx.wav"),
            dir.path().join("p-rx.wav"),
            dir.path().join("p.wav"),
        );
        // Quiet first half, loud second half.
        let mut s = sine(8_000, 1.0, 440.0, 500.0);
        s.extend(sine(8_000, 1.0, 440.0, 20_000.0));
        write_raw(&rx, 8_000, &s, true);
        let m = mix(&tx, &rx, &out).unwrap().unwrap();
        let (first, second) = m.peaks.split_at(PEAK_BINS / 2);
        assert!(first.iter().all(|&p| p < 20), "{first:?}");
        assert!(second.iter().any(|&p| p > 240), "{second:?}");
    }
}
