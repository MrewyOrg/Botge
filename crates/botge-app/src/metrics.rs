//! In-process counters rendered in the Prometheus text exposition format.
//!
//! Labels come from fixed sets: command names outside the registered list are counted as
//! `other`, and Activity routes come from the router's own route table. The series count stays
//! bounded however callers behave. Values reset when the process restarts.

use std::{
  collections::BTreeMap,
  sync::{Mutex, PoisonError},
  time::Duration,
};

/// Upper bucket bounds in milliseconds with their exposition labels in seconds.
const RENDER_BUCKETS: [(u64, &str); 9] = [
  (100, "0.1"),
  (250, "0.25"),
  (500, "0.5"),
  (1_000, "1"),
  (2_500, "2.5"),
  (5_000, "5"),
  (10_000, "10"),
  (25_000, "25"),
  (40_000, "40"),
];

/// Discord command labels; any other name is recorded as `other`.
const COMMANDS: [&str; 6] = [
  "emote-compose",
  "emote-shortcuts",
  "clear-messages",
  "prefix-compose",
  "quantum-emote",
  "react-emote",
];

/// How a composition request ended.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(super) enum Outcome {
  /// An image was produced.
  Image,
  /// The input was rejected or named an unavailable emote.
  Rejected,
  /// Another render held the single render slot.
  Busy,
  /// Lookup, download, or rendering failed.
  Error,
}

impl Outcome {
  /// The exposition label value.
  const fn label(self) -> &'static str {
    match self {
      Self::Image => "image",
      Self::Rejected => "rejected",
      Self::Busy => "busy",
      Self::Error => "error",
    }
  }
}

/// How a `/quantum-emote` draw ended, before any rendering.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum QuantumOutcome {
  /// The sidecar returned an in-pool sample that selected two emotes.
  Sampled,
  /// The catalog had fewer than two base or two overlay emotes; the sidecar was not called.
  TooFew,
  /// Too many quantum requests were already waiting on the sidecar.
  Busy,
  /// The sidecar could not be reached, timed out or failed.
  Unavailable,
  /// The sidecar rejected the request.
  Refused,
  /// Rejection sampling exhausted its shot budget.
  Exhausted,
  /// The sidecar's answer did not match the request.
  Invalid,
}

impl QuantumOutcome {
  /// The exposition label value.
  const fn label(self) -> &'static str {
    match self {
      Self::Sampled => "sampled",
      Self::TooFew => "too_few",
      Self::Busy => "busy",
      Self::Unavailable => "unavailable",
      Self::Refused => "refused",
      Self::Exhausted => "exhausted",
      Self::Invalid => "invalid",
    }
  }
}

/// How a `/react-emote` call ended, before any emote rendering.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub enum ChemistryOutcome {
  /// The sidecar reported a chemical reaction and projected a valid pair.
  Reacted,
  /// The two substrates do not react under the chosen condition.
  NoReaction,
  /// The catalog had fewer than two base or two overlay emotes; the sidecar was not called.
  TooFew,
  /// Too many chemistry requests were already waiting on the sidecar.
  Busy,
  /// The sidecar could not be reached, timed out, or returned 5xx.
  Unavailable,
  /// The sidecar rejected the request.
  Refused,
  /// The sidecar's answer failed validation.
  Invalid,
}

impl ChemistryOutcome {
  /// The exposition label value.
  const fn label(self) -> &'static str {
    match self {
      Self::Reacted => "reacted",
      Self::NoReaction => "no_reaction",
      Self::TooFew => "too_few",
      Self::Busy => "busy",
      Self::Unavailable => "unavailable",
      Self::Refused => "refused",
      Self::Invalid => "invalid",
    }
  }
}

/// Counter state guarded by one lock; no lock is held across an await.
#[derive(Clone, Debug, Default)]
struct State {
  commands: BTreeMap<&'static str, u64>,
  compositions: BTreeMap<Outcome, u64>,
  quantum: BTreeMap<QuantumOutcome, u64>,
  chemistry: BTreeMap<ChemistryOutcome, u64>,
  requests: BTreeMap<(String, u16), u64>,
  render_buckets: [u64; RENDER_BUCKETS.len()],
  render_count: u64,
  render_sum_ms: u64,
}

/// Process-wide operation counters shared by the adapters through the application.
#[derive(Debug, Default)]
pub struct Metrics(Mutex<State>);

impl Metrics {
  /// Runs `change` on the counters. A panic while counting cannot leave them unusable.
  fn update(&self, change: impl FnOnce(&mut State)) {
    change(&mut self.0.lock().unwrap_or_else(PoisonError::into_inner));
  }

  /// Counts one Discord command or prefix composition.
  pub fn command(&self, name: &str) {
    let label = COMMANDS
      .into_iter()
      .find(|known| *known == name)
      .unwrap_or("other");
    self.update(|state| *state.commands.entry(label).or_default() += 1);
  }

