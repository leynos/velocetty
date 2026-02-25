#!/usr/bin/env bash
set -euo pipefail

venv_dir="${1:-.node-gyp-python}"

if command -v python3 >/dev/null 2>&1; then
  python_cmd=python3
elif command -v python >/dev/null 2>&1 && python -c 'import sys; raise SystemExit(0 if sys.version_info.major == 3 else 1)' >/dev/null 2>&1; then
  python_cmd=python
else
  echo "Unable to find python3 or python on PATH." >&2
  exit 1
fi

if ! "$python_cmd" -m venv "$venv_dir"; then
  echo "Failed to create Python virtual environment at \"$venv_dir\"." >&2
  echo "Command: $python_cmd -m venv \"$venv_dir\"" >&2
  echo "Ensure the Python 'venv' module is installed (for Debian/Ubuntu, install python3-venv)." >&2
  exit 1
fi

python_bin="$venv_dir/bin/python"
if [ ! -x "$python_bin" ]; then
  python_bin="$venv_dir/Scripts/python.exe"
fi

if [ ! -x "$python_bin" ]; then
  echo "Unable to find Python executable in virtualenv at $venv_dir." >&2
  exit 1
fi

"$python_bin" -m pip install --upgrade pip setuptools packaging

resolved_python=$("$python_bin" -c 'import sys; print(sys.executable)')

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "python=$resolved_python" >>"$GITHUB_OUTPUT"
else
  echo "$resolved_python"
fi
