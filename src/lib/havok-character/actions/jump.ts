/**
 * ジャンプアクション。放物線で上昇→落下し、着地時にIK足位置を復帰する。
 */
import type { HavokCharacter } from '../types';

/** ジャンプ開始。二重ジャンプは防止。 */
export function startJump(character: HavokCharacter): void {
  const jump = character.jumpState;
  if (jump.active) return;
  jump.active = true;
  jump.velocityY = jump.jumpVelocity;
}

/** ジャンプ進行。毎フレーム呼び出し。 */
export function updateJump(character: HavokCharacter, dt: number): void {
  const jump = character.jumpState;
  if (!jump.active) return;

  jump.velocityY -= jump.gravity * dt;
  jump.heightOffset += jump.velocityY * dt;

  if (jump.heightOffset <= 0) {
    jump.heightOffset = 0;
    jump.velocityY = 0;
    jump.active = false;
  }

  character.root.position.y = jump.heightOffset;

  // 空中では足のIKターゲットを持ち上げて地面に張り付かないようにする
  if (jump.active && jump.heightOffset > 0.05) {
    const chains = character.ikChains;
    const groundY = character.initialFootY.left;
    const airFootY = groundY + jump.heightOffset - 0.05;
    chains.leftLeg.target.y = Math.max(groundY, airFootY);
    chains.rightLeg.target.y = Math.max(groundY, airFootY);
  }
}
