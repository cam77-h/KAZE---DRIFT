import * as THREE from 'three';
import { GameLoop, PHYSICS_DT } from './core/loop';
import { StateMachine } from './core/state';
import { EventBus, type GameEvents } from './core/events';
import { loadSave, newSave, writeSave, type OwnedCar, type SaveData } from './core/save';
import { defaultKeys, type Action } from './core/settings';
import { InputManager } from './input/input';
import { Vehicle } from './physics/vehicle';
import { emptyInput, type DriverInput } from './physics/types';
import { SURFACES } from './physics/surfaces';
import { Track } from './world/track';
import { buildTrackMeshes } from './world/trackMesh';
import { buildScenery } from './world/scenery';
import { CarView } from './vehicles/carView';
import { buildCarVisual, fitPhysicsToModel } from './vehicles/carVisual';
import type { PaintFinish } from './vehicles/paint';
import { Environment } from './render/environment';
import { PostStack } from './render/post';
import { ChaseCamera } from './render/camera';
import { SpeedLines } from './render/speedLines';
import { DEFAULT_PROFILES, profileFor, SteerPipeline, type SteerDevice } from './input/steering';
import { Showroom } from './render/showroom';
import { ShowroomUi, ownedToShowroom } from './ui/showroomUi';
import { UpgradeShop } from './ui/upgradeShop';
import { buyCar } from './ui/shop';
import { applyBuild } from './garage/parts';
import { ConeField, SkidMarks, SmokeSystem } from './render/effects';
import { setMaxAnisotropy } from './render/textures';
import { CarAudio } from './audio/engineAudio';
import { Hud } from './ui/hud';
import { Menus, TouchControls } from './ui/menus';
import { TRACKS, carDef, carName, carPhysics, trackName } from './data';
import { Flow } from './ui/flow';
import { Shop } from './ui/shop';
import { ChainHud } from './ui/chainHud';
import { SkillChain } from './scoring/skillChain';
import { TrafficSystem } from './world/traffic';
import { buildOpenRoadScenery } from './world/openRoadScenery';
import { OpenRoadMode } from './modes/openRoad';
import { DriftEventMode } from './modes/driftEvent';
import type { GameApi, ModeController, SessionConfig } from './modes/types';
import { formatYen } from './core/progression';

