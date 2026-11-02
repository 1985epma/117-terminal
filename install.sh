#!/usr/bin/env bash
# 117Terminal installer for Linux. See usage() below, or run it with --help.
set -euo pipefail

REPO="1985epma/117-terminal"
PKG_NAME="117-terminal" # name inside the .deb / .rpm

usage() {
  cat <<'EOF'
117Terminal installer for Linux

Installs the libraries 117Terminal needs first, then the package for this machine from the
GitHub release, after checking its SHA-256 against the release's SHA256SUMS.txt.

  Debian / Ubuntu (apt)     .deb    (needs sudo)
  Fedora / RHEL (dnf)       .rpm    (needs sudo)
  anything else, or --user  .tar.gz in ~/.local/opt/117terminal (no sudo)

Usage:
  bash install.sh [options]
  curl -fsSL https://raw.githubusercontent.com/1985epma/117-terminal/main/install.sh | bash -s -- [options]

Options:
  --version X.Y.Z   install that release instead of the latest   (or VERSION=X.Y.Z)
  --user            portable build in your home, no sudo           (or T117_USER=1)
  --force           reinstall even if this version is installed
  --uninstall       remove 117Terminal (the package, or the --user install)
  --dry-run         print what would run, change nothing           (or DRY_RUN=1)
  --no-color        no colors                                       (or NO_COLOR=1)
  -h, --help        this help

Exit codes: 0 ok · 1 error · 2 wrong usage
EOF
}

VERSION="${VERSION:-}"
USER_INSTALL="${T117_USER:-0}"
DRY_RUN="${DRY_RUN:-0}"
FORCE=0
UNINSTALL=0
COLOR=1
[[ -t 1 && -z "${NO_COLOR:-}" ]] || COLOR=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --version)
      [[ $# -ge 2 ]] || { echo "install.sh: --version needs a value" >&2; exit 2; }
      VERSION="$2"
      shift 2
      ;;
    --version=*) VERSION="${1#*=}"; shift ;;
    --user) USER_INSTALL=1; shift ;;
    --force) FORCE=1; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    --dry-run) DRY_RUN=1; shift ;;
    --no-color) COLOR=0; shift ;;
    -h | --help) usage; exit 0 ;;
    *) printf "install.sh: unknown option: %s\nTry 'install.sh --help'.\n" "$1" >&2; exit 2 ;;
  esac
done

if [[ "${COLOR}" == "1" ]]; then
  say() { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
  die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
else
  say() { printf '==> %s\n' "$*"; }
  die() { printf 'error: %s\n' "$*" >&2; exit 1; }
fi

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

USER_DIR="${HOME}/.local/opt/117terminal"
USER_BIN="${HOME}/.local/bin/117terminal"

if [[ "${USER_INSTALL}" == "1" ]]; then
  KIND=tar
elif command -v apt-get >/dev/null 2>&1 && command -v dpkg >/dev/null 2>&1; then
  KIND=deb
elif command -v dnf >/dev/null 2>&1; then
  KIND=rpm
else
  KIND=tar
  USER_INSTALL=1
  AUTO_TAR=1
fi

SUDO=""
if [[ "$(id -u)" -ne 0 && "${KIND}" != "tar" ]]; then
  command -v sudo >/dev/null 2>&1 || die "sudo is required (or run as root, or use --user)"
  SUDO="sudo"
fi

installed_version() {
  case "${KIND}" in
    # Only "ii" counts: after `apt remove` the package stays as "rc" (config files only).
    deb) dpkg-query -W -f='${db:Status-Abbrev}|${Version}' "${PKG_NAME}" 2>/dev/null | sed -n 's/^ii *|//p' || true ;;
    rpm) rpm -q --qf '%{VERSION}' "${PKG_NAME}" 2>/dev/null | grep -E '^[0-9]' || true ;;
    tar) cat "${USER_DIR}/.version" 2>/dev/null || true ;;
  esac
}

if [[ "${UNINSTALL}" == "1" ]]; then
  current="$(installed_version)"
  [[ -n "${current}" ]] || { say "117Terminal is not installed (${KIND})."; exit 0; }
  say "Removing 117Terminal ${current}"
  case "${KIND}" in
    deb) run ${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get remove -y "${PKG_NAME}" ;;
    rpm) run ${SUDO} dnf remove -y "${PKG_NAME}" ;;
    tar) run rm -rf "${USER_DIR}" "${USER_BIN}" ;;
  esac
  say "Done. Your settings stay in ~/.117terminal and ~/.config/117Terminal; delete them to remove everything."
  exit 0
