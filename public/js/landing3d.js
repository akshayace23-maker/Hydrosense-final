// js/landing3d.js — HydroSense hero scene (three.js, self-hosted, ES module).
// A night-sky scene: a rolling wireframe "water surface" that ripples, a glowing wireframe sphere
// floating above it (with ripple rings on the surface beneath) and twinkling stars.
// Pure decoration — it shows no data. Pauses when off-screen / tab hidden; one still frame for
// reduced-motion; falls back to the CSS gradient when WebGL is unavailable.
import * as THREE from '/js/vendor/three.module.min.js';

const canvas = document.getElementById('heroCanvas');
const fallback = document.querySelector('.hero__fallback');

function webglOK() {
  try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; }
}

if (!canvas || !webglOK()) {
  if (canvas) canvas.style.display = 'none';
} else {
  if (fallback) fallback.style.opacity = '0.5';
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 0.1, 200);
  camera.position.set(0, 1.4, 11);

  const AQUA = new THREE.Color('#5eead4'), SKY = new THREE.Color('#38bdf8'), DEEP = new THREE.Color('#0b3b78');
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

  // ---------- Stars
  const STARS = 360;
  const sPos = new Float32Array(STARS * 3), sSize = new Float32Array(STARS), sOff = new Float32Array(STARS);
  for (let i = 0; i < STARS; i++) {
    sPos[i * 3] = (rnd() - 0.5) * 70; sPos[i * 3 + 1] = rnd() * 26 - 2; sPos[i * 3 + 2] = -22 - rnd() * 20;
    sSize[i] = 1.2 + rnd() * 2.6; sOff[i] = rnd() * 6.28;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  starGeo.setAttribute('aOff', new THREE.BufferAttribute(sOff, 1));
  const starMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uPx: { value: renderer.getPixelRatio() } },
    vertexShader: `attribute float aSize; attribute float aOff; uniform float uTime; uniform float uPx; varying float vA;
      void main(){ vA = 0.35 + 0.65*(0.5+0.5*sin(uTime*1.3 + aOff));
        gl_PointSize = aSize * uPx; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); }`,
    fragmentShader: `varying float vA; void main(){ gl_FragColor = vec4(0.78, 0.95, 1.0, vA*0.9); }`,
  });
  scene.add(new THREE.Points(starGeo, starMat));

  // ---------- Rolling wireframe water surface
  const surfGeo = new THREE.PlaneGeometry(64, 44, 84, 56);
  const surfMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, wireframe: true,
    uniforms: { uTime: { value: 0 }, uPtr: { value: new THREE.Vector2(0, 0) }, cA: { value: AQUA }, cB: { value: SKY } },
    vertexShader: `uniform float uTime; uniform vec2 uPtr; varying float vH; varying float vFade;
      void main(){ vec3 p = position;
        float h = sin(p.x*0.30 + uTime*0.75)*0.62 + sin(p.y*0.36 + uTime*0.55)*0.5 + sin((p.x+p.y)*0.17 + uTime*0.4)*0.7;
        float d = length(p.xy - vec2(uPtr.x*9.0, -4.0));
        h += sin(d*0.95 - uTime*2.0)*0.32*exp(-d*0.13);
        p.z = h; vH = h;
        vec4 mv = modelViewMatrix*vec4(p,1.);
        vFade = smoothstep(58.0, 14.0, -mv.z) * (1.0 - smoothstep(18.0, 22.0, p.y));
        gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform vec3 cA; uniform vec3 cB; varying float vH; varying float vFade;
      void main(){ vec3 col = mix(cB, cA, smoothstep(-1.2, 1.4, vH)); gl_FragColor = vec4(col, 0.5*vFade); }`,
  });
  const surface = new THREE.Mesh(surfGeo, surfMat);
  surface.rotation.x = -1.2; surface.position.set(0, -3.4, -4);
  scene.add(surface);

  // ---------- Floating wireframe sphere with glowing core
  const orb = new THREE.Group();
  scene.add(orb);
  const wire = new THREE.Mesh(
    new THREE.IcosahedronGeometry(1.45, 2),
    new THREE.MeshBasicMaterial({ color: AQUA, wireframe: true, transparent: true, opacity: 0.95 })
  );
  orb.add(wire);
  const coreMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uTime: { value: 0 }, cA: { value: AQUA }, cB: { value: DEEP } },
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.); vP = -mv.xyz; gl_Position = projectionMatrix*mv; }`,
    fragmentShader: `uniform float uTime; uniform vec3 cA; uniform vec3 cB; varying vec3 vN; varying vec3 vP;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vP))), 2.0);
        float band = 0.5 + 0.5*sin(vN.y*6.0 + uTime*0.9);
        gl_FragColor = vec4(mix(cB, cA, f*0.8 + band*0.18), 0.3 + f*0.5); }`,
  });
  orb.add(new THREE.Mesh(new THREE.SphereGeometry(1.4, 48, 48), coreMat));

  // Ripple rings on the surface beneath the sphere
  const ripples = [];
  for (let i = 0; i < 3; i++) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(0.98, 1.0, 120),
      new THREE.MeshBasicMaterial({ color: SKY, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false })
    );
    ring.rotation.x = -1.2; scene.add(ring);
    ripples.push({ ring, phase: i / 3 });
  }

  // ---------- Layout + interaction
  let ptrX = 0, ptrY = 0, tx = 0, ty = 0, orbX = 3.7, orbY = 1.7;
  function resize() {
    const w = canvas.clientWidth || canvas.parentElement.clientWidth, h = canvas.clientHeight || canvas.parentElement.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    const narrow = w < 900;
    orbX = narrow ? 0 : 4.2; orbY = narrow ? 3.4 : 1.9;
    orb.scale.setScalar(narrow ? 0.62 : 1);
    camera.position.z = narrow ? 12.5 : 11;
  }
  window.addEventListener('resize', resize);
  resize();
  window.addEventListener('pointermove', (e) => { tx = (e.clientX / innerWidth) * 2 - 1; ty = -((e.clientY / innerHeight) * 2 - 1); }, { passive: true });

  let visible = true, running = false;
  const clock = new THREE.Clock();

  function frame() {
    if (!visible || document.hidden) { running = false; return; }
    const t = clock.getElapsedTime();
    ptrX += (tx - ptrX) * 0.05; ptrY += (ty - ptrY) * 0.05;
    starMat.uniforms.uTime.value = t; surfMat.uniforms.uTime.value = t; coreMat.uniforms.uTime.value = t;
    surfMat.uniforms.uPtr.value.set(ptrX, ptrY);

    const bob = Math.sin(t * 0.9) * 0.18;
    orb.position.set(orbX + ptrX * 0.3, orbY + bob, 0);
    orb.rotation.y = t * 0.22 + ptrX * 0.4; orb.rotation.x = 0.25 + t * 0.07 + ptrY * 0.2;

    ripples.forEach((r) => {
      const k = (t * 0.22 + r.phase) % 1;
      r.ring.scale.set(1.0 + k * 3.4, 1.0 + k * 3.4, 1);
      r.ring.material.opacity = 0.55 * (1 - k) * (1 - k);
      r.ring.position.set(orb.position.x - 0.1, -1.55 + bob * 0.2, -1.0);
    });

    camera.position.x = ptrX * 0.5; camera.position.y = 1.4 + ptrY * 0.3; camera.lookAt(0, 0.4, 0);
    renderer.render(scene, camera);
    if (!reduce) requestAnimationFrame(frame); else running = false;
  }
  function start() { if (!running) { running = true; requestAnimationFrame(frame); } }

  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; if (visible) start(); }).observe(canvas);
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) start(); });
  start();
  canvas.dataset.ready = '1';
}
