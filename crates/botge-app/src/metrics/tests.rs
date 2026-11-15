//! Checks label bounds, histogram buckets, and the exposition text.

#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use super::*;

/// Returns the value of the series line that starts with `series`.
fn value(text: &str, series: &str) -> Option<String> {
  text
    .lines()
    .find_map(|line| line.strip_prefix(series)?.strip_prefix(' '))
    .map(str::to_owned)
}

#[test]
fn bounds_command_labels_and_counts_responses_by_route() {
  let metrics = Metrics::default();
  for name in [
    "emote-compose",
    "emote-compose",
    "prefix-compose",
    "drop table",
    "x",
  ] {
    metrics.command(name);
  }
  metrics.activity_request("/catalog", 200);
  metrics.activity_request("/catalog", 200);
  metrics.activity_request("/catalog", 503);
  let text = metrics.render(3);
  let command = |name: &str| {
    value(
      &text,
      &format!("botge_commands_total{{command=\"{name}\"}}"),
    )
  };
  assert_eq!(command("emote-compose").as_deref(), Some("2"));
  assert_eq!(command("prefix-compose").as_deref(), Some("1"));
  assert_eq!(command("other").as_deref(), Some("2"));
  assert_eq!(command("drop table"), None);
  let request = |status: u16| {
    value(
      &text,
      &format!("botge_activity_requests_total{{route=\"/catalog\",status=\"{status}\"}}"),
    )
  };
  assert_eq!(request(200).as_deref(), Some("2"));
  assert_eq!(request(503).as_deref(), Some("1"));
  assert_eq!(
    value(&text, "botge_seventv_reconnects_total").as_deref(),
    Some("3")
  );
}

#[test]
fn records_outcomes_and_times_only_successful_renders() {
  let metrics = Metrics::default();
  metrics.composition(Outcome::Image, Duration::from_millis(80));
  metrics.composition(Outcome::Image, Duration::from_millis(1_500));
  metrics.composition(Outcome::Image, Duration::from_secs(60));
  metrics.composition(Outcome::Busy, Duration::from_secs(30));
  metrics.composition(Outcome::Rejected, Duration::ZERO);
  metrics.composition(Outcome::Error, Duration::from_secs(2));
  let text = metrics.render(0);
  for (outcome, count) in [
    ("image", "3"),
    ("busy", "1"),
    ("rejected", "1"),
    ("error", "1"),
  ] {
    let series = format!("botge_compositions_total{{outcome=\"{outcome}\"}}");
    assert_eq!(value(&text, &series).as_deref(), Some(count), "{outcome}");
  }
  let bucket = |bound: &str| {
    value(
      &text,
      &format!("botge_render_seconds_bucket{{le=\"{bound}\"}}"),
    )
  };
  assert_eq!(bucket("0.1").as_deref(), Some("1"));
  assert_eq!(bucket("1").as_deref(), Some("1"));
  assert_eq!(bucket("2.5").as_deref(), Some("2"));
  assert_eq!(bucket("40").as_deref(), Some("2"));
  assert_eq!(bucket("+Inf").as_deref(), Some("3"));
  assert_eq!(
    value(&text, "botge_render_seconds_sum").as_deref(),
    Some("61.580")
  );
  assert_eq!(
    value(&text, "botge_render_seconds_count").as_deref(),
    Some("3")
  );
  // Every family is introduced exactly once, and no line is left empty.
  assert_eq!(text.matches("# TYPE ").count(), 5);
  assert!(text.lines().all(|line| !line.is_empty()));
}

#[test]
fn keeps_counting_after_a_panic_poisons_the_lock() {
  let metrics = Metrics::default();
  let poisoned = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
    metrics.update(|_| std::panic::resume_unwind(Box::new("injected")));
  }));
  assert!(poisoned.is_err());
  metrics.command("emote-shortcuts");
  let text = metrics.render(0);
  assert_eq!(
    value(&text, "botge_commands_total{command=\"emote-shortcuts\"}").as_deref(),
    Some("1")
  );
}
