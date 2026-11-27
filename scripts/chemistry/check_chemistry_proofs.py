"""Run every Phase 0 proof check for the organic chemistry emote specification.

Stages (select some with `--only`, default all):

* `lean`: static hygiene scan of the Lean sources, then `lake build`, `lake lint`, and
  `lake exe audit_axioms` in `chemistry/proofs/lean`.
* `symbolic`: SymPy and Z3 checks (`chemistry/proofs/symbolic/verify_chem_symbolic.py`).
* `certificate`: exhaustive 5,120-triple RDKit matrix certificate.
* `rust`: formatting, Clippy, and tests of `crates/botge-chemistry`.
* `tex`: printed constants, specification scope, `.tex`-to-Lean traceability, and atlas sync.
"""

import argparse
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from collections.abc import Iterable

ROOT = Path(__file__).resolve().parent
REPO_ROOT = ROOT.parents[1]
LEAN_ROOT = REPO_ROOT / 'chemistry' / 'proofs' / 'lean'
SYMBOLIC_ROOT = REPO_ROOT / 'chemistry' / 'proofs' / 'symbolic'
CERT_ROOT = REPO_ROOT / 'chemistry' / 'proofs' / 'certificate'
STAGES = ('lean', 'symbolic', 'certificate', 'rust', 'tex')
MAX_COLUMNS = 100

FORBIDDEN_LEAN: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r'\bsorry\b'), '`sorry`'),
    (re.compile(r'\badmit\b'), '`admit`'),
    (
        re.compile(
            r'^\s*(?:@\[[^\]]*\]\s*)*(?:(?:public|private|protected|noncomputable|partial|unsafe)\s+)*axiom\s'
        ),
        'axiom declaration',
    ),
    (re.compile(r'\bnative_decide\b'), '`native_decide` (trusts the compiler)'),
    (re.compile(r'^\s*#print\s+axioms\b'), '`#print axioms` (use `lake exe audit_axioms`)'),
    (re.compile(r'\bset_option\b'), '`set_option` (configure options in lakefile.toml)'),
)


def blank_lean_comments(text: str) -> str:
    """Replace Lean comments with spaces, preserving newlines so line numbers stay intact."""
    out: list[str] = []
    depth, index, in_string = 0, 0, False
    while index < len(text):
        pair = text[index : index + 2]
        char = text[index]
        if depth == 0 and not in_string and pair == '--':
            end = text.find('\n', index)
            end = len(text) if end < 0 else end
            out.append(' ' * (end - index))
            index = end
            continue
        if not in_string and pair == '/-':
            depth += 1
            out.append('  ')
            index += 2
            continue
        if depth > 0:
            if pair == '-/':
                depth -= 1
                out.append('  ')
                index += 2
                continue
            out.append('\n' if char == '\n' else ' ')
            index += 1
            continue
        if char == '"' and (index == 0 or text[index - 1] != '\\'):
            in_string = not in_string
        out.append(char)
        index += 1
    return ''.join(out)


def lean_sources() -> list[Path]:
    """Every Lean source of the chemistry formalization."""
    return [
        LEAN_ROOT / 'BotgeChemLean.lean',
        *sorted((LEAN_ROOT / 'BotgeChemLean').rglob('*.lean')),
    ]


def scan_lean(paths: Iterable[Path], root: Path = REPO_ROOT) -> list[str]:
    """Report forbidden tactics, declarations, CRLF, tabs, trailing spaces, and long lines."""
    resolved_root = root.resolve()
    errors: list[str] = []
    for path in paths:
        resolved_path = path.resolve()
        data = resolved_path.read_bytes()
        name = resolved_path.relative_to(resolved_root)
        if b'\r' in data:
            errors.append(f'{name}: CRLF line endings')
        text = data.decode('utf-8')
        code_lines = blank_lean_comments(text).splitlines()
        for number, line in enumerate(text.splitlines(), start=1):
            where = f'{name}:{number}'
            if line != line.rstrip():
                errors.append(f'{where}: trailing whitespace')
            if '\t' in line:
                errors.append(f'{where}: tab character')
            if len(line) > MAX_COLUMNS:
                errors.append(f'{where}: line longer than {MAX_COLUMNS} columns')
            code = code_lines[number - 1]
            errors.extend(
                f'{where}: {why}' for pattern, why in FORBIDDEN_LEAN if pattern.search(code)
            )
    return errors


