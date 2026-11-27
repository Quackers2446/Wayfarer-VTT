#!/usr/bin/env bash
# Convert opaque dark-plate spell .webm clips to true-transparent VP9 (yuva420p).
#
# Per clip: confirm opaque dark plate, then rgba split → grayscale luma mask →
# curves black-point crush (0/0 0.08/0 0.35/0.85 1/1) → alphamerge → hard-zero
# alpha crumbs → encode libvpx-vp9 / yuva420p / -b:v 2M / -auto-alt-ref 0 +
# alpha_mode=1, write to <source>/transparent/. This kills .webm plate "TV static"
# better than colorkey on noisy catalogue previews.
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
# Prefer first frame for plate color when mid has FX filling corners.
best_hex = None
best_dark_n = -1
for seek in [0.0, max(0.0, min(dur * 0.4, max(dur - 0.05, 0.0)))]:
    extract(src, seek, out)
    img = Image.open(out).convert("RGBA")
    w, h = img.size
    edge = []
    for x in range(w):
        edge.append(img.getpixel((x, 0))[:3])
        edge.append(img.getpixel((x, h - 1))[:3])
    for y in range(h):
        edge.append(img.getpixel((0, y))[:3])
        edge.append(img.getpixel((w - 1, y))[:3])
    dark = [c for c in edge if sum(c) / 3 <= 48]
    if len(dark) > best_dark_n:
        best_dark_n = len(dark)
        if dark:
            mode = Counter(dark).most_common(1)[0][0]
        else:
            pts = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]
            mode = Counter(img.getpixel(p)[:3] for p in pts).most_common(1)[0][0]
        best_hex = f"{mode[0]:02x}{mode[1]:02x}{mode[2]:02x}"
print(best_hex or "000000")
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

# Opaque dark plate: uniform dark corners OR ≥40% of edge pixels opaque-dark
# (FX may touch some corners — e.g. breath-fire / acid-line).
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
    # Border-majority plate: FX may occupy 1–2 corners but most of the rim is black.
    edge = []
    for x in range(w):
        edge.append(img.getpixel((x, 0)))
        edge.append(img.getpixel((x, h - 1)))
    for y in range(h):
        edge.append(img.getpixel((0, y)))
        edge.append(img.getpixel((w - 1, y)))
    dark_opaque = sum(1 for r, g, b, a in edge if a >= 250 and (r + g + b) / 3 <= 48)
    if dark_opaque / len(edge) >= 0.40:
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
  echo "KEY alphamerge+curves (plate sample #$hex)  →  transparent/$base"
  # Record sampled plate for the run report.
  echo "$base #$hex alphamerge" >> "$VERIFY_DIR/converted-hex.txt"

  # Dark-plate → alpha in rgba: luma mask + curves black-point crush kills .webm
  # compression "TV static" in the plate, then alphamerge. Hard-zero alpha crumbs
  # (<10) so browsers don't matte residual noise. Prefer -b:v 2M over CRF for overlays.
  # Browsers/VTT honor WebM AlphaMode; ffprobe often still reports pix_fmt=yuv420p.
  fc="[0:v]format=rgba,split[rgb][a];[a]format=gray,curves=all='0/0 0.08/0 0.35/0.85 1/1'[mask];[rgb][mask]alphamerge,format=rgba,geq=r='if(lt(alpha(X,Y)\,10)\,0\,r(X,Y))':g='if(lt(alpha(X,Y)\,10)\,0\,g(X,Y))':b='if(lt(alpha(X,Y)\,10)\,0\,b(X,Y))':a='if(lt(alpha(X,Y)\,10)\,0\,alpha(X,Y))',format=yuva420p[out]"

  ffmpeg -y -i "$src" \
    -filter_complex "$fc" \
    -map "[out]" \
    -c:v libvpx-vp9 \
    -pix_fmt yuva420p \
    -b:v 2M \
    -auto-alt-ref 0 \
    -metadata:s:v:0 alpha_mode=1 \
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

