//! Call statistics: what the engine measures about the audio of a call (network, jitter buffer, regularity of
//! the audio blocks), turned every second into a [`CallStatsSample`] the UI can chart.
//!
//! The engine reports counters that only grow since the call started, plus a few maxima over the time since
//! the previous report. [`StatsTracker`] subtracts the previous report, so a sample says what happened during
//! the last second.

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

/// Samples kept per call: 15 minutes at one per second.
pub const HISTORY_MAX: usize = 900;

// ----------------------------------------------------------- what the engine reports

/// One report of the engine about the audio of a call, as printed by the `zestats` command.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawCallStats {
    /// `false` while the call has no audio stream yet.
    pub found: bool,
    /// Codec of what we receive and of what we send.
    pub codec: String,
    pub tx_codec: String,
    pub clock_rate: u32,
    pub rtp: RawRtp,
    pub rtcp: RawRtcp,
    pub jbuf: RawJbuf,
    pub filters: RawFilters,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawRtp {
    pub tx_packets: u32,
    pub tx_bytes: u32,
    pub tx_errors: u32,
    pub tx_bitrate: u32,
    pub rx_packets: u32,
    pub rx_bytes: u32,
    pub rx_errors: u32,
    pub rx_bitrate: u32,
}

/// RTCP: `rx` is what we measure on the incoming stream, `tx` what the other side says about ours.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawRtcp {
    /// `false` until the first RTCP report: the values below are then not real.
    pub available: bool,
    pub tx_lost: i32,
    pub tx_jitter_us: u32,
    pub rx_lost: i32,
    pub rx_jitter_us: u32,
    pub rtt_us: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawJbuf {
    pub put: u32,
    pub get: u32,
    pub out_of_seq: u32,
    pub dups: u32,
    pub late: u32,
    pub late_lost: u32,
    pub lost: u32,
    pub overflow: u32,
    pub flush: u32,
    /// Delay the jitter buffer adds to the incoming audio right now.
    pub delay_ms: u32,
    pub packets: u32,
    pub jitter_ms: u32,
    pub skew_ms: i32,
}

/// How the audio blocks went through ZePhone's own audio filter, in one direction.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawFilter {
    pub frames: u64,
    /// Blocks that came much later than the previous one (cumulative).
    pub late: u64,
    /// Longest wait between two blocks since the previous report.
    pub gap_max_us: u32,
    /// Longest time the filter itself took on a block since the previous report.
    pub busy_max_us: u32,
    pub srate: u32,
    pub channels: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawRecording {
    pub on: bool,
    pub dropped_samples: u32,
    pub queued_max_bytes: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct RawFilters {
    /// What we receive, then what we send.
    pub rx: RawFilter,
    pub tx: RawFilter,
    pub recording: RawRecording,
}

// ----------------------------------------------------------- what the UI gets

/// Counters since the start of the call.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallStatsTotals {
    pub codec: String,
    pub tx_codec: String,
    pub clock_rate: u32,
    pub rx_packets: u32,
    pub tx_packets: u32,
    pub rx_bytes: u32,
    pub tx_bytes: u32,
    pub rx_errors: u32,
    pub tx_errors: u32,
    /// Incoming RTP packets that never arrived (RTCP), and the same as a percentage of what was expected.
    pub rx_lost: i32,
    pub loss_pct: f32,
    pub jbuf_lost: u32,
    pub jbuf_late: u32,
    pub jbuf_overflow: u32,
    pub jbuf_flush: u32,
    pub rx_late_blocks: u64,
    pub tx_late_blocks: u64,
    pub rec_dropped: u32,
}

