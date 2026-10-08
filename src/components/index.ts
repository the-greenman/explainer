import { intro } from './intro.ts';
import { numberedList } from './numbered-list.ts';
import { choice } from './choice.ts';
import type { Component } from './base.ts';

export * from './base.ts';
export * from './canvas.ts';
export const corePack: Component[] = [intro, numberedList, choice];
