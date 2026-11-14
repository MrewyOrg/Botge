//! Measures catalog mapping and future sizes using the pinned nightly's benchmark harness.

#![expect(
  clippy::missing_errors_doc,
  clippy::missing_panics_doc,
  reason = "Fixture failures and assertion panics describe test failures"
)]

use std::hint::black_box;

use test::Bencher;

use super::*;

#[bench]
fn shared_catalog_request(b: &mut Bencher) {
  let snapshot: Arc<[emotes::Emote]> = (0..1000)
    .map(|id| emotes::tests::example(&format!("Wave{id}"), &id.to_string()))
    .collect();
  b.iter(|| {
    let catalog = emotes::catalog::Catalog::new(vec![], vec![Arc::clone(&snapshot)]);
    black_box(emotes::browser_catalog(&catalog));
  });
}

#[bench]
fn cloned_catalog_request(b: &mut Bencher) {
  let snapshot: Arc<[emotes::Emote]> = (0..1000)
    .map(|id| emotes::tests::example(&format!("Wave{id}"), &id.to_string()))
    .collect();
  b.iter(|| {
    let catalog = snapshot.to_vec();
    black_box(emotes::browser_catalog(&catalog));
  });
}

#[bench]
fn browser_catalog(b: &mut Bencher) {
  let catalog: Vec<_> = (0..1000)
    .map(|id| emotes::tests::example(&format!("Wave{id}"), &id.to_string()))
    .collect();
  b.iter(|| black_box(emotes::browser_catalog(black_box(&catalog))));
}

#[test]
fn catalog_future_fits_the_worker_budget() -> Result<()> {
  let directory = tempfile::tempdir()?;
  let store = Arc::new(Store::open(&directory.path().join("future.redb"))?);
  let emotes = emotes::Emotes::new(config::Providers::default(), store, None)?;
  let future = emotes.catalog(None);
  let bytes = size_of_val(&future);
  // Keep per-request state below one memory page; a regression needs an explicit review.
  assert!(bytes <= 4096, "catalog future grew to {bytes} bytes");
  println!("catalog future: {bytes} bytes");
  Ok(())
}
