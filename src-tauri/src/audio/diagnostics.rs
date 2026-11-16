//! Audio tests the user starts on purpose: a tone on the conversation output, the ringtone on the ringer's
//! output, and a live microphone level.
//!
//! They use their own stream on the chosen device, never the call's: nothing here goes through the SIP engine,
//! so nothing can reach the other party. The commands refuse to run while a call exists (a test would compete
//! with the call for the device), and each test is a single, bounded, explicit action.

use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

use cpal::{
    SampleFormat,
    traits::{DeviceTrait, HostTrait, StreamTrait},
};

/// Mono samples at a rate.
#[derive(Debug, Clone, PartialEq)]
pub struct Samples {
    pub rate: u32,
    pub data: Vec<f32>,
}

/// A soft 440 Hz tone with a short fade in and out (no click), at a comfortable level.
pub fn tone(rate: u32, seconds: f32) -> Samples {
    let n = (rate as f32 * seconds) as usize;
    let fade = (rate as f32 * 0.03) as usize;
    let data = (0..n)
        .map(|i| {
            let edge = i.min(n - 1 - i).min(fade) as f32 / fade.max(1) as f32;
            0.2 * edge * (2.0 * std::f32::consts::PI * 440.0 * i as f32 / rate as f32).sin()
        })
        .collect();
    Samples { rate, data }
}

/// Reads a WAV file: PCM 16-bit, G.711 µ-law or A-law (the ringtone is µ-law), any channel count (mixed to mono).
pub fn decode_wav(bytes: &[u8]) -> Result<Samples, String> {
    let u16le = |i: usize| {
        bytes
            .get(i..i + 2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
    };
    let u32le = |i: usize| {
        bytes
            .get(i..i + 4)
            .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
    };
    if bytes.get(0..4) != Some(b"RIFF") || bytes.get(8..12) != Some(b"WAVE") {
        return Err("fichier WAV invalide".into());
    }
    let (mut format, mut channels, mut rate, mut bits) = (0u16, 1u16, 0u32, 16u16);
    let mut data: Option<&[u8]> = None;
    let mut pos = 12;
    while pos + 8 <= bytes.len() {
        let id = &bytes[pos..pos + 4];
        let size = u32le(pos + 4).ok_or("fichier WAV tronqué")? as usize;
        let body = pos + 8;
        match id {
            b"fmt " => {
                format = u16le(body).ok_or("fichier WAV tronqué")?;
                channels = u16le(body + 2).ok_or("fichier WAV tronqué")?.max(1);
                rate = u32le(body + 4).ok_or("fichier WAV tronqué")?;
                bits = u16le(body + 14).ok_or("fichier WAV tronqué")?;
            }
            b"data" => data = bytes.get(body..(body + size).min(bytes.len())),
            _ => {}
        }
        pos = body + size + (size & 1);
    }
    let data = data.ok_or("fichier WAV sans données")?;
    if rate == 0 {
        return Err("fichier WAV sans format".into());
    }
    let frames: Vec<f32> = match (format, bits) {
        (1, 16) => data
            .chunks_exact(2)
            .map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0)
            .collect(),
        (7, 8) => data.iter().map(|b| mulaw(*b)).collect(),
        (6, 8) => data.iter().map(|b| alaw(*b)).collect(),
        _ => {
            return Err(format!(
                "format WAV non pris en charge ({format}, {bits} bits)"
            ));
        }
    };
    let mono = frames
        .chunks(channels as usize)
        .map(|c| c.iter().sum::<f32>() / c.len() as f32)
        .collect();
    Ok(Samples { rate, data: mono })
}

fn mulaw(b: u8) -> f32 {
    let b = !b;
    let sign = b & 0x80;
    let exponent = (b >> 4) & 7;
    let mantissa = (b & 0x0F) as i32;
    let sample = (((mantissa << 3) + 0x84) << exponent) - 0x84;
    (if sign != 0 { -sample } else { sample }) as f32 / 32768.0
}

fn alaw(b: u8) -> f32 {
    let b = b ^ 0x55;
    let sign = b & 0x80;
    let exponent = (b >> 4) & 7;
    let mantissa = (b & 0x0F) as i32;
    let sample = if exponent == 0 {
        (mantissa << 4) + 8
    } else {
        ((mantissa << 4) + 0x108) << (exponent - 1)
    };
    (if sign != 0 { sample } else { -sample }) as f32 / 32768.0
}

/// Linear resampling: enough for a ringtone to be heard at the device's own rate.
pub fn resample(data: &[f32], from: u32, to: u32) -> Vec<f32> {
    if from == to || data.is_empty() {
        return data.to_vec();
    }
    let n = (data.len() as u64 * to as u64 / from as u64) as usize;
    (0..n)
        .map(|i| {
            let pos = i as f64 * from as f64 / to as f64;
            let (a, frac) = (pos as usize, (pos - pos.floor()) as f32);
            let x = data[a.min(data.len() - 1)];
            let y = data[(a + 1).min(data.len() - 1)];
            x + (y - x) * frac
        })
        .collect()
}

