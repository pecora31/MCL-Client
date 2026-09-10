/**
 * Minecraft keeps the outer layer of a skin — helmet, jacket, sleeves, trouser legs — in atlas
 * regions that must be transparent wherever that layer is unused. A skin exported without an
 * alpha channel, which plenty of skin sites hand out, turns the whole outer layer opaque and
 * the game then draws a solid shell around the player instead of the skin underneath.
 *
 * skinview3d quietly repairs this for its own render, so a broken skin looks perfect in the 3D
 * panel while the library thumbnail and the game — both of which read the image as it is —
 * show the shell. Repairing once on import keeps all three showing the same thing.
 */
export function normalizeSkinImage(image: HTMLImageElement, source: string): string {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  if (!width || !height) return source;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return source;
  ctx.drawImage(image, 0, 0);

  // A skin that carries any transparency has already said which parts of the outer layer it
  // wants drawn, so it is left exactly as it is.
  if (!isFullyOpaque(ctx, width, height)) return source;

  const scale = width / 64;
  const clear = (x: number, y: number, w: number, h: number) =>
    ctx.clearRect(x * scale, y * scale, w * scale, h * scale);

  clear(32, 0, 32, 16); // helmet, every face
  // The tall layout adds a second layer for the body and limbs; the wide legacy one has none.
  if (height >= width) {
    clear(0, 32, 64, 16); // jacket, right sleeve, right trouser leg
    clear(0, 48, 16, 16); // left trouser leg
    clear(48, 48, 16, 16); // left sleeve
  }

  return canvas.toDataURL('image/png');
}

function isFullyOpaque(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  try {
    const { data } = ctx.getImageData(0, 0, width, height);
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return false;
    }
    return true;
  } catch {
    return false;
  }
}
