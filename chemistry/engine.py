"""Pure RDKit SMARTS reaction engine and deterministic catalog projection."""

from collections import Counter
from dataclasses import dataclass
from typing import TYPE_CHECKING, Final, cast

from atlas import ATLAS_SIZE, CONDITIONS, REACTIONS, SUBSTRATES, VALID_CONDITIONS, ReactionTemplate
from depict import render_reaction_png_b64
from rdkit import Chem
from rdkit.Chem import Descriptors, rdChemReactions, rdMolDescriptors

if TYPE_CHECKING:
    from collections.abc import Callable

FNV1A_64_OFFSET: Final[int] = 0xCBF29CE484222325
FNV1A_64_PRIME: Final[int] = 0x100000001B3
MASK_64: Final[int] = 0xFFFFFFFFFFFFFFFF
MIN_BASE_POOL: Final[int] = 2
MAX_BASE_POOL: Final[int] = 1024
MIN_OVERLAY_POOL: Final[int] = 2
MAX_OVERLAY_POOL: Final[int] = 128
AVOIDANCE_THRESHOLD: Final[int] = 3

_MOL_WT: Final[Callable[[Chem.Mol], float]] = cast(
    'Callable[[Chem.Mol], float]',
    Descriptors.MolWt,  # pyright: ignore[reportAttributeAccessIssue, reportUnknownMemberType]
)


def fnv1a_64(data: bytes) -> int:
    """Compute the 64-bit FNV-1a hash matching `botge-chemistry` and `BotgeChemLean`."""
    value = FNV1A_64_OFFSET
    for byte in data:
        value = ((value ^ byte) * FNV1A_64_PRIME) & MASK_64
    return value


def substrate_index(emote_id: str) -> int:
    """Map an immutable emote ID string to an atlas index in `[0, ATLAS_SIZE)`."""
    return fnv1a_64(emote_id.encode('utf-8')) % ATLAS_SIZE


def project_product(
    inchi_key: str,
    base_pool_size: int,
    overlay_pool_size: int,
    exclude_base_indices: tuple[int, ...] = (),
) -> tuple[int, int]:
    """Deterministically project a product InChIKey to `(base_index, overlay_index)`.

    When `base_pool_size >= 3`, shifts `base_index` modulo `base_pool_size` until it avoids up to
    two excluded reactant base indices (`thm:projection`).
    """
    if not (MIN_BASE_POOL <= base_pool_size <= MAX_BASE_POOL):
        msg = f'base_pool_size {base_pool_size} out of bounds'
        raise ValueError(msg)
    if not (MIN_OVERLAY_POOL <= overlay_pool_size <= MAX_OVERLAY_POOL):
        msg = f'overlay_pool_size {overlay_pool_size} out of bounds'
        raise ValueError(msg)
    key_bytes = inchi_key.encode('ascii')
    base_index = fnv1a_64(b'base:' + key_bytes) % base_pool_size
    overlay_index = fnv1a_64(b'overlay:' + key_bytes) % overlay_pool_size
    if base_pool_size >= AVOIDANCE_THRESHOLD and exclude_base_indices:
        excluded = set(exclude_base_indices[:2])
        for _ in range(len(excluded)):
            if base_index not in excluded:
                break
            base_index = (base_index + 1) % base_pool_size
    return base_index, overlay_index


def heavy_atom_counts(mol: Chem.Mol) -> Counter[str]:
    """Count non-hydrogen atoms by element symbol for stoichiometric conservation checks."""
    return Counter(atom.GetSymbol() for atom in mol.GetAtoms() if atom.GetAtomicNum() > 1)


@dataclass(frozen=True, slots=True)
class ReactedOutcome:
    """Deterministic chemical result of a successful bimolecular reaction."""

    reaction_id: str
    reaction_name: str
    condition_used: str
    substrate_a_name: str
    substrate_b_name: str
    product_smiles: str
    product_formula: str
    product_mw: float
    inchi_key: str
    base_index: int
    overlay_index: int
    diagram_png_b64: str | None


@dataclass(frozen=True, slots=True)
class NoReactionOutcome:
    """Structured explanation when two substrates do not react under a condition."""

    substrate_a_name: str
    substrate_a_group: str
    substrate_b_name: str
    substrate_b_group: str
    reason: str
    hint_condition: str | None
    hint_reaction: str | None


@dataclass(frozen=True, slots=True)
class PoolTarget:
    """Catalog pool dimensions and reactant-avoidance exclusions for projection."""

    base_pool_size: int
    overlay_pool_size: int
    exclude_base_indices: tuple[int, ...] = ()
    include_diagram: bool = True


@dataclass(frozen=True, slots=True)
class _Candidate:
    """Internal canonicalized reaction candidate."""

    template: ReactionTemplate
    product_smiles: str
    product_mol: Chem.Mol


