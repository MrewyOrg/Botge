"""Require Parameter and Returns tags in Swift documentation comments.

The Google Swift Style Guide documents parameters and return values with `- Parameter(s):` and
`- Returns:` tags, omitted only when the summary already describes them. A parameter counts as
described when the comment names it in backticks; a return value counts as described when the
summary starts with "Returns" or "Whether". SwiftLint already requires the comments themselves and
their `- Throws:` lines. Test targets are exempt, as for SwiftLint's documentation rules.
"""

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import override

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ('Botge', 'BotgeKit', 'BotgeLiveActivity')
DECLARATION = re.compile(
    r'^\s*(?:@[\w.]+(?:\([^)]*\))?\s+)*'
    r'(?:(?:public|package|internal|fileprivate|private|static|class|final|override|mutating|'
    r'nonisolated|convenience|required|nonmutating)(?:\(set\))?\s+)*'
    r'(?P<kind>func\s+(?P<name>[^\s(<]+)|init[?!]?|subscript)\s*(?:<[^>]*>)?\('
)
DESCRIBED_RESULTS = ('Returns', 'Whether')
VOID_RESULTS = frozenset({'Void', '()'})


@dataclass(frozen=True, slots=True)
class Finding:
    """A missing tag at a declaration."""

    path: Path
    line: int
    message: str

    @override
    def __str__(self) -> str:
        """Format the finding like a compiler diagnostic."""
        return f'{self.path}:{self.line}: {self.message}'


def split_parameters(text: str) -> list[str]:
    """Split a parameter list on top-level commas."""
    parts: list[str] = []
    depth = 0
    current: list[str] = []
    for character in text:
        if character in '([<{':
            depth += 1
        elif character in ')]>}':
            depth -= 1
        if character == ',' and depth == 0:
            parts.append(''.join(current))
            current = []
        else:
            current.append(character)
    if ''.join(current).strip():
        parts.append(''.join(current))
    return parts


def parameter_names(parameters: str) -> list[str]:
    """Return the internal names of parameters, skipping unnamed (`_`) ones."""
    names: list[str] = []
    for parameter in split_parameters(parameters):
        head = parameter.split(':', 1)[0].split()
        if head and head[-1] != '_':
            names.append(head[-1].strip('`'))
    return names


def signature(lines: list[str], start: int) -> tuple[str, str]:
    """Return the parameter list and the text after it for a declaration starting at `start`."""
    text = '\n'.join(lines[start : start + 40])
    opening = DECLARATION.match(text)
    position = opening.end() if opening else text.index('(') + 1
    depth = 1
    for index in range(position, len(text)):
        if text[index] == '(':
            depth += 1
        elif text[index] == ')':
            depth -= 1
            if depth == 0:
                rest = re.split(r'[{\n]\s*(?:///|\}|$)|\{', text[index + 1 :], maxsplit=1)[0]
                return text[position:index], rest
    return text[position:], ''


def result_type(rest: str) -> str | None:
    """Return the declared result type, or `None` for functions without one."""
    match = re.search(r'->\s*(.+?)\s*(?:where\b|$)', ' '.join(rest.split()))
    return match[1] if match else None


def documentation(lines: list[str], start: int) -> list[str]:
    """Return the `///` lines directly above a declaration and its attributes."""
    index = start - 1
    while index >= 0 and lines[index].strip().startswith('@'):
        index -= 1
    comment: list[str] = []
    while index >= 0 and lines[index].strip().startswith('///'):
        comment.insert(0, lines[index].strip().removeprefix('///').strip())
        index -= 1
    return comment


def check_file(path: Path, display: Path) -> list[Finding]:
    """Check every documented function, initializer and subscript in one file."""
    lines = path.read_text(encoding='utf-8').splitlines()
    findings: list[Finding] = []
    for number, line in enumerate(lines):
        match = DECLARATION.match(line)
        comment = documentation(lines, number) if match else []
        if not match or not comment:
            continue
        text = '\n'.join(comment)
        parameters, rest = signature(lines, number)
        for name in parameter_names(parameters):
            tagged = re.search(
                rf'^(?:- Parameter {re.escape(name)}:|- {re.escape(name)}:)', text, re.MULTILINE
            )
            if not tagged and f'`{name}`' not in text:
                findings.append(Finding(display, number + 1, f'document parameter `{name}`'))
        result = result_type(rest) if match['kind'].startswith('func') else None
        summary = comment[0]
        if (
            result is not None
            and result not in VOID_RESULTS
            and '- Returns:' not in text
            and not summary.startswith(DESCRIBED_RESULTS)
        ):
            findings.append(Finding(display, number + 1, 'document the result with `- Returns:`'))
    return findings


def check(root: Path) -> list[Finding]:
    """Check the app, framework and widget sources under `root/ios`."""
    findings: list[Finding] = []
    for target in SOURCES:
        for path in sorted((root / 'ios' / target).rglob('*.swift')):
            findings.extend(check_file(path, path.relative_to(root)))
    return findings


def main() -> None:
    """Print findings and exit with status 1 when any tag is missing."""
    argparse.ArgumentParser(description=__doc__).parse_args()
    findings = check(ROOT)
    for finding in findings:
        print(finding, file=sys.stderr)
    raise SystemExit(1 if findings else 0)


if __name__ == '__main__':
    main()