  /// Counts one Activity API response by its matched route and HTTP status.
  pub fn activity_request(&self, route: &str, status: u16) {
    self.update(|state| {
      *state
        .requests
        .entry((route.to_owned(), status))
        .or_default() += 1;
    });
  }

  /// Counts how one `/quantum-emote` draw ended.
  pub fn quantum(&self, outcome: QuantumOutcome) {
    self.update(|state| *state.quantum.entry(outcome).or_default() += 1);
  }

  /// Counts how one `/react-emote` call ended.
  pub fn chemistry(&self, outcome: ChemistryOutcome) {
    self.update(|state| *state.chemistry.entry(outcome).or_default() += 1);
  }

  /// Counts a composition outcome. Image outcomes also record their duration.
  pub(crate) fn composition(&self, outcome: Outcome, elapsed: Duration) {
    let milliseconds = u64::try_from(elapsed.as_millis()).unwrap_or(u64::MAX);
    self.update(|state| {
      *state.compositions.entry(outcome).or_default() += 1;
      if outcome != Outcome::Image {
        return;
      }
      state.render_count += 1;
      state.render_sum_ms = state.render_sum_ms.saturating_add(milliseconds);
      for (bucket, (bound, _)) in state.render_buckets.iter_mut().zip(RENDER_BUCKETS) {
        if milliseconds <= bound {
          *bucket += 1;
        }
      }
    });
  }

  /// Writes every series with its help and type lines.
  ///
  /// `reconnects` is the 7TV event stream's disconnect count, owned by the provider client.
  /// The counters are copied under the lock and formatted after it is released.
  pub(crate) fn render(&self, reconnects: u64) -> String {
    let state = self
      .0
      .lock()
      .unwrap_or_else(PoisonError::into_inner)
      .clone();
    let mut lines = Vec::new();
    family(
      &mut lines,
      "commands_total",
      "counter",
      "Discord commands received.",
    );
    for (command, count) in &state.commands {
      lines.push(format!(
        "botge_commands_total{{command=\"{command}\"}} {count}"
      ));
    }
    family(
      &mut lines,
      "compositions_total",
      "counter",
      "Emote compositions by outcome.",
    );
    for (outcome, count) in &state.compositions {
      let outcome = outcome.label();
      lines.push(format!(
        "botge_compositions_total{{outcome=\"{outcome}\"}} {count}"
      ));
    }
    family(
      &mut lines,
      "quantum_samples_total",
      "counter",
      "Quantum emote draws by outcome.",
    );
    for (outcome, count) in &state.quantum {
      let outcome = outcome.label();
      lines.push(format!(
        "botge_quantum_samples_total{{outcome=\"{outcome}\"}} {count}"
      ));
    }
    family(
      &mut lines,
      "chemistry_reactions_total",
      "counter",
      "Organic chemistry emote reactions by outcome.",
    );
    for (outcome, count) in &state.chemistry {
      let outcome = outcome.label();
      lines.push(format!(
        "botge_chemistry_reactions_total{{outcome=\"{outcome}\"}} {count}"
      ));
    }
    family(
      &mut lines,
      "render_seconds",
      "histogram",
      "Time to resolve, download, and render successful compositions.",
    );
    for (count, (_, bound)) in state.render_buckets.iter().zip(RENDER_BUCKETS) {
      lines.push(format!(
        "botge_render_seconds_bucket{{le=\"{bound}\"}} {count}"
      ));
    }
    let (count, sum) = (state.render_count, state.render_sum_ms);
    lines.push(format!(
      "botge_render_seconds_bucket{{le=\"+Inf\"}} {count}"
    ));
    lines.push(format!(
      "botge_render_seconds_sum {}.{:03}",
      sum / 1000,
      sum % 1000
    ));
    lines.push(format!("botge_render_seconds_count {count}"));
    family(
      &mut lines,
      "activity_requests_total",
      "counter",
      "Activity API responses by route and status.",
    );
    for ((route, status), count) in &state.requests {
      lines.push(format!(
        "botge_activity_requests_total{{route=\"{route}\",status=\"{status}\"}} {count}"
      ));
    }
    family(
      &mut lines,
      "seventv_reconnects_total",
      "counter",
      "7TV event stream disconnects.",
    );
    lines.push(format!("botge_seventv_reconnects_total {reconnects}"));
    lines.push(String::new());
    lines.join("\n")
  }
}

/// Adds the help and type lines that introduce the `botge_`-prefixed metric family `name`.
fn family(lines: &mut Vec<String>, name: &str, kind: &str, help: &str) {
  lines.push(format!("# HELP botge_{name} {help}"));
  lines.push(format!("# TYPE botge_{name} {kind}"));
}

#[cfg(test)]
mod tests;
