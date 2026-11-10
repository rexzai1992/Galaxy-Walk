// Every selfie is normalised into this square layout before it is sent to the
// server. The 3D head projects the photo assuming exactly this layout, so the
// station crop and the head shader must agree on these numbers.
export const FACE_LAYOUT = {
  size: 512,
  // Midpoint between the pupils, as a fraction of the image.
  eyeCenterX: 0.5,
  eyeCenterY: 0.44,
  // Distance between the pupils, as a fraction of the image width.
  eyeDistance: 0.2,
}

// Oval (in layout UV space, y down) that contains forehead -> chin, cheek -> cheek.
export const FACE_OVAL = {
  centerX: 0.5,
  centerY: 0.52,
  radiusX: 0.235,
  radiusY: 0.32,
}
