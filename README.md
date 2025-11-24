# Serene Bird Flocking

A visually rich Three.js simulation of a flock of birds gliding through a tranquil meadow. Swap between an orbital overview and an immersive bird-following chase cam while tuning flocking behaviour with an on-screen GUI.

## Getting started

```bash
npm install
npm run dev -- --host
```

Open the printed URL (default http://localhost:5173/) in your browser.

## Controls

- **Orbit view**: Default. Drag to look around the scene.
- **Bird view (B)**: Toggle to follow a single bird.
- **Next bird (N)**: Cycle the chase target.
- **Pause (Space)**: Pause/resume simulation.
- **GUI**: Adjust flock size, speeds, perception radii, and wind influence.

## Notes
- The environment includes dynamic lighting, stylized water, trees, rocks, and grass swaying under foggy sky colors.
- Instanced birds use classic boid rules (alignment, cohesion, separation) plus terrain avoidance and wind sway.
