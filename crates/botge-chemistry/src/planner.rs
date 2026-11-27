//! Request planning and strict validation of sidecar reaction responses.

use botge_domain::emotes::Emote;

use crate::{
  ChemError, Condition, Diagram, Pools, ReactRequest, ReactResponse, substrate_index,
  types::decode_diagram_png,
};

/// Reactant base-index avoidance requires at least three base emotes (`prop:chem-budget`).
const AVOIDANCE_THRESHOLD: u32 = 3;

/// Plans one `/react-emote` call and checks the sidecar response against the guild's pools.
#[derive(Clone, Debug)]
pub struct Plan<'a> {
  pools: Pools<'a>,
  emote_a: &'a Emote,
  emote_b: &'a Emote,
  condition: Condition,
  diagram: Diagram,
  excluded: Vec<u32>,
}

impl<'a> Plan<'a> {
  /// Creates a reaction plan for `emote_a` + `emote_b` under `condition`.
  #[must_use]
  pub fn new(
    pools: Pools<'a>,
    emote_a: &'a Emote,
    emote_b: &'a Emote,
    condition: Condition,
    diagram: Diagram,
  ) -> Self {
    let mut excluded = Vec::new();
    if pools.budget().base_pool() >= AVOIDANCE_THRESHOLD {
      if let Some(idx) = pools.base_index_of(emote_a) {
        excluded.push(idx);
      }
      if let Some(idx) = pools.base_index_of(emote_b)
        && !excluded.contains(&idx)
      {
        excluded.push(idx);
      }
    }
    Self {
      pools,
      emote_a,
      emote_b,
      condition,
      diagram,
      excluded,
    }
  }

  /// Builds the strict JSON request payload for `POST /v1/react`.
  #[must_use]
  pub fn request(&self) -> ReactRequest {
    let budget = self.pools.budget();
    ReactRequest {
      reactant_a: substrate_index(&self.emote_a.id),
      reactant_b: substrate_index(&self.emote_b.id),
      condition: self.condition,
      base_pool_size: budget.base_pool(),
      overlay_pool_size: budget.overlay_pool(),
      exclude_base_indices: self.excluded.clone(),
      include_diagram: self.diagram.is_included(),
    }
  }

  /// Validates and resolves a sidecar [`ReactResponse`] against this plan's pools.
  ///
  /// # Errors
  ///
  /// Returns [`ChemError::Invalid`] if indices fall outside the pools, reactant avoidance was
  /// violated, chemical metadata is malformed, or the PNG diagram violates bounds or expectations.
  pub fn resolve(&self, response: ReactResponse) -> Result<Outcome<'a>, ChemError> {
    match response {
      ReactResponse::Reacted {
        reaction_id,
        reaction_name,
        condition_used,
        substrate_a_name,
        substrate_b_name,
        product_smiles,
        product_formula,
        product_mw,
        inchi_key,
        base_index,
        overlay_index,
        diagram_png_b64,
      } => {
        if condition_used == Condition::Auto
          || reaction_id.trim().is_empty()
          || reaction_name.trim().is_empty()
          || substrate_a_name.trim().is_empty()
          || substrate_b_name.trim().is_empty()
          || product_smiles.trim().is_empty()
          || product_formula.trim().is_empty()
          || inchi_key.trim().is_empty()
          || !product_mw.is_finite()
          || product_mw <= 0.0
          || self.excluded.contains(&base_index)
        {
          return Err(ChemError::Invalid);
        }
        let base = usize::try_from(base_index)
          .ok()
          .and_then(|idx| self.pools.base().get(idx))
          .copied()
          .ok_or(ChemError::Invalid)?;
        let overlay = usize::try_from(overlay_index)
          .ok()
          .and_then(|idx| self.pools.overlay().get(idx))
          .copied()
          .ok_or(ChemError::Invalid)?;
        let diagram_png = match (self.diagram, diagram_png_b64) {
          (Diagram::Include, Some(encoded)) => Some(decode_diagram_png(&encoded)?),
          (Diagram::Omit, None) => None,
          (Diagram::Include, None) | (Diagram::Omit, Some(_)) => return Err(ChemError::Invalid),
        };
        Ok(Outcome::Reacted(ReactionSelection {
          emote_a: self.emote_a,
          emote_b: self.emote_b,
          base,
          overlay,
          reaction_name,
          condition_used,
          substrate_a_name,
          substrate_b_name,
          product_formula,
          product_mw,
          diagram_png,
        }))
      }
      ReactResponse::NoReaction {
        substrate_a_name,
        substrate_a_group,
        substrate_b_name,
        substrate_b_group,
        reason,
        hint_condition,
        hint_reaction,
      } => {
        if substrate_a_name.trim().is_empty()
          || substrate_b_name.trim().is_empty()
          || reason.trim().is_empty()
          || hint_condition == Some(Condition::Auto)
        {
          return Err(ChemError::Invalid);
        }
        Ok(Outcome::NoReaction(NoReactionReport {
          emote_a: self.emote_a,
          emote_b: self.emote_b,
          substrate_a_name,
          substrate_a_group,
          substrate_b_name,
          substrate_b_group,
          reason,
          hint_condition,
          hint_reaction,
        }))
      }
    }
  }
}

/// Resolved chemical outcome ready for Discord rendering or ephemeral explanation.
#[derive(Clone, Debug, PartialEq)]
pub enum Outcome<'a> {
  /// Substrates reacted into a projected `(base, overlay)` pair with optional 2D diagram.
  Reacted(ReactionSelection<'a>),
  /// Substrates did not react under the requested condition.
  NoReaction(NoReactionReport<'a>),
}

/// Projected emote pair and chemical caption metadata for a successful reaction.
#[derive(Clone, Debug, PartialEq)]
pub struct ReactionSelection<'a> {
  pub(crate) emote_a: &'a Emote,
  pub(crate) emote_b: &'a Emote,
  pub(crate) base: &'a Emote,
  pub(crate) overlay: &'a Emote,
  pub(crate) reaction_name: String,
  pub(crate) condition_used: Condition,
  pub(crate) substrate_a_name: String,
  pub(crate) substrate_b_name: String,
  pub(crate) product_formula: String,
  pub(crate) product_mw: f64,
  pub(crate) diagram_png: Option<Vec<u8>>,
}

impl<'a> ReactionSelection<'a> {
  /// The projected base emote.
  #[must_use]
  pub const fn base(&self) -> &'a Emote {
    self.base
  }

  /// The projected overlay emote, rendered over [`Self::base`].
  #[must_use]
  pub const fn overlay(&self) -> &'a Emote {
    self.overlay
  }

  /// The dark-mode 2D skeletal PNG bytes, if requested.
  #[must_use]
  pub fn diagram_png(&self) -> Option<&[u8]> {
    self.diagram_png.as_deref()
  }
}

/// Ephemeral explanation when two substrates are chemically incompatible.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NoReactionReport<'a> {
  pub(crate) emote_a: &'a Emote,
  pub(crate) emote_b: &'a Emote,
  pub(crate) substrate_a_name: String,
  pub(crate) substrate_a_group: String,
  pub(crate) substrate_b_name: String,
  pub(crate) substrate_b_group: String,
  pub(crate) reason: String,
  pub(crate) hint_condition: Option<Condition>,
  pub(crate) hint_reaction: Option<String>,
}

#[cfg(test)]
mod tests;
