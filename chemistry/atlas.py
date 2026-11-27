"""Curated 32-substrate organic atlas and 8 strictly bimolecular SMARTS reaction templates."""

from dataclasses import dataclass
from typing import Final

ATLAS_SIZE: Final[int] = 32
CONDITIONS: Final[tuple[str, ...]] = ('heat', 'acid', 'base', 'palladium')
VALID_CONDITIONS: Final[frozenset[str]] = frozenset(('auto', *CONDITIONS))


@dataclass(frozen=True, slots=True)
class Substrate:
    """One deterministic organic substrate assigned to an emote ID hash bucket."""

    index: int
    name: str
    smiles: str
    group: str


@dataclass(frozen=True, slots=True)
class ReactionTemplate:
    """One strictly bimolecular, heavy-atom-balanced organic reaction template."""

    id: str
    name: str
    condition: str
    priority: int
    smarts: str
    byproduct: str
    byproduct_atoms: dict[str, int]


SUBSTRATES: Final[tuple[Substrate, ...]] = (
    Substrate(0, '1,3-butadiene', 'C=CC=C', 'conjugated diene'),
    Substrate(1, 'isoprene', 'CC(=C)C=C', 'conjugated diene'),
    Substrate(2, '1,3-cyclohexadiene', 'C1=CC=CCC1', 'cyclic diene'),
    Substrate(3, 'cyclopentadiene', 'C1=CCC=C1', 'cyclic diene'),
    Substrate(4, 'maleic anhydride', 'O=C1OC(=O)C=C1', 'cyclic dienophile'),
    Substrate(5, 'methyl acrylate', 'COC(=O)C=C', 'enoate / Michael acceptor'),
    Substrate(6, 'acrylonitrile', 'C=CC#N', 'conjugated nitrile'),
    Substrate(7, 'methyl vinyl ketone', 'CC(=O)C=C', 'enone / Michael acceptor'),
    Substrate(8, 'acetic acid', 'CC(=O)O', 'carboxylic acid'),
    Substrate(9, 'propanoic acid', 'CCC(=O)O', 'carboxylic acid'),
    Substrate(10, 'benzoic acid', 'O=C(O)c1ccccc1', 'aryl carboxylic acid'),
    Substrate(11, 'methanol', 'CO', 'primary alcohol'),
    Substrate(12, 'ethanol', 'CCO', 'primary alcohol'),
    Substrate(13, 'benzyl alcohol', 'OCc1ccccc1', 'benzylic alcohol'),
    Substrate(14, 'methylamine', 'CN', 'primary amine'),
    Substrate(15, 'ethylamine', 'CCN', 'primary amine'),
    Substrate(16, 'aniline', 'Nc1ccccc1', 'arylamine'),
    Substrate(17, 'pyrrolidine', 'C1CCNC1', 'secondary amine'),
    Substrate(18, 'acetaldehyde', 'CC=O', 'aldehyde'),
    Substrate(19, 'propanal', 'CCC=O', 'aldehyde'),
    Substrate(20, 'benzaldehyde', 'O=Cc1ccccc1', 'aryl aldehyde'),
    Substrate(21, 'acetone', 'CC(=O)C', 'ketone'),
    Substrate(22, 'acetyl chloride', 'CC(=O)Cl', 'acyl chloride'),
    Substrate(23, 'benzoyl chloride', 'O=C(Cl)c1ccccc1', 'aroyl chloride'),
    Substrate(24, '1-bromobutane', 'CCCCBr', 'primary alkyl bromide'),
    Substrate(25, 'benzyl bromide', 'BrCc1ccccc1', 'benzylic bromide'),
    Substrate(26, 'bromobenzene', 'Brc1ccccc1', 'aryl bromide'),
    Substrate(27, '4-bromoanisole', 'COc1ccc(Br)cc1', 'aryl bromide'),
    Substrate(28, 'phenylboronic acid', 'OB(O)c1ccccc1', 'arylboronic acid'),
    Substrate(29, '4-tolylboronic acid', 'Cc1ccc(B(O)O)cc1', 'arylboronic acid'),
    Substrate(30, 'acetylacetone', 'CC(=O)CC(=O)C', '1,3-diketone'),
    Substrate(31, 'dimethyl malonate', 'COC(=O)CC(=O)OC', '1,3-diester'),
)

