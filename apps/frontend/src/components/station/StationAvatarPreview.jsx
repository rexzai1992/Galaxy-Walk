import { Suspense, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import AvatarCharacter from '../avatar/AvatarCharacter.jsx'
import AvatarLighting from '../avatar/AvatarLighting.jsx'

// Slow back-and-forth turn so the guest sees the 3D head from a few angles.
function Turntable({ children }) {
  const groupRef = useRef(null)
  useFrame(({ clock }) => {
    if (groupRef.current) groupRef.current.rotation.y = Math.sin(clock.elapsedTime * 0.7) * 0.45
  })
  return <group ref={groupRef}>{children}</group>
}

function StationAvatarPreview({ faceDataUrl, characterType, animation = 'wave' }) {
  return (
    <div className="station-avatar-preview">
      <Canvas dpr={[1, 2]} camera={{ position: [0, 0.35, 8.4], fov: 33 }}>
        <AvatarLighting />
        <Suspense fallback={null}>
          <Turntable>
            <AvatarCharacter
              position={[0, -2.05, 0]}
              characterType={characterType}
              paradeAnimation={animation}
              faceTextureUrl={faceDataUrl}
            />
          </Turntable>
        </Suspense>
      </Canvas>
    </div>
  )
}

export default StationAvatarPreview
