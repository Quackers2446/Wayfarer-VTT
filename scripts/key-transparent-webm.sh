#!/usr/bin/env bash
# Convert opaque dark-plate spell .webm clips to true-transparent VP9 (yuva420p).
#
# Per clip: sample corner RGB from a mid-ish frame (exact plate color — often #000000
# or off-black like #101216 / #140d0f), soft-colorkey, encode libvpx-vp9 / yuva420p /
# -auto-alt-ref 0 + alpha_mode=1, write to <source>/transparent/.
#
# Detection uses a codec-aware alpha decode (libvpx for VP8, libvpx-vp9 for VP9).
# ALPHA_MODE tags alone are NOT trusted — some clips (e.g. spell-fx-ice-storm) are
# tagged alpha but decode fully opaque black. Already-transparent JB2A/keyed clips
# are skipped when corners decode with alpha < 250.
#
# Usage:
#   scripts/key-transparent-webm.sh [--install] [--pattern '*.webm'] [SOURCE_DIR]
#
# Defaults:
#   SOURCE_DIR = dist/assets/animations
#   pattern    = *.webm  (skips transparent/ and .opaque.bak via glob + checks)
#   --install  = after encode, replace in-place originals with transparent versions,
#                keeping originals as <name>.webm.opaque.bak; also refreshes
#                credits.json sha256 for replaced clips so build hash checks stay valid.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$ROOT/dist/assets/animations"
PATTERN="*.webm"
INSTALL=0
SIMILARITY="${KEY_SIMILARITY:-0.20}"
BLEND="${KEY_BLEND:-0.18}"
CRF="${KEY_CRF:-32}"
CPU_USED="${KEY_CPU_USED:-3}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --install) INSTALL=1; shift ;;
    --pattern) PATTERN="$2"; shift 2 ;;
    --similarity) SIMILARITY="$2"; shift 2 ;;
    --blend) BLEND="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,24p' "$0"
      exit 0
      ;;
    *)
      SOURCE="$1"
      shift
      ;;
  esac
done

if [[ ! -d "$SOURCE" ]]; then
  echo "Source directory not found: $SOURCE" >&2
  exit 1
fi

command -v ffmpeg >/dev/null || { echo "ffmpeg required" >&2; exit 1; }
command -v ffprobe >/dev/null || { echo "ffprobe required" >&2; exit 1; }
command -v python3 >/dev/null || { echo "python3 required" >&2; exit 1; }

OUT_DIR="$SOURCE/transparent"
VERIFY_DIR="$OUT_DIR/_verify"
mkdir -p "$OUT_DIR" "$VERIFY_DIR"

# Shared Python helpers: codec-aware frame extract + corner analysis.
# Prints corner hex (RGB) from mid frame for sampling.
sample_corner_hex() {
  local src="$1" frame_png="$2"
  python3 - "$src" "$frame_png" <<'PY'
import json, subprocess, sys
from PIL import Image
from collections import Counter

src, out = sys.argv[1], sys.argv[2]

def codec_of(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    return (r.stdout or "").strip()

def extract(path, seek, dest):
    codec = codec_of(path)
    dec = "libvpx-vp9" if codec == "vp9" else ("libvpx" if codec == "vp8" else None)
    cmd = ["ffmpeg", "-y"]
    if dec:
        cmd += ["-c:v", dec]
    cmd += ["-ss", f"{seek:.3f}", "-i", path, "-vf", "format=rgba",
            "-frames:v", "1", "-update", "1", dest]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 and dec:
        cmd = ["ffmpeg", "-y", "-ss", f"{seek:.3f}", "-i", path, "-vf", "format=rgba",
               "-frames:v", "1", "-update", "1", dest]
        subprocess.run(cmd, capture_output=True, check=True)
    else:
        r.check_returncode()

probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
     "-of", "default=nw=1:nk=1", src],
    capture_output=True, text=True, check=True,
)
try:
    dur = float(probe.stdout.strip() or "1")
except ValueError:
    dur = 1.0
seek = max(0.0, min(dur * 0.4, max(dur - 0.05, 0.0)))
extract(src, seek, out)
img = Image.open(out).convert("RGBA")
w, h = img.size
pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
# Prefer mode of corner RGB (ignore alpha for key color).
mode = Counter(img.getpixel(p)[:3] for p in pts).most_common(1)[0][0]
r, g, b = mode
print(f"{r:02x}{g:02x}{b:02x}")
PY
}

