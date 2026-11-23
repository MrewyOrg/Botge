//! Catalog authorization and persistence operations shared by adapters.
use super::access::FailureKind;
use super::{
  Application,
  access::{
    AccessError as ApiError, Credential, GuildAccess, GuildRole, Membership, membership, user_id,
  },
};
use botge_domain::{
  emotes::{Emote, GuildEmotes},
  settings::VoiceSettings,
};
use botge_storage::{AddEmoteOutcome, CatalogEditor};
use std::{num::NonZeroU64, sync::Arc};

/// The emote itself is already in the server catalog.
const ALREADY_ADDED: ApiError = ApiError(
  FailureKind::Conflict,
  "This emote is already in the server catalog.",
);
/// Another emote in the server catalog already uses the name, ignoring case.
const NAME_TAKEN: ApiError = ApiError(
  FailureKind::Conflict,
  "Another emote in the server catalog already uses this name.",
);
/// The server reached its limit of individually added emotes.
const CATALOG_FULL: ApiError = ApiError(
  FailureKind::Conflict,
  "This server already has the maximum of 1,000 added emotes.",
);

impl Application {
  /// Loads the guild's saved emote policy on the blocking pool.
  ///
  /// # Errors
  ///
  /// Returns an internal API error if the blocking database task or saved policy read fails.
  async fn emote_settings(&self, guild: NonZeroU64) -> Result<GuildEmotes, ApiError> {
    let store = Arc::clone(&self.store);
    database(move || store.guild_emotes(guild)).await
  }

  /// Distinguishes a missing 7TV emote from a failed upstream request.
  ///
  /// # Errors
  ///
  /// Returns not-found for an unavailable emote, or a gateway error for provider lookup failures.
  async fn lookup_emote(&self, id: &str) -> Result<Emote, ApiError> {
    self
      .fetch_added(id)
      .await
      .map_err(|error| {
        tracing::warn!(%error, message = "7TV emote lookup failed");
        ApiError(FailureKind::Upstream, "7TV is unavailable. Try again.")
      })?
      .ok_or(ApiError(
        FailureKind::NotFound,
        "Could not find that 7TV emote.",
      ))
  }

  /// Checks the catalog snapshot for conflicts, then lets storage enforce atomic insertion.
  ///
  /// The catalog check catches collisions with provider entries. The redb transaction checks
  /// the latest saved additions again, including additions made since the snapshot was loaded,
  /// such as an earlier item in the same batch.
  ///
  /// # Errors
  ///
  /// Returns a conflict naming the cause: the same emote, a taken name, or a full catalog. The
  /// stored list is checked atomically even when the snapshot is stale; database failures are
  /// internal errors.
  async fn add_to_catalog(
    &self,
    editor: CatalogEditor,
    emote: Emote,
    catalog: &botge_emotes::catalog::Catalog,
  ) -> Result<String, ApiError> {
    if catalog.into_iter().any(|entry| entry.id == emote.id) {
      return Err(ALREADY_ADDED);
    }
    if catalog
      .into_iter()
      .any(|entry| entry.name.eq_ignore_ascii_case(&emote.name))
    {
      return Err(NAME_TAKEN);
    }
    let store = Arc::clone(&self.store);
    let message = format!("Added emote {}.", emote.name);
    match database(move || store.add_emote(editor, emote)).await? {
      AddEmoteOutcome::Added => {
        self.catalog_changed(crate::CatalogChange::Guild(editor.guild));
        Ok(message)
      }
      AddEmoteOutcome::DuplicateId => Err(ALREADY_ADDED),
      AddEmoteOutcome::DuplicateName => Err(NAME_TAKEN),
      AddEmoteOutcome::Full => Err(CATALOG_FULL),
    }
  }

  /// Removes a stored addition and reports 404 when the guild has no matching row entry.
  ///
  /// # Errors
  ///
  /// Returns not-found if the ID is not individually added, or an internal database/task error.
  async fn remove_from_catalog(&self, editor: CatalogEditor, id: String) -> Result<(), ApiError> {
    let store = Arc::clone(&self.store);
    if !database(move || store.remove_emote(editor, &id)).await? {
      return Err(ApiError(
        FailureKind::NotFound,
        "This emote is not individually added.",
      ));
    }
    self.catalog_changed(crate::CatalogChange::Guild(editor.guild));
    Ok(())
  }

  /// Checks the operator switch and guild rules before allowing individual emote changes.
  ///
  /// When individual additions are enabled, access comes from administrator privileges, the
  /// guild's everyone setting, or a role listed in the saved manager rules.
  ///
  /// # Errors
  ///
  /// Returns a denial when the operator disables additions or the current member lacks the
  /// saved guild permissions. Credential, lookup, deadline, and database errors propagate.
  async fn authorize_change<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<CatalogEditor, ApiError> {
    if !self.added_emotes_enabled() {
      return Err(ApiError(
        FailureKind::PermissionDenied,
        "Added 7TV emotes are disabled by the operator.",
      ));
    }
    let member = membership(access, guild, credential).await?;
    if !member.can_manage_emotes(&self.emote_settings(guild).await?) {
      return Err(ApiError(
        FailureKind::PermissionDenied,
        "You do not have permission to manage added emotes.",
      ));
    }
    Ok(CatalogEditor {
      guild,
      actor: Some(user_id(access, credential).await?),
    })
  }

