---
name: PyMuPDF fitz package conflict
description: Never install a separate PyPI `fitz` package alongside PyMuPDF; it shadows PyMuPDF's own `fitz` module and crashes imports.
---

There are two unrelated PyPI packages that both expose a module/name `fitz`:
- `PyMuPDF` — the real PDF library, provides `import fitz` as its module name.
- `fitz` — an unrelated, near-abandoned neuroimaging workflow tool (0.0.1.dev2) that also installs as `fitz`.

If the bare `fitz` package ends up installed alongside `PyMuPDF`, it can shadow PyMuPDF's own `fitz` module, breaking any code that does `import fitz` expecting PDF functionality (crashes on import or wrong API).

**Why:** This has recurred across re-imports/re-installs of the same project — a stray `fitz` line sometimes reappears in `requirements.txt` (e.g. from duplicated/merged requirement blocks) and gets pulled in by bulk installs.

**How to apply:** When installing/reinstalling Python deps for a project that uses `PyMuPDF`, check `requirements.txt` for a bare `fitz` entry and remove it; only `PyMuPDF`/`PyMuPDFb` should be present. If `pip show fitz` reports the neuroimaging package, uninstall it.

A second, unrelated failure mode with the same symptom (`import fitz` succeeds but `fitz.open` is missing, `fitz.__file__` is `None`): the installed `PyMuPDF` package itself is missing `fitz/__init__.py` on disk even though `pip show -f PyMuPDF` lists it — `fitz` then loads as an empty namespace package. Check with `ls .../site-packages/fitz/` (should contain `__init__.py`); if it's absent, `pip install --force-reinstall --no-deps PyMuPDF==<version>` restores it without touching other deps.
