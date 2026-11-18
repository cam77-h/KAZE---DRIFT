import * as THREE from 'three';
import { GameLoop, PHYSICS_DT } from './core/loop';
import { StateMachine } from './core/state';
import { EventBus, type GameEvents } from './core/events';
import { loadSave, newSave, writeSave, type SaveData } from './core/save';
import { defaultKeys, type Action } from './core/settings';
import { InputManager } from './input/input';
import { Vehicle } from './physics/vehicle';
import { emptyInput, type DriverInput } from './physics/types';
import { SURFACES } from './physics/surfaces';
import { Track } from './world/track';
import { buildTrackMeshes } from './world/trackMesh';
import { buildScenery } from './world/scenery';
import { CarView } from './vehicles/carView';
import { Environment } from './render/environment';
import { PostStack } from './render/post';
import { ChaseCamera } from './render/camera';
import { ConeField, SkidMarks, SmokeSystem } from './render/effects';
import { setMaxAnisotropy } from './render/textures';
import { CarAudio } from './audio/engineAudio';
import { Hud } from './ui/hud';
import { Menus, TouchControls } from './ui/menus';
import { TRACKS, carDef, carName, carPhysics, trackName } from './data';

type GameState = 'boot' | 'title' | 'select' | 'loading' | 'drive' | 'paused';

interface Location {
  id: string;
  track: Track;
  group: THREE.Group;
  lamps: THREE.MeshStandardMaterial[];
  cones: ConeField | null;
}

