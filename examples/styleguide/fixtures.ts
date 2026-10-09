// Fixture content for every component in this repo (core pack + examples/video): one cue's data and items, so a component
// can be rendered on its own. Shared by test/still.test.ts (the still frame is complete) and the styleguide page.
// Text is public content from the first explainer (guide 1.1, Decision Recording) so frames read as design review.
// A component with no entry here fails the "has a fixture" test, so adding a component means adding its fixture.
export type Fx = { data: any; items: any[]; dur?: number };
export const NS = 'com.semanticops.explainer';
export const fixtures: Record<string, Fx> = {
  [`${NS}/intro@1`]: { data: { title: 'Decision Recording', subtitle: 'Four questions that make a decision stick', presenter: 'A guide to decision-making' }, items: [] },
  [`${NS}/numbered-list@1`]: { data: { heading: 'Four questions' }, items: ['What was decided?', 'Why?', { text: 'What were the options?' }, 'When to revisit?'] },
  [`${NS}/choice@1`]: { data: { prompt: 'Want to see one filled in?' }, items: [{ id: 'example', label: 'See an example' }, { id: 'watch-outs', label: 'Skip to the watch-outs' }, { id: 'replay', label: 'Replay the four questions' }] },
  [`${NS}.example/cycle@1`]: { data: { caption: 'Round and round' }, items: [{ label: 'Debate' }, { label: 'Decide?' }, { label: 'Forget' }, { label: 'Repeat' }] },
  [`${NS}.example/emphasis@1`]: { data: {}, items: [{ text: 'clear', at: 0.2 }, { text: 'visible', at: 1 }, { text: 'useful', at: 1.8 }] },
};
/** Cue length in seconds unless a fixture says otherwise. */
export const DUR = 10;
