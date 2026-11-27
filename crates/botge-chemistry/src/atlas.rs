//! Stable 32-substrate organic atlas and FNV-1a 64-bit `emote.id` mapping (`def:substrate-map`).

use core::fmt;

use serde::Serialize;

use crate::Condition;

/// Number of curated organic substrates in the deterministic atlas.
pub const ATLAS_SIZE: u16 = 32;

/// Standard 64-bit FNV-1a offset basis (`def:substrate-map`).
const FNV1A_64_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
/// Standard 64-bit FNV-1a prime multiplier (`def:substrate-map`).
const FNV1A_64_PRIME: u64 = 0x0100_0000_01b3;

/// Metadata for one curated organic substrate, kept in lockstep with `chemistry/atlas.py`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SubstrateInfo {
  /// Common IUPAC/trivial substrate name.
  pub name: &'static str,
  /// Concise functional-group classification for autocomplete and `NoReaction` diagnostics.
  pub group: &'static str,
}

/// Curated 32-substrate organic table; order and text must match `chemistry/atlas.py`.
const SUBSTRATES: [SubstrateInfo; ATLAS_SIZE as usize] = [
  SubstrateInfo {
    name: "1,3-butadiene",
    group: "conjugated diene",
  },
  SubstrateInfo {
    name: "isoprene",
    group: "conjugated diene",
  },
  SubstrateInfo {
    name: "1,3-cyclohexadiene",
    group: "cyclic diene",
  },
  SubstrateInfo {
    name: "cyclopentadiene",
    group: "cyclic diene",
  },
  SubstrateInfo {
    name: "maleic anhydride",
    group: "cyclic dienophile",
  },
  SubstrateInfo {
    name: "methyl acrylate",
    group: "enoate / Michael acceptor",
  },
  SubstrateInfo {
    name: "acrylonitrile",
    group: "conjugated nitrile",
  },
  SubstrateInfo {
    name: "methyl vinyl ketone",
    group: "enone / Michael acceptor",
  },
  SubstrateInfo {
    name: "acetic acid",
    group: "carboxylic acid",
  },
  SubstrateInfo {
    name: "propanoic acid",
    group: "carboxylic acid",
  },
  SubstrateInfo {
    name: "benzoic acid",
    group: "aryl carboxylic acid",
  },
  SubstrateInfo {
    name: "methanol",
    group: "primary alcohol",
  },
  SubstrateInfo {
    name: "ethanol",
    group: "primary alcohol",
  },
  SubstrateInfo {
    name: "benzyl alcohol",
    group: "benzylic alcohol",
  },
  SubstrateInfo {
    name: "methylamine",
    group: "primary amine",
  },
  SubstrateInfo {
    name: "ethylamine",
    group: "primary amine",
  },
  SubstrateInfo {
    name: "aniline",
    group: "arylamine",
  },
  SubstrateInfo {
    name: "pyrrolidine",
    group: "secondary amine",
  },
  SubstrateInfo {
    name: "acetaldehyde",
    group: "aldehyde",
  },
  SubstrateInfo {
    name: "propanal",
    group: "aldehyde",
  },
  SubstrateInfo {
    name: "benzaldehyde",
    group: "aryl aldehyde",
  },
  SubstrateInfo {
    name: "acetone",
    group: "ketone",
  },
  SubstrateInfo {
    name: "acetyl chloride",
    group: "acyl chloride",
  },
  SubstrateInfo {
    name: "benzoyl chloride",
    group: "aroyl chloride",
  },
  SubstrateInfo {
    name: "1-bromobutane",
    group: "primary alkyl bromide",
  },
  SubstrateInfo {
    name: "benzyl bromide",
    group: "benzylic bromide",
  },
  SubstrateInfo {
    name: "bromobenzene",
    group: "aryl bromide",
  },
  SubstrateInfo {
    name: "4-bromoanisole",
    group: "aryl bromide",
  },
  SubstrateInfo {
    name: "phenylboronic acid",
    group: "arylboronic acid",
  },
  SubstrateInfo {
    name: "4-tolylboronic acid",
    group: "arylboronic acid",
  },
  SubstrateInfo {
    name: "acetylacetone",
    group: "1,3-diketone",
  },
  SubstrateInfo {
    name: "dimethyl malonate",
    group: "1,3-diester",
  },
];

/// Validated substrate index strictly below [`ATLAS_SIZE`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(transparent)]
pub struct AtlasIndex(u16);

impl AtlasIndex {
  /// Returns the numeric bucket in `0..32`.
  #[must_use]
  pub const fn get(self) -> u16 {
    self.0
  }

  /// Returns the substrate metadata for this bucket.
  #[must_use]
  pub const fn info(self) -> &'static SubstrateInfo {
    #[expect(
      clippy::indexing_slicing,
      reason = "AtlasIndex(u16) is only constructed modulo ATLAS_SIZE (32)"
    )]
    &SUBSTRATES[self.0 as usize]
  }
}

