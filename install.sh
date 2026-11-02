#!/usr/bin/env bash
# 117Terminal installer for Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/1985epma/117-terminal/main/install.sh | bash
#
# Installs the libraries 117Terminal needs first, then the right package for this machine
# from the GitHub release, after checking its SHA-256 against the release's SHA256SUMS.txt.
#
#   Debian / Ubuntu (apt)       → .deb  (needs sudo)
#   Fedora / RHEL (dnf)         → .rpm  (needs sudo)
#   anything else, or --user    → .tar.gz in ~/.local/opt/117terminal (no sudo)
#
# Options (or environment variables):
#   --version X.Y.Z   VERSION=X.Y.Z   install that release instead of the latest
#   --user            T117_USER=1     tarball in your home, no sudo, no system libraries
#   --dry-run         DRY_RUN=1       print what would run, change nothing
set -euo pipefail

REPO="1985epma/117-terminal"
VERSION="${VERSION:-}"
USER_INSTALL="${T117_USER:-0}"
DRY_RUN="${DRY_RUN:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version) VERSION="${2:?--version needs a value}"; shift 2 ;;
    --version=*) VERSION="${1#*=}"; shift ;;
    --user) USER_INSTALL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h | --help) sed -n '2,17p' "$0" 2>/dev/null || true; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

# Runs a command, or only prints it with --dry-run.
run() {
  if [[ "${DRY_RUN}" == "1" ]]; then
    printf '    [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

[[ "$(uname -s)" == "Linux" ]] || die "this installer is for Linux. On macOS: brew install --cask 1985epma/117terminal/117terminal"

case "$(uname -m)" in
  x86_64 | amd64) DEB_ARCH=amd64 RPM_ARCH=x86_64 TAR_ARCH=x64 ;;
  aarch64 | arm64) DEB_ARCH=arm64 RPM_ARCH=aarch64 TAR_ARCH=arm64 ;;
  *) die "unsupported CPU: $(uname -m) (117Terminal ships x86_64 and arm64)" ;;
esac

command -v curl >/dev/null 2>&1 || die "curl is required"

SUDO=""
if [[ "$(id -u)" -ne 0 && "${USER_INSTALL}" != "1" ]]; then
  command -v sudo >/dev/null 2>&1 || die "sudo is required (or run as root, or use --user)"
  SUDO="sudo"
fi

if [[ -z "${VERSION}" ]]; then
  # /releases/latest redirects to /releases/tag/vX.Y.Z; no API token needed.
  latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest")"
  VERSION="${latest##*/v}"
  [[ "${VERSION}" =~ ^[0-9]+(\.[0-9]+)+$ ]] || die "could not find the latest release (got: ${latest})"
fi
VERSION="${VERSION#v}"
BASE="https://github.com/${REPO}/releases/download/v${VERSION}"

if [[ "${USER_INSTALL}" == "1" ]]; then
  KIND=tar
elif command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
  KIND=deb
elif command -v dnf >/dev/null 2>&1; then
  KIND=rpm
else
  say "No apt or dnf here: installing the portable build in your home folder instead."
  KIND=tar
  USER_INSTALL=1
fi

case "${KIND}" in
  deb) ASSET="117Terminal-${VERSION}-linux-${DEB_ARCH}.deb" ;;
  rpm) ASSET="117Terminal-${VERSION}-linux-${RPM_ARCH}.rpm" ;;
  tar) ASSET="117Terminal-${VERSION}-linux-${TAR_ARCH}.tar.gz" ;;
esac

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

say "117Terminal ${VERSION} · ${ASSET}"
say "Downloading"
curl -fL --retry 3 --progress-bar -o "${TMP}/${ASSET}" "${BASE}/${ASSET}" || die "download failed: ${BASE}/${ASSET}"
curl -fsSL --retry 3 -o "${TMP}/SHA256SUMS.txt" "${BASE}/SHA256SUMS.txt" || die "could not download SHA256SUMS.txt"

expected="$(awk -v f="${ASSET}" '$2 == f || $2 == "*" f { print $1 }' "${TMP}/SHA256SUMS.txt")"
[[ -n "${expected}" ]] || die "${ASSET} is not listed in SHA256SUMS.txt"
actual="$(sha256sum "${TMP}/${ASSET}" | cut -d' ' -f1)"
[[ "${expected}" == "${actual}" ]] || die "checksum mismatch for ${ASSET}: expected ${expected}, got ${actual}"
say "Checksum OK"

# First apt candidate that exists, so one list works on old and new releases
# (Ubuntu 24.04 renamed libgtk-3-0 → libgtk-3-0t64 and libasound2 → libasound2t64).
apt_pick() {
  local pkg policy
  for pkg in "$@"; do
    # Read the whole output first: `| grep -q` would close the pipe early, and with
    # pipefail the SIGPIPE would make every check fail.
    policy="$(apt-cache policy "${pkg}" 2>/dev/null || true)"
    if [[ "${policy}" =~ Candidate:\ [0-9] ]]; then
      echo "${pkg}"
      return
    fi
  done
  echo "$1"
}

case "${KIND}" in
  deb)
    say "Installing the libraries 117Terminal needs"
    run ${SUDO} apt-get update -qq
    deps=(libnss3 "$(apt_pick libgtk-3-0t64 libgtk-3-0)" libgbm1 "$(apt_pick libasound2t64 libasound2)" xdg-utils)
    run ${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${deps[@]}"
    say "Installing 117Terminal"
    run ${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get install -y "${TMP}/${ASSET}"
    ;;
  rpm)
    say "Installing the libraries 117Terminal needs"
    run ${SUDO} dnf install -y nss gtk3 mesa-libgbm alsa-lib xdg-utils
    say "Installing 117Terminal"
    run ${SUDO} dnf install -y "${TMP}/${ASSET}"
    ;;
  tar)
    dest="${HOME}/.local/opt/117terminal"
    bin="${HOME}/.local/bin"
    say "Unpacking into ${dest}"
    run rm -rf "${dest}"
    run mkdir -p "${dest}" "${bin}"
    run tar -xzf "${TMP}/${ASSET}" -C "${dest}" --strip-components=1
    # chrome-sandbox would need to be setuid root, which a home install cannot do.
    if [[ "${DRY_RUN}" == "1" ]]; then
      printf '    [dry-run] write %s/117terminal (runs %s/117terminal --no-sandbox)\n' "${bin}" "${dest}"
    else
      printf '#!/bin/sh\nexec "%s/117terminal" --no-sandbox "$@"\n' "${dest}" >"${bin}/117terminal"
      chmod 0755 "${bin}/117terminal"
    fi
    say "The system libraries are not installed in --user mode. If it does not start, install:"
    echo "    Debian/Ubuntu: libnss3 libgtk-3-0 libgbm1 libasound2 xdg-utils"
    echo "    Fedora:        nss gtk3 mesa-libgbm alsa-lib xdg-utils"
    echo "    Arch:          nss gtk3 mesa alsa-lib xdg-utils"
    case ":${PATH}:" in
      *":${bin}:"*) ;;
      *) say "Add ${bin} to your PATH to run 117terminal from any shell." ;;
    esac
    ;;
esac

say "Done. Start it with: 117terminal   (browser / HarmonyOS: 117terminal --serve)"
