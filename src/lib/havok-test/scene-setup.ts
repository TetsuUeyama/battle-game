/**
 * Babylon.js シーン初期化。カメラ・ライト・地面の作成。
 */
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight, DirectionalLight,
  Vector3, Color3, Color4, MeshBuilder, StandardMaterial,
} from '@babylonjs/core';

export interface SceneObjects {
  engine: Engine;
  scene: Scene;
  camera: ArcRotateCamera;
}

export function setupScene(canvas: HTMLCanvasElement): SceneObjects {
  const engine = new Engine(canvas, true);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.12, 0.12, 0.18, 1);

  const camera = new ArcRotateCamera('cam', Math.PI / 2, Math.PI / 3, 3, new Vector3(0, 0.8, 0), scene);
  camera.attachControl(canvas, true);
  camera.lowerRadiusLimit = 0.5;
  camera.upperRadiusLimit = 10;
  camera.wheelPrecision = 50;

  new HemisphericLight('hemi', new Vector3(0, 1, 0), scene).intensity = 0.5;
  new DirectionalLight('dir', new Vector3(-1, -2, 1), scene).intensity = 0.8;

  // Ground
  const ground = MeshBuilder.CreateGround('ground', { width: 6, height: 6 }, scene);
  const gMat = new StandardMaterial('gMat', scene);
  gMat.diffuseColor = new Color3(0.3, 0.3, 0.35);
  gMat.alpha = 0.5;
  ground.material = gMat;

  return { engine, scene, camera };
}