/// RMS level in dBFS, down to −90 for silence.
pub fn level_db(samples: &[f32]) -> f32 {
    if samples.is_empty() {
        return -90.0;
    }
    let rms = (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt();
    (20.0 * rms.max(1e-6).log10()).max(-90.0)
}

fn output_named(name: &str) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    let matching: Vec<_> = host
        .output_devices()
        .map_err(|e| e.to_string())?
        .filter(|d| d.description().is_ok_and(|x| x.name() == name))
        .collect();
    match matching.len() {
        1 => Ok(matching.into_iter().next().unwrap()),
        0 => Err(format!("« {name} » n'est plus disponible")),
        _ => Err(format!(
            "Plusieurs périphériques s'appellent « {name} » : le test ne saurait pas lequel jouer"
        )),
    }
}

fn input_named(name: &str) -> Result<cpal::Device, String> {
    let host = cpal::default_host();
    let matching: Vec<_> = host
        .input_devices()
        .map_err(|e| e.to_string())?
        .filter(|d| d.description().is_ok_and(|x| x.name() == name))
        .collect();
    match matching.len() {
        1 => Ok(matching.into_iter().next().unwrap()),
        0 => Err(format!("« {name} » n'est plus disponible")),
        _ => Err(format!(
            "Plusieurs périphériques s'appellent « {name} » : le test ne saurait pas lequel écouter"
        )),
    }
}

/// Plays `samples` on the named output and returns when they are finished (or after `max`). Blocking: call it
/// from a blocking task. The sound goes to the device directly; it cannot reach a call.
pub fn play(device_name: &str, samples: Samples, gain: f32, max: Duration) -> Result<(), String> {
    let device = output_named(device_name)?;
    let config = device
        .default_output_config()
        .map_err(|e| format!("Le périphérique ne s'ouvre pas : {e}"))?;
    if config.sample_format() != SampleFormat::F32 {
        return Err(format!(
            "Format audio non pris en charge ({:?})",
            config.sample_format()
        ));
    }
    let (rate, channels) = (config.sample_rate(), config.channels() as usize);
    let data = Arc::new(resample(&samples.data, samples.rate, rate));
    let position = Arc::new(AtomicUsize::new(0));
    let (d, p) = (data.clone(), position.clone());
    let stream = device
        .build_output_stream(
            config.config(),
            move |out: &mut [f32], _| {
                for frame in out.chunks_mut(channels) {
                    let i = p.fetch_add(1, Ordering::Relaxed);
                    let v = d.get(i).copied().unwrap_or(0.0) * gain;
                    frame.iter_mut().for_each(|s| *s = v);
                }
            },
            |e| log::warn!("audio test stream: {e}"),
            None,
        )
        .map_err(|e| format!("Le périphérique ne s'ouvre pas : {e}"))?;
    stream
        .play()
        .map_err(|e| format!("Le périphérique ne démarre pas : {e}"))?;
    let started = Instant::now();
    while position.load(Ordering::Relaxed) < data.len() && started.elapsed() < max {
        std::thread::sleep(Duration::from_millis(30));
    }
    // Let the last buffer play out.
    std::thread::sleep(Duration::from_millis(120));
    Ok(())
}

/// A live microphone level, until stopped (or a minute, so it never stays open by mistake).
pub struct Meter {
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
}

impl Meter {
    pub fn start(
        device_name: &str,
        on_level: Arc<dyn Fn(f32) + Send + Sync>,
    ) -> Result<Meter, String> {
        let name = device_name.to_owned();
        let stop = Arc::new(AtomicBool::new(false));
        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
        let flag = stop.clone();
        let thread = std::thread::Builder::new()
            .name("zephone-meter".into())
            .spawn(move || {
                // The stream is not `Send`: it lives and dies on this thread.
                let opened = (|| -> Result<cpal::Stream, String> {
                    let device = input_named(&name)?;
                    let config = device
                        .default_input_config()
                        .map_err(|e| format!("Le micro ne s'ouvre pas : {e}"))?;
                    if config.sample_format() != SampleFormat::F32 {
                        return Err(format!(
                            "Format audio non pris en charge ({:?})",
                            config.sample_format()
                        ));
                    }
                    let window = (config.sample_rate() as usize * config.channels() as usize) / 20; // 50 ms
                    let mut acc: Vec<f32> = Vec::with_capacity(window);
                    let stream = device
                        .build_input_stream(
                            config.config(),
                            move |data: &[f32], _| {
                                for s in data {
                                    acc.push(*s);
                                    if acc.len() >= window {
                                        on_level(level_db(&acc));
                                        acc.clear();
                                    }
                                }
                            },
                            |e| log::warn!("audio meter stream: {e}"),
                            None,
                        )
                        .map_err(|e| format!("Le micro ne s'ouvre pas : {e}"))?;
                    stream
                        .play()
                        .map_err(|e| format!("Le micro ne démarre pas : {e}"))?;
                    Ok(stream)
                })();
                match opened {
                    Err(e) => {
                        let _ = tx.send(Err(e));
                    }
                    Ok(stream) => {
                        let _ = tx.send(Ok(()));
                        let started = Instant::now();
                        while !flag.load(Ordering::Relaxed)
                            && started.elapsed() < Duration::from_secs(60)
                        {
                            std::thread::sleep(Duration::from_millis(50));
                        }
                        drop(stream);
                    }
                }
            })
            .map_err(|e| e.to_string())?;
        match rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(())) => Ok(Meter {
                stop,
                thread: Some(thread),
            }),
            Ok(Err(e)) => Err(e),
            Err(_) => Err("Le micro n'a pas répondu à temps".into()),
        }
    }
}

