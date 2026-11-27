#![expect(
  clippy::missing_panics_doc,
  reason = "Assertion panics describe test failures"
)]

use super::*;

#[test]
fn size_condition_and_diagram_parse_without_clamping() {
  assert_eq!(Size::default().get(), 2);
  assert_eq!(Size::try_from(1).map(Size::get), Ok(1));
  assert_eq!(Size::try_from(4).map(Size::get), Ok(4));
  assert_eq!(
    Size::try_from(0).map_err(|err| err.to_string()),
    Err("Choose size from 1 to 4.".to_owned())
  );
  assert_eq!(
    Size::try_from(5).map_err(|err| err.to_string()),
    Err("Choose size from 1 to 4.".to_owned())
  );

  assert_eq!(Diagram::default(), Diagram::Include);
  assert!(Diagram::Include.is_included());
  assert!(!Diagram::Omit.is_included());

  for (raw, expected) in [
    ("auto", Condition::Auto),
    (" HEAT ", Condition::Heat),
    ("acid", Condition::Acid),
    ("Base", Condition::Base),
    ("palladium", Condition::Palladium),
  ] {
    assert_eq!(Condition::parse_option(raw), Some(expected));
    assert_eq!(expected.as_str(), raw.trim().to_ascii_lowercase());
    assert_eq!(expected.to_string(), expected.as_str());
  }
  assert_eq!(Condition::parse_option("plasma"), None);
}

#[test]
fn secret_and_errors_format_consistently() {
  assert_eq!(Secret::new("   "), None);
  let secret = Secret::new("  top-secret  ");
  assert_eq!(secret.as_ref().map(Secret::expose), Some("top-secret"));
  if let Some(secret) = secret {
    assert_eq!(format!("{secret:?}"), "Secret([redacted])");
  }

  for (error, label, snippet) in [
    (ChemError::Busy, "busy", "busy"),
    (ChemError::Unavailable, "unavailable", "unavailable"),
    (ChemError::Refused, "refused", "refused"),
    (ChemError::Invalid, "invalid", "invalid response"),
  ] {
    assert_eq!(error.label(), label);
    assert!(error.to_string().contains(snippet));
  }
}

#[test]
fn png_decoder_enforces_magic_and_size_bounds() {
  let valid = STANDARD.encode(b"\x89PNG\r\n\x1a\npayload");
  assert_eq!(
    decode_diagram_png(&valid).as_deref(),
    Ok(&b"\x89PNG\r\n\x1a\npayload"[..])
  );
  assert_eq!(decode_diagram_png(""), Err(ChemError::Invalid));
  assert_eq!(decode_diagram_png("not-base64!"), Err(ChemError::Invalid));
  assert_eq!(
    decode_diagram_png(&STANDARD.encode(b"GIF89a")),
    Err(ChemError::Invalid)
  );
  let precheck_oversized = "A".repeat(MAX_DIAGRAM_BYTES.div_ceil(3) * 4 + 5);
  assert_eq!(
    decode_diagram_png(&precheck_oversized),
    Err(ChemError::Invalid)
  );
  let mut png_oversized = Vec::from(*b"\x89PNG\r\n\x1a\n");
  png_oversized.resize(MAX_DIAGRAM_BYTES + 1, 0);
  assert_eq!(
    decode_diagram_png(&STANDARD.encode(png_oversized)),
    Err(ChemError::Invalid)
  );
}
