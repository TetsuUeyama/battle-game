import type {
  AnimatorCondition,
  AnimatorParameter,
  AnimatorParameterType,
} from "./types";

/**
 * Animator のパラメータ値を保持する。
 *
 * - Bool / Float / Int は普通の値。
 * - Trigger は「立っている / 立っていない」のフラグで、Transition の条件を満たして
 *   遷移が成立した瞬間に消費される (Unity の挙動と同じ)。
 */
export class ParameterStore {
  private readonly types = new Map<string, AnimatorParameterType>();
  private readonly bools = new Map<string, boolean>();
  private readonly floats = new Map<string, number>();
  private readonly ints = new Map<string, number>();
  private readonly triggers = new Set<string>();

  constructor(parameters: readonly AnimatorParameter[]) {
    for (const p of parameters) {
      this.types.set(p.name, p.type);
      switch (p.type) {
        case "Bool":
          this.bools.set(p.name, p.defaultBool);
          break;
        case "Float":
          this.floats.set(p.name, p.defaultFloat);
          break;
        case "Int":
          this.ints.set(p.name, p.defaultInt);
          break;
        case "Trigger":
          if (p.defaultBool) this.triggers.add(p.name);
          break;
      }
    }
  }

  has(name: string): boolean {
    return this.types.has(name);
  }

  setBool(name: string, value: boolean): void {
    this.assertType(name, "Bool");
    this.bools.set(name, value);
  }

  setFloat(name: string, value: number): void {
    this.assertType(name, "Float");
    this.floats.set(name, value);
  }

  setInt(name: string, value: number): void {
    this.assertType(name, "Int");
    this.ints.set(name, value);
  }

  setTrigger(name: string): void {
    this.assertType(name, "Trigger");
    this.triggers.add(name);
  }

  resetTrigger(name: string): void {
    this.triggers.delete(name);
  }

  getBool(name: string): boolean {
    return this.bools.get(name) ?? false;
  }
  getFloat(name: string): number {
    return this.floats.get(name) ?? 0;
  }
  getInt(name: string): number {
    return this.ints.get(name) ?? 0;
  }
  isTriggered(name: string): boolean {
    return this.triggers.has(name);
  }

  /**
   * Transition の conditions すべてを評価。空配列は「条件なし」として true 扱い。
   */
  evaluateConditions(conditions: readonly AnimatorCondition[]): boolean {
    for (const c of conditions) {
      if (!this.evaluate(c)) return false;
    }
    return true;
  }

  /**
   * 遷移が成立した直後に呼び、関連 Trigger を消費する。
   */
  consumeTriggers(conditions: readonly AnimatorCondition[]): void {
    for (const c of conditions) {
      if (this.types.get(c.parameter) === "Trigger") {
        this.triggers.delete(c.parameter);
      }
    }
  }

  private evaluate(c: AnimatorCondition): boolean {
    const type = this.types.get(c.parameter);
    if (!type) return false;

    switch (type) {
      case "Bool": {
        const v = this.bools.get(c.parameter) ?? false;
        if (c.mode === "If") return v === true;
        if (c.mode === "IfNot") return v === false;
        return false;
      }
      case "Trigger": {
        // Trigger は If/IfNot のみが意味を持つ (Unity に倣う)
        const fired = this.triggers.has(c.parameter);
        if (c.mode === "If") return fired;
        if (c.mode === "IfNot") return !fired;
        return false;
      }
      case "Float": {
        const v = this.floats.get(c.parameter) ?? 0;
        return compareNumeric(v, c.mode, c.threshold);
      }
      case "Int": {
        const v = this.ints.get(c.parameter) ?? 0;
        return compareNumeric(v, c.mode, c.threshold);
      }
    }
  }

  private assertType(name: string, expected: AnimatorParameterType): void {
    const actual = this.types.get(name);
    if (actual !== expected) {
      throw new Error(
        `Parameter '${name}' is ${actual ?? "undefined"}, not ${expected}`,
      );
    }
  }
}

function compareNumeric(
  v: number,
  mode: AnimatorCondition["mode"],
  threshold: number,
): boolean {
  switch (mode) {
    case "Greater":
      return v > threshold;
    case "Less":
      return v < threshold;
    case "Equals":
      return v === threshold;
    case "NotEqual":
      return v !== threshold;
    default:
      return false;
  }
}
