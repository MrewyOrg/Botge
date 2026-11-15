//! Persistence capability consumed by the voice reconciler.
use botge_domain::settings::VoiceSettings;
use botge_storage::Store;
use std::{num::NonZeroU64, sync::Arc};
/// Saved voice settings with distinct storage and worker failures.
pub type SettingsLoad =
  Result<anyhow::Result<Vec<(NonZeroU64, VoiceSettings)>>, tokio::task::JoinError>;
/// Loads saved voice state without blocking the async executor.
pub trait VoiceSettingsSource: Send + Sync + 'static {
  /// Loads every guild preference on a blocking worker.
  fn load_voice_settings(self: Arc<Self>) -> impl Future<Output = SettingsLoad> + Send;
}
impl VoiceSettingsSource for Store {
  async fn load_voice_settings(self: Arc<Self>) -> SettingsLoad {
    tokio::task::spawn_blocking(move || self.all_voice_settings()).await
  }
}
impl VoiceSettingsSource for super::Application {
  async fn load_voice_settings(self: Arc<Self>) -> SettingsLoad {
    Arc::clone(&self.store).load_voice_settings().await
  }
}
