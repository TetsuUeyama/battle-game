'use client';

/**
 * IK/FK 学習用デモページ
 *
 * 2ボーン構造（肩-肘-手）を1本だけ表示し、FK と IK の違いを体感する。
 *
 * - FKモード: 肩・肘の角度をスライダーで動かす → 手の位置が追従
 * - IKモード: 手の目標位置をスライダーで動かす → 肩・肘の角度を自動計算
 */
import { useEffect, useRef, useState } from 'react';
import {
  Engine, Scene, ArcRotateCamera, HemisphericLight,
  Vector3, Color3, MeshBuilder, StandardMaterial, Mesh,
  Quaternion,
} from '@babylonjs/core';

type Mode = 'FK' | 'IK';

export default function IkFkLearningPage() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [mode, setMode] = useState<Mode>('IK');

  // FK用: 肩と肘の角度（度数）
  const [shoulderPitch, setShoulderPitch] = useState(0);   // 上下
  const [shoulderYaw, setShoulderYaw] = useState(0);       // 左右
  const [shoulderRoll, setShoulderRoll] = useState(0);     // ひねり
  const [elbowAngle, setElbowAngle] = useState(45);        // 肘の曲げ

  // IK用: 手の目標位置とポールヒント位置
  const [targetX, setTargetX] = useState(0.4);
  const [targetY, setTargetY] = useState(-0.3);
  const [targetZ, setTargetZ] = useState(0.3);
  const [poleX, setPoleX] = useState(-0.5);
  const [poleY, setPoleY] = useState(-0.3);
  const [poleZ, setPoleZ] = useState(-0.5);

  // 共通: 骨の長さ
  const [upperLen, setUpperLen] = useState(0.4);
  const [lowerLen, setLowerLen] = useState(0.4);

  // IK計算結果の表示用
  const [ikInfo, setIkInfo] = useState({
    distance: 0,
    reachable: true,
    elbowDeg: 0,
    handPos: { x: 0, y: 0, z: 0 },
  });

  const refs = useRef<{
    scene: Scene | null;
    shoulderJoint: Mesh | null;
    elbowJoint: Mesh | null;
    handJoint: Mesh | null;
    upperArm: Mesh | null;
    lowerArm: Mesh | null;
    poleMarker: Mesh | null;
    targetMarker: Mesh | null;
  }>({
    scene: null, shoulderJoint: null, elbowJoint: null, handJoint: null,
    upperArm: null, lowerArm: null, poleMarker: null, targetMarker: null,
  });

  // シーン初期化（1回だけ）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const engine = new Engine(canvas, true);
    const scene = new Scene(engine);
    scene.clearColor = new Color3(0.1, 0.1, 0.15).toColor4();

    const camera = new ArcRotateCamera(
      'cam', Math.PI / 2, Math.PI / 2.5, 2, Vector3.Zero(), scene,
    );
    camera.attachControl(canvas, true);
    camera.wheelPrecision = 100;
    camera.lowerRadiusLimit = 0.5;
    camera.upperRadiusLimit = 5;

    new HemisphericLight('light', new Vector3(0, 1, 0), scene);

    // 原点の補助グリッド
    const ground = MeshBuilder.CreateGround('ground', { width: 2, height: 2, subdivisions: 20 }, scene);
    const gm = new StandardMaterial('gm', scene);
    gm.wireframe = true;
    gm.emissiveColor = new Color3(0.2, 0.2, 0.3);
    ground.material = gm;
    ground.position.y = -0.8;

    // 肩ジョイント（固定・原点）
    const shoulderJoint = MeshBuilder.CreateSphere('shoulder', { diameter: 0.08 }, scene);
    const sm = new StandardMaterial('sm', scene);
    sm.emissiveColor = new Color3(1, 0.2, 0.2);
    shoulderJoint.material = sm;

    // 肘ジョイント
    const elbowJoint = MeshBuilder.CreateSphere('elbow', { diameter: 0.06 }, scene);
    const em = new StandardMaterial('em', scene);
    em.emissiveColor = new Color3(0.2, 1, 0.2);
    elbowJoint.material = em;

    // 手
    const handJoint = MeshBuilder.CreateSphere('hand', { diameter: 0.07 }, scene);
    const hm = new StandardMaterial('hm', scene);
    hm.emissiveColor = new Color3(0.2, 0.5, 1);
    handJoint.material = hm;

    // 上腕（シリンダー: Y軸方向に伸びる）
    const upperArm = MeshBuilder.CreateCylinder('upper', { height: 1, diameter: 0.04 }, scene);
    const um = new StandardMaterial('um', scene);
    um.diffuseColor = new Color3(0.9, 0.7, 0.4);
    upperArm.material = um;

    // 前腕
    const lowerArm = MeshBuilder.CreateCylinder('lower', { height: 1, diameter: 0.035 }, scene);
    const lm = new StandardMaterial('lm', scene);
    lm.diffuseColor = new Color3(0.7, 0.5, 0.3);
    lowerArm.material = lm;

    // ポールヒントマーカー
    const poleMarker = MeshBuilder.CreateSphere('pole', { diameter: 0.04 }, scene);
    const pm = new StandardMaterial('pm', scene);
    pm.emissiveColor = new Color3(1, 1, 0.2);
    poleMarker.material = pm;

    // 目標位置マーカー
    const targetMarker = MeshBuilder.CreateSphere('target', { diameter: 0.05 }, scene);
    const tm = new StandardMaterial('tm', scene);
    tm.emissiveColor = new Color3(1, 0.3, 1);
    tm.alpha = 0.7;
    targetMarker.material = tm;

    refs.current = {
      scene, shoulderJoint, elbowJoint, handJoint,
      upperArm, lowerArm, poleMarker, targetMarker,
    };

    engine.runRenderLoop(() => scene.render());
    const onResize = () => engine.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      engine.dispose();
    };
  }, []);

  // パラメータ変更時に姿勢を更新
  useEffect(() => {
    const r = refs.current;
    if (!r.scene || !r.shoulderJoint) return;

    const deg2rad = (d: number) => d * Math.PI / 180;

    let elbowPos: Vector3;
    let handPos: Vector3;
    let computedElbowDeg = 0;
    let distance = 0;
    let reachable = true;

    if (mode === 'FK') {
      // === FK: 肩・肘の角度から手の位置を計算 ===
      // 手順:
      //   1. 肩の回転行列を作る（ZYX順: pitch→yaw→roll）
      //   2. 上腕の「根本→先端」ベクトル (0, -upperLen, 0) を肩回転で変換
      //      → これが肘の位置
      //   3. 肘を中心に前腕を elbow角度 だけ曲げる
      //      → 前腕ベクトルを計算し、肘に足すと手の位置

      const sp = deg2rad(shoulderPitch);
      const sy = deg2rad(shoulderYaw);
      const sr = deg2rad(shoulderRoll);

      // 上腕は基本「下向き (0, -1, 0)」。肩の回転を適用
      // ZYX順の回転行列を手動で組む
      const cx = Math.cos(sp), sx = Math.sin(sp);
      const cy = Math.cos(sy), syS = Math.sin(sy);
      const cz = Math.cos(sr), sz = Math.sin(sr);

      // 初期の上腕方向 = (0, -1, 0)
      // Z回転(roll) → X回転(pitch) → Y回転(yaw) の順で掛ける
      const rotate = (v: Vector3): Vector3 => {
        // Roll (Z軸回転)
        let x = v.x * cz - v.y * sz;
        let y = v.x * sz + v.y * cz;
        let z = v.z;
        // Pitch (X軸回転)
        const y2 = y * cx - z * sx;
        const z2 = y * sx + z * cx;
        y = y2; z = z2;
        // Yaw (Y軸回転)
        const x3 = x * cy + z * syS;
        const z3 = -x * syS + z * cy;
        x = x3; z = z3;
        return new Vector3(x, y, z);
      };

      const upperDir = rotate(new Vector3(0, -1, 0));
      elbowPos = upperDir.scale(upperLen);

      // 前腕は肘で elbowAngle 曲がる。
      // 肘の曲げ軸はローカルX軸（肩と同じ回転のあと）。
      // 簡単のため「肘は上腕の延長線から elbowAngle 曲がる」モデル。
      const ea = deg2rad(elbowAngle);
      // 上腕方向を基準に、肘の曲げ方向（ローカルX軸方向）
      const localX = rotate(new Vector3(1, 0, 0));
      // 前腕ベクトル = 上腕方向を elbow軸周りに回転
      // 近似: 上腕方向 × cos(ea) + 肘の曲げ方向 × sin(ea)
      // （ロドリゲスの公式ベース）
      const forearmDir = upperDir.scale(Math.cos(ea)).add(
        Vector3.Cross(localX, upperDir).scale(Math.sin(ea)),
      );
      handPos = elbowPos.add(forearmDir.scale(lowerLen));
      computedElbowDeg = elbowAngle;

    } else {
      // === IK: 手の目標位置から肩・肘の角度を逆算 ===
      // 手順:
      //   1. 肩から目標までの距離 d を計算
      //   2. d > L1+L2 なら届かない（腕を伸ばし切る）
      //   3. 余弦定理で肘の曲げ角度を計算
      //      cos(π - θ_elbow) = (L1² + L2² - d²) / (2*L1*L2)
      //   4. 肩→肘の方向を「肩→目標 方向 + ポールヒント方向」で決める
      //   5. 肘の位置と手の位置を確定

      const target = new Vector3(targetX, targetY, targetZ);
      const pole = new Vector3(poleX, poleY, poleZ);

      distance = target.length();
      const L1 = upperLen;
      const L2 = lowerLen;
      const maxReach = L1 + L2;

      if (distance > maxReach) {
        // 届かない → 腕を伸ばし切って目標方向に向ける
        reachable = false;
        const dir = target.normalize();
        elbowPos = dir.scale(L1);
        handPos = dir.scale(maxReach);
        computedElbowDeg = 180; // 完全に伸びている
      } else {
        reachable = true;

        // 余弦定理で肘の内角（上腕と前腕のなす角）を計算
        // 肘の内角を θ とすると:
        //   d² = L1² + L2² - 2*L1*L2*cos(θ)
        // これを解くと:
        //   cos(θ) = (L1² + L2² - d²) / (2*L1*L2)
        const cosElbow = (L1 * L1 + L2 * L2 - distance * distance) / (2 * L1 * L2);
        const elbowInnerAngle = Math.acos(Math.max(-1, Math.min(1, cosElbow)));
        // 表示用: 「曲げ角度」= 180° − 内角（伸び切ったとき0°、90°で直角）
        computedElbowDeg = (Math.PI - elbowInnerAngle) * 180 / Math.PI;

        // 肩→目標 方向
        const toTarget = target.normalize();

        // 肩から見て、肘が目標線上のどこに射影されるか（余弦定理）
        //   cos(α) = (L1² + d² - L2²) / (2*L1*d)
        //   α: 肩→目標 と 肩→肘 のなす角
        const cosAlpha = (L1 * L1 + distance * distance - L2 * L2) / (2 * L1 * distance);
        const alpha = Math.acos(Math.max(-1, Math.min(1, cosAlpha)));

        // 肘の平面を決める: toTarget と (pole - target線上への射影) で平面を作る
        // 1. ポールから目標線への垂線方向を計算
        const poleVec = pole.clone();
        const poleOnLine = toTarget.scale(Vector3.Dot(poleVec, toTarget));
        let bendDir = poleVec.subtract(poleOnLine);
        if (bendDir.lengthSquared() < 1e-6) {
          // ポールが目標線上にある場合のフォールバック（下方向）
          bendDir = new Vector3(0, -1, 0);
        }
        bendDir = bendDir.normalize();

        // 肘の位置: 肩→目標方向に L1*cos(α) 進み、bendDir に L1*sin(α) ずれる
        elbowPos = toTarget.scale(L1 * Math.cos(alpha))
          .add(bendDir.scale(L1 * Math.sin(alpha)));
        handPos = target.clone();
      }
    }

    // メッシュに反映
    r.shoulderJoint!.position.set(0, 0, 0);
    r.elbowJoint!.position.copyFrom(elbowPos);
    r.handJoint!.position.copyFrom(handPos);

    // 上腕シリンダーを 肩→肘 に配置
    alignCylinder(r.upperArm!, new Vector3(0, 0, 0), elbowPos);
    // 前腕シリンダーを 肘→手 に配置
    alignCylinder(r.lowerArm!, elbowPos, handPos);

    // ポールマーカー（IK時のみ表示）
    r.poleMarker!.setEnabled(mode === 'IK');
    r.targetMarker!.setEnabled(mode === 'IK');
    if (mode === 'IK') {
      r.poleMarker!.position.set(poleX, poleY, poleZ);
      r.targetMarker!.position.set(targetX, targetY, targetZ);
    }

    setIkInfo({
      distance,
      reachable,
      elbowDeg: computedElbowDeg,
      handPos: { x: handPos.x, y: handPos.y, z: handPos.z },
    });
  }, [
    mode, shoulderPitch, shoulderYaw, shoulderRoll, elbowAngle,
    targetX, targetY, targetZ, poleX, poleY, poleZ, upperLen, lowerLen,
  ]);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh' }}>
      <canvas ref={canvasRef} style={{ flex: 1, outline: 'none' }} />
      <div style={{
        width: 360, padding: 16, background: '#1a1a22', color: '#eee',
        overflowY: 'auto', fontFamily: 'sans-serif', fontSize: 13,
      }}>
        <h2 style={{ marginTop: 0 }}>IK / FK 学習デモ</h2>

        <div style={{ marginBottom: 16 }}>
          <label style={{ marginRight: 12 }}>
            <input type="radio" checked={mode === 'FK'}
              onChange={() => setMode('FK')} /> FK モード
          </label>
          <label>
            <input type="radio" checked={mode === 'IK'}
              onChange={() => setMode('IK')} /> IK モード
          </label>
        </div>

        {mode === 'FK' && (
          <section>
            <h3>FK: 角度 → 手の位置</h3>
            <Slider label="肩 Pitch (上下)" value={shoulderPitch} min={-180} max={180} step={1}
              onChange={setShoulderPitch} unit="°" />
            <Slider label="肩 Yaw (左右)" value={shoulderYaw} min={-180} max={180} step={1}
              onChange={setShoulderYaw} unit="°" />
            <Slider label="肩 Roll (ひねり)" value={shoulderRoll} min={-180} max={180} step={1}
              onChange={setShoulderRoll} unit="°" />
            <Slider label="肘の曲げ" value={elbowAngle} min={0} max={150} step={1}
              onChange={setElbowAngle} unit="°" />
          </section>
        )}

        {mode === 'IK' && (
          <section>
            <h3>IK: 目標位置 → 角度</h3>
            <p style={{ color: '#aaa', fontSize: 11 }}>紫: 目標 / 黄: ポールヒント</p>
            <Slider label="目標 X" value={targetX} min={-1.5} max={1.5} step={0.01} onChange={setTargetX} />
            <Slider label="目標 Y" value={targetY} min={-1.5} max={1.5} step={0.01} onChange={setTargetY} />
            <Slider label="目標 Z" value={targetZ} min={-1.5} max={1.5} step={0.01} onChange={setTargetZ} />
            <h4 style={{ marginBottom: 4 }}>ポールヒント（肘の曲がる方向）</h4>
            <Slider label="Pole X" value={poleX} min={-1.5} max={1.5} step={0.01} onChange={setPoleX} />
            <Slider label="Pole Y" value={poleY} min={-1.5} max={1.5} step={0.01} onChange={setPoleY} />
            <Slider label="Pole Z" value={poleZ} min={-1.5} max={1.5} step={0.01} onChange={setPoleZ} />
          </section>
        )}

        <section style={{ marginTop: 16 }}>
          <h3>骨の長さ</h3>
          <Slider label="上腕" value={upperLen} min={0.1} max={0.7} step={0.01} onChange={setUpperLen} />
          <Slider label="前腕" value={lowerLen} min={0.1} max={0.7} step={0.01} onChange={setLowerLen} />
        </section>

        <section style={{ marginTop: 16, background: '#252530', padding: 12, borderRadius: 4 }}>
          <h3 style={{ marginTop: 0 }}>計算結果</h3>
          {mode === 'IK' && (
            <>
              <div>距離 d = <b>{ikInfo.distance.toFixed(3)}</b> m</div>
              <div>届く範囲 L1+L2 = <b>{(upperLen + lowerLen).toFixed(3)}</b> m</div>
              <div style={{ color: ikInfo.reachable ? '#5f5' : '#f77' }}>
                {ikInfo.reachable ? '✓ 到達可能' : '✗ 届かない（腕を伸ばし切る）'}
              </div>
            </>
          )}
          <div>肘角度 = <b>{ikInfo.elbowDeg.toFixed(1)}</b>°</div>
          <div>手の位置 = ({ikInfo.handPos.x.toFixed(2)}, {ikInfo.handPos.y.toFixed(2)}, {ikInfo.handPos.z.toFixed(2)})</div>
        </section>

        <section style={{ marginTop: 16, fontSize: 11, color: '#aaa' }}>
          <h3>観察ポイント</h3>
          <ul style={{ paddingLeft: 16 }}>
            <li>FK: 肩角度を変えると子（肘・手）がまとめて動く</li>
            <li>IK: 目標を遠くに移動 → d &gt; L1+L2 で届かなくなる</li>
            <li>IK: ポールを前/後ろで肘の曲がる方向が反転</li>
            <li>骨の長さを変えると到達可能範囲が変化</li>
          </ul>
        </section>
      </div>
    </div>
  );
}