# True if corners already decode transparent — skip (do not ruin JB2A / keyed clips).
# Do NOT trust ALPHA_MODE tags alone; Ice Storm is tagged but fully opaque.
has_real_alpha() {
  python3 - "$1" <<'PY'
import subprocess, sys, tempfile
from pathlib import Path
from PIL import Image

src = sys.argv[1]

def codec_of(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    return (r.stdout or "").strip()

def extract(path, seek, dest):
    codec = codec_of(path)
    dec = "libvpx-vp9" if codec == "vp9" else ("libvpx" if codec == "vp8" else None)
    cmd = ["ffmpeg", "-y"]
    if dec:
        cmd += ["-c:v", dec]
    cmd += ["-ss", f"{seek:.3f}", "-i", path, "-vf", "format=rgba",
            "-frames:v", "1", "-update", "1", dest]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 and dec:
        cmd = ["ffmpeg", "-y", "-ss", f"{seek:.3f}", "-i", path, "-vf", "format=rgba",
               "-frames:v", "1", "-update", "1", dest]
        subprocess.run(cmd, capture_output=True, check=True)
    else:
        r.check_returncode()

probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
     "-of", "default=nw=1:nk=1", src],
    capture_output=True, text=True, check=True,
)
try:
    dur = float(probe.stdout.strip() or "1")
except ValueError:
    dur = 1.0
# Check first + mid; any transparent corner → already keyed / JB2A alpha.
seeks = [0.0, max(0.0, min(dur * 0.4, max(dur - 0.05, 0.0)))]
tmpdir = Path(tempfile.mkdtemp(prefix="alpha-chk-"))
try:
    for i, seek in enumerate(seeks):
        out = str(tmpdir / f"f{i}.png")
        extract(src, seek, out)
        img = Image.open(out).convert("RGBA")
        w, h = img.size
        for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]:
            if img.getpixel(p)[3] < 250:
                sys.exit(0)  # has real alpha
    sys.exit(1)
finally:
    for p in tmpdir.glob("*"):
        p.unlink(missing_ok=True)
    tmpdir.rmdir()
PY
}

# Opaque dark plate: corners nearly match, dark (luma < 48), and alpha >= 250.
is_opaque_dark_plate() {
  local src="$1" frame_png="$2"
  python3 - "$src" "$frame_png" <<'PY'
import subprocess, sys
from PIL import Image

src, out = sys.argv[1], sys.argv[2]

def codec_of(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=codec_name", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True,
    )
    return (r.stdout or "").strip()

def extract(path, seek, dest):
    codec = codec_of(path)
    dec = "libvpx-vp9" if codec == "vp9" else ("libvpx" if codec == "vp8" else None)
    cmd = ["ffmpeg", "-y"]
    if dec:
        cmd += ["-c:v", dec]
    cmd += ["-ss", f"{seek:.3f}", "-i", path, "-vf", "format=rgba",
            "-frames:v", "1", "-update", "1", dest]
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0 and dec:
        cmd = ["ffmpeg", "-y", "-ss", f"{seek:.3f}", "-i", path, "-vf", "format=rgba",
               "-frames:v", "1", "-update", "1", dest]
        subprocess.run(cmd, capture_output=True, check=True)
    else:
        r.check_returncode()

probe = subprocess.run(
    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
     "-of", "default=nw=1:nk=1", src],
    capture_output=True, text=True, check=True,
)
try:
    dur = float(probe.stdout.strip() or "1")
except ValueError:
    dur = 1.0
# Prefer mid; also accept first-frame plate if mid has FX in a corner.
for seek in [max(0.0, min(dur * 0.4, max(dur - 0.05, 0.0))), 0.0]:
    extract(src, seek, out)
    img = Image.open(out).convert("RGBA")
    w, h = img.size
    corners = [img.getpixel(p) for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]]
    if any(c[3] < 250 for c in corners):
        continue  # real alpha on this frame
    rgb = [(c[0], c[1], c[2]) for c in corners]
    uniform = all(
        abs(rgb[0][0] - r) <= 8 and abs(rgb[0][1] - g) <= 8 and abs(rgb[0][2] - b) <= 8
        for r, g, b in rgb
    )
    dark = all((r + g + b) / 3 <= 48 for r, g, b in rgb)
    if uniform and dark:
        sys.exit(0)
sys.exit(1)
PY
}