type GameState = 'boot' | 'title' | 'menu' | 'loading' | 'drive' | 'paused';

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
  private speedLines: SpeedLines;
  private showroom: Showroom;
  private showroomUi: ShowroomUi;
  private upgrades: UpgradeShop;
  private showroomFrom: 'select' | 'dealer' | 'mycars' = 'select';
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
  readonly flow: Flow;
  readonly chainHud: ChainHud;
  readonly shop: Shop;
  chain = new SkillChain();
  private mode: ModeController | null = null;
  private session: SessionConfig | null = null;
  private traffic: TrafficSystem | null = null;
  private objectiveEl: HTMLElement;
  private bannerEl: HTMLElement;
  private sessionTime = 0;
  private playerSCache = 0;
  private endTimer = 0;
  private seaT = 0;
  private animated: THREE.Object3D[] = [];

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
    this.speedLines = new SpeedLines(this.uiRoot);
    this.hud = new Hud(this.uiRoot);
    this.hud.onPause = () => this.pause();
    this.touch = new TouchControls(this.uiRoot, this.input);
    if (matchMedia('(pointer: coarse)').matches) document.body.classList.add('touch');
    this.menus = new Menus(this.uiRoot, s, this.input, () => this.save, {
      onFreeDrive: () => this.goMenu('main'),
      onSelectLocation: () => undefined,
      onResume: () => this.resume(),
      onReset: () => {
        this.resetCar();
        this.resume();
      },
      onChangeLocation: () => this.endSession(),
      onQuit: () => this.abandonSession(),
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

    this.flow = new Flow(this.uiRoot, () => this.save, {
      start: (cfg) => void this.startSession(cfg),
      openSettings: () => this.openSettingsFromMenu(),
      openGarage: () => this.openShop('skills'),
      openDealer: () => this.openShop('dealer'),
      openRecords: () => this.hud.toast('RECORDS · coming in step 6'),
      openHowTo: () => {
        this.menus.openSettings('menu', 'controls');
        this.flow.show(null);
      },
      retry: () => this.session && void this.startSession(this.session),
      click: () => this.audio.click(),
      selectCar: (uid) => {
        this.save.garage.selected = uid;
        this.persist();
      },
      carSelect: () => this.openShowroom('select'),
      openMyCars: () => this.openShowroom('mycars'),
    });
    this.showroom = new Showroom(this.renderer, 16 / 9);
    this.showroomUi = new ShowroomUi(this.uiRoot, this.showroom, () => this.save, {
      click: () => this.audio.click(),
      toast: (m) => this.hud.toast(m),
      choose: (uid) => {
        this.closeShowroom();
        this.flow.chooseCar(uid);
      },
      buy: (carId, paint, finish) => {
        const r = buyCar(this.save, carId, { body: paint, finish });
        if (typeof r !== 'string') {
          this.persist();
          this.flow.refreshChips();
        }
        return r;
      },
      testDrive: (carId) => {
        this.closeShowroom();
        const prev = this.save.garage.selected;
        // a test drive borrows the car on the skidpad; the garage stays as it was
        this.testDriveRestore = prev;
        history.replaceState(null, '', `?car=${carId}`);
        void this.startSession({ mode: 'practice', location: 'skidpad', event: 'free' });
      },
      upgrades: (uid) => {
        const o = this.save.garage.cars.find((c) => c.uid === uid);
        if (!o) return;
        this.showroomUi.hide();
        this.showroom.active = true;
        this.upgrades.show(o);
      },
      close: () => {
        this.closeShowroom();
        this.goMenu(this.showroomFrom === 'select' ? 'modes' : 'main');
      },
    });
    this.upgrades = new UpgradeShop(this.uiRoot, () => this.save, {
      click: () => this.audio.click(),
      toast: (m) => this.hud.toast(m),
      changed: () => {
        this.persist();
        this.flow.refreshChips();
      },
      preview: (o, build) => {
        const car = ownedToShowroom(o);
        if (build) {
          car.build = build;
          car.key = `preview|${o.uid}|${JSON.stringify(build)}|${JSON.stringify(o.tune)}`;
        }
        void this.showroom.show(car);
      },
      install: async (o) => {
        await this.showroom.show(ownedToShowroom(o));
      },
      paint: () => this.hud.toast('PAINT & LIVERY · coming with the garage (Section 4)'),
      close: () => {
        this.upgrades.hide();
        this.showroomUi.show('mycars');
      },
    });
    this.menus.onClose = (to) => {
      if (to === 'menu') this.goMenu('main');
      else this.menus.show(to);
    };
    this.shop = new Shop(this.uiRoot, () => this.save, {
      changed: () => {
        this.persist();
        this.flow.refreshChips();
      },
      back: () => {
        this.shop.hide();
        this.flow.show('main');
      },
      click: () => this.audio.click(),
      toast: (t) => this.hud.toast(t),
      chip: () => {
        const c = document.createElement('div');
        c.className = 'profile-chip';
        const sv = this.save;
        c.innerHTML = `<span class="lv">LV ${sv.profile.level}</span><b>${formatYen(sv.profile.credits)}</b><span class="sp">${sv.profile.sp} SP</span>`;
        return c;
      },
    });
    this.chainHud = new ChainHud(this.uiRoot);
    this.chainHud.setVisible(false);
    this.objectiveEl = document.createElement('div');
    this.objectiveEl.className = 'objective';
    this.bannerEl = document.createElement('div');
    this.bannerEl.className = 'banner';
    this.uiRoot.append(this.objectiveEl, this.bannerEl);
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
          this.flow.show(null);
          this.hud.setVisible(false);
          this.chainHud.setVisible(false);
          this.touch.setVisible(false);
          this.loop.paused = false;
          if (!this.location || this.location.id !== 'minami') void this.loadLocation('minami', true);
        },
      })
      .add('menu', {
        enter: () => {
          this.menus.show(null);
          this.hud.setVisible(false);
          this.chainHud.setVisible(false);
          this.objectiveEl.textContent = '';
          this.touch.setVisible(false);
          this.loop.paused = false;
          this.audio.resume();
        },
      })
      .add('loading')
      .add('drive', {
        enter: () => {
          this.menus.show(null);
          this.flow.show(null);
          this.hud.setVisible(true);
          this.chainHud.setVisible(this.session?.mode !== 'practice');
          this.touch.setVisible(true);
          this.loop.paused = false;
          this.audio.resume();
        },
      })
      .add('paused', {
        enter: () => {
          this.menus.show('pause');
          this.hud.setVisible(false);
          this.chainHud.setVisible(false);
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
    if (this.state.is('title') && this.menus.visible === 'title') {
      this.goMenu('main');
      return;
    }
    if (a === 'reset' && this.state.is('menu') && this.flow.visible === 'results' && this.session) {
      void this.startSession(this.session);
      return;
    }
    if (a === 'pause') {
      if (this.state.is('drive')) this.pause();
      else if (this.state.is('paused') && this.menus.visible === 'pause') this.resume();
      else if (this.menus.visible === 'settings') this.menus.onClose?.(this.state.is('paused') ? 'pause' : 'menu');
      else if (this.showroom.active) return;
      else if (this.state.is('menu')) {
        const v = this.flow.visible;
        this.goMenu(v === 'events' ? 'cars' : v === 'cars' ? 'modes' : 'main');
      }
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
    // same place again (retry): keep the world, just respawn
    if (this.location && this.location.id === id && !background) {
      this.skids.clear();
      this.smoke.clear();
      this.location.cones?.reset();
      this.traffic?.reset();
      progress(0.8);
      await this.spawnCar();
      progress(1);
      await tick();
      return;
    }
    // tear down the old location
    if (this.location) {
      this.scene.remove(this.location.group);
      disposeGroup(this.location.group);
      this.location = null;
    }
    this.traffic = null;
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
        if (this.state.is('drive')) {
          this.chain.wreckage(1);
          this.save.stats.conesHit++;
        }
        this.audio.impact(speed * 0.3, 'tire');
      };
      group.add(cones.mesh);
    }
    const lamps = [...scenery.lamps];
    if (track.def.sections) {
      const or = buildOpenRoadScenery(track);
      group.add(or.group);
      lamps.push(...or.lamps);
    }
    progress(0.75);
    await tick();
    if (id === 'openroad') {
      const tr = new TrafficSystem(track, {
        onNearMiss: () => {
          this.chain.nearMiss();
          (this.mode as OpenRoadMode | null)?.nearMiss?.();
          this.input.rumble(0.1, 0.4, 90);
        },
        onHit: (speed) => {
          this.chain.break('HIT TRAFFIC');
          this.audio.impact(speed * 1.5, 'concrete');
          this.cam.bump(Math.min(1, speed / 8));
          this.mode?.onImpact(speed, 'traffic');
        },
        onHonk: () => this.audio.sfx('honk'),
      });
      await tr.init(this.save.settings.graphics.preset === 'low' ? 22 : 34, (f) => progress(0.75 + f * 0.1));
      group.add(tr.group);
      this.traffic = tr;
    }
    progress(0.85);
    await tick();
    if (token !== this.loadToken) {
      disposeGroup(group);
      return;
    }
    this.scene.add(group);
    this.animated = [];
    group.traverse((o) => (o.userData as { animate?: unknown }).animate && this.animated.push(o));
    this.location = { id, track, group, lamps, cones };
    this.save.world.lastLocation = id;
    progress(0.9);
    await this.spawnCar();
    this.applyTimeOfDay();
    progress(1);
    // warm up shaders so the first frames don't hitch
    this.renderer.compile(this.scene, this.cam.camera);
    await tick();
  }

  goMenu(screen: string): void {
    this.shop?.hide();
    if (this.showroom?.active) this.closeShowroom();
    if (!this.state.is('menu')) this.state.go('menu');
    this.menus.show(null);
    this.flow.show(screen);
    if (!this.location) void this.loadLocation('minami', true);
  }

  openShop(which: 'dealer' | 'skills'): void {
    if (!this.state.is('menu')) this.state.go('menu');
    this.flow.show(null);
    if (which === 'dealer') this.openShowroom('dealer');
    else this.shop.showSkills();
  }

  private testDriveRestore: string | null = null;

  /** Update 4 §2: the 3D showroom for car select, the dealer and my cars */
  openShowroom(mode: 'select' | 'dealer' | 'mycars'): void {
    if (!this.state.is('menu')) this.state.go('menu');
    this.flow.show(null);
    this.menus.show(null);
    this.showroomFrom = mode;
    this.post.setScene(this.showroom.scene, this.showroom.camera);
    this.showroomUi.show(mode);
  }

  private closeShowroom(): void {
    this.showroomUi.hide();
    this.upgrades.hide();
    this.showroom.active = false;
    this.post.setScene(this.scene, this.cam.camera);
  }

  private openSettingsFromMenu(): void {
    this.flow.show(null);
    this.menus.openSettings('menu');
  }

  /** Start a session: load the location, build the car, set up the mode. */
  async startSession(cfg: SessionConfig): Promise<void> {
    this.mode?.dispose();
    this.mode = null;
    this.session = cfg;
    this.state.go('loading');
    this.flow.show(null);
    await this.loadLocation(cfg.location);
    this.chain = new SkillChain({ bankTime: 2.5 + 0.5 * (this.save.perks.bank ?? 0), maxMultiplier: 10 + (this.save.perks.mult ?? 0), nearMissBonus: 1 + 0.25 * (this.save.perks.nearmiss ?? 0) });
    this.chain.enabled = cfg.mode !== 'practice';
    this.chain.on((e) => {
      this.chainHud.handle(e);
      if (e.type === 'break') {
        this.desat = 0.85;
        this.audio.sfx('crack');
        this.input.rumble(0.8, 0.6, 300);
      }
      if (e.type === 'bank') this.audio.sfx('bank');
    });
    this.chainHud.reset();
    if (cfg.mode === 'openroad') this.mode = new OpenRoadMode(cfg);
    else if (cfg.mode === 'drift') this.mode = new DriftEventMode(cfg);
    else this.mode = null;
    if (this.mode) await this.mode.setup(this.gameApi());
    this.sessionTime = 0;
    this.endTimer = 0;
    this.cam.mode = this.save.settings.gameplay.camera;
    this.cam.snap();
    this.audio.start(this.vehicle?.spec.engine.cylinders ?? 4);
    this.save.stats.sessions++;
    setTimeout(() => this.state.go('drive'), 250);
  }

  /** End the session normally: pay out and show results. */
  endSession(): void {
    if (this.testDriveRestore !== null) {
      // the test drive is over: hand the borrowed car back
      history.replaceState(null, '', location.pathname);
      this.testDriveRestore = null;
    }
    if (!this.session) return this.goMenu('main');
    this.save.stats.timePlayed += this.sessionTime;
    if (this.vehicle) this.save.stats.carTime[this.vehicle.spec.id] = (this.save.stats.carTime[this.vehicle.spec.id] ?? 0) + this.sessionTime;
    if (!this.mode) {
      this.persist();
      return this.goMenu('main');
    }
    const r = this.mode.result();
    this.mode.dispose();
    this.mode = null;
    this.traffic?.reset();
    this.persist();
    this.state.go('menu');
    if (r.newRecord) this.audio.sfx('record');
    this.flow.showResults(r);
    for (const up of r.levelUps.filter((u) => u.milestone)) {
      const set = `sticker-set-${up.level}`;
      if (!this.save.unlocks.stickers.includes(set)) this.save.unlocks.stickers.push(set);
      this.celebrate(`LEVEL ${up.level}`, `MILESTONE · STICKER SET UNLOCKED · +${formatYen(up.yen)}`);
    }
  }

  /** Quit without rewards. */
  abandonSession(): void {
    this.mode?.dispose();
    this.mode = null;
    this.traffic?.reset();
    this.persist();
    this.goMenu('main');
  }

  private gameApi(): GameApi {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const g = this;
    return {
      scene: this.scene,
      get save() {
        return g.save;
      },
      get chain() {
        return g.chain;
      },
      get track() {
        return g.location!.track;
      },
      get vehicle() {
        return g.vehicle!;
      },
      get carId() {
        return g.vehicle!.spec.id;
      },
      playerS: () => this.playerSCache,
      toast: (t, sec) => this.hud.toast(t, sec),
      banner: (t, sub, color) => this.banner(t, sub, color),
      sound: (k) => this.audio.sfx(k),
      resetToStart: () => this.resetCar(),
      addMarker: (kind, x, z) => this.hud.addMarker(kind, x, z),
      setObjective: (t) => {
        if (this.objectiveEl.textContent !== t) this.objectiveEl.textContent = t;
      },
      finish: () => setTimeout(() => this.state.is('drive') && this.endSession(), 2200),
    };
  }

  private celebrate(title: string, sub: string): void {
    const d = document.createElement('div');
    d.className = 'celebrate';
    d.innerHTML = `<b>${title}</b><span>${sub}</span><em>CLICK TO CONTINUE</em>`;
    d.addEventListener('click', () => d.remove());
    this.uiRoot.append(d);
    this.audio.sfx('record');
  }

  private banner(title: string, sub: string, color = '#f2efe6'): void {
    this.bannerEl.innerHTML = `<b style="color:${color}">${title}</b><span>${sub}</span>`;
    this.bannerEl.classList.remove('on');
    void this.bannerEl.offsetWidth;
    this.bannerEl.classList.add('on');
  }

  /** Build (or rebuild) the player's car: model first, so the physics can match its geometry. */
  private async ensureCar(): Promise<void> {
    const owned = this.currentCar();
    const carId = new URLSearchParams(location.search).get('car') ?? owned.carId;
    const testDrive = carId !== owned.carId;
    const key = `${this.save.settings.gameplay.physicsModel}|${carId}|${owned.uid}|${testDrive ? '' : JSON.stringify(owned.parts) + JSON.stringify(owned.tune)}`;
    if (this.vehicle && this.carKey === key) return;
    const def = carDef(carId);
    const visual = await buildCarVisual(def, owned.paint.body, (owned.paint.finish as PaintFinish) ?? 'metallic');
    // the car as built: installed parts and tune (a borrowed test-drive car is stock)
    const spec = testDrive ? carPhysics(carId) : applyBuild(carPhysics(carId), owned.parts, owned.tune);
    if (visual.kind === 'glb') fitPhysicsToModel(spec, visual.dims);
    if (this.view) {
      this.scene.remove(this.view.group);
      this.view.dispose();
    }
    if (this.save.perks.quickShift) spec.gearbox.shiftTime *= 0.7;
    this.vehicle = new Vehicle(spec, this.save.settings.assists, this.save.settings.gameplay.physicsModel);
    if (this.save.settings.graphics.preset === 'low') this.vehicle.substeps = 2;
    this.vehicle.engine.powerScale = this.save.settings.gameplay.arcadePower;
    this.view = new CarView(this.vehicle, visual, { stance: def.visual.stance ?? 0 });
    this.scene.add(this.view.group);
    this.carKey = key;
  }
  private carKey = '';

  currentCar(): OwnedCar {
    return this.save.garage.cars.find((c) => c.uid === this.save.garage.selected) ?? this.save.garage.cars[0];
  }

  private async spawnCar(): Promise<void> {
    const loc = this.location!;
    await this.ensureCar();
    if (!this.vehicle) return;
    const owned = this.currentCar();
    this.vehicle.assists = this.save.settings.assists;
    const showcase = loc.track.def.showcase as { x: number; z: number; yaw: number } | undefined;
    let sp = (this.state.is('title') || this.state.is('menu')) && showcase ? showcase : loc.track.def.spawn;
    if (this.session?.mode === 'drift' && this.state.is('loading')) {
      // events start from a rolling grid slot just behind the start line
      const road = loc.track.roads[0];
      const p = road.samples[road.samples.length - 40];
      sp = { x: p.x, z: p.z, yaw: Math.atan2(p.tx, p.tz) };
    }
    this.vehicle.reset(loc.track, sp.x, sp.z, sp.yaw);
    for (let i = 0; i < 60; i++) this.vehicle.step(PHYSICS_DT, emptyInput(), loc.track);
    this.vehicle.prevPosition.copy(this.vehicle.position);
    this.vehicle.prevQuaternion.copy(this.vehicle.quaternion);
    const n = trackName(loc.id);
    this.hud.configure(this.vehicle, loc.track, { location: n.name.toUpperCase(), jp: n.jp, car: carName(this.vehicle.spec.id) }, this.save.settings);
    this.cam.snap();
    void owned;
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
    this.showroom?.setAspect(w / h);
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
    if (driving) {
      const l = loc.track.locate(v.position.x, v.position.z);
      if (l) this.playerSCache = l.s;
      this.sessionTime += dt;
      this.save.stats.distance += v.telemetry.speed * dt;
      if (this.session?.mode === 'openroad' || this.session?.mode === 'practice') this.chain.update(dt, v);
      this.mode?.step(dt);
      this.traffic?.update(dt, v, this.playerSCache);
    }
    for (const imp of v.impacts) {
      if (driving && imp.speed > 2.5 && imp.kind === 'wall') {
        this.chain.break(imp.material === 'tire' ? 'TIRE WALL' : 'WALL');
        this.mode?.onImpact(imp.speed, imp.material);
      }
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

  private steerPipe = new SteerPipeline();

  /** Update 5 §5.2: device profile → deadzone, gamma, speed, filter, speed sensitivity; sets the assist */
  private steerInput(raw: number, dt: number): number {
    const v = this.vehicle;
    const c = this.save.settings.controls;
    const device = this.input.lastDevice as SteerDevice;
    // the drift profile is the default everywhere: every mode in this game is a drift mode
    const id = profileFor(device, true);
    const p = { ...DEFAULT_PROFILES[id], ...(c.steerProfiles?.[id] ?? {}) };
    if (v) {
      this.input.carLockDeg = (v.spec.steerLock * 180) / Math.PI;
      this.input.carSteerRatio = v.spec.steerRatio ?? 13;
      v.assists.countersteer = p.assist;
    }
    const sim = v?.model === 'sim';
    const sliding = !!v && Math.abs(v.telemetry.driftAngle) > 0.12;
    // the classic model has its own speed-sensitive steering assist
    return this.steerPipe.update(raw, dt, sim ? p : { ...p, speedSens: 0 }, sim ? v!.telemetry.speed : 0, sliding);
  }

  private render(dt: number, alpha: number): void {
    const v = this.vehicle, view = this.view;
    if (this.state.is('drive')) {
      const raw = this.input.update(dt);
      const di = this.driverInput;
      di.throttle = raw.throttle;
      di.brake = raw.brake;
      di.steer = this.steerInput(raw.steer, dt);
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
        // attract mode: low front three-quarter view that slowly sways around the parked car
        this.titleOrbit += dt;
        const a = v.yaw + 0.62 + Math.sin(this.titleOrbit * 0.11) * 0.38;
        const r = 6.4;
        const camPos = TMP.set(pos.x + Math.sin(a) * r, pos.y + 0.55 + Math.sin(this.titleOrbit * 0.07) * 0.2, pos.z + Math.cos(a) * r);
        this.cam.camera.position.copy(camPos);
        // aim slightly right of the car so it sits beside the menu
        const side = TMP2.set(Math.cos(a), 0, -Math.sin(a)).multiplyScalar(-1.6);
        this.cam.camera.lookAt(pos.x + side.x, pos.y + 0.15, pos.z + side.z);
        this.cam.camera.fov = 40;
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
        upshift: v.engine.upshiftEvent,
      });
      v.engine.bovEvent = 0;
      if (v.engine.upshiftEvent && this.state.is('drive')) this.cam.nudge(Math.min(1, v.engine.load + 0.2));
      v.engine.upshiftEvent = 0;
      if (v.launchEvent && this.state.is('drive')) this.cam.kick(v.launchEvent);
      v.launchEvent = 0;
      if (slip > 0.4 && this.state.is('drive')) this.input.rumble(0.05, slip * 0.25, 60);

      if (this.state.is('drive')) {
        const a = v.assists;
        this.assistFlags.ABS = a.abs && v.wheels.some((w) => w.absFactor < 0.95);
        this.assistFlags.TCS = a.tcs && t.throttle < this.driverInput.throttle - 0.05;
        this.assistFlags.STM = a.stability && Math.abs(t.driftAngle) > 0.15;
        this.assistFlags.DRIFT = a.driftAssist > 0 && t.rearSlip > 0.2;
        this.hud.update(v, this.save.settings, dt, this.assistFlags);
        this.chainHud.update(this.chain, dt);
        const m = this.mode as (ModeController & { sessionMoney?: number }) | null;
        this.chainHud.setMoney(m?.sessionMoney ?? this.chain.stats.banked * 0.03);
        this.mode?.frame(dt);
        if (this.mode?.done && !this.endTimer) this.endTimer = 1;
      }
      // animate the sea
      this.seaT += dt;
      for (const o of this.animated) (o.userData as { animate: (t: number) => void }).animate(this.seaT);
      this.speedLines.update(dt, Math.max(0, t.forwardSpeed), this.state.is('drive'));
      this.desat = Math.max(0, this.desat - dt * 1.5);
      this.post.setLook(this.env.look.night, t.speed, this.desat);
    }

    // autosave every 30 s while driving
    this.saveTimer += dt;
    if (this.saveTimer > 30 && this.state.is('drive')) {
      this.saveTimer = 0;
      this.persist();
    }
    if (this.showroom.active) {
      this.showroom.update(dt);
      this.showroomUi.pollPad();
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
      drive: (id = 'minami') => this.startSession({ mode: id === 'skidpad' ? 'practice' : id === 'openroad' ? 'openroad' : 'drift', location: id, event: id === 'skidpad' || id === 'openroad' ? 'free' : 'driftattack' }),
      session: (cfg: SessionConfig) => this.startSession(cfg),
      end: () => this.endSession(),
      money: () => this.save.profile.credits,
      result: () => this.flow.lastResult,
      chain: () => ({ banked: this.chain.stats.banked, value: this.chain.value, mult: this.chain.multiplier }),
      traffic: () => this.traffic?.activeCount ?? 0,
      /** place the car at distance s along the main road (tests/screenshots) */
      teleport: (sAlong: number, speed = 0) => {
        const t = this.location?.track;
        if (!t || !this.vehicle) return;
        const road = t.roads[0];
        const p = road.samples[Math.floor((sAlong / road.length) * road.samples.length) % road.samples.length];
        const off = (this.session?.mode === 'openroad' ? p.halfWidth * 0.5 : 0);
        this.vehicle.reset(t, p.x + p.lx * off, p.z + p.lz * off, Math.atan2(p.tx, p.tz));
        if (speed) this.vehicle.launch(speed);
        this.cam.snap();
      },
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