function Slider(props: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string;
}) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span>{props.label}</span>
        <span>{props.value.toFixed(props.step < 1 ? 2 : 0)}{props.unit ?? ''}</span>
      </div>
      <input type="range" min={props.min} max={props.max} step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(parseFloat(e.target.value))}
        style={{ width: '100%' }}
      />
    </div>
  );
}

/**
 * シリンダーを 2点 from→to 間に配置する。
 * シリンダーは初期状態で +Y 方向に高さ1。
 */
function alignCylinder(cyl: Mesh, from: Vector3, to: Vector3) {
  const diff = to.subtract(from);
  const len = diff.length();
  cyl.scaling.set(1, len, 1);
  cyl.position.copyFrom(from.add(to).scale(0.5));

  // 回転: (0,1,0) から diff方向 への回転
  const dir = diff.normalize();
  const up = new Vector3(0, 1, 0);
  const dot = Vector3.Dot(up, dir);
  if (dot > 0.9999) {
    cyl.rotationQuaternion = null;
    cyl.rotation.set(0, 0, 0);
  } else if (dot < -0.9999) {
    cyl.rotationQuaternion = null;
    cyl.rotation.set(Math.PI, 0, 0);
  } else {
    const axis = Vector3.Cross(up, dir).normalize();
    const angle = Math.acos(dot);
    cyl.rotationQuaternion = Quaternion.RotationAxis(axis, angle);
  }
}
