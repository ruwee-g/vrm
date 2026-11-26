import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";

const PREVIEW_WIDTH = 180;
const PREVIEW_HEIGHT = 320;
const PREVIEW_FOV = 24;

let renderer: THREE.WebGLRenderer | null = null;
let loader: GLTFLoader | null = null;
let queue: Promise<unknown> = Promise.resolve();

function getRenderer(): THREE.WebGLRenderer {
  if (!renderer) {
    renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
    });
    renderer.setPixelRatio(1);
    renderer.setClearColor(0xffffff, 1);
  }
  return renderer;
}

function getLoader(): GLTFLoader {
  if (!loader) {
    loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));
  }
  return loader;
}

async function renderPreview(buffer: ArrayBuffer): Promise<string> {
  const gltf = await new Promise<GLTF>((resolve, reject) => {
    getLoader().parse(buffer, "", resolve, reject);
  });
  const vrm = gltf.userData.vrm as VRM | undefined;
  if (!vrm) {
    throw new Error("Файл не является VRM-моделью");
  }

  const scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.85));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xd9d9e3, 0.8));
  const keyLight = new THREE.DirectionalLight(0xffffff, 0.95);
  keyLight.position.set(1, 2, 2);
  scene.add(keyLight);

  const model = vrm.scene;
  model.rotation.y = Math.PI;
  scene.add(model);
  vrm.update(0);

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, 0.2);
  const distance =
    (height / (2 * Math.tan(THREE.MathUtils.degToRad(PREVIEW_FOV) / 2))) * 1.12;
  const camera = new THREE.PerspectiveCamera(
    PREVIEW_FOV,
    PREVIEW_WIDTH / PREVIEW_HEIGHT,
    0.01,
    100,
  );
  camera.position.set(center.x, center.y, center.z + distance);
  camera.lookAt(center.x, center.y, center.z);

  const activeRenderer = getRenderer();
  activeRenderer.setSize(PREVIEW_WIDTH, PREVIEW_HEIGHT, false);
  activeRenderer.render(scene, camera);
  const url = activeRenderer.domElement.toDataURL("image/jpeg", 0.82);
  VRMUtils.deepDispose(model);
  return url;
}

export function renderVrmPreview(buffer: ArrayBuffer): Promise<string> {
  const job = queue.then(() => renderPreview(buffer));
  queue = job.catch(() => {});
  return job;
}