/// What happened during the last second of a call.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CallStatsSample {
    pub call_id: String,
    /// When the sample was taken (Unix time, ms) and how long after the first one of the call (s).
    pub at_ms: i64,
    pub elapsed_secs: f32,
    /// Packets received / sent since the previous sample, and the bit rate over that time.
    pub rx_packets: u32,
    pub tx_packets: u32,
    pub rx_bitrate: u32,
    pub tx_bitrate: u32,
    /// Jitter measured on the incoming stream, and the one the other side measures on ours (RTCP).
    pub rx_jitter_ms: f32,
    pub tx_jitter_ms: f32,
    /// Round trip to the other side (RTCP); `None` until measured.
    pub rtt_ms: Option<f32>,
    pub jbuf_delay_ms: u32,
    pub jbuf_packets: u32,
    pub jbuf_skew_ms: i32,
    /// Incoming packets lost, too late, overflowing the buffer or arriving out of order in this second.
    pub jbuf_lost: u32,
    pub jbuf_late: u32,
    pub jbuf_overflow: u32,
    pub jbuf_flush: u32,
    pub jbuf_out_of_seq: u32,
    /// Longest wait between two audio blocks in this second, towards the speaker and from the microphone.
    pub rx_gap_max_ms: f32,
    pub tx_gap_max_ms: f32,
    pub rx_late_blocks: u32,
    pub tx_late_blocks: u32,
    /// Longest time spent in the audio filter on one block, in µs.
    pub rx_busy_max_us: u32,
    pub tx_busy_max_us: u32,
    /// Recorded samples that could not be kept in this second.
    pub rec_dropped: u32,
    pub totals: CallStatsTotals,
}

fn diff(now: u32, before: u32) -> u32 {
    now.saturating_sub(before) // a counter that restarted counts as nothing, not as a huge number
}

fn diff64(now: u64, before: u64) -> u32 {
    u32::try_from(now.saturating_sub(before)).unwrap_or(u32::MAX)
}

fn us_to_ms(us: u32) -> f32 {
    us as f32 / 1000.0
}

/// Turns the successive reports of one call into samples.
#[derive(Debug, Default)]
pub struct StatsTracker {
    before: RawCallStats,
    elapsed: f32,
}

impl StatsTracker {
    /// `dt_secs` is the time since the previous report (for the bit rates), `at_ms` the Unix time now.
    pub fn next(
        &mut self,
        call_id: &str,
        raw: &RawCallStats,
        dt_secs: f32,
        at_ms: i64,
    ) -> CallStatsSample {
        self.elapsed += dt_secs.max(0.0);
        let elapsed = self.elapsed;
        let b = &self.before;
        let bitrate = |bytes_now: u32, bytes_before: u32, reported: u32| -> u32 {
            if dt_secs > 0.05 {
                (f64::from(diff(bytes_now, bytes_before)) * 8.0 / f64::from(dt_secs)) as u32
            } else {
                reported
            }
        };
        let expected = i64::from(raw.rtp.rx_packets) + i64::from(raw.rtcp.rx_lost.max(0));
        let sample = CallStatsSample {
            call_id: call_id.to_owned(),
            at_ms,
            elapsed_secs: elapsed,
            rx_packets: diff(raw.rtp.rx_packets, b.rtp.rx_packets),
            tx_packets: diff(raw.rtp.tx_packets, b.rtp.tx_packets),
            rx_bitrate: bitrate(raw.rtp.rx_bytes, b.rtp.rx_bytes, raw.rtp.rx_bitrate),
            tx_bitrate: bitrate(raw.rtp.tx_bytes, b.rtp.tx_bytes, raw.rtp.tx_bitrate),
            rx_jitter_ms: us_to_ms(raw.rtcp.rx_jitter_us),
            tx_jitter_ms: us_to_ms(raw.rtcp.tx_jitter_us),
            rtt_ms: (raw.rtcp.available && raw.rtcp.rtt_us > 0).then(|| us_to_ms(raw.rtcp.rtt_us)),
            jbuf_delay_ms: raw.jbuf.delay_ms,
            jbuf_packets: raw.jbuf.packets,
            jbuf_skew_ms: raw.jbuf.skew_ms,
            jbuf_lost: diff(raw.jbuf.lost, b.jbuf.lost),
            jbuf_late: diff(raw.jbuf.late, b.jbuf.late),
            jbuf_overflow: diff(raw.jbuf.overflow, b.jbuf.overflow),
            jbuf_flush: diff(raw.jbuf.flush, b.jbuf.flush),
            jbuf_out_of_seq: diff(raw.jbuf.out_of_seq, b.jbuf.out_of_seq),
            rx_gap_max_ms: us_to_ms(raw.filters.rx.gap_max_us),
            tx_gap_max_ms: us_to_ms(raw.filters.tx.gap_max_us),
            rx_late_blocks: diff64(raw.filters.rx.late, b.filters.rx.late),
            tx_late_blocks: diff64(raw.filters.tx.late, b.filters.tx.late),
            rx_busy_max_us: raw.filters.rx.busy_max_us,
            tx_busy_max_us: raw.filters.tx.busy_max_us,
            rec_dropped: diff(
                raw.filters.recording.dropped_samples,
                b.filters.recording.dropped_samples,
            ),
            totals: CallStatsTotals {
                codec: raw.codec.clone(),
                tx_codec: raw.tx_codec.clone(),
                clock_rate: raw.clock_rate,
                rx_packets: raw.rtp.rx_packets,
                tx_packets: raw.rtp.tx_packets,
                rx_bytes: raw.rtp.rx_bytes,
                tx_bytes: raw.rtp.tx_bytes,
                rx_errors: raw.rtp.rx_errors,
                tx_errors: raw.rtp.tx_errors,
                rx_lost: raw.rtcp.rx_lost,
                loss_pct: if raw.rtcp.available && expected > 0 {
                    (f64::from(raw.rtcp.rx_lost.max(0)) * 100.0 / expected as f64) as f32
                } else {
                    0.0
                },
                jbuf_lost: raw.jbuf.lost,
                jbuf_late: raw.jbuf.late,
                jbuf_overflow: raw.jbuf.overflow,
                jbuf_flush: raw.jbuf.flush,
                rx_late_blocks: raw.filters.rx.late,
                tx_late_blocks: raw.filters.tx.late,
                rec_dropped: raw.filters.recording.dropped_samples,
            },
        };
        self.before = raw.clone();
        sample
    }
}

