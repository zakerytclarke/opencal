// Center-crop a photo to a square before sending it to the on-device VLM.
// The model was trained on square inputs, so feeding it the largest centered
// square of the original keeps the food in frame while dropping the wide
// letterboxing that would otherwise dilute attention on small items.
// Returns a new File (JPEG) — never mutates the original.

export async function cropToSquare(file: File | Blob): Promise<File> {
  const bmp = await createImageBitmap(file)
  const size = Math.min(bmp.width, bmp.height)
  const sx = Math.floor((bmp.width - size) / 2)
  const sy = Math.floor((bmp.height - size) / 2)
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    bmp.close()
    throw new Error('Canvas 2D is not available.')
  }
  ctx.drawImage(bmp, sx, sy, size, size, 0, 0, size, size)
  bmp.close()

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (out) => (out ? resolve(out) : reject(new Error('Could not encode the cropped photo.'))),
      'image/jpeg',
      0.9,
    )
  })

  const name = file instanceof File ? file.name.replace(/\.\w+$/, '') : 'photo'
  return new File([blob], `${name}-square.jpg`, { type: 'image/jpeg' })
}
