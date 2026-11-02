//! Decodes one HEIC/HEIF image to JPEG bytes: reads the whole input from
//! stdin, writes the JPEG to stdout, and reports an error on stderr with
//! a nonzero exit code when decoding fails. A disposable one-shot
//! process, spawned once per photo by the GraphLog worker
//! (`attachmentFrames.server.ts`'s `heicToJpeg`) -- the memory a real
//! libheif decode holds is returned to the OS the moment this process
//! exits, the same isolation the WASM decoder this replaces already
//! used, but without the WASM translation layer's own ~130-250 MB
//! overhead per decode (native libheif via FFI instead). See the
//! `rust-heic-decode-worker` garden seed for the full investigation this
//! replaces.

use std::io::{self, Read, Write};
use std::process::ExitCode;

use image::codecs::jpeg::JpegEncoder;
use image::ExtendedColorType;
use libheif_rs::{ColorSpace, HeifContext, LibHeif, RgbChroma};

/// Matches the existing WASM/`sharp` paths' own choice
/// (`attachmentFrames.server.ts`), so switching decoders doesn't also
/// silently change output size/quality.
const JPEG_QUALITY: u8 = 85;

/// Mirrors the existing WASM child's own self-sacrifice trick
/// (`HEIC_CHILD_SCRIPT` in `attachmentFrames.server.ts`): asks the
/// kernel to kill THIS process first under real memory pressure, so one
/// huge photo fails as just that photo rather than taking the whole
/// worker down. Best-effort, silently ignored where `/proc` doesn't
/// exist (macOS, local dev) -- same reasoning, just a different runtime.
fn lower_oom_priority() {
    let _ = std::fs::write("/proc/self/oom_score_adj", b"1000");
}

fn decode_to_jpeg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let ctx = HeifContext::read_from_bytes(bytes).map_err(|e| e.to_string())?;
    let handle = ctx.primary_image_handle().map_err(|e| e.to_string())?;
    let width = handle.width();
    let height = handle.height();

    let lib_heif = LibHeif::new();
    // Carries out every geometric transformation (rotation, cropping,
    // mirroring) the HEIF file itself specifies, as part of the decode
    // itself -- unlike a JPEG's EXIF orientation tag, which a reader has
    // to apply by hand, HEIF stores this at the container level and
    // libheif applies it before handing back pixels (confirmed directly
    // in libheif's own C API docs for `heif_decode_image`).
    let image = lib_heif
        .decode(&handle, ColorSpace::Rgb(RgbChroma::Rgb), None)
        .map_err(|e| e.to_string())?;

    let planes = image.planes();
    let plane = planes
        .interleaved
        .ok_or_else(|| "decoded image has no interleaved RGB plane".to_string())?;

    // libheif pads each row out to `stride` bytes, which can exceed
    // `width * 3` -- the JPEG encoder wants a tightly packed buffer, so
    // copy row-by-row rather than assuming stride == width * 3.
    let row_bytes = (width as usize) * 3;
    let mut packed = Vec::with_capacity(row_bytes * height as usize);
    for row in 0..height as usize {
        let start = row * plane.stride;
        packed.extend_from_slice(&plane.data[start..start + row_bytes]);
    }

    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, JPEG_QUALITY)
        .encode(&packed, width, height, ExtendedColorType::Rgb8)
        .map_err(|e| e.to_string())?;
    Ok(out)
}

fn main() -> ExitCode {
    lower_oom_priority();

    let mut input = Vec::new();
    if let Err(err) = io::stdin().read_to_end(&mut input) {
        eprintln!("failed to read stdin: {err}");
        return ExitCode::FAILURE;
    }

    match decode_to_jpeg(&input) {
        Ok(jpeg) => match io::stdout().write_all(&jpeg) {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("failed to write stdout: {err}");
                ExitCode::FAILURE
            }
        },
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