/// The samples of one call, oldest first, kept for the window that opens the statistics during the call.
#[derive(Debug, Default)]
pub struct CallStatsHistory {
    pub tracker: StatsTracker,
    samples: VecDeque<CallStatsSample>,
}

impl CallStatsHistory {
    pub fn push(&mut self, sample: CallStatsSample) {
        if self.samples.len() == HISTORY_MAX {
            self.samples.pop_front();
        }
        self.samples.push_back(sample);
    }

    pub fn samples(&self) -> Vec<CallStatsSample> {
        self.samples.iter().cloned().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What `zestats` prints (as written by the C module).
    const REPORT: &str = r#"{"found":true,"codec":"PCMA","txCodec":"PCMA","clockRate":8000,
        "rtp":{"txPackets":100,"txBytes":16000,"txErrors":0,"txBitrate":64000,"rxPackets":98,"rxBytes":15680,"rxErrors":0,"rxBitrate":63000},
        "rtcp":{"available":true,"txLost":0,"txJitterUs":1500,"rxLost":2,"rxJitterUs":4200,"rttUs":23000},
        "jbuf":{"put":98,"get":96,"outOfSeq":1,"dups":0,"late":3,"lateLost":1,"lost":2,"overflow":0,"flush":1,"delayMs":60,"packets":3,"jitterMs":12,"skewMs":-4},
        "filters":{"rx":{"frames":96,"late":4,"gapMaxUs":45000,"busyMaxUs":30,"srate":48000,"channels":1},
                   "tx":{"frames":100,"late":0,"gapMaxUs":21000,"busyMaxUs":12,"srate":48000,"channels":1},
                   "recording":{"on":true,"droppedSamples":0,"queuedMaxBytes":4096}}}"#;

    fn raw() -> RawCallStats {
        serde_json::from_str(REPORT).unwrap()
    }

    #[test]
    fn reads_what_the_c_module_prints() {
        let r = raw();
        assert!(r.found);
        assert_eq!((r.codec.as_str(), r.clock_rate), ("PCMA", 8000));
        assert_eq!(r.rtp.rx_packets, 98);
        assert_eq!(r.rtcp.rx_jitter_us, 4200);
        assert_eq!(r.jbuf.skew_ms, -4);
        assert_eq!(r.filters.rx.gap_max_us, 45_000);
        assert!(r.filters.recording.on);
    }

