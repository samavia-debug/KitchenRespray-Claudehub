// Turns a drawing or a photo or scan of a signature into a small PNG with a clear background, so it sits on a letter like ink
// on the paper. Runs in the browser; the server checks what it receives again and never trusts this.

const MAX_SIDE = 700;
const MARGIN = 8;
/** How much of the ink must be left for the picture to count as a signature. */
const MIN_INK_PIXELS = 30;

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That file could not be opened as a picture."));
    };
    img.src = url;
  });
}

/** White and near-white paper becomes clear, darker marks stay as ink, and the picture is cropped to the signature. */
function cleanUp(source: HTMLCanvasElement | HTMLImageElement, width: number, height: number): string {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("This browser cannot prepare the picture.");
  ctx.drawImage(source, 0, 0, w, h);

  const image = ctx.getImageData(0, 0, w, h);
  const px = image.data;
  let minX = w, minY = h, maxX = -1, maxY = -1, ink = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      // Paper is light on all three colours; the darkest of them says how much ink there is.
      const strength = Math.max(0, Math.min(255, (230 - Math.min(px[i], px[i + 1], px[i + 2])) * 2.2));
      const alpha = Math.round(Math.min(px[i + 3], strength));
      px[i + 3] = alpha;
      if (alpha > 40) {
        ink++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (ink < MIN_INK_PIXELS) throw new Error("No signature could be seen in that picture. Use dark ink on white paper, or draw it.");
  ctx.putImageData(image, 0, 0);

  const x0 = Math.max(0, minX - MARGIN);
  const y0 = Math.max(0, minY - MARGIN);
  const cw = Math.min(w, maxX + MARGIN) - x0;
  const ch = Math.min(h, maxY + MARGIN) - y0;
  const out = document.createElement("canvas");
  out.width = Math.max(cw, 20);
  out.height = Math.max(ch, 20);
  out.getContext("2d")!.drawImage(canvas, x0, y0, cw, ch, 0, 0, cw, ch);
  return out.toDataURL("image/png");
}

/** A PNG data URL ready to send, from an uploaded photo or scan. */
export async function prepareSignatureFile(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp|gif|bmp)$/i.test(file.type)) throw new Error("Choose a picture (PNG or JPEG).");
  if (file.size > 15 * 1024 * 1024) throw new Error("That picture is very large. Use a smaller one.");
  const img = await loadImage(file);
  return cleanUp(img, img.naturalWidth, img.naturalHeight);
}

/** A PNG data URL ready to send, from the drawing pad. */
export function prepareSignatureCanvas(canvas: HTMLCanvasElement): string {
  return cleanUp(canvas, canvas.width, canvas.height);
}
