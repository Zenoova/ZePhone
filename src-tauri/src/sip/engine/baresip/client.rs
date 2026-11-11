//! Client for Baresip's `ctrl_tcp` module (netstring-framed JSON over TCP).
//!
//! Requests carry a unique `token`; the matching response is routed back to the
//! caller. Events are forwarded on a channel. The connection is loopback only.

use std::{
    collections::HashMap,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};

use serde_json::json;
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{
        TcpStream,
        tcp::{OwnedReadHalf, OwnedWriteHalf},
    },
    sync::{mpsc, oneshot},
};

use crate::sip::engine::{
    EngineError, EngineResult,
    netstring::{self, Decoder},
    protocol::{self, Message, RawEvent, Response},
};

pub const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

type Pending = Arc<Mutex<HashMap<String, oneshot::Sender<Response>>>>;

pub struct ControlClient {
    writer: tokio::sync::Mutex<OwnedWriteHalf>,
    pending: Pending,
    next_token: AtomicU64,
    closed: Arc<std::sync::atomic::AtomicBool>,
}

fn reject_control_chars(s: &str) -> EngineResult<()> {
    if s.chars().any(char::is_control) {
        return Err(EngineError::Invalid("caractères de contrôle interdits dans une commande".into()));
    }
    Ok(())
}

impl ControlClient {
    /// Connects to `127.0.0.1:port` and starts the reader task. Events are sent to
    /// `events`; when the connection ends, `on_close` fires.
    pub async fn connect(
        port: u16,
        events: mpsc::UnboundedSender<RawEvent>,
        on_close: oneshot::Sender<String>,
    ) -> std::io::Result<Arc<Self>> {
        let stream = TcpStream::connect(("127.0.0.1", port)).await?;
        stream.set_nodelay(true).ok();
        let (read, write) = stream.into_split();
        let pending: Pending = Arc::default();
        let closed = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let client = Arc::new(ControlClient {
            writer: tokio::sync::Mutex::new(write),
            pending: pending.clone(),
            next_token: AtomicU64::new(1),
            closed: closed.clone(),
        });
        tokio::spawn(read_loop(read, pending, events, on_close, closed));
        Ok(client)
    }

    pub fn is_closed(&self) -> bool {
        self.closed.load(Ordering::SeqCst)
    }

    /// Sends one command and waits for its response.
    pub async fn request(&self, command: &str, params: &str) -> EngineResult<Response> {
        self.request_with_timeout(command, params, REQUEST_TIMEOUT).await
    }

    pub async fn request_with_timeout(&self, command: &str, params: &str, timeout: Duration) -> EngineResult<Response> {
        reject_control_chars(command)?;
        reject_control_chars(params)?;
        if self.is_closed() {
            return Err(EngineError::NotRunning);
        }
        let token = self.next_token.fetch_add(1, Ordering::SeqCst).to_string();
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(token.clone(), tx);

        let body = json!({ "command": command, "params": params, "token": token }).to_string();
        let frame = netstring::encode(body.as_bytes());
        {
            let mut w = self.writer.lock().await;
            if let Err(e) = w.write_all(&frame).await {
                self.pending.lock().unwrap().remove(&token);
                return Err(EngineError::Io(e.to_string()));
            }
        }
        match tokio::time::timeout(timeout, rx).await {
            Ok(Ok(resp)) => Ok(resp),
            Ok(Err(_)) => Err(EngineError::NotRunning), // connection closed while waiting
            Err(_) => {
                self.pending.lock().unwrap().remove(&token);
                Err(EngineError::Timeout)
            }
        }
    }
}

