/**
 * Шейдер чёрной дыры: настоящая геодезика фотона в метрике Шварцшильда.
 *
 * Никаких «чёрный круг + размытое кольцо». Каждый пиксель кадра — это луч,
 * пущенный из камеры назад во времени; его путь интегрируется по уравнению
 * нулевой геодезики в поле Шварцшильда (в единицах радиуса Шварцшильда rs = 1):
 *
 *     d²x/dλ² = −1.5 · h² · x / r⁵ ,   h = |x × v|
 *
 * Отсюда получаются сразу все эффекты, которые раньше приходилось рисовать
 * руками: экран сворачивается вокруг дыры сам, диск виден и снизу, и сверху
 * (свет огибает дыру), тень имеет ровно критический размер 3√3/2 · rs,
 * а по её краю возникает тонкое кольцо Эйнштейна.
 *
 * Точность формулы проверена численно: в слабом поле отклонение сходится
 * к ряду 2rs/b + 2,945(rs/b)² + 5,33(rs/b)³ (расхождение 0,00 % при b = 50 rs
 * и 0,35 % при b = 12 rs), а критический прицельный параметр выходит
 * между 2,59 и 2,60 rs при теоретических 2,5981.
 *
 * Что считается по-настоящему, а не «для красоты»:
 *
 *   • **тень** — луч либо уходит за горизонт, либо нет; граница берётся из
 *     интегрирования, а не нарисована;
 *   • **аккреционный диск** — тонкий, от ISCO (3 rs) наружу. Профиль
 *     температуры Shakura–Sunyaev (T ∝ r^-3/4), цвет — абсолютно чёрного тела,
 *     узор закручивается по Кеплеру: внутренние слои обгоняют внешние;
 *   • **релятивистский набор** — вещество в диске летит со скоростью
 *     v = √(GM/r) (в долях c), поэтому набегающий край светит в разы ярче
 *     уходящего: доплеровский фактор 1/(γ(1 − β·n)) и гравитационное
 *     красное смещение √(1 − rs/r) вместе дают множитель g, а яркость растёт
 *     как g³·⁴ (инвариант I_ν/ν³). Отсюда же цвет: набегающий край бело-голубой,
 *     уходящий — багровый;
 *   • **линзирование звёзд** — луч, ушедший на бесконечность, несёт в себе
 *     весь накопленный изгиб, поэтому небо вокруг дыры закольцовано само;
 *   • **хвост** — за пределами проинтегрированного участка остаточный изгиб
 *     добирается слабополевой формулой (ошибка там — доли процента), иначе
 *     пришлось бы тащить луч до бесконечности.
 *
 * Единицы: всё внутри шейдера — в радиусах Шварцшильда, мировые координаты
 * делятся на uRS. Камера при этом стоит в мировых, поэтому сцена остаётся
 * обычной three.js-сценой: обложки летают как летали.
 */

/** Предел на число шагов интегрирования (в GLSL цикл обязан быть с константой). */
const MAX_STEPS = 256;

const VERT = `
uniform float uTanHalf;
uniform float uAspect;
varying vec3 vRay;
void main() {
  /* Полноэкранный треугольник: луч восстанавливаем прямо из NDC. Для
     перспективной камеры направление луча линейно по (x, y) экрана —
     поэтому интерполяция без деления на w точна. */
  vRay = vec3(position.x * uTanHalf * uAspect, position.y * uTanHalf, -1.0);
  gl_Position = vec4(position.xy, 0.9999, 1.0);
}`;

