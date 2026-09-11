/**
 * Постобработка для 3D-сцен случайного трека.
 *
 * Сцена рисуется не прямо в холст, а в отдельный буфер, поверх которого
 * работает три эффекта:
 *
 *   • гравитационное линзирование — свет у дыры отклоняется тем сильнее, чем
 *     ближе к горизонту (обратно пропорционально прицельному расстоянию),
 *     поэтому звёзды и диск за дырой выгибаются и складываются в кольцо;
 *   • мягкое свечение (bloom) — яркое размывается и добавляется обратно,
 *     благодаря чему раскалённый диск и фотонная сфера светятся, а не «рисуются»;
 *   • тональная компрессия ACES — пересветы не превращаются в белые пятна.
 *
 * Плюс совсем немного хроматической аберрации: у самого горизонта цвета
 * расходятся, как в оптике.
 *
 * Буфер — полуторомерный (HalfFloat), поэтому яркости больше 1 не обрезаются
 * и свечение считается честно.
 */

const VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

/** Выделение яркого: всё, что выше порога, пойдёт в размытие. */
const BRIGHT = `
uniform sampler2D tDiffuse;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
void main() {
  vec3 c = texture2D(tDiffuse, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + uKnee, l), 1.0);
}`;

/** Размытие по Гауссу, разделяемое: один проход по горизонтали, один по вертикали. */
const BLUR = `
uniform sampler2D tDiffuse;
uniform vec2 uDir;
varying vec2 vUv;
void main() {
  vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  s += texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb * 0.0702702703;
  s += texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0);
}`;

const COMPOSITE = `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uCenter;
uniform float uAspect;
uniform float uHoleR;      // радиус тени горизонта в долях высоты кадра
uniform float uStrength;
uniform float uBloom;
uniform float uAber;
uniform float uRing;
uniform float uExposure;
varying vec2 vUv;

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

/* Отклонение луча: ~1/b от прицельного расстояния b, с мягким ядром внутри
   фотонной сферы и спадом наружу — иначе края кадра «плыли» бы целиком. */
vec2 lens(vec2 uv, float k) {
  vec2 d = (uv - uCenter) * vec2(uAspect, 1.0);
  float r = max(length(d), 1e-5);
  float b = max(r, uHoleR * 0.94);
  float defl = uStrength * uHoleR * uHoleR / b;
  defl *= 1.0 - smoothstep(uHoleR * 3.0, uHoleR * 9.0, r);
  defl = min(defl, b * 0.55) * k;
  return uv - vec2(d.x / (r * uAspect), d.y / r) * defl;
}

void main() {
  // три выборки с чуть разной силой — по ним же и хроматическая аберрация
  vec2 uvG = lens(vUv, 1.0);
  vec4 sG = texture2D(tScene, uvG);
  float cr = texture2D(tScene, lens(vUv, 1.0 + uAber * 0.02)).r;
  float cb = texture2D(tScene, lens(vUv, 1.0 - uAber * 0.02)).b;
  vec3 col = vec3(cr, sG.g, cb);
  float alpha = sG.a;

  vec3 glow = texture2D(tBloom, uvG).rgb;
  col += glow * uBloom;
  alpha = clamp(alpha + max(max(glow.r, glow.g), glow.b) * uBloom * 0.9, 0.0, 1.0);

  // кольцо Эйнштейна: узкая засветка сразу за тенью горизонта
  vec2 d = (vUv - uCenter) * vec2(uAspect, 1.0);
  float r = length(d);
  float ring = exp(-pow((r - uHoleR * 1.22) / max(uHoleR * 0.24, 1e-4), 2.0));
  ring *= smoothstep(uHoleR * 0.7, uHoleR * 1.05, r);      // внутрь тени не заходит
  col += vec3(1.0, 0.85, 0.64) * ring * uRing;
  alpha = clamp(alpha + ring * uRing * 0.85, 0.0, 1.0);

  col = aces(col * uExposure);
  gl_FragColor = vec4(col * alpha, alpha);                 // холст ждёт premultiplied
  #include <colorspace_fragment>
}`;