REACTIONS: Final[tuple[ReactionTemplate, ...]] = (
    ReactionTemplate(
        id='diels_alder',
        name='Diels-Alder [4+2] cycloaddition',
        condition='heat',
        priority=1,
        smarts=(
            '[C;H2,H1:1]=[C;H1,H0:2]-[C;H1,H0:3]=[C;H2,H1:4].'
            '[C;H2,H1:5]=[C;H1,H0:6][$([CX3]=O),$(C#N):7]>>'
            '[C:1]1-[C:2]=[C:3]-[C:4]-[C:6]([*:7])-[C:5]1'
        ),
        byproduct='',
        byproduct_atoms={},
    ),
    ReactionTemplate(
        id='fischer_esterification',
        name='Fischer esterification',
        condition='acid',
        priority=2,
        smarts='[CX3:1](=[OX1:2])[OX2H1].[OX2H1;!$(OC=O);!$(OB):3][#6:4]>>[C:1](=[O:2])[O:3][#6:4]',
        byproduct='H2O',
        byproduct_atoms={'O': 1},
    ),
    ReactionTemplate(
        id='imine_condensation',
        name='Imine condensation',
        condition='acid',
        priority=3,
        smarts=(
            '[$([CX3H1](=O)[#6]),$([CX3](=O)([#6])[#6]):1]=[OX1].'
            '[NX3;H2;!$(NC=O):2][#6:3]>>[C:1]=[N:2][#6:3]'
        ),
        byproduct='H2O',
        byproduct_atoms={'O': 1},
    ),
    ReactionTemplate(
        id='amide_coupling',
        name='Acylation / amide coupling',
        condition='base',
        priority=4,
        smarts='[CX3:1](=[OX1:2])[ClX1].[NX3;H2,H1;!$(NC=O):3]>>[C:1](=[O:2])[N:3]',
        byproduct='HCl',
        byproduct_atoms={'Cl': 1},
    ),
    ReactionTemplate(
        id='williamson_sn2',
        name='Williamson SN2 substitution',
        condition='base',
        priority=5,
        smarts='[OX2H1;!$(OC=O);!$(OB):1].[CX4;H2:2][BrX1]>>[O:1]-[C:2]',
        byproduct='HBr',
        byproduct_atoms={'Br': 1},
    ),
    ReactionTemplate(
        id='aldol_condensation',
        name='Aldol condensation',
        condition='base',
        priority=6,
        smarts=(
            '[CX3;!$(C(=O)[OX2H1]);!$(C(=O)[ClX1]):1](=[OX1:2])-[CX4;H3,H2:3].'
            '[CX3;H1:4](=[OX1])[#6:5]>>[C:1](=[O:2])-[C:3]=[C:4]-[#6:5]'
        ),
        byproduct='H2O',
        byproduct_atoms={'O': 1},
    ),
    ReactionTemplate(
        id='michael_addition',
        name='Michael conjugate addition',
        condition='base',
        priority=7,
        smarts=(
            '[CX4;H2;$(C([CX3]=O)[CX3]=O):1].'
            '[CX3;H2:2]=[CX3;H1:3][$([CX3]=O),$(C#N):4]>>'
            '[C:1]-[C:2]-[C:3]-[*:4]'
        ),
        byproduct='',
        byproduct_atoms={},
    ),
    ReactionTemplate(
        id='suzuki_miyaura',
        name='Suzuki-Miyaura cross-coupling',
        condition='palladium',
        priority=8,
        smarts='[c:1][BrX1].[c:2][BX3]([OX2H1])[OX2H1]>>[c:1]-[c:2]',
        byproduct='B(OH)2Br',
        byproduct_atoms={'B': 1, 'O': 2, 'Br': 1},
    ),
)
