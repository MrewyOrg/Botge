"""Dark-mode 2D skeletal reaction diagram renderer backed by RDKit Cairo."""

import base64
from typing import Final

from rdkit import Chem
from rdkit.Chem import rdChemReactions, rdDepictor
from rdkit.Chem.Draw import rdMolDraw2D

DIAGRAM_WIDTH: Final[int] = 320
DIAGRAM_HEIGHT: Final[int] = 120
MAX_DIAGRAM_BYTES: Final[int] = 131_072
PNG_MAGIC: Final[bytes] = b'\x89PNG\r\n\x1a\n'

# Botge dark theme palette matching botge-quantum.tex / docs/diagrams/mermaid.config.json.
BG_COLOUR: Final[tuple[float, float, float, float]] = (14 / 255, 17 / 255, 23 / 255, 1.0)
FG_COLOUR: Final[tuple[float, float, float, float]] = (233 / 255, 237 / 255, 244 / 255, 1.0)
ACCENT_BLUE: Final[tuple[float, float, float, float]] = (88 / 255, 166 / 255, 255 / 255, 1.0)
ACCENT_RED: Final[tuple[float, float, float, float]] = (248 / 255, 81 / 255, 73 / 255, 1.0)
ACCENT_GREEN: Final[tuple[float, float, float, float]] = (63 / 255, 185 / 255, 80 / 255, 1.0)
ACCENT_AMBER: Final[tuple[float, float, float, float]] = (210 / 255, 153 / 255, 34 / 255, 1.0)

DARK_PALETTE: Final[dict[int, tuple[float, float, float, float]]] = {
    -1: FG_COLOUR,
    0: FG_COLOUR,
    1: FG_COLOUR,
    5: ACCENT_AMBER,
    6: FG_COLOUR,
    7: ACCENT_BLUE,
    8: ACCENT_RED,
    9: ACCENT_GREEN,
    17: ACCENT_GREEN,
    35: ACCENT_AMBER,
}


def _prepared_copy(mol: Chem.Mol) -> Chem.Mol:
    """Clone an RDKit molecule and compute deterministic 2D coordinates."""
    copy = Chem.Mol(mol)
    rdDepictor.Compute2DCoords(copy)  # pyright: ignore[reportUnknownMemberType]
    return copy


def render_reaction_png(mol_a: Chem.Mol, mol_b: Chem.Mol, product: Chem.Mol) -> bytes:
    """Render a 320x120 dark-mode 2D skeletal reaction PNG (`A + B -> Product`).

    Raises:
        ValueError: If RDKit produces an invalid or oversized PNG payload.

    """
    reaction = rdChemReactions.ChemicalReaction()
    reaction.AddReactantTemplate(_prepared_copy(mol_a))  # pyright: ignore[reportUnknownMemberType]
    reaction.AddReactantTemplate(_prepared_copy(mol_b))  # pyright: ignore[reportUnknownMemberType]
    reaction.AddProductTemplate(_prepared_copy(product))  # pyright: ignore[reportUnknownMemberType]

    drawer = rdMolDraw2D.MolDraw2DCairo(DIAGRAM_WIDTH, DIAGRAM_HEIGHT)
    options = drawer.drawOptions()
    options.setBackgroundColour(BG_COLOUR)  # pyright: ignore[reportUnknownMemberType]
    options.setSymbolColour(FG_COLOUR)  # pyright: ignore[reportUnknownMemberType]
    options.setLegendColour(FG_COLOUR)  # pyright: ignore[reportUnknownMemberType]
    options.updateAtomPalette(DARK_PALETTE)
    options.bondLineWidth = 1.5
    drawer.DrawReaction(reaction)
    drawer.FinishDrawing()
    raw = drawer.GetDrawingText()
    if (
        not isinstance(raw, bytes)
        or not raw.startswith(PNG_MAGIC)
        or not (1 <= len(raw) <= MAX_DIAGRAM_BYTES)
    ):
        msg = 'Rendered diagram failed PNG bounds or signature check'
        raise ValueError(msg)
    return raw


def render_reaction_png_b64(mol_a: Chem.Mol, mol_b: Chem.Mol, product: Chem.Mol) -> str:
    """Render a 2D reaction PNG and return standard base64 text."""
    return base64.b64encode(render_reaction_png(mol_a, mol_b, product)).decode('ascii')