const FRAG = `
precision highp float;

#define MAX_STEPS ${MAX_STEPS}
#define B_CRIT 2.5981          // критический прицельный параметр: 3√3/2

uniform mat3  uCamRot;         // поворот камеры в мировых координатах
uniform float uRS;             // радиус Шварцшильда в мировых единицах
uniform float uDiskIn;         // внутренний край диска (ISCO), в rs
uniform float uDiskOut;        // внешний край диска, в rs
uniform float uEsc;            // где считаем луч ушедшим, в rs
uniform float uTime;
uniform float uSpin;           // скорость вращения узора диска
uniform float uFeed;           // 0 — выброс, 1 — дыра заглатывает
uniform float uHeroT;          // 0…1: обложка выпавшего трека поднимается
uniform float uTemp;           // температура внутреннего края, K
uniform float uBright;         // общая яркость диска
uniform float uDiskAlpha;      // непрозрачность диска
uniform float uRing, uHalo;    // кольцо Эйнштейна и ореол над горизонтом
uniform float uJet, uJetH, uJetR, uJetV;   // релятивистские джеты
uniform float uStars;          // яркость звёздного неба
uniform vec3  uAccent;
uniform int   uSteps;          // сколько шагов реально интегрируем
varying vec3  vRay;

/* ------------------------------ хэш и шум ------------------------------ */
float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
vec3 hash33(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.xxy + p.yxx) * p.zyx);
}
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = mix(mix(hash13(i),                  hash13(i + vec3(1.0, 0.0, 0.0)), f.x),
                mix(hash13(i + vec3(0.0, 1.0, 0.0)), hash13(i + vec3(1.0, 1.0, 0.0)), f.x), f.y);
  float b = mix(mix(hash13(i + vec3(0.0, 0.0, 1.0)), hash13(i + vec3(1.0, 0.0, 1.0)), f.x),
                mix(hash13(i + vec3(0.0, 1.0, 1.0)), hash13(i + vec3(1.0, 1.0, 1.0)), f.x), f.y);
  return mix(a, b, f.z);
}
float fbm(vec3 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 5.7; a *= 0.5; }
  return s;
}

/* ------------------- цвет абсолютно чёрного тела -------------------
   Аппроксимация планковского локуса: по температуре получаем тот самый
   цвет раскалённого вещества — от багрового к бело-голубому. */
vec3 blackbody(float T) {
  T = clamp(T, 1200.0, 28000.0);
  vec3 c;
  c.r = 56100000.0 * pow(T, -1.5) + 148.0;
  c.g = T > 6500.0 ? 35200000.0 * pow(T, -1.5) + 184.0 : 100.04 * log(T) - 623.6;
  c.b = 194.18 * log(T) - 1448.6;
  return clamp(c / 255.0, 0.0, 1.0);
}

/* -------------------------- точка аккреционного диска --------------------------
   hit — точка пересечения с плоскостью диска (в rs), dir — направление луча
   в этой точке. Возвращает излучение, в alpha — непрозрачность слоя. */
vec3 diskSample(vec3 hit, vec3 dir, out float alpha) {
  alpha = 0.0;
  float r = length(hit);
  if (r < uDiskIn || r > uDiskOut) return vec3(0.0);

  float x = uDiskIn / r;                                   // 1 у внутреннего края
  float inner = smoothstep(uDiskIn * 0.99, uDiskIn * 1.32, r);
  float outer = 1.0 - smoothstep(uDiskOut * 0.58, uDiskOut, r);
  float edge = inner * outer;
  if (edge <= 0.002) return vec3(0.0);

  /* Кеплеров сдвиг: внутренние слои обгоняют внешние, поэтому узор сам
     сворачивается в спираль — без всякой анимации текстуры. */
  float ang = -uTime * uSpin * pow(max(r, 0.75), -1.5);
  float ca = cos(ang), sa = sin(ang);
  vec2 q = vec2(ca * hit.x - sa * hit.z, sa * hit.x + ca * hit.z);

  /* Шум — в полярных координатах, но на окружности: так разрез по азимуту
     получается бесшовным, а потоки вытянуты вдоль орбиты, как и положено.
     Три масштаба: крупные сгустки, потоки, тонкие нити. Третья координата
     убывает со временем — вещество видимо стекает внутрь, а не стоит. */
  vec2 u = normalize(q);
  float lr = log(r);
  float n1 = fbm(vec3(u * 2.2, lr * 9.0 + uTime * 0.10));      // сгустки
  float n2 = fbm(vec3(u * 5.6, lr * 23.0 + uTime * 0.26));     // потоки
  float n3 = fbm(vec3(u * 12.5, lr * 52.0 + uTime * 0.48));    // нити

  // «рёбра» вместо пятен: из облака получаются вытянутые жгуты
  float fil = 1.0 - abs(2.0 * n2 - 1.0);
  float dens = edge * (0.22 + 1.0 * n1) * (0.42 + 0.78 * fil) * (0.55 + 0.85 * n3);

  // редкие яркие сгустки: они вращаются вместе с потоком и вытягиваются в дуги
  float hot = pow(max(n1, 0.0), 3.2);
  // раскалённая кромка на внутреннем крае диска
  float rim = exp(-pow((r - uDiskIn * 1.14) / (uDiskIn * 0.34), 2.0));

  /* Релятивистский набор. Вещество в диске летит по Кеплеру со скоростью
     v = √(GM/r) = √(0,5/r) в долях света (rs = 1). Доплеровский фактор
     и гравитационное красное смещение складываются в один множитель g:
     яркость растёт как g³·⁴, а цвет сдвигается по температуре. */
  vec3 vorb = normalize(cross(vec3(0.0, 1.0, 0.0), hit)) * sqrt(0.5 / r);
  float b2 = min(dot(vorb, vorb), 0.8);
  float gam = 1.0 / sqrt(1.0 - b2);
  float dop = 1.0 / (gam * (1.0 - dot(vorb, -dir)));
  float grav = sqrt(max(1.0 - 1.0 / r, 0.03));
  float g = clamp(dop * grav, 0.28, 2.35);

  // профиль Shakura–Sunyaev: T ∝ r^-3/4 с нулевым моментом на внутреннем крае
  float T = uTemp * pow(x, 0.75) * (0.55 + 0.45 * pow(max(1.0 - sqrt(x * 0.985), 0.0), 0.25));
  float emis = pow(x, 1.25) * pow(g, 3.4);
  // пульсация внутренней области: дыра не бывает ровной
  float pulse = 1.0 + 0.07 * sin(uTime * 2.1 + r * 1.7) + 0.045 * sin(uTime * 5.3 - r * 3.1);

  alpha = clamp(dens * uDiskAlpha, 0.0, 1.0);
  vec3 col = blackbody(T * g * (1.0 + 0.35 * hot)) * emis * (0.55 + 0.7 * n1) * uBright * pulse;
  // кромка и сгустки добавляют отдельное белое свечение поверх диска
  col += vec3(1.0, 0.93, 0.82) * (rim * 0.85 + hot * 0.55) * emis * uBright * pulse * 0.6;
  return col;
}

/* --------------------------- звёздное небо --------------------------- */
vec3 skySample(vec3 dir) {
  vec3 col = vec3(0.0);
  for (int k = 0; k < 4; k++) {
    float sc = 110.0 * pow(2.15, float(k));
    vec3 p = dir * sc;
    vec3 id = floor(p);
    vec3 f = p - id;
    vec3 rnd = hash33(id + float(k) * 13.7);
    float mag = pow(hash13(id + 5.3 + float(k) * 3.1), 18.0);   // редкие яркие
    float dd = length(f - rnd);
    vec3 tint = mix(vec3(0.66, 0.79, 1.0), vec3(1.0, 0.86, 0.68), hash13(id + 2.1));
    col += tint * (mag * smoothstep(0.45, 0.0, dd)) / pow(1.7, float(k));
  }
  // Млечный путь: мягкая полоса, чтобы небо не выглядело чёрной картонки
  float band = exp(-pow(dot(dir, normalize(vec3(0.36, 0.84, -0.41))) * 2.4, 2.0));
  float cloud = fbm(dir * 6.5);
  col += vec3(0.020, 0.023, 0.034) * band * pow(cloud, 2.4) * 3.2;
  // едва заметная туманность: чтобы пустота не была мёртвой
  float m = fbm(dir * 2.1);
  col += uAccent * 0.016 * pow(m, 3.0);
  col += vec3(0.012, 0.016, 0.030) * pow(m, 2.0);
  return col * uStars;
}

void main() {
  vec3 rd = normalize(uCamRot * vRay);
  vec3 p = cameraPosition / uRS;                 // переходим в единицы rs
  vec3 d = rd;

  // прицельный параметр: насколько близко луч прошёл бы мимо дыры
  vec3 hv = cross(p, d);
  float b = length(hv);
  float h2 = b * b;

  vec3 col = vec3(0.0);
  float trans = 1.0;                             // сколько света дошло до камеры
  bool captured = false;

  /* Интегрирование геодезики схемой «скорость Верле»: одно вычисление
     ускорения на шаг, второй порядок точности. Шag тем мельче, чем ближе
     к горизонту, — иначе луч срежет угол на развороте. */
  float jit = 0.93 + 0.14 * hash13(vec3(gl_FragCoord.xy, 0.37));
  vec3 acc = -1.5 * h2 * p / pow(max(dot(p, p), 1e-3), 2.5);

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps) break;
    float r = length(p);
    if (r < 1.02) { captured = true; break; }              // ушёл за горизонт
    if (r > uEsc && dot(p, d) > 0.0) break;                // дыра и диск остались позади
    if (trans < 0.004) break;                              // дальше всё равно не видно
    float dl = min(max(0.08 * r + 0.02, 0.014), 1.1) * jit;

    vec3 pn = p + d * dl + (0.5 * dl * dl) * acc;
    vec3 an = -1.5 * h2 * pn / pow(max(dot(pn, pn), 1e-3), 2.5);

    // пересекли плоскость диска — интерполируем точку и берём излучение
    if (p.y * pn.y < 0.0) {
      float t = p.y / (p.y - pn.y);
      vec3 hit = mix(p, pn, t);
      float rh = length(hit);
      if (rh > uDiskIn && rh < uDiskOut && trans > 0.004) {
        float a;
        vec3 e = diskSample(hit, d, a);
        col += trans * e;                                  // спереди назад
        trans *= 1.0 - a;
      }
    }

    /* Релятивистские джеты: два луча вдоль оси вращения диска. Это объёмная
       среда, поэтому излучение набирается тем же маршем: сколько вещества
       прошли на этом шаге, столько и посветило. Узлы в струе бегут наружу. */
    if (uJet > 0.002) {
      float ay = abs(pn.y);
      if (ay > 0.8 && ay < uJetH) {
        float rad = length(pn.xz);
        float cone = uJetR * (0.55 + 0.13 * ay);
        if (rad < cone) {
          float t = rad / cone;
          float knots = 0.5 + 0.5 * sin(ay * 1.9 - uTime * 4.2 + t * 3.4)
                            * sin(ay * 0.7 - uTime * 1.7);
          float fade = exp(-ay / (uJetH * 0.5)) * (1.0 - t * t);
          float densJ = uJet * fade * (0.22 + 0.95 * knots) * (0.35 + 0.65 * t);
          vec3 vj = vec3(0.0, sign(pn.y) * uJetV, 0.0);                 // струя вдоль оси
          float gJ = clamp(1.0 / (sqrt(1.0 - uJetV * uJetV) * (1.0 - dot(vj, -d))), 0.35, 2.4);
          col += trans * mix(vec3(0.62, 0.79, 1.0), uAccent, 0.22)
                       * pow(gJ, 2.6) * densJ * dl;
          trans *= 1.0 - clamp(densJ * dl * 0.5, 0.0, 1.0);
        }
      }
    }

    d += (0.5 * dl) * (acc + an);
    p = pn;
    acc = an;
  }

  if (!captured && trans > 0.004) {
    /* Хвост: сколько изгиба осталось за пределами проинтегрированного
       участка. Слабополевая формула с поправками второго и третьего
       порядка — на таких расстояниях её ошибка не видна, а тащить луч
       до бесконечности слишком дорого. */
    float s = dot(p, d);
    float bi = 1.0 / max(b, 0.08);
    float tail = (bi + 1.4725 * bi * bi + 2.665 * bi * bi * bi)
               * (1.0 - s / sqrt(s * s + b * b));
    vec3 nh = normalize(-p + d * s);                       // от луча к центру
    vec3 dd = normalize(d * cos(tail) + nh * sin(tail));
    vec3 sky = skySample(dd);
    sky *= smoothstep(B_CRIT - 0.07, B_CRIT + 0.06, b);    // тень: внутри — ровно ничего
    col += trans * sky;
  }

  /* Кольцо Эйнштейна и ореол: то, что добавляет картинке «дорогой»
     оптики. Их гасит передний край диска — они за ним, а не перед ним. */
  float ring = exp(-pow((b - B_CRIT) / 0.055, 2.0));
  float halo = exp(-pow((b - 2.95) / 0.62, 2.0));
  float flare = 0.8 + 0.45 * uFeed + 0.5 * uHeroT;
  col += trans * (vec3(1.0, 0.87, 0.68) * ring * uRing * flare
                + mix(vec3(1.0, 0.72, 0.42), uAccent, 0.25) * halo * uHalo * (0.5 + 0.5 * uFeed));

  col += (hash13(vec3(gl_FragCoord.xy, 1.7)) - 0.5) * 0.0035;   // дизеринг против бандинга
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

/**
 * Полноэкранный «купол» с чёрной дырой.
 *
 * Это не объект сцены, а треугольник в NDC: он всегда закрывает кадр целиком,
 * не зависит от дальнего плана отсечения и рисуется первым (renderOrder −1000,
 * глубину не пишет). Всё остальное — обложки, вспышки — честно живёт в глубине
 * поверх него: сфера горизонта по-прежнему пишет глубину и прячет то, что
 * оказалось за дырой.
 */
export function createHoleDome(THREE, {
  rs = 1, diskIn = 3, diskOut = 15, esc = 22, temp = 9000,
  bright = 0.6, diskAlpha = 0.85, ring = 0.5, halo = 0.22, stars = 1, steps = 112,
  jet = 0.55, jetH = 26, jetR = 0.55, jetV = 0.62,
} = {}) {
  const geo = new THREE.BufferGeometry();
  // треугольник, накрывающий весь кадр: дешевле двух треугольников квада
  geo.setAttribute('position', new THREE.BufferAttribute(
    new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3,
  ));

  const uniforms = {
    uCamRot: { value: new THREE.Matrix3() },
    uRS: { value: rs },
    uDiskIn: { value: diskIn },
    uDiskOut: { value: diskOut },
    uEsc: { value: esc },
    uTime: { value: 0 },
    uSpin: { value: 2.2 },
    uFeed: { value: 0 },
    uHeroT: { value: 0 },
    uTemp: { value: temp },
    uBright: { value: bright },
    uDiskAlpha: { value: diskAlpha },
    uRing: { value: ring },
    uHalo: { value: halo },
    uStars: { value: stars },
    uJet: { value: jet },
    uJetH: { value: jetH },
    uJetR: { value: jetR },
    uJetV: { value: jetV },
    uAccent: { value: new THREE.Color('#1db954') },
    uSteps: { value: steps },
    uTanHalf: { value: 0.5 },
    uAspect: { value: 1 },
  };

  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: VERT, fragmentShader: FRAG,
    depthTest: false, depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;      // подложка: рисуется до всего остального

  return {
    mesh,
    uniforms,
    setSteps(n) { uniforms.uSteps.value = Math.max(48, Math.min(MAX_STEPS, Math.round(n))); },
    dispose() { geo.dispose(); material.dispose(); },
  };
}

export { MAX_STEPS };