class ChemistryEngine:
    """Pre-compiled RDKit substrate and SMARTS reaction engine."""

    def __init__(self) -> None:
        """Sanitize all 32 substrates and compile all 8 SMARTS reaction templates once."""
        mols: list[Chem.Mol] = []
        for entry in SUBSTRATES:
            mol = cast('Chem.Mol | None', Chem.MolFromSmiles(entry.smiles))  # pyright: ignore[reportUnknownMemberType]
            if mol is None:
                msg = f'Invalid substrate SMILES for {entry.name}: {entry.smiles}'
                raise RuntimeError(msg)
            mols.append(mol)
        self._mols: tuple[Chem.Mol, ...] = tuple(mols)
        compiled: list[tuple[ReactionTemplate, rdChemReactions.ChemicalReaction]] = []
        for template in REACTIONS:
            rxn = cast(
                'rdChemReactions.ChemicalReaction | None',
                rdChemReactions.ReactionFromSmarts(template.smarts),  # pyright: ignore[reportUnknownMemberType]
            )
            if rxn is None:
                msg = f'Invalid reaction SMARTS for {template.id}'
                raise RuntimeError(msg)
            compiled.append((template, rxn))
        self._reactions: tuple[tuple[ReactionTemplate, rdChemReactions.ChemicalReaction], ...] = (
            tuple(compiled)
        )

    def substrate_mol(self, index: int) -> Chem.Mol:
        """Return the pre-parsed RDKit molecule for substrate `index`."""
        return self._mols[index]

    def _evaluate_pair(self, idx_a: int, idx_b: int, condition: str) -> _Candidate | None:
        """Evaluate canonicalized `(lo, hi)` under `condition` (`'auto'` or explicit)."""
        lo, hi = (idx_a, idx_b) if idx_a <= idx_b else (idx_b, idx_a)
        mol_lo = self._mols[lo]
        mol_hi = self._mols[hi]
        orientations = ((mol_lo, mol_hi),) if lo == hi else ((mol_lo, mol_hi), (mol_hi, mol_lo))
        candidates: list[_Candidate] = []
        for template, rxn in self._reactions:
            if condition not in {'auto', template.condition}:
                continue
            for m1, m2 in orientations:
                for product_tuple in rxn.RunReactants((m1, m2)):  # pyright: ignore[reportUnknownMemberType]
                    if len(product_tuple) != 1:
                        continue
                    product = Chem.Mol(product_tuple[0])
                    try:
                        Chem.SanitizeMol(product)  # pyright: ignore[reportUnknownMemberType]
                    except Exception:  # noqa: BLE001, S112 - Reject chemically invalid intermediates.
                        continue
                    expected = (
                        heavy_atom_counts(m1)
                        + heavy_atom_counts(m2)
                        - Counter(template.byproduct_atoms)
                    )
                    if heavy_atom_counts(product) != expected:
                        continue
                    smiles = Chem.MolToSmiles(  # pyright: ignore[reportUnknownMemberType]
                        product,
                        isomericSmiles=True,
                        canonical=True,
                    )
                    candidates.append(_Candidate(template, smiles, product))
        if not candidates:
            return None
        candidates.sort(key=lambda item: (item.template.priority, item.product_smiles))
        return candidates[0]

    def react(
        self,
        reactant_a: int,
        reactant_b: int,
        condition: str,
        target: PoolTarget,
    ) -> ReactedOutcome | NoReactionOutcome:
        """Run bimolecular reaction evaluation and deterministic catalog projection."""
        if not (0 <= reactant_a < ATLAS_SIZE) or not (0 <= reactant_b < ATLAS_SIZE):
            msg = 'Reactant index out of atlas range'
            raise ValueError(msg)
        if condition not in VALID_CONDITIONS:
            msg = f'Unsupported condition: {condition}'
            raise ValueError(msg)

        sub_a = SUBSTRATES[reactant_a]
        sub_b = SUBSTRATES[reactant_b]
        candidate = self._evaluate_pair(reactant_a, reactant_b, condition)
        if candidate is not None:
            product_mol = cast('Chem.Mol', candidate.product_mol)  # pyright: ignore[reportUnknownMemberType]
            inchi_key = cast('str', Chem.MolToInchiKey(product_mol))  # pyright: ignore[reportUnknownMemberType]
            formula = rdMolDescriptors.CalcMolFormula(product_mol)  # pyright: ignore[reportUnknownMemberType]
            mw = round(_MOL_WT(product_mol), 2)
            base_index, overlay_index = project_product(
                inchi_key,
                target.base_pool_size,
                target.overlay_pool_size,
                target.exclude_base_indices,
            )
            diagram_b64 = (
                render_reaction_png_b64(
                    self._mols[reactant_a],
                    self._mols[reactant_b],
                    product_mol,
                )
                if target.include_diagram
                else None
            )
            return ReactedOutcome(
                reaction_id=candidate.template.id,
                reaction_name=candidate.template.name,
                condition_used=candidate.template.condition,
                substrate_a_name=sub_a.name,
                substrate_b_name=sub_b.name,
                product_smiles=candidate.product_smiles,
                product_formula=formula,
                product_mw=mw,
                inchi_key=inchi_key,
                base_index=base_index,
                overlay_index=overlay_index,
                diagram_png_b64=diagram_b64,
            )

        hint_condition: str | None = None
        hint_reaction: str | None = None
        if condition != 'auto':
            for alt_condition in CONDITIONS:
                if alt_condition == condition:
                    continue
                alt_match = self._evaluate_pair(reactant_a, reactant_b, alt_condition)
                if alt_match is not None:
                    hint_condition = alt_condition
                    hint_reaction = alt_match.template.name
                    break

        reason = (
            f'{sub_a.name} ({sub_a.group}) and {sub_b.name} ({sub_b.group}) '
            f'do not undergo a compatible reaction under {condition} conditions.'
        )
        return NoReactionOutcome(
            substrate_a_name=sub_a.name,
            substrate_a_group=sub_a.group,
            substrate_b_name=sub_b.name,
            substrate_b_group=sub_b.group,
            reason=reason,
            hint_condition=hint_condition,
            hint_reaction=hint_reaction,
        )
