import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import type { GraphicsSettings } from '../core/settings';

/** Colour grade, vignette, film grain and a radial speed blur, after tone mapping. */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    grain: { value: 0.035 },
    vignette: { value: 0.32 },
    blur: { value: 0 },
    lift: { value: new THREE.Vector3(0.0, 0.0, 0.012) },
    gain: { value: new THREE.Vector3(1.02, 1.0, 0.98) },
    saturation: { value: 1.06 },
    desaturate: { value: 0 },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float time, grain, vignette, blur, saturation, desaturate; uniform vec3 lift, gain;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)) + time) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      vec4 col = texture2D(tDiffuse, vUv);
      if (blur > 0.001) {
        float amt = blur * smoothstep(0.15, 0.7, length(c));
        vec4 acc = col;
        for (int i = 1; i < 6; i++) acc += texture2D(tDiffuse, vUv - c * amt * float(i) * 0.012);
        col = acc / 6.0;
      }
      vec3 rgb = col.rgb * gain + lift;
      float l = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
      rgb = mix(vec3(l), rgb, saturation * (1.0 - desaturate));
      rgb *= 1.0 - vignette * smoothstep(0.35, 0.85, length(c * vec2(1.1, 1.0)));
      rgb += (hash(vUv * 731.0) - 0.5) * grain;
      gl_FragColor = vec4(rgb, col.a);
    }`,
};

export class PostStack {
  composer: EffectComposer;
  private render: RenderPass;
  private gtao: GTAOPass;
  private bloom: UnrealBloomPass;
  private output: OutputPass;
  private grade: ShaderPass;
  private smaa: SMAAPass;
  enabled = true;
  private motionBlur = false;

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(renderer, rt);
    this.render = new RenderPass(scene, camera);
    this.gtao = new GTAOPass(scene, camera, size.x, size.y);
    this.gtao.blendIntensity = 0.75;
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.32, 0.55, 0.88);
    this.output = new OutputPass();
    this.grade = new ShaderPass(GradeShader);
    this.smaa = new SMAAPass();
    this.composer.addPass(this.render);
    this.composer.addPass(this.gtao);
    this.composer.addPass(this.bloom);
    this.composer.addPass(this.output);
    this.composer.addPass(this.grade);
    this.composer.addPass(this.smaa);
  }

  setCamera(camera: THREE.Camera): void {
    this.render.camera = camera;
    (this.gtao as unknown as { camera: THREE.Camera }).camera = camera;
  }

  apply(g: GraphicsSettings): void {
    this.gtao.enabled = g.ssao;
    this.bloom.enabled = g.bloom;
    this.smaa.enabled = g.antialias;
    this.motionBlur = g.motionBlur;
    (this.grade.uniforms.grain.value as number) = g.grain ? 0.03 : 0;
    this.grade.uniforms.grain.value = g.grain ? 0.03 : 0;
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
  }

  setLook(night: number, speed: number, desaturate: number): void {
    const u = this.grade.uniforms;
    u.time.value = (u.time.value + 0.0173) % 100;
    u.blur.value = this.motionBlur ? Math.max(0, Math.min(1, (speed - 25) / 35)) : 0;
    u.vignette.value = 0.28 + night * 0.12;
    u.saturation.value = 1.06 - night * 0.08;
    u.desaturate.value = desaturate;
    // the sky is HDR, so the daytime threshold sits well above 1 to bloom only real highlights
    this.bloom.strength = 0.14 + night * 0.5;
    this.bloom.threshold = night > 0.5 ? 0.7 : 6;
    this.bloom.radius = 0.35 + night * 0.25;
  }

  draw(): void {
    this.composer.render();
  }
}
