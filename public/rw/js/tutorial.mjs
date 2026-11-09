// 拾径 · Wordloom — 新手引导（纯逻辑）
//
// 首次进入时展示 3 步教学，完成后写入本地标记，不再重复打扰。
// 文案通过 i18n key 提供，便于中英双语。

export const TUTORIAL_DONE_KEY = 'rw-tutorial-done';

export const TUTORIAL_STEPS = [
  { icon: '◎', key: 'tutorial.step1' },
  { icon: '✋', key: 'tutorial.step2' },
  { icon: '1024', key: 'tutorial.step3' },
];

/** 本地标记解析：只认 '1'。 */
export function parseTutorialDone(raw) {
  return raw === '1';
}

/** 是否需要展示引导。 */
export function shouldShowTutorial(done) {
  return done !== true;
}

/** 完成标记的存储值。 */
export function tutorialDoneValue() {
  return '1';
}
