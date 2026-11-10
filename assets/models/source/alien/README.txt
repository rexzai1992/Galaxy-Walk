Source (full-size) Meshy exports. These are NOT served to the browser.

  assets/models/source/character.glb      base rig + mesh (has the FaceSlot mesh, no longer used)
  assets/models/source/alien/idle.glb     animation exports ("withSkin")
  assets/models/source/alien/wave.glb
  assets/models/source/alien/dance.glb
  assets/models/source/alien/pose.glb

After replacing any of these, rebuild the lightweight runtime files:

  npm run optimize:models

That writes apps/frontend/public/models/character.glb (texture re-encoded to a
2048px JPEG) and apps/frontend/public/models/alien/<anim>.glb (animation clips
only, no mesh/texture). ~145 MB of source becomes ~1.5 MB at runtime.

Requirements for a replacement model:
- Same skeleton bone names in the base file and every animation file.
- A bone named "Head" (the selfie head is attached to it; vertices driven by
  Head / head_end / headfront are hidden at runtime, and skin painted on the
  "neck" bone takes the guest's skin tone).
- The Alien renders this body; the Astronaut, Human and Robot are code-built
  bodies on the same skeleton (apps/frontend/src/components/avatar/
  proceduralBodies.js), so they also depend on these bone names.

Original Meshy file names:
- Meshy_AI_Neon_Alien_in_a_Purpl_biped_Character_output.glb -> alien/character.glb
- Meshy_AI_Neon_Alien_in_a_Purpl_biped_Animation_Idle_3_withSkin.glb -> idle.glb
- Meshy_AI_Neon_Alien_in_a_Purpl_biped_Animation_Wave_for_Help_3_withSkin.glb -> wave.glb
- Meshy_AI_Neon_Alien_in_a_Purpl_biped_Animation_FunnyDancing_02_withSkin.glb -> dance.glb
- Meshy_AI_Neon_Alien_in_a_Purpl_biped_Animation_Love_You_Pop_Dance_withSkin.glb -> pose.glb