# encode_one exit codes: 0=keyed, 2=skipped, 1=failed
encode_one() {
  local src="$1"
  local base hex vf dest similarity="$SIMILARITY" blend="$BLEND"
  base="$(basename "$src")"
  dest="$OUT_DIR/$base"
  local sample_png="$VERIFY_DIR/${base%.webm}-sample.png"

  if has_real_alpha "$src"; then
    echo "SKIP (already alpha): $base"
    return 2
  fi
  if ! is_opaque_dark_plate "$src" "$sample_png"; then
    echo "SKIP (not opaque dark plate): $base"
    return 2
  fi

  hex="$(sample_corner_hex "$src" "$sample_png")"
  if [[ "$base" == "blfx-blink.webm" ]]; then
    similarity=0.03
    blend=0.07
  fi
  echo "KEY #$hex  sim=$similarity blend=$blend  →  transparent/$base"
  # Record sampled plate for the run report.
  echo "$base #$hex" >> "$VERIFY_DIR/converted-hex.txt"

  # Soft colorkey → yuva420p. Crush near-zero alpha crumbs so plate corners stay fully clear.
  # Browsers/VTT honor WebM AlphaMode; ffprobe often still reports pix_fmt=yuv420p.
  vf="colorkey=0x${hex}:${similarity}:${blend},format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(lt(alpha(X,Y)\,10)\,0\,alpha(X,Y))',format=yuva420p"

  ffmpeg -y -i "$src" \
    -vf "$vf" \
    -c:v libvpx-vp9 \
    -pix_fmt yuva420p \
    -auto-alt-ref 0 \
    -metadata:s:v:0 alpha_mode=1 \
    -b:v 0 -crf "$CRF" \
    -deadline good -cpu-used "$CPU_USED" \
    -an \
    "$dest" </dev/null

  # Preserve container timing metadata best-effort; fps comes from source stream.
  echo "OK $dest"
  return 0
}

