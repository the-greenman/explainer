import { intro } from './intro.ts';
import { numberedList } from './numbered-list.ts';
import { choice } from './choice.ts';
import { scene } from './scene.ts';
import type { Component } from './base.ts';

export * from './base.ts';
export * from './canvas.ts';
export { scene, sceneStillP, choreoOf, fxProgress, findSceneTemplate, SCENE_FX } from './scene.ts';
export const corePack: Component[] = [intro, numberedList, choice, scene];