/** Top-level game: owns the renderer, the current location, the car and all UI. */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly env: Environment;
  readonly post: PostStack;
  readonly cam: ChaseCamera;
  readonly input: InputManager;
  readonly audio: CarAudio;
  readonly hud: Hud;
  readonly menus: Menus;
  readonly touch: TouchControls;
  readonly events = new EventBus<GameEvents>();
  readonly state = new StateMachine<GameState>();
  readonly loop: GameLoop;
  save: SaveData;

  private location: Location | null = null;
  private vehicle: Vehicle | null = null;
  private view: CarView | null = null;
  private smoke: SmokeSystem;
  private skids = new SkidMarks();
  private driverInput: DriverInput = emptyInput();
  private titleOrbit = 0;
  private saveTimer = 0;
  private desat = 0;
  private uiRoot: HTMLElement;
  private assistFlags: Record<string, boolean> = { ABS: false, TCS: false, STM: false, DRIFT: false };

  constructor(private container: HTMLElement) {
    this.save = loadSave();
    const s = this.save.settings;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    container.appendChild(this.renderer.domElement);

    this.env = new Environment(this.scene, this.renderer);
    this.env.setHour(16.6);
    this.cam = new ChaseCamera(innerWidth / innerHeight);
    this.post = new PostStack(this.renderer, this.scene, this.cam.camera);
    this.smoke = new SmokeSystem(Math.round(1600 * s.graphics.particles));
    this.scene.add(this.smoke.mesh, this.skids.mesh);

    this.input = new InputManager(s.controls);
    this.audio = new CarAudio(s.audio);
    this.uiRoot = document.getElementById('ui') ?? document.body;
    this.hud = new Hud(this.uiRoot);
    this.hud.onPause = () => this.pause();
    this.touch = new TouchControls(this.uiRoot, this.input);
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    this.menus = new Menus(this.uiRoot, s, this.input, () => this.save, {
      onFreeDrive: () => this.state.go('select'),
      onSelectLocation: (id) => void this.startDriving(id),
      onResume: () => this.resume(),
      onReset: () => {
        this.resetCar();
        this.resume();
      },
      onChangeLocation: () => this.state.go('select'),
      onQuit: () => this.state.go('title'),
      onSettingsChanged: (section) => this.applySettings(section),
      onImportSave: (data) => {
        this.save = data;
        Object.assign(this.save.settings, data.settings);
        this.persist();
        location.reload();
      },
      onResetSave: () => {
        const keepSettings = this.save.settings;
        this.save = newSave();
        this.save.settings = keepSettings;
        this.persist();
      },
      click: () => this.audio.click(),
    });

    this.input.onAction((a) => this.onAction(a));
    this.setupStates();
    this.applySettings('all');
    addEventListener('resize', () => this.resize());
    this.resize();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state.is('drive')) this.pause();
        this.audio.suspend();
      }
    });
    // first user gesture starts audio (browser autoplay rules)
    const unlock = () => {
      this.audio.start(this.vehicle?.spec.engine.cylinders ?? 4);
      removeEventListener('pointerdown', unlock);
      removeEventListener('keydown', unlock);
    };
    addEventListener('pointerdown', unlock);
    addEventListener('keydown', unlock);

    this.loop = new GameLoop({ step: (dt) => this.step(dt), render: (dt, a) => this.render(dt, a) });
  }

  // ---------------------------------------------------------------- states

  private setupStates(): void {
    this.state
      .add('boot')
      .add('title', {
        enter: () => {
          this.menus.show('title');
          this.hud.setVisible(false);
          this.touch.setVisible(false);
          this.loop.paused = false;
          if (!this.location || this.location.id !== 'minami') void this.loadLocation('minami', true);
        },
      })
      .add('select', {
        enter: () => {
          this.menus.show('select');
          this.hud.setVisible(false);
          this.touch.setVisible(false);
          this.loop.paused = false;
        },
      })
      .add('loading')
      .add('drive', {
        enter: () => {
          this.menus.show(null);
          this.hud.setVisible(true);
          this.touch.setVisible(true);
          this.loop.paused = false;
          this.audio.resume();
        },
      })
      .add('paused', {
        enter: () => {
          this.menus.show('pause');
          this.hud.setVisible(false);
          this.touch.setVisible(false);
          this.loop.paused = true;
          this.audio.suspend();
          this.persist();
        },
      });
    this.state.onChange((from, to) => this.events.emit('stateChanged', { from: String(from), to }));
  }

  start(): void {
    this.state.go('boot');
    this.state.go('title');
    this.loop.start();
  }

  pause(): void {
    if (this.state.is('drive')) this.state.go('paused');
  }

  resume(): void {
    if (this.state.is('paused')) this.state.go('drive');
  }

  private onAction(a: Action): void {
    if (a === 'pause') {
      if (this.state.is('drive')) this.pause();
      else if (this.state.is('paused') && this.menus.visible === 'pause') this.resume();
      else if (this.menus.visible === 'settings') this.menus.show(this.state.is('paused') ? 'pause' : 'title');
      else if (this.state.is('select')) this.state.go('title');
      return;
    }
    if (!this.state.is('drive')) return;
    if (a === 'camera') {
      const name = this.cam.cycle();
      this.save.settings.gameplay.camera = this.cam.mode;
      this.hud.toast(`CAMERA · ${name.toUpperCase()}`);
    } else if (a === 'reset') {
      this.resetCar();
      this.hud.toast('RESET');
    }
  }

  // ---------------------------------------------------------------- loading

  private loadToken = 0;
  async loadLocation(id: string, background = false): Promise<void> {
    const token = ++this.loadToken;
    if (!background) this.menus.showLoading(id);
    const progress = (f: number) => !background && this.menus.setProgress(f);
    const tick = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
    await tick();
    const g = this.save.settings.graphics;
    // tear down the old location
    if (this.location) {
      this.scene.remove(this.location.group);
      disposeGroup(this.location.group);
      this.location = null;
    }
    this.skids.clear();
    this.smoke.clear();
    progress(0.1);
    await tick();
    const track = new Track(TRACKS[id]);
    progress(0.3);
    await tick();
    const group = new THREE.Group();
    const meshes = buildTrackMeshes(track, g.drawDistance);
    group.add(meshes.group);
    progress(0.6);
    await tick();
    const scenery = buildScenery(track, Math.min(1.3, g.drawDistance));
    group.add(scenery.group);
    let cones: ConeField | null = null;
    if (scenery.cones.length) {
      cones = new ConeField(scenery.cones, track);
      cones.onKnock = (_c, speed) => {
        this.cam.bump(0.08);
        this.audio.impact(speed * 0.3, 'tire');
      };
      group.add(cones.mesh);
    }
    progress(0.8);
    await tick();
    if (token !== this.loadToken) {
      disposeGroup(group);
      return;
    }
    this.scene.add(group);
    this.location = { id, track, group, lamps: scenery.lamps, cones };
    this.save.world.lastLocation = id;
    this.spawnCar();
    this.applyTimeOfDay();
    progress(1);
    // warm up shaders so the first frames don't hitch
    this.renderer.compile(this.scene, this.cam.camera);
    await tick();
  }

  private async startDriving(id: string): Promise<void> {
    this.state.go('loading');
    if (!this.location || this.location.id !== id || this.loadToken === 0) await this.loadLocation(id);
    else {
      this.menus.showLoading(id);
      this.menus.setProgress(1);
      this.resetCar();
    }
    this.cam.mode = this.save.settings.gameplay.camera;
    this.cam.snap();
    this.audio.start(this.vehicle?.spec.engine.cylinders ?? 4);
    setTimeout(() => this.state.go('drive'), 250);
  }

  private spawnCar(): void {
    const loc = this.location!;
    const owned = this.save.garage.cars.find((c) => c.uid === this.save.garage.selected) ?? this.save.garage.cars[0];
    const def = carDef(owned.carId);
    if (!this.vehicle || this.vehicle.spec.id !== owned.carId) {
      if (this.view) {
        this.scene.remove(this.view.group);
        this.view.dispose();
      }
      this.vehicle = new Vehicle(carPhysics(owned.carId), this.save.settings.assists);
      this.view = new CarView(this.vehicle, def, owned.paint.body);
      this.scene.add(this.view.group);
    }
    this.vehicle.assists = this.save.settings.assists;
    const sp = loc.track.def.spawn;
    this.vehicle.reset(loc.track, sp.x, sp.z, sp.yaw);
    for (let i = 0; i < 60; i++) this.vehicle.step(PHYSICS_DT, emptyInput(), loc.track);
    this.vehicle.prevPosition.copy(this.vehicle.position);
    this.vehicle.prevQuaternion.copy(this.vehicle.quaternion);
    const n = trackName(loc.id);
    this.hud.configure(this.vehicle, loc.track, { location: n.name.toUpperCase(), jp: n.jp, car: carName(owned.carId) }, this.save.settings);
    this.cam.snap();
  }

  resetCar(): void {
    if (!this.location || !this.vehicle) return;
    // reset to the nearest point on the road, facing along it
    const t = this.location.track;
    const loc = t.locate(this.vehicle.position.x, this.vehicle.position.z);
    if (loc && loc.road.def.closed && Math.abs(loc.lateral) < 60) {
      const S = loc.road.samples;
      const i = Math.floor((loc.s / loc.road.length) * S.length) % S.length;
      const p = S[i];
      this.vehicle.reset(t, p.x, p.z, Math.atan2(p.tx, p.tz));
    } else {
      const sp = t.def.spawn;
      this.vehicle.reset(t, sp.x, sp.z, sp.yaw);
    }
    this.location.cones?.reset();
    this.skids.clear();
    this.cam.snap();
  }

  private applyTimeOfDay(): void {
    // Phase 1: late-afternoon golden hour; ?hour=21 in the URL previews night
    const q = new URLSearchParams(location.search).get('hour');
    const hour = q !== null ? Number(q) : 16.6;
    this.env.setHour(hour);
    const night = this.env.look.night;
    this.view?.setHeadlights(night > 0.4);
    for (const m of this.location?.lamps ?? []) m.emissiveIntensity = night > 0.4 ? 2.2 : 0.12;
    const u = this.smoke.material.uniforms;
    u.lightColor.value.copy(this.env.sun.color).multiplyScalar(Math.min(1.2, this.env.sun.intensity * 0.4));
    u.ambient.value.copy(this.env.hemi.color).multiplyScalar(0.55 + 0.25 * (1 - night));
    u.fogColor.value.copy((this.scene.fog as THREE.Fog).color);
  }

  // ---------------------------------------------------------------- settings

  applySettings(section: string): void {
    const s = this.save.settings;
    const g = s.graphics;
    if (section === 'all' || section === 'graphics') {
      this.renderer.setPixelRatio(Math.min(2, devicePixelRatio) * g.renderScale);
      this.renderer.shadowMap.enabled = g.shadows;
      this.env.setShadowQuality(g.shadows ? g.shadowQuality : 0);
      this.env.setDrawDistance(g.drawDistance);
      this.post.apply(g);
      const f = this.scene.fog as THREE.Fog;
      this.smoke.material.uniforms.fogNear.value = f.near;
      this.smoke.material.uniforms.fogFar.value = f.far;
      this.resize();
      // materials need recompiling when shadows toggle
      this.scene.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        if (m) (Array.isArray(m) ? m : [m]).forEach((x) => (x.needsUpdate = true));
      });
    }
    if (section === 'all' || section === 'audio') this.audio.applySettings(s.audio);
    if (section === 'all' || section === 'controls') {
      this.input.settings = s.controls;
      // never allow an action to end up with no key at all
      for (const [a, keys] of Object.entries(s.controls.keys)) if (!keys.length) s.controls.keys[a as Action] = [...defaultKeys()[a as Action]];
    }
    if (section === 'all' || section === 'assists') {
      if (this.vehicle) this.vehicle.assists = s.assists;
    }
    if ((section === 'all' || section === 'gameplay') && this.vehicle && this.location) {
      const n = trackName(this.location.id);
      this.hud.configure(this.vehicle, this.location.track, { location: n.name.toUpperCase(), jp: n.jp, car: carName(this.vehicle.spec.id) }, s);
      this.cam.shakeScale = s.gameplay.cameraShake;
    }
    this.persist();
  }

  private persist(): void {
    writeSave(this.save);
  }

  private resize(): void {
    const w = this.container.clientWidth || innerWidth, h = this.container.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    const pr = this.renderer.getPixelRatio();
    this.post.setSize(w * pr, h * pr);
    this.post.composer.setPixelRatio(1);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- loop

  private step(dt: number): void {
    const v = this.vehicle, loc = this.location;
    if (!v || !loc) return;
    const driving = this.state.is('drive');
    const inp = driving ? this.driverInput : ATTRACT_INPUT;
    if (!driving) {
      inp.throttle = 0;
      inp.brake = 0;
      inp.handbrake = 1;
    }
    v.step(dt, inp, loc.track);
    inp.shiftUp = false;
    inp.shiftDown = false;
    for (const imp of v.impacts) {
      this.cam.bump(Math.min(1, imp.speed / 10));
      this.audio.impact(imp.speed, imp.material);
      this.input.rumble(Math.min(1, imp.speed / 12), 0.5, 180);
      if (imp.speed > 6) this.desat = Math.min(1, imp.speed / 14) * 0.6;
      this.events.emit('impact', { speed: imp.speed, material: imp.material, x: imp.x, y: imp.y, z: imp.z });
    }
    v.impacts.length = 0;
    loc.cones?.update(dt, v);
    // keep the car inside the world
    if (v.position.y < -50) this.resetCar();
  }

  private render(dt: number, alpha: number): void {
    const v = this.vehicle, view = this.view;
    if (this.state.is('drive')) {
      const raw = this.input.update(dt);
      const di = this.driverInput;
      di.throttle = raw.throttle;
      di.brake = raw.brake;
      di.steer = raw.steer;
      di.handbrake = raw.handbrake;
      di.clutch = raw.clutch;
      if (this.input.consume('shiftUp')) di.shiftUp = true;
      if (this.input.consume('shiftDown')) di.shiftDown = true;
      this.cam.lookBack = this.input.lookBack;
    } else {
      this.input.update(dt);
    }

    if (v && view) {
      view.update(alpha, dt);
      const t = v.telemetry;
      // smoke & skid marks from sliding wheels
      const density = this.save.settings.graphics.particles;
      for (const w of v.wheels) {
        const surf = SURFACES[w.surface];
        const slide = w.slide;
        const c = v.wheelCenter(w, TMP);
        if (w.onGround && slide > 0.05 && surf.particle !== 'none' && this.state.is('drive', 'title')) {
          const n = Math.random() < slide * density * dt * 60 * (surf.particle === 'smoke' ? 0.9 : 0.6) ? 1 : 0;
          for (let k = 0; k < n; k++) this.smoke.emit(w.contact.x, w.contact.y, w.contact.z, v.velocity.x, v.velocity.y, v.velocity.z, slide, surf.particle === 'smoke' ? 'smoke' : surf.particle === 'grass' ? 'grass' : 'dust');
        }
        const dir = TMP2.set(0, 0, 1).applyQuaternion(v.quaternion);
        this.skids.add(w.index, w.contact.x, w.contact.y + 0.02, w.contact.z, dir.x, dir.z, 0.22, slide, w.onGround && surf.marks);
        void c;
      }
      this.smoke.update(dt);

      const pos = view.group.position;
      if (this.state.is('drive', 'paused', 'loading')) {
        this.cam.update(dt, pos, view.group.quaternion, v.velocity, t.speed);
      } else {
        // attract mode: slow orbit around the parked car
        this.titleOrbit += dt * 0.12;
        const r = 7.2;
        const camPos = TMP.set(pos.x + Math.sin(this.titleOrbit) * r, pos.y + 1.4, pos.z + Math.cos(this.titleOrbit) * r);
        this.cam.camera.position.copy(camPos);
        this.cam.camera.lookAt(pos.x, pos.y + 0.2, pos.z);
        this.cam.camera.fov = 42;
        this.cam.camera.updateProjectionMatrix();
      }
      this.env.follow(pos);

      // audio
      const rear = v.wheels.filter((w) => !w.front);
      const slip = Math.max(...v.wheels.map((w) => w.slide));
      const surf = rear[0]?.surface ?? 'asphalt';
      this.audio.update({
        rpm: t.rpm,
        throttle: t.throttle,
        load: v.engine.load,
        boost: t.boost,
        speed: t.speed,
        slip,
        surface: surf === 'gravel' || surf === 'dirt' ? 'gravel' : surf === 'grass' ? 'grass' : 'tarmac',
        limiter: v.engine.limiterCut,
        bov: v.engine.bovEvent,
      });
      v.engine.bovEvent = 0;
      if (slip > 0.4 && this.state.is('drive')) this.input.rumble(0.05, slip * 0.25, 60);

      if (this.state.is('drive')) {
        const a = v.assists;
        this.assistFlags.ABS = a.abs && v.wheels.some((w) => w.absFactor < 0.95);
        this.assistFlags.TCS = a.tcs && t.throttle < this.driverInput.throttle - 0.05;
        this.assistFlags.STM = a.stability && Math.abs(t.driftAngle) > 0.15;
        this.assistFlags.DRIFT = a.driftAssist > 0 && t.rearSlip > 0.2;
        this.hud.update(v, this.save.settings, dt, this.assistFlags);
      }
      this.desat = Math.max(0, this.desat - dt * 1.5);
      this.post.setLook(this.env.look.night, t.speed, this.desat);
    }

    // autosave every 30 s while driving
    this.saveTimer += dt;
    if (this.saveTimer > 30 && this.state.is('drive')) {
      this.saveTimer = 0;
      this.persist();
    }
    this.post.draw();
  }

  /** Hooks for automated tests (Playwright smoke test). */
  debugApi() {
    return {
      game: this,
      state: () => this.state.current,
      telemetry: () => this.vehicle?.telemetry,
      position: () => this.vehicle?.position.toArray(),
      drive: (id = 'minami') => this.startDriving(id),
      setInput: (inp: Partial<DriverInput> | null) => (this.input.override = inp),
      camera: (mode: number) => {
        this.cam.mode = mode;
        this.cam.snap();
      },
      pause: () => this.pause(),
      resume: () => this.resume(),
      settings: () => this.menus.openSettings(this.state.is('paused') ? 'pause' : 'title'),
      frameSteps: () => this.loop.stepsLastFrame,
    };
  }
}

const TMP = new THREE.Vector3();
const TMP2 = new THREE.Vector3();
const ATTRACT_INPUT = emptyInput();

function disposeGroup(g: THREE.Object3D): void {
  g.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat?.dispose();
    }
  });
}