  /// Requires administrator access and returns the roles that can be shown in settings.
  ///
  /// # Errors
  ///
  /// Returns an error if current membership cannot be verified or the caller is not an
  /// administrator.
  pub(super) async fn authorize_settings<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<Vec<GuildRole>, ApiError> {
    let member = membership(access, guild, credential).await?;
    if !member.administrator {
      return Err(ApiError(
        FailureKind::PermissionDenied,
        "Only a server administrator can change emote settings.",
      ));
    }
    Ok(member.available_roles)
  }
}

impl Membership {
  /// Applies administrator access and the saved policy for ordinary members.
  fn can_manage_emotes(&self, settings: &GuildEmotes) -> bool {
    self.administrator || settings.allows_member_management(&self.roles)
  }
}

impl Application {
  /// Loads committed voice preferences off the async executor.
  ///
  /// # Errors
  /// Returns a sanitized storage or worker failure.
  async fn voice_settings(&self, guild: NonZeroU64) -> Result<VoiceSettings, ApiError> {
    let store = Arc::clone(&self.store);
    database(move || store.voice_settings(guild)).await
  }
}

/// Runs transactional work off the executor and sanitizes local failures.
///
/// # Errors
/// Returns a sanitized failure if the worker or operation fails.
pub(crate) async fn database<T: Send + 'static>(
  work: impl FnOnce() -> anyhow::Result<T> + Send + 'static,
) -> Result<T, ApiError> {
  tokio::task::spawn_blocking(work)
    .await
    .map_err(ApiError::internal)?
    .map_err(ApiError::internal)
}