def tool(name: str, hint: str) -> str:
    """Resolve an executable or exit with an installation hint."""
    path = shutil.which(name)
    if path is None:
        msg = f'Missing `{name}`; {hint}'
        raise SystemExit(msg)
    return path


def run(command: list[str], cwd: Path) -> None:
    """Run one check command, stopping on the first failure."""
    print(f'$ {" ".join(command)}', flush=True)
    result = subprocess.run(command, cwd=cwd, check=False)  # noqa: S603 - fixed argument lists
    if result.returncode != 0:
        msg = f'`{" ".join(command)}` failed with status {result.returncode}'
        raise SystemExit(msg)


def check_lean() -> None:
    """Scan, build, lint, and axiom-audit the chemistry Lean formalization."""
    errors = scan_lean(lean_sources())
    if errors:
        raise SystemExit('\n'.join(errors))
    lake = tool('lake', 'install elan and link or fetch Mathlib in chemistry/proofs/lean.')
    run([lake, 'build'], LEAN_ROOT)
    run([lake, 'lint'], LEAN_ROOT)
    run([lake, 'exe', 'audit_axioms'], LEAN_ROOT)


def check_symbolic() -> None:
    """Run the SymPy and Z3 verification."""
    run([sys.executable, str(SYMBOLIC_ROOT / 'verify_chem_symbolic.py')], REPO_ROOT)


def check_certificate() -> None:
    """Run the exhaustive 5,120-triple RDKit matrix certificate."""
    run([sys.executable, str(CERT_ROOT / 'verify_matrix.py')], REPO_ROOT)


def check_rust() -> None:
    """Check formatting, Clippy, and tests of `crates/botge-chemistry`."""
    cargo = tool('cargo', 'install the toolchain pinned in rust-toolchain.toml.')
    crates = ['-p', 'botge-chemistry']
    run([cargo, 'fmt', '--check', *crates], REPO_ROOT)
    packages = ['--locked', *crates]
    run([cargo, 'clippy', *packages, '--all-targets', '--', '-D', 'warnings'], REPO_ROOT)
    run([cargo, 'test', *packages, '--release'], REPO_ROOT)


def check_tex() -> None:
    """Check printed constants, specification scope, `.tex`-to-Lean traceability, and sync."""
    run([sys.executable, str(ROOT / 'verify_chemistry_tex.py')], REPO_ROOT)


CHECKS = {
    'lean': check_lean,
    'symbolic': check_symbolic,
    'certificate': check_certificate,
    'rust': check_rust,
    'tex': check_tex,
}


def main() -> None:
    """Run the selected proof stages in order."""
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group()
    group.add_argument(
        '--only',
        action='append',
        choices=STAGES,
        help='run only this stage (repeatable; default: all stages)',
    )
    group.add_argument(
        '--scan-lean',
        nargs='+',
        type=Path,
        metavar='PATH',
        help='run the static Lean hygiene scan on the given files without invoking Lake',
    )
    args = parser.parse_args()
    if args.scan_lean is not None:
        errors = scan_lean(args.scan_lean, root=REPO_ROOT)
        if errors:
            raise SystemExit('\n'.join(errors))
        return
    stages = args.only or list(STAGES)
    for stage in STAGES:
        if stage in stages:
            print(f'== {stage} ==', flush=True)
            CHECKS[stage]()
    print(f'Chemistry proof checks passed: {", ".join(s for s in STAGES if s in stages)}.')


if __name__ == '__main__':
    main()