export function createPostFX(THREE, renderer, {
  strength = 0.85, bloom = 0.9, threshold = 0.42, exposure = 1.06, aberration = 1, ring = 0.55,
} = {}) {
  renderer.info.autoReset = false;      // сбрасываем вручную, см. render()
  const opts = { type: THREE.HalfFloatType, depthBuffer: false };

  const rtScene = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType, depthBuffer: true, samples: 4,   // MSAA внутри буфера: без «лестницы» на силуэте
  });
  const rtHalf = [new THREE.WebGLRenderTarget(1, 1, opts), new THREE.WebGLRenderTarget(1, 1, opts)];

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);

  const makeMat = (fragmentShader, uniforms) => new THREE.ShaderMaterial({
    vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false,
  });

  const brightMat = makeMat(BRIGHT, {
    tDiffuse: { value: null }, uThreshold: { value: threshold }, uKnee: { value: 0.35 },
  });
  const blurMat = makeMat(BLUR, { tDiffuse: { value: null }, uDir: { value: new THREE.Vector2() } });
  const compMat = makeMat(COMPOSITE, {
    tScene: { value: rtScene.texture },
    tBloom: { value: rtHalf[0].texture },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uAspect: { value: 1 },
    uHoleR: { value: 0.14 },
    uStrength: { value: strength },
    uBloom: { value: bloom },
    uAber: { value: aberration },
    uRing: { value: ring },
    uExposure: { value: exposure },
  });

  const quad = new THREE.Mesh(quadGeo, brightMat);
  quad.frustumCulled = false;
  quadScene.add(quad);

  let W = 1, H = 1;

  function setSize(w, h) {
    W = Math.max(1, Math.floor(w));
    H = Math.max(1, Math.floor(h));
    rtScene.setSize(W, H);
    rtHalf[0].setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    rtHalf[1].setSize(Math.max(1, W >> 1), Math.max(1, H >> 1));
    compMat.uniforms.uAspect.value = W / H;
  }

  const pass = (mat, target) => {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.clear(true, true, true);
    renderer.render(quadScene, quadCam);
  };

  /**
   * @param {THREE.Scene} scene   что рисовать
   * @param {THREE.Camera} camera чем рисовать
   * @param {number} holeR        радиус тени горизонта в долях высоты кадра
   * @param {number} boost        временное усиление свечения (вспышка, разгар)
   */
  function render(scene, camera, holeR = 0.14, boost = 1) {
    // info сбрасываем сами: иначе показатели кадра относятся к последнему
    // полноэкранному проходу, а не к самой сцене
    renderer.info.reset();
    renderer.setRenderTarget(rtScene);
    renderer.clear(true, true, true);
    renderer.render(scene, camera);
    const calls = renderer.info.render.calls;
    const triangles = renderer.info.render.triangles;

    brightMat.uniforms.tDiffuse.value = rtScene.texture;
    pass(brightMat, rtHalf[0]);

    // два прохода туда-обратно: второй шире — свечение получается мягким
    const hw = 1 / Math.max(1, W >> 1);
    const hh = 1 / Math.max(1, H >> 1);
    for (const radius of [1, 2.6]) {
      blurMat.uniforms.tDiffuse.value = rtHalf[0].texture;
      blurMat.uniforms.uDir.value.set(hw * radius, 0);
      pass(blurMat, rtHalf[1]);
      blurMat.uniforms.tDiffuse.value = rtHalf[1].texture;
      blurMat.uniforms.uDir.value.set(0, hh * radius);
      pass(blurMat, rtHalf[0]);
    }

    compMat.uniforms.uHoleR.value = holeR;
    compMat.uniforms.uBloom.value = bloom * boost;
    quad.material = compMat;
    renderer.setRenderTarget(null);
    renderer.clear(true, true, true);
    renderer.render(quadScene, quadCam);
    return { calls, triangles };
  }

  function dispose() {
    rtScene.dispose();
    rtHalf.forEach((rt) => rt.dispose());
    quadGeo.dispose();
    [brightMat, blurMat, compMat].forEach((m) => m.dispose());
  }

  return {
    render,
    setSize,
    dispose,
    set bloom(v) { compMat.uniforms.uBloom.value = v; },
    get bloom() { return compMat.uniforms.uBloom.value; },
    set strength(v) { compMat.uniforms.uStrength.value = v; },
    get strength() { return compMat.uniforms.uStrength.value; },
  };
}