async fn read_loop(
    mut read: OwnedReadHalf,
    pending: Pending,
    events: mpsc::UnboundedSender<RawEvent>,
    on_close: oneshot::Sender<String>,
    closed: Arc<std::sync::atomic::AtomicBool>,
) {
    let mut decoder = Decoder::new();
    let mut buf = vec![0u8; 16 * 1024];
    let reason = 'outer: loop {
        match read.read(&mut buf).await {
            Ok(0) => break "connexion fermée par le moteur".to_owned(),
            Ok(n) => decoder.push(&buf[..n]),
            Err(e) => break format!("erreur de lecture : {e}"),
        }
        loop {
            match decoder.next_frame() {
                Ok(Some(frame)) => match protocol::parse_message(&frame) {
                    Ok(Message::Response(resp)) => {
                        if let Some(token) = &resp.token {
                            if let Some(tx) = pending.lock().unwrap().remove(token) {
                                let _ = tx.send(resp);
                            }
                        }
                    }
                    Ok(Message::Event(ev)) => {
                        let _ = events.send(ev);
                    }
                    Ok(Message::Other) => {}
                    Err(e) => log::warn!("baresip: ignoring malformed message: {e}"),
                },
                Ok(None) => break,
                Err(e) => break 'outer format!("flux corrompu : {e}"),
            }
        }
    };
    closed.store(true, Ordering::SeqCst);
    // Wake every waiter: dropping the senders yields `NotRunning`.
    pending.lock().unwrap().clear();
    let _ = on_close.send(reason);
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::net::TcpListener;

    /// Minimal fake of baresip's ctrl_tcp: answers every command with
    /// `{"response":true,"ok":true,"data":"echo:<command> <params>","token":..}`
    /// and pushes one event right after connect.
    async fn fake_server(listener: TcpListener, hang_on: Option<&'static str>) {
        let (mut sock, _) = listener.accept().await.unwrap();
        let ev = netstring::encode(
            br#"{"event":true,"class":"ua","type":"CREATE","accountaor":"sip:1@x","param":"sip:1@x"}"#,
        );
        sock.write_all(&ev).await.unwrap();
        let mut dec = Decoder::new();
        let mut buf = [0u8; 4096];
        loop {
            let n = match sock.read(&mut buf).await {
                Ok(0) | Err(_) => return,
                Ok(n) => n,
            };
            dec.push(&buf[..n]);
            while let Some(frame) = dec.next_frame().unwrap() {
                let req: serde_json::Value = serde_json::from_slice(&frame).unwrap();
                let cmd = req["command"].as_str().unwrap().to_owned();
                if Some(cmd.as_str()) == hang_on {
                    continue; // never answer
                }
                if cmd == "die" {
                    return; // drop the socket
                }
                let resp = json!({
                    "response": true,
                    "ok": cmd != "fail",
                    "data": format!("echo:{} {}", cmd, req["params"].as_str().unwrap()),
                    "token": req["token"],
                });
                sock.write_all(&netstring::encode(resp.to_string().as_bytes())).await.unwrap();
            }
        }
    }

    async fn setup(hang_on: Option<&'static str>) -> (Arc<ControlClient>, mpsc::UnboundedReceiver<RawEvent>, oneshot::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(fake_server(listener, hang_on));
        let (etx, erx) = mpsc::unbounded_channel();
        let (ctx, crx) = oneshot::channel();
        let client = ControlClient::connect(port, etx, ctx).await.unwrap();
        (client, erx, crx)
    }

    #[tokio::test]
    async fn request_response_and_events() {
        let (client, mut events, _close) = setup(None).await;
        let ev = events.recv().await.unwrap();
        assert_eq!(ev.kind, "CREATE");
        let r = client.request("reginfo", "").await.unwrap();
        assert!(r.ok);
        assert_eq!(r.data, "echo:reginfo ");
        let r = client.request("dial", "sip:bob@example.com").await.unwrap();
        assert_eq!(r.data, "echo:dial sip:bob@example.com");
    }

    #[tokio::test]
    async fn concurrent_requests_are_correlated_by_token() {
        let (client, _events, _close) = setup(None).await;
        let mut handles = vec![];
        for i in 0..20 {
            let c = client.clone();
            handles.push(tokio::spawn(async move {
                let r = c.request("cmd", &format!("n{i}")).await.unwrap();
                assert_eq!(r.data, format!("echo:cmd n{i}"));
            }));
        }
        for h in handles {
            h.await.unwrap();
        }
    }

    #[tokio::test]
    async fn failed_command_is_reported_not_ok() {
        let (client, _e, _c) = setup(None).await;
        assert!(!client.request("fail", "").await.unwrap().ok);
    }

    #[tokio::test]
    async fn times_out_when_engine_does_not_answer() {
        let (client, _e, _c) = setup(Some("hang")).await;
        let err = client.request_with_timeout("hang", "", Duration::from_millis(150)).await.unwrap_err();
        assert!(matches!(err, EngineError::Timeout));
        // The client is still usable afterwards.
        assert!(client.request("reginfo", "").await.unwrap().ok);
    }

    #[tokio::test]
    async fn connection_loss_is_signalled_and_fails_pending_requests() {
        let (client, _e, close) = setup(None).await;
        let err = client.request("die", "").await.unwrap_err();
        assert!(matches!(err, EngineError::NotRunning), "{err:?}");
        assert!(close.await.is_ok());
        assert!(client.is_closed());
        assert!(matches!(client.request("x", "").await.unwrap_err(), EngineError::NotRunning));
    }

    #[tokio::test]
    async fn refuses_control_characters() {
        let (client, _e, _c) = setup(None).await;
        assert!(matches!(client.request("dial", "sip:a@b\nquit").await.unwrap_err(), EngineError::Invalid(_)));
    }

    #[tokio::test]
    async fn connect_fails_cleanly_when_nothing_listens() {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = l.local_addr().unwrap().port();
        drop(l);
        let (etx, _erx) = mpsc::unbounded_channel();
        let (ctx, _crx) = oneshot::channel();
        assert!(ControlClient::connect(port, etx, ctx).await.is_err());
    }
}