shopt -s nullglob
# eval so brace patterns like '{a,b}.webm' expand; PATTERN is ours (not user shell input).
eval "files=(\"$SOURCE\"/$PATTERN)"
if [[ ${#files[@]} -eq 0 ]]; then
  echo "No files matching $PATTERN in $SOURCE" >&2
  exit 1
fi

echo "Source:  $SOURCE"
echo "Pattern: $PATTERN (${#files[@]} candidates)"
echo "Output:  $OUT_DIR"
echo "Key:     similarity=$SIMILARITY blend=$BLEND crf=$CRF"
echo

converted=0
skipped=0
failed=0
declare -a CONVERTED_NAMES=()
REF_HEX=""
: > "$VERIFY_DIR/converted-hex.txt"

for src in "${files[@]}"; do
  base="$(basename "$src")"
  # Skip anything already inside transparent/ or backup sidecars
  [[ "$src" == *"/transparent/"* ]] && continue
  [[ "$base" == *.opaque.bak ]] && continue
  set +e
  encode_one "$src"
  rc=$?
  set -e
  if [[ "$rc" -eq 0 ]]; then
    converted=$((converted + 1))
    CONVERTED_NAMES+=("$base")
    if [[ -z "$REF_HEX" && -f "$VERIFY_DIR/${base%.webm}-sample.png" ]]; then
      REF_HEX="$(sample_corner_hex "$src" "$VERIFY_DIR/${base%.webm}-sample.png" || true)"
    fi
  elif [[ "$rc" -eq 2 ]]; then
    skipped=$((skipped + 1))
  else
    echo "FAIL $base" >&2
    failed=$((failed + 1))
  fi
done

# Verification on first converted (prefer Ice Storm / earthbind if present)
VERIFY_BASE=""
for cand in spell-fx-ice-storm.webm blfx-earthbind.webm "${CONVERTED_NAMES[@]:-}"; do
  if [[ -f "$OUT_DIR/$cand" ]]; then
    VERIFY_BASE="$cand"
    break
  fi
done

if [[ -n "$VERIFY_BASE" ]]; then
  echo
  echo "=== Verify $VERIFY_BASE ==="
  VERIFY_PNG="$VERIFY_DIR/${VERIFY_BASE%.webm}-keyed.png"
  # Mid-frame keyed still from the OUTPUT (already has alpha)
  DUR="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT_DIR/$VERIFY_BASE" || echo 1)"
  SEEK="$(python3 -c "d=float('$DUR' or 1); print(f'{max(0,min(d*0.4,max(d-0.05,0))):.3f}')")"
  # Must decode with libvpx to recover the VP9 alpha plane (native decoder drops it).
  ffmpeg -y -c:v libvpx-vp9 -ss "$SEEK" -i "$OUT_DIR/$VERIFY_BASE" \
    -vf format=rgba -frames:v 1 -update 1 "$VERIFY_PNG" </dev/null
  python3 - "$VERIFY_PNG" "$VERIFY_DIR/${VERIFY_BASE%.webm}-sample.png" <<'PY'
import sys
from PIL import Image
keyed = Image.open(sys.argv[1]).convert("RGBA")
sample = Image.open(sys.argv[2]).convert("RGB")
w, h = keyed.size
corners = [keyed.getpixel(p) for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]]
alphas = [p[3] for p in keyed.getdata()]
partial = sum(1 for a in alphas if 1 <= a <= 250)
sc = sample.getpixel((0, 0))
print(f"sampled_source_corner_hex=#{sc[0]:02x}{sc[1]:02x}{sc[2]:02x}")
print(f"verify_png={sys.argv[1]}")
print(f"corner_rgba={corners}")
print(f"corner_alpha_all_zero={all(c[3]==0 for c in corners)}")
print(f"alpha0={alphas.count(0)} alpha255={alphas.count(255)} partial={partial}")
if not all(c[3] == 0 for c in corners):
    raise SystemExit("Verification failed: corner alpha not 0")
if partial < 100:
    print("WARN: few partial-alpha pixels — edges may be hard-cut")
else:
    print("smooth_alpha_gradients=yes")
PY
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt:stream_tags=alpha_mode \
    -of default=nw=1 "$OUT_DIR/$VERIFY_BASE"
fi

if [[ "$INSTALL" -eq 1 && ${#CONVERTED_NAMES[@]} -gt 0 ]]; then
  echo
  echo "=== Install (backup → replace) ==="
  CREDITS="$SOURCE/credits.json"
  for base in "${CONVERTED_NAMES[@]}"; do
    src="$SOURCE/$base"
    bak="$SOURCE/${base}.opaque.bak"
    if [[ ! -f "$bak" ]]; then
      cp -p "$src" "$bak"
      echo "backup $bak"
    else
      echo "backup exists, keeping: $bak"
    fi
    cp -f "$OUT_DIR/$base" "$src"
    echo "installed $src"
  done

  if [[ -f "$CREDITS" ]]; then
    python3 - "$CREDITS" "$SOURCE" "${CONVERTED_NAMES[@]}" <<'PY'
import hashlib, json, sys
from pathlib import Path

credits_path = Path(sys.argv[1])
source = Path(sys.argv[2])
names = set(sys.argv[3:])
data = json.loads(credits_path.read_text())
updated = 0
for clip in data.get("clips", []):
    file = clip.get("file", "")
    base = Path(file).name
    if base not in names:
        continue
    blob = (source / base).read_bytes()
    clip["sha256"] = hashlib.sha256(blob).hexdigest()
    note = clip.get("notes") or ""
    tag = "Keyed to transparent VP9 (yuva420p) for VTT overlay."
    if tag not in note:
        clip["notes"] = (note + " " + tag).strip() if note else tag
    updated += 1
credits_path.write_text(json.dumps(data, indent=2) + "\n")
print(f"credits.json sha256 updated for {updated} clips")
PY
  fi

  # Mirror into dist/client if present (local build artifact); serve.py uses dist/ directly.
  CLIENT_ANIM="$ROOT/dist/client/assets/animations"
  if [[ -d "$CLIENT_ANIM" ]]; then
    for base in "${CONVERTED_NAMES[@]}"; do
      if [[ -f "$CLIENT_ANIM/$base" ]]; then
        [[ -f "$CLIENT_ANIM/${base}.opaque.bak" ]] || cp -p "$CLIENT_ANIM/$base" "$CLIENT_ANIM/${base}.opaque.bak"
        cp -f "$OUT_DIR/$base" "$CLIENT_ANIM/$base"
      fi
    done
    echo "mirrored installs into dist/client/assets/animations"
  fi
fi

echo
echo "Done. converted=$converted skipped=$skipped failed=$failed"
echo "transparent_dir=$OUT_DIR"
[[ -n "$REF_HEX" ]] && echo "reference_sampled_hex=#$REF_HEX"
exit "$([[ "$failed" -eq 0 ]] && echo 0 || echo 1)"