# Verification on this run's converts (prefer Ice Storm / earthbind among them).
VERIFY_BASE=""
for cand in spell-fx-ice-storm.webm blfx-earthbind.webm spell-fx-breath-fire.webm "${CONVERTED_NAMES[@]:-}"; do
  if [[ " ${CONVERTED_NAMES[*]} " == *" $cand "* ]] && [[ -f "$OUT_DIR/$cand" ]]; then
    VERIFY_BASE="$cand"
    break
  fi
done
if [[ -z "$VERIFY_BASE" && ${#CONVERTED_NAMES[@]} -gt 0 ]]; then
  VERIFY_BASE="${CONVERTED_NAMES[0]}"
fi

if [[ -n "$VERIFY_BASE" ]]; then
  echo
  echo "=== Verify $VERIFY_BASE ==="
  VERIFY_PNG="$VERIFY_DIR/${VERIFY_BASE%.webm}-keyed.png"
  # Prefer first frame (plate) then mid — plate clips may have FX in mid corners.
  DUR="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$OUT_DIR/$VERIFY_BASE" || echo 1)"
  SEEK0="0"
  SEEK_MID="$(python3 -c "d=float('$DUR' or 1); print(f'{max(0,min(d*0.4,max(d-0.05,0))):.3f}')")"
  # Must decode with libvpx to recover the VP9 alpha plane (native decoder drops it).
  ffmpeg -y -c:v libvpx-vp9 -ss "$SEEK0" -i "$OUT_DIR/$VERIFY_BASE" \
    -vf format=rgba -frames:v 1 -update 1 "$VERIFY_PNG" </dev/null
  VERIFY_PNG_MID="$VERIFY_DIR/${VERIFY_BASE%.webm}-keyed-mid.png"
  ffmpeg -y -c:v libvpx-vp9 -ss "$SEEK_MID" -i "$OUT_DIR/$VERIFY_BASE" \
    -vf format=rgba -frames:v 1 -update 1 "$VERIFY_PNG_MID" </dev/null
  python3 - "$VERIFY_PNG" "$VERIFY_PNG_MID" <<'PY'
import sys
from PIL import Image

def edge_dark_opaque_frac(img):
    w, h = img.size
    edge = []
    for x in range(w):
        edge.append(img.getpixel((x, 0)))
        edge.append(img.getpixel((x, h - 1)))
    for y in range(h):
        edge.append(img.getpixel((0, y)))
        edge.append(img.getpixel((w - 1, y)))
    return sum(1 for r, g, b, a in edge if a >= 250 and (r + g + b) / 3 <= 48) / len(edge)

def report(label, path):
    keyed = Image.open(path).convert("RGBA")
    w, h = keyed.size
    corners = [keyed.getpixel(p) for p in [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1)]]
    alphas = [p[3] for p in keyed.getdata()]
    partial = sum(1 for a in alphas if 1 <= a <= 250)
    frac = edge_dark_opaque_frac(keyed)
    print(f"{label}: corner_rgba={corners}")
    print(f"{label}: corner_alpha_all_zero={all(c[3]==0 for c in corners)}")
    print(f"{label}: edge_dark_opaque_frac={frac:.3f}")
    print(f"{label}: alpha0={alphas.count(0)} alpha255={alphas.count(255)} partial={partial}")
    return all(c[3] == 0 for c in corners), frac, partial, alphas.count(0)

c0, f0, p0, a0 = report("first", sys.argv[1])
c1, f1, p1, a1 = report("mid", sys.argv[2])
# Pass if plate gone: corners clear OR edge no longer mostly opaque-dark, with real transparency.
ok = (c0 or c1 or (f0 < 0.05 and f1 < 0.05)) and (a0 > 100 or a1 > 100)
print(f"plate_cleared={ok}")
if p0 >= 100 or p1 >= 100:
    print("smooth_alpha_gradients=yes")
else:
    print("WARN: few partial-alpha pixels — edges may be hard-cut")
if not ok:
    raise SystemExit("Verification failed: dark plate still present")
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