impl fmt::Display for AtlasIndex {
  fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
    let info = self.info();
    write!(f, "{} ({})", info.name, info.group)
  }
}

/// Computes the 64-bit FNV-1a digest of `bytes`.
#[must_use]
pub(crate) const fn fnv1a_64(bytes: &[u8]) -> u64 {
  let mut hash = FNV1A_64_OFFSET;
  let mut rest = bytes;
  while let Some((&byte, tail)) = rest.split_first() {
    hash ^= byte as u64;
    hash = hash.wrapping_mul(FNV1A_64_PRIME);
    rest = tail;
  }
  hash
}

/// Maps an immutable emote ID to its deterministic substrate bucket (`0..32`).
#[must_use]
pub const fn substrate_index(emote_id: &str) -> AtlasIndex {
  #[expect(
    clippy::cast_possible_truncation,
    reason = "ATLAS_SIZE is 32, so remainder fits in u16"
  )]
  let bucket = (fnv1a_64(emote_id.as_bytes()) % (ATLAS_SIZE as u64)) as u16;
  AtlasIndex(bucket)
}

/// Returns the deterministic organic substrate assigned to `emote_id`.
#[must_use]
pub const fn substrate(emote_id: &str) -> &'static SubstrateInfo {
  substrate_index(emote_id).info()
}

/// 32x32 symmetric compatibility bitmasks for `Condition::Heat` (`32` ordered pairs).
const COMPAT_HEAT: [u32; ATLAS_SIZE as usize] = [
  0x0000_00f0,
  0x0000_00f0,
  0x0000_00f0,
  0x0000_00f0,
  0x0000_000f,
  0x0000_000f,
  0x0000_000f,
  0x0000_000f,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
];

/// 32x32 symmetric compatibility bitmasks for `Condition::Acid` (`54` ordered pairs).
const COMPAT_ACID: [u32; ATLAS_SIZE as usize] = [
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0001_c000,
  0x0000_3800,
  0x0000_3800,
  0x0000_3800,
  0x0000_0700,
  0x0000_0700,
  0x0000_0700,
  0x403c_0080,
  0x403c_0080,
  0x403c_0080,
  0x0000_0000,
  0x0001_c000,
  0x0001_c000,
  0x0001_c000,
  0x0001_c000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0001_c000,
  0x0000_0000,
];

/// 32x32 symmetric compatibility bitmasks for `Condition::Base` (`72` ordered pairs).
const COMPAT_BASE: [u32; ATLAS_SIZE as usize] = [
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0xc000_0000,
  0xc000_0000,
  0xc01c_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0300_0000,
  0x0300_0000,
  0x0300_0000,
  0x00c0_0000,
  0x00c0_0000,
  0x00c0_0000,
  0x00c0_0000,
  0xc03c_0080,
  0xc03c_0080,
  0xc02c_0080,
  0x001c_0000,
  0x0003_c000,
  0x0003_c000,
  0x0000_3800,
  0x0000_3800,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x001c_00e0,
  0x001c_00e0,
];

/// 32x32 symmetric compatibility bitmasks for `Condition::Palladium` (`8` ordered pairs).
const COMPAT_PALLADIUM: [u32; ATLAS_SIZE as usize] = [
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x0000_0000,
  0x3000_0000,
  0x3000_0000,
  0x0c00_0000,
  0x0c00_0000,
  0x0000_0000,
  0x0000_0000,
];

/// Returns the symmetric compatibility bitmask row for substrate `a` under `condition`.
const fn compat_mask(a: AtlasIndex, condition: Condition) -> u32 {
  let row = a.0 as usize;
  #[expect(
    clippy::indexing_slicing,
    reason = "AtlasIndex(u16) is constructed strictly below ATLAS_SIZE (32)"
  )]
  match condition {
    Condition::Auto => {
      COMPAT_HEAT[row] | COMPAT_ACID[row] | COMPAT_BASE[row] | COMPAT_PALLADIUM[row]
    }
    Condition::Heat => COMPAT_HEAT[row],
    Condition::Acid => COMPAT_ACID[row],
    Condition::Base => COMPAT_BASE[row],
    Condition::Palladium => COMPAT_PALLADIUM[row],
  }
}

/// Returns `true` iff substrate buckets `a` and `b` react cleanly under `condition`.
#[must_use]
pub const fn can_react(a: AtlasIndex, b: AtlasIndex, condition: Condition) -> bool {
  (compat_mask(a, condition) & (1_u32 << b.0)) != 0
}

/// Returns `true` iff substrate `a` participates in at least one reaction under `condition`.
#[must_use]
pub const fn can_react_any(a: AtlasIndex, condition: Condition) -> bool {
  compat_mask(a, condition) != 0
}

#[cfg(test)]
mod tests;
