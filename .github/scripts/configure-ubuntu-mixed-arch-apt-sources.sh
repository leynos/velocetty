#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 1 ]; then
  echo "Usage: $0 <sources-list-path>" >&2
  exit 1
fi

if [ ! -r /etc/os-release ]; then
  echo "Unable to read /etc/os-release for Ubuntu codename detection." >&2
  exit 1
fi

# shellcheck disable=SC1091
. /etc/os-release

if [ "${ID:-}" != "ubuntu" ]; then
  echo "Mixed-arch source generation supports Ubuntu only." >&2
  exit 1
fi

codename="${VERSION_CODENAME:-${UBUNTU_CODENAME:-}}"
if [ -z "$codename" ]; then
  echo "Unable to determine Ubuntu codename for mixed-arch apt sources." >&2
  exit 1
fi

sources_list_path=$1
cat <<EOF >"$sources_list_path"
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports ${codename} main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports ${codename}-updates main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports ${codename}-backports main restricted universe multiverse
deb [arch=arm64] http://ports.ubuntu.com/ubuntu-ports ${codename}-security main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu ${codename} main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu ${codename}-updates main restricted universe multiverse
deb [arch=amd64] http://archive.ubuntu.com/ubuntu ${codename}-backports main restricted universe multiverse
deb [arch=amd64] http://security.ubuntu.com/ubuntu ${codename}-security main restricted universe multiverse
EOF