    #[test]
    fn a_report_with_missing_parts_still_reads() {
        // An older module without the filter section, or a call without audio yet.
        let r: RawCallStats = serde_json::from_str(r#"{"found":false}"#).unwrap();
        assert!(!r.found);
        let r: RawCallStats =
            serde_json::from_str(r#"{"found":true,"rtp":{"rxPackets":5}}"#).unwrap();
        assert_eq!(r.rtp.rx_packets, 5);
        assert_eq!(r.filters, RawFilters::default());
    }

    #[test]
    fn the_first_sample_counts_from_the_start_of_the_call() {
        let mut t = StatsTracker::default();
        let s = t.next("call1", &raw(), 1.0, 1_000);
        assert_eq!((s.rx_packets, s.tx_packets), (98, 100));
        assert_eq!(s.rx_bitrate, 15_680 * 8);
        assert_eq!(s.tx_bitrate, 16_000 * 8);
        assert_eq!(s.rx_jitter_ms, 4.2);
        assert_eq!(s.rtt_ms, Some(23.0));
        assert_eq!((s.jbuf_late, s.jbuf_lost, s.jbuf_flush), (3, 2, 1));
        assert_eq!(s.rx_gap_max_ms, 45.0);
        assert_eq!(s.rx_late_blocks, 4);
        assert_eq!(s.totals.rx_lost, 2);
        assert!((s.totals.loss_pct - 2.0).abs() < 0.01); // 2 lost of 100 expected
        assert_eq!(s.elapsed_secs, 1.0);
    }

    #[test]
    fn the_next_samples_are_the_difference_with_the_previous_report() {
        let mut t = StatsTracker::default();
        t.next("call1", &raw(), 1.0, 1_000);
        let mut r = raw();
        r.rtp.rx_packets += 50;
        r.rtp.rx_bytes += 8_000;
        r.jbuf.late += 2;
        r.filters.rx.late += 1;
        r.filters.rx.gap_max_us = 22_000;
        let s = t.next("call1", &r, 2.0, 3_000);
        assert_eq!(s.rx_packets, 50);
        assert_eq!(s.rx_bitrate, 8_000 * 8 / 2);
        assert_eq!((s.jbuf_late, s.jbuf_lost), (2, 0));
        assert_eq!(s.rx_late_blocks, 1);
        assert_eq!(s.rx_gap_max_ms, 22.0); // the maxima are read as they are: they already cover one window
        assert_eq!(s.elapsed_secs, 3.0);
        assert_eq!(s.totals.rx_packets, 148);
    }

    #[test]
    fn a_counter_that_restarts_never_makes_a_huge_difference() {
        let mut t = StatsTracker::default();
        t.next("c", &raw(), 1.0, 0);
        let mut r = raw();
        r.rtp.rx_packets = 3; // the stream was restarted
        r.filters.rx.late = 0;
        let s = t.next("c", &r, 1.0, 0);
        assert_eq!(s.rx_packets, 0);
        assert_eq!(s.rx_late_blocks, 0);
    }

    #[test]
    fn the_rtcp_values_are_ignored_until_the_first_report() {
        let mut r = raw();
        r.rtcp.available = false;
        let s = StatsTracker::default().next("c", &r, 1.0, 0);
        assert_eq!(s.rtt_ms, None);
        assert_eq!(s.totals.loss_pct, 0.0);
    }

    #[test]
    fn the_history_keeps_the_most_recent_samples() {
        let mut h = CallStatsHistory::default();
        for i in 0..(HISTORY_MAX + 5) {
            h.push(CallStatsSample {
                at_ms: i as i64,
                ..Default::default()
            });
        }
        let all = h.samples();
        assert_eq!(all.len(), HISTORY_MAX);
        assert_eq!(all.first().unwrap().at_ms, 5);
        assert_eq!(all.last().unwrap().at_ms, (HISTORY_MAX + 4) as i64);
    }
}
