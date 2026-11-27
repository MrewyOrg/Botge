# LaTeX baseline audit

Reviewed 2026-11-25 against the [pinned LaTeX guides and subguides](README.md). Scope:
[botge-quantum.tex](../../../quantum/docs/botge-quantum.tex),
[botge-quantum.pdf](../../../quantum/docs/botge-quantum.pdf), [`.chktexrc`](../../../.chktexrc), and
LaTeX Workshop settings in [`.vscode/settings.json`](../../../.vscode/settings.json).

## Review matrix

- **Modern LaTeX2e & obsolete constructs** ([usrguide](../cache/latex-usrguide.tex),
  [l2tabuen](../cache/latex-l2tabuen.tex), [`nag`](../cache/latex-nag.dtx)): `\RequirePackage` loads
  `[l2tabu, orthodox]{nag}` before `\documentclass`, paired with `\pdfinfoomitdate=1`,
  `\pdfsuppressptexinfo=15`, and `\pdftrailerid{}` for byte-for-byte reproducible builds; no
  `$...$`/`$$...$$`, `eqnarray`, `\sloppy`, or legacy font switches (`\bf`, `\it`, `\rm`, `\sc`,
  `\sf`, `\sl`, `\tt`).
- **Fonts & encodings** ([fntguide](../cache/latex-fntguide.tex),
  [encguide](../cache/latex-encguide.tex)): `\usepackage[T1]{fontenc}`, `\usepackage{lmodern}`, and
  `\usepackage{microtype}` eliminate `OMS/cmtt` glyph-substitution warnings and micro-typographic
  overflows.
- **Mathematics** ([amsldoc](../cache/latex-amsldoc.tex),
  [mathtools](../cache/latex-mathtools.dtx)): `\( ... \)` everywhere inline, `\[ ... \]` /
  `equation` / `align` displays, `\coloneqq`, `\DeclareMathOperator`-equivalent `\operatorname`,
  `\qedhere` inside terminal display proofs, and `booktabs` tables without vertical rules.
- **Hyperlinks** ([hyperref](../cache/latex-hyperref-doc.tex)): `colorlinks=true` with dark/light
  link contrast (`#58a6ff` / `#0969da`), PDF metadata, and `\texorpdfstring` on section math.
- **Dark mode** ([darkmode](../cache/latex-darkmode.dtx)): `\BotgeDarkMode` defaults to `1`,
  activating `\enabledarkmode` with Botge's dark palette (`#0e1117` background, `#e9edf4` text) and
  allowing `-usepretex=\def\BotgeDarkMode{0}` for light builds.
- **Strict ChkTeX & LaCheck** ([ChkTeX manual](../cache/latex-chktex-manual.tex),
  [`chktex.ts`](../cache/latex-workshop-chktex.ts),
  [`lacheck.ts`](../cache/latex-workshop-lacheck.ts)): workspace `.chktexrc` enforces
  `QuoteStyle = Logical`, `TabSize = 2`, `CmdSpaceStyle = Both`, and POSIX regex bans on `$$`,
  legacy font macros, `\sloppy`, and `eqnarray`; VS Code runs `-eall -n22 -n30 -q` to match CLI
  strictness.
- **LaTeX Workshop schema** ([`package.json`](../cache/latex-workshop-package.json)): uses verified
  `latex-workshop.*` keys for `outDir: "%DIR%"`, `auxDir: "%WORKSPACE_FOLDER%/tmp/latex"`,
  `-emulate-aux-dir`, `-halt-on-error`, `-synctex=0`, `latexmk (dark)` / `latexmk (light)` recipes,
  and `view.pdf.invertMode.enabled: "never"` so dark PDFs are not double-inverted.

## Discrepancies found and resolved

1. **Legacy `latex/botgequantum.tex` warnings (335 ChkTeX + 22 compiler warnings):** Replaced all
   290 `$ ... $` spans with `\( ... \)`, braced parenthesized bases before `^`/`_`, replaced `\!`
   and `\inf\{` spacing patterns flagged by ChkTeX `#21` with `\mkern-2mu` / `\inf \{`, fixed
   `\ket`/`\bra`/`\braket` macro spacing, fixed dash lengths (`inclusion-exclusion`) and quote
   punctuation, added `\allowbreak{}` at `Std.` boundaries, and refined table/section wrapping to
   eliminate all 16 overfull and 4 underfull `\hbox` warnings.
2. **Placeholders in `chktex.exec.args`:** Inspected `chktex.ts` and verified LaTeX Workshop passes
   `linting.chktex.exec.args` verbatim without `%WORKSPACE_FOLDER%` expansion, while automatically
   discovering root `.chktexrc` when `-l` is omitted. Removed explicit `-l` from VS Code args so
   both editor and CLI (`chktex -l .chktexrc`) share identical config.
3. **ChkTeX `-n22 -n30` flag ordering & POSIX regexes:** In ChkTeX CLI, `-e all` overrides earlier
   `-n` suppressions, so CLI validation passes `-e all -n22 -n30` (ignoring only `%` comments and
   2-space indentation, matching LaTeX Workshop's `chktex.ts` default). `UserWarnRegex` uses
   `POSIX:` ERE syntax because macOS ChkTeX is compiled with POSIX regexes rather than PCRE.
4. **TeX Live 2026 `latexindent` formatter on macOS:** Local `latexindent` aborts on missing Perl
   `File/HomeDir.pm`, and `tex-fmt` is not installed. Set
   `"latex-workshop.formatting.latex": "none"` and enforce 2-space / 100-column layout via `[latex]`
   editor rulers.

## Verification

- `python3 .agents/scripts/cache_references.py --check` (offline snapshot integrity)
- `sh scripts/quality/check-latex.sh` (runs ChkTeX `-eall -n22 -n30`, LaCheck, dark + light
  `latexmk -halt-on-error` builds, `nag` / warning / `hbox` log audit, and `quantum/docs/`
  cleanliness check; dark PDF hashes identically across rebuilds)
