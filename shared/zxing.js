let reader, writer;
export async function readQr(input) {
  if (!reader) {
    reader = import('/vendor/zxing-reader.js').then(module => {
      module.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_reader.wasm' } });
      return module;
    }).catch(error => { reader = undefined; throw error; });
  }
  return (await reader).readBarcodes(input, { formats: ['QRCode'], tryHarder: true, maxNumberOfSymbols: 1 });
}
export async function qrImage(code) {
  if (!writer) {
    writer = import('/vendor/zxing-writer.js').then(module => {
      module.prepareZXingModule({ overrides: { locateFile: () => '/vendor/zxing_writer.wasm' } });
      return module;
    }).catch(error => { writer = undefined; throw error; });
  }
  const result = await (await writer).writeBarcode(code, { format: 'QRCode', scale: 6, options: 'ecLevel=M' });
  if (result.error || !result.image) throw new Error('二维码生成失败，请稍后重试');
  return result.image;
}