impl Drop for Meter {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
        if let Some(t) = self.thread.take() {
            let _ = t.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_tone_is_soft_bounded_and_without_clicks() {
        let t = tone(48_000, 0.5);
        assert_eq!(t.data.len(), 24_000);
        assert!(t.data.iter().all(|s| s.abs() <= 0.2 + 1e-6), "never loud");
        assert!(
            t.data[0].abs() < 0.01 && t.data[t.data.len() - 1].abs() < 0.01,
            "fades in and out"
        );
        assert!(level_db(&t.data) > -30.0, "audible");
    }

    #[test]
    fn the_real_ringtone_file_decodes() {
        let bytes = std::fs::read(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/resources/baresip/sounds/ring.wav"
        ))
        .unwrap();
        let s = decode_wav(&bytes).unwrap();
        assert_eq!(s.rate, 8000);
        assert!(s.data.len() > 4000, "{} samples", s.data.len());
        assert!(s.data.iter().any(|x| x.abs() > 0.05) && s.data.iter().all(|x| x.abs() <= 1.0));
    }

    #[test]
    fn pcm_wav_is_decoded_and_mixed_to_mono() {
        let mut wav = Vec::new();
        wav.extend_from_slice(b"RIFF\0\0\0\0WAVEfmt ");
        wav.extend_from_slice(&16u32.to_le_bytes());
        for v in [1u16, 2] {
            wav.extend_from_slice(&v.to_le_bytes()); // PCM, stereo
        }
        wav.extend_from_slice(&44_100u32.to_le_bytes());
        wav.extend_from_slice(&(44_100u32 * 4).to_le_bytes());
        wav.extend_from_slice(&4u16.to_le_bytes());
        wav.extend_from_slice(&16u16.to_le_bytes());
        wav.extend_from_slice(b"data");
        wav.extend_from_slice(&8u32.to_le_bytes());
        for s in [16384i16, -16384, 8192, 8192] {
            wav.extend_from_slice(&s.to_le_bytes());
        }
        let s = decode_wav(&wav).unwrap();
        assert_eq!(s.rate, 44_100);
        assert_eq!(s.data, [0.0, 0.25]);
    }

    #[test]
    fn bad_files_are_refused_not_played() {
        assert!(decode_wav(b"not a wav").is_err());
        assert!(decode_wav(b"RIFF\0\0\0\0WAVE").is_err());
        let mut mp3ish = b"RIFF\0\0\0\0WAVEfmt ".to_vec();
        mp3ish.extend_from_slice(&16u32.to_le_bytes());
        mp3ish.extend_from_slice(&[0x55, 0, 1, 0]); // format 0x55
        mp3ish.extend_from_slice(&8000u32.to_le_bytes());
        mp3ish.extend_from_slice(&[0; 8]);
        mp3ish.extend_from_slice(b"data\x02\0\0\0ab");
        assert!(
            decode_wav(&mp3ish)
                .unwrap_err()
                .contains("non pris en charge")
        );
    }

    #[test]
    fn resampling_keeps_the_duration() {
        let one_second = vec![0.5f32; 8000];
        let r = resample(&one_second, 8000, 48_000);
        assert_eq!(r.len(), 48_000);
        assert!(r.iter().all(|x| (*x - 0.5).abs() < 1e-6));
        assert_eq!(resample(&one_second, 8000, 8000), one_second);
        assert!(resample(&[], 8000, 48_000).is_empty());
    }

    #[test]
    fn levels_are_in_dbfs() {
        assert_eq!(level_db(&[]), -90.0);
        assert_eq!(level_db(&[0.0; 100]), -90.0, "silence is the floor");
        let full: Vec<f32> = (0..1000)
            .map(|i| if i % 2 == 0 { 1.0 } else { -1.0 })
            .collect();
        assert!(level_db(&full).abs() < 0.01, "full scale is 0 dB");
        let half: Vec<f32> = full.iter().map(|x| x * 0.5).collect();
        assert!((level_db(&half) + 6.02).abs() < 0.05);
    }

    #[test]
    fn a_device_that_is_not_there_is_an_explained_error() {
        assert!(
            play(
                "No Such Device Anywhere",
                tone(8000, 0.1),
                1.0,
                Duration::from_secs(1)
            )
            .unwrap_err()
            .contains("n'est plus disponible")
        );
        assert!(
            Meter::start("No Such Device Anywhere", Arc::new(|_| {}))
                .err()
                .unwrap()
                .contains("n'est plus disponible")
        );
    }
}