fi

command -v curl >/dev/null 2>&1 || die "curl is required"

if [[ -z "${VERSION}" ]]; then
  # /releases/latest redirects to /releases/tag/vX.Y.Z; no API token needed.
  latest="$(curl -fsSLI -o /dev/null -w '%{url_effective}' "https://github.com/${REPO}/releases/latest")"
  VERSION="${latest##*/v}"
  [[ "${VERSION}" =~ ^[0-9]+(\.[0-9]+)+$ ]] || die "could not find the latest release (got: ${latest})"
fi
VERSION="${VERSION#v}"
[[ "${VERSION}" =~ ^[0-9]+(\.[0-9]+)+$ ]] || { echo "install.sh: invalid version: ${VERSION}" >&2; exit 2; }
BASE="https://github.com/${REPO}/releases/download/v${VERSION}"

current="$(installed_version)"
if [[ "${current}" == "${VERSION}" && "${FORCE}" != "1" ]]; then
  say "117Terminal ${VERSION} is already installed. Use --force to reinstall."
  exit 0
fi

case "${KIND}" in
  deb) ASSET="117Terminal-${VERSION}-linux-${DEB_ARCH}.deb" ;;
  rpm) ASSET="117Terminal-${VERSION}-linux-${RPM_ARCH}.rpm" ;;
  tar) ASSET="117Terminal-${VERSION}-linux-${TAR_ARCH}.tar.gz" ;;
esac

[[ "${AUTO_TAR:-0}" != "1" ]] || say "No apt or dnf here: installing the portable build in your home folder."

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT

say "117Terminal ${VERSION} · ${ASSET}${current:+ (replacing ${current})}"
say "Downloading"
progress="--progress-bar"
[[ -t 2 ]] || progress="--silent --show-error"
# shellcheck disable=SC2086 # progress holds one or two curl flags
curl -fL --retry 3 ${progress} -o "${TMP}/${ASSET}" "${BASE}/${ASSET}" || die "download failed: ${BASE}/${ASSET}"
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
    run ${SUDO} env DEBIAN_FRONTEND=noninteractive apt-get install -y --allow-downgrades "${TMP}/${ASSET}"
    ;;
  rpm)
    say "Installing the libraries 117Terminal needs"
    run ${SUDO} dnf install -y nss gtk3 mesa-libgbm alsa-lib xdg-utils
    say "Installing 117Terminal"
    run ${SUDO} dnf install -y "${TMP}/${ASSET}"
    ;;
  tar)
    say "Unpacking into ${USER_DIR}"
    run rm -rf "${USER_DIR}"
    run mkdir -p "${USER_DIR}" "$(dirname "${USER_BIN}")"
    run tar -xzf "${TMP}/${ASSET}" -C "${USER_DIR}" --strip-components=1
    # chrome-sandbox would need to be setuid root, which a home install cannot do.
    if [[ "${DRY_RUN}" == "1" ]]; then
      printf '    [dry-run] write %s (runs %s/117terminal --no-sandbox)\n' "${USER_BIN}" "${USER_DIR}"
    else
      printf '#!/bin/sh\nexec "%s/117terminal" --no-sandbox "$@"\n' "${USER_DIR}" >"${USER_BIN}"
      chmod 0755 "${USER_BIN}"
      echo "${VERSION}" >"${USER_DIR}/.version"
    fi
    say "The system libraries are not installed in --user mode. If it does not start, install:"
    echo "    Debian/Ubuntu: libnss3 libgtk-3-0 libgbm1 libasound2 xdg-utils"
    echo "    Fedora:        nss gtk3 mesa-libgbm alsa-lib xdg-utils"
    echo "    Arch:          nss gtk3 mesa alsa-lib xdg-utils"
    case ":${PATH}:" in
      *":$(dirname "${USER_BIN}"):"*) ;;
      *) say "Add $(dirname "${USER_BIN}") to your PATH to run 117terminal from any shell." ;;
    esac
    ;;
esac

say "Done. Start it with: 117terminal   (browser / HarmonyOS: 117terminal --serve)"