/// A catalog and the current caller's permitted catalog actions.
#[derive(Debug)]
pub struct GuildCatalog {
  /// Borrowed provider snapshots and persisted additions in precedence order.
  pub entries: botge_emotes::catalog::Catalog,
  /// Whether the current guild rules permit individual additions/removals.
  pub can_manage: bool,
  /// Whether the operator enables individually discovered additions.
  pub can_compose_discovery: bool,
}
/// The mutation applied independently to every validated ID in a batch.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EmoteAction {
  /// Resolve and add each provider ID.
  Add,
  /// Remove each individually saved provider ID.
  Remove,
}
/// One committed or rejected batch item in original request order.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmoteChange {
  /// The requested provider identifier.
  pub emote_id: String,
  /// Whether this item committed successfully.
  pub ok: bool,
  /// A sanitized outcome message.
  pub message: String,
}
impl Application {
  /// Authorizes a guild catalog read and resolves its current capabilities.
  ///
  /// # Errors
  /// Returns current membership or saved-state failures.
  pub async fn guild_catalog<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<GuildCatalog, ApiError> {
    let member = membership(access, guild, credential).await?;
    let settings = self.emote_settings(guild).await?;
    let entries = self
      .catalog(Some(guild))
      .await
      .map_err(ApiError::internal)?;
    Ok(GuildCatalog {
      entries,
      can_manage: self.added_emotes_enabled() && member.can_manage_emotes(&settings),
      can_compose_discovery: self.added_emotes_enabled(),
    })
  }
  /// Checks current management permissions before resolving and adding an emote.
  ///
  /// # Errors
  /// Returns validation, authorization, provider, conflict or storage failures.
  pub async fn add_emote<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
    id: &str,
  ) -> Result<String, ApiError> {
    if !botge_domain::emotes::valid_seven_id(id) {
      return Err(ApiError::INVALID);
    }
    let editor = self.authorize_change(access, guild, credential).await?;
    let emote = self.lookup_emote(id).await?;
    let catalog = self
      .catalog(Some(guild))
      .await
      .map_err(ApiError::internal)?;
    self.add_to_catalog(editor, emote, &catalog).await
  }
  /// Checks current management permissions before removing a saved addition.
  ///
  /// # Errors
  /// Returns validation, authorization, missing-entry or storage failures.
  pub async fn remove_emote<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
    id: String,
  ) -> Result<(), ApiError> {
    if !botge_domain::emotes::valid_seven_id(&id) {
      return Err(ApiError::INVALID);
    }
    let editor = self.authorize_change(access, guild, credential).await?;
    self.remove_from_catalog(editor, id).await
  }
  /// Authorizes one bounded batch and commits each successful mutation independently.
  ///
  /// # Errors
  /// Returns request validation, authorization or initial catalog errors. Item failures remain in
  /// the returned outcomes, preserving earlier commits and original request order.
  pub async fn change_emotes<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
    action: EmoteAction,
    ids: Vec<String>,
  ) -> Result<Vec<EmoteChange>, ApiError> {
    let mut seen = std::collections::HashSet::new();
    if ids.is_empty()
      || ids.len() > 12
      || !ids
        .iter()
        .all(|id| botge_domain::emotes::valid_seven_id(id) && seen.insert(id))
    {
      return Err(ApiError::INVALID);
    }
    let editor = self.authorize_change(access, guild, credential).await?;
    let mut results = Vec::with_capacity(12);
    match action {
      EmoteAction::Add => {
        let (catalog, emotes) = tokio::join!(
          self.catalog(Some(guild)),
          futures_util::future::join_all(ids.iter().map(|id| self.lookup_emote(id)))
        );
        let catalog = catalog.map_err(ApiError::internal)?;
        for (id, emote) in ids.into_iter().zip(emotes) {
          let result = match emote {
            Ok(emote) => self.add_to_catalog(editor, emote, &catalog).await,
            Err(error) => Err(error),
          };
          results.push(change(id, result));
        }
      }
      EmoteAction::Remove => {
        for id in ids {
          let result = self
            .remove_from_catalog(editor, id.clone())
            .await
            .map(|()| "Removed emote.".to_owned());
          results.push(change(id, result));
        }
      }
    }
    Ok(results)
  }
  /// Resolves live administrator-only channel choices and committed preferences.
  ///
  /// # Errors
  /// Returns permission, Discord deadline or saved-state failures.
  pub async fn read_voice_settings<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<(VoiceSettings, Vec<super::access::VoiceChannel>), ApiError> {
    let channels = super::access::channels(access, guild, credential).await?;
    Ok((self.voice_settings(guild).await?, channels))
  }
  /// Authorizes and validates the preference, commits it, then wakes reconciliation.
  ///
  /// # Errors
  /// Returns invalid settings, channel the bot cannot join, authorization or persistence failures.
  /// No notification is sent before persistence succeeds.
  pub async fn save_voice_settings<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
    saved: VoiceSettings,
    changed: &tokio::sync::Notify,
  ) -> Result<(VoiceSettings, Vec<super::access::VoiceChannel>), ApiError> {
    if !saved.is_valid() {
      return Err(ApiError::INVALID);
    }
    let channels = super::access::channels(access, guild, credential).await?;
    if saved
      .channel_id
      .as_ref()
      .is_some_and(|id| !channels.iter().any(|channel| channel.id == *id))
    {
      return Err(ApiError::INVALID);
    }
    let store = Arc::clone(&self.store);
    let saved = database(move || {
      store.save_voice_settings(guild, &saved)?;
      Ok(saved)
    })
    .await?;
    changed.notify_one();
    Ok((saved, channels))
  }
  /// Authorizes the settings picker and reads committed guild policy.
  ///
  /// # Errors
  /// Returns current administrator authorization or saved-state failures.
  pub async fn read_emote_settings<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
  ) -> Result<(GuildEmotes, Vec<GuildRole>), ApiError> {
    let roles = self.authorize_settings(access, guild, credential).await?;
    Ok((self.emote_settings(guild).await?, roles))
  }
  /// Validates and replaces guild provider/manager policy after current administrator checks.
  ///
  /// # Errors
  /// Returns authorization, validation or persistence failures without a partial replacement.
  pub async fn save_emote_settings<A: GuildAccess>(
    &self,
    access: &A,
    guild: NonZeroU64,
    credential: &Credential,
    saved: GuildEmotes,
  ) -> Result<(GuildEmotes, Vec<GuildRole>), ApiError> {
    let roles = self.authorize_settings(access, guild, credential).await?;
    if !saved.valid() {
      return Err(ApiError::INVALID);
    }
    let store = Arc::clone(&self.store);
    let editor = CatalogEditor {
      guild,
      actor: Some(user_id(access, credential).await?),
    };
    let saved = database(move || {
      store.save_guild_emotes(editor, &saved)?;
      Ok(saved)
    })
    .await?;
    self.catalog_changed(crate::CatalogChange::Guild(guild));
    Ok((saved, roles))
  }
  /// Reads a personal border under the current credential's authenticated identity.
  ///
  /// # Errors
  /// Returns identity, lookup deadline or storage failures.
  pub async fn read_border<A: GuildAccess>(
    &self,
    access: &A,
    credential: &Credential,
  ) -> Result<Option<u32>, ApiError> {
    let user = user_id(access, credential).await?;
    self.border_for_user(user).await.map_err(ApiError::internal)
  }
  /// Writes a personal border under the credential's identity, never a request-supplied user ID.
  ///
  /// # Errors
  /// Returns invalid color, identity, lookup deadline or storage failures.
  pub async fn save_border<A: GuildAccess>(
    &self,
    access: &A,
    credential: &Credential,
    color: Option<u32>,
  ) -> Result<(), ApiError> {
    if color.is_some_and(|color| color > 0x00ff_ffff) {
      return Err(ApiError::INVALID);
    }
    let user = user_id(access, credential).await?;
    let store = Arc::clone(&self.store);
    database(move || store.save_emote_border(user, color)).await
  }
}
fn change(emote_id: String, result: Result<String, ApiError>) -> EmoteChange {
  match result {
    Ok(message) => EmoteChange {
      emote_id,
      ok: true,
      message,
    },
    Err(error) => EmoteChange {
      emote_id,
      ok: false,
      message: error.1.to_owned(),
    },
  }
}

#[cfg(test)]
mod tests;
