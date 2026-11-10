import { Environment, Lightformer } from '@react-three/drei'

/**
 * Studio-style lighting shared by every view of the characters (parade wall,
 * station preview, admin lineup): key + fill + rim lights for shape, and a
 * locally generated reflection environment (no HDR download, works offline).
 */
function AvatarLighting({ intensity = 1 }) {
  return (
    <>
      <hemisphereLight args={['#dcecff', '#2a2140', 0.55 * intensity]} />
      {/* Key: front-right, above. */}
      <directionalLight position={[8, 12, 14]} intensity={2.1 * intensity} color="#fff6ec" />
      {/* Fill: front-left, soft and cool so the shadow side is not black. */}
      <directionalLight position={[-12, 4, 10]} intensity={0.55 * intensity} color="#b8d4ff" />
      {/* Rims: from behind, outline the silhouette against the dark background. */}
      <directionalLight position={[-9, 9, -12]} intensity={1.6 * intensity} color="#7fe9ff" />
      <directionalLight position={[10, 6, -10]} intensity={0.9 * intensity} color="#c39bff" />

      <Environment resolution={128} frames={1}>
        <color attach="background" args={['#0b1022']} />
        <Lightformer form="rect" intensity={2.2} color="#ffffff" position={[4, 6, 8]} scale={[8, 5, 1]} />
        <Lightformer form="rect" intensity={1.2} color="#9fdcff" position={[-8, 2, 4]} scale={[4, 8, 1]} />
        <Lightformer form="ring" intensity={1.6} color="#7fe9ff" position={[0, 6, -9]} scale={6} />
        <Lightformer form="rect" intensity={0.6} color="#5c3d8f" position={[0, -6, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
      </Environment>
    </>
  )
}

export default AvatarLighting
