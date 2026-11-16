//! Remote control of the softphone: one vocabulary ([`command`]), one rule to pick the call ([`select`]), one
//! executor ([`controller`]), and the ways to reach it: global keyboard shortcuts (`crate::shortcuts`), the tray
//! menu, and the command line `zephone ctl` over a private local socket ([`socket`], [`cli`]).

pub mod cli;
pub mod command;
pub mod controller;
pub mod select;
pub mod socket;

use async_trait::async_trait;

use crate::{
    error::AppResult,
    sip::{manager::SipManager, types::Call},
};
use command::{AccountBrief, AppStatus};
use controller::Telephony;

/// The real core: the very functions the buttons of the interface call.
#[async_trait]
impl Telephony for SipManager {
    fn calls(&self) -> Vec<Call> {
        SipManager::calls(self)
    }
    fn engine_running(&self) -> bool {
        self.is_engine_running()
    }
    fn status(&self) -> AppResult<AppStatus> {
        let connected = self.connected_account_ids();
        let accounts = self
            .list_accounts()?
            .into_iter()
            .map(|v| AccountBrief {
                connected: connected.contains(&v.account.id),
                id: v.account.id,
                label: v.account.label,
                is_default: v.account.is_default,
            })
            .collect();
        Ok(AppStatus {
            engine_running: self.is_engine_running(),
            do_not_disturb: self.do_not_disturb()?,
            accounts,
            calls: SipManager::calls(self),
        })
    }
    async fn dial(&self, target: &str, account_id: Option<&str>) -> AppResult<Call> {
        SipManager::dial(self, target, account_id).await
    }
    async fn answer(&self, id: &str) -> AppResult<()> {
        SipManager::answer(self, id).await
    }
    async fn reject(&self, id: &str) -> AppResult<()> {
        SipManager::reject(self, id).await
    }
    async fn hangup(&self, id: &str) -> AppResult<()> {
        SipManager::hangup(self, id).await
    }
    async fn hold(&self, id: &str) -> AppResult<()> {
        SipManager::hold(self, id).await
    }
    async fn resume(&self, id: &str) -> AppResult<()> {
        SipManager::resume(self, id).await
    }
    async fn set_mute(&self, id: &str, muted: bool) -> AppResult<()> {
        SipManager::set_mute(self, id, muted).await
    }
    fn do_not_disturb(&self) -> AppResult<bool> {
        SipManager::do_not_disturb(self)
    }
    async fn set_do_not_disturb(&self, on: bool) -> AppResult<()> {
        SipManager::set_do_not_disturb(self, on).await
    }
}
