"""Run every Phase 0 proof check for the quantum emote specification.

Stages (select some with `--only`, default all):

* `lean`: static hygiene scan of the Lean sources, then `lake build` (warnings are errors),
  `lake lint` and `lake exe audit_axioms` in `quantum/proofs/lean`.
* `symbolic`: SymPy and Z3 checks (`quantum/proofs/symbolic/verify_symbolic.py`).
* `rust`: formatting, Clippy and the release-mode tests of `crates/botge-quantum` and the
  414-configuration certificate simulator (`quantum/proofs/certificate`).
* `tex`: printed constants, specification scope and `.tex`-to-Lean traceability
  (`verify_tex_constants.py`).
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
LEAN_ROOT = REPO_ROOT / 'quantum' / 'proofs' / 'lean'
SYMBOLIC_ROOT = REPO_ROOT / 'quantum' / 'proofs' / 'symbolic'
STAGES = ('lean', 'symbolic', 'rust', 'tex')
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
    """Replace Lean comments with spaces, keeping newlines so line numbers still match.

    Block comments (`/- ... -/`, including doc comments) nest; `--` comments run to the line end.
    String literals are kept, so `"--"` inside one does not start a comment.
    """
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
    """Every Lean source of the formalization."""
    return [LEAN_ROOT / 'BotgeLean.lean', *sorted((LEAN_ROOT / 'BotgeLean').rglob('*.lean'))]


def scan_lean(paths: Iterable[Path], root: Path = REPO_ROOT) -> list[str]:
    """Report forbidden tactics and declarations, CRLF, tabs, trailing spaces and long lines.

    Forbidden constructs are searched outside comments. Locations are relative to `root`.
    """
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
    """Resolve an executable or stop with an installation hint."""
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
    """Scan, build, lint and axiom-audit the Lean formalization."""
    errors = scan_lean(lean_sources())
    if errors:
        raise SystemExit('\n'.join(errors))
    lake = tool('lake', 'install elan and run `lake exe cache get` in quantum/proofs/lean.')
    run([lake, 'build'], LEAN_ROOT)
    run([lake, 'lint'], LEAN_ROOT)
    run([lake, 'exe', 'audit_axioms'], LEAN_ROOT)


def check_symbolic() -> None:
    """Run the SymPy and Z3 verification."""
    run([sys.executable, str(SYMBOLIC_ROOT / 'verify_symbolic.py')], REPO_ROOT)


def check_rust() -> None:
    """Check formatting, Clippy and the release-mode tests of the budget and its certificate."""
    cargo = tool('cargo', 'install the toolchain pinned in rust-toolchain.toml.')
    crates = ['-p', 'botge-quantum', '-p', 'botge-quantum-certificate']
    run([cargo, 'fmt', '--check', *crates], REPO_ROOT)
    packages = ['--locked', *crates]
    run([cargo, 'clippy', *packages, '--all-targets', '--', '-D', 'warnings'], REPO_ROOT)
    run([cargo, 'test', *packages, '--release'], REPO_ROOT)


def check_tex() -> None:
    """Check printed constants, specification scope and `.tex`-to-Lean traceability."""
    run([sys.executable, str(ROOT / 'verify_tex_constants.py')], REPO_ROOT)


CHECKS = {
    'lean': check_lean,
    'symbolic': check_symbolic,
    'rust': check_rust,
    'tex': check_tex,
}


def main() -> None:
    """Run the selected stages in order."""
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
    print(f'Proof checks passed: {", ".join(stage for stage in STAGES if stage in stages)}.')


if __name__ == '__main__':
    main()
