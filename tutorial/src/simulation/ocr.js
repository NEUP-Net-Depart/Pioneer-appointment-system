export async function recognizeSerialPhoto(_file, { onProgress } = {}) {
  onProgress?.('正在识别演示标签…');
  return { candidates: ['PF4DEMO26'], text: 'S/N: PF4DEMO26', confidence: 99, labelled: true };
}
